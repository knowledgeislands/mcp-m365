/**
 * Parser for the v1 routing-rule DSL.
 *
 * Grammar (from the Email Routing Engine Design note):
 *
 *   file      := header line*
 *   header    := "rules v1"                       (from the fence info string)
 *   line      := comment | blank | rule
 *   rule      := andexpr ( "|" andexpr )* "->" action ( "," action )* comment?
 *   andexpr   := term+                            (juxtaposition = AND)
 *   term      := "!"? predicate | "*"
 *   predicate := key ":" value
 *   value     := bareword | quoted                (quoted when it contains spaces)
 *
 * `|` binds across whole AND-groups: `a b | c` is `(a AND b) OR (c)`. There are
 * no parentheses — a rule that would need them is written as two rules.
 *
 * Parsing never throws on a malformed rule: errors are collected with line
 * numbers so `email_rules_lint` can report every problem in one pass. Callers
 * that mutate a mailbox (`email_triage_run`, `email_aged_run`) must refuse to
 * run while `errors` is non-empty.
 */
import {
  type Action,
  type AndGroup,
  IMPORTANCE_VALUES,
  MARK_VALUES,
  type ParseError,
  type ParseResult,
  PREDICATE_KEYS,
  type PredicateKey,
  type Rule,
  type RuleBlock,
  STATUS_VALUES,
  type Term,
  TYPE_VALUES
} from './types.js'

/** The only grammar version this engine understands. Anything else is rejected rather than guessed at. */
export const SUPPORTED_VERSION = 'v1'

const FENCE_RE = /^```rules\s+(\S+)\s*$/
const HEADING_RE = /^#{1,6}\s+(.+?)\s*$/
const BARE_HEADER_RE = /^rules\s+(\S+)$/
const AGE_RE = /^(\d+)d$/

/**
 * Split `text` on every occurrence of `sep` that falls outside double quotes.
 * Used for `|` (OR-groups), `,` (actions) and `->` (the predicate/action split)
 * so a separator inside a quoted value — `subject:"a, b"` — is left alone.
 */
export const splitOutsideQuotes = (text: string, sep: string): string[] => {
  const parts: string[] = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    if (ch === '"') inQuote = !inQuote
    if (!inQuote && text.startsWith(sep, i)) {
      parts.push(current)
      current = ''
      i += sep.length - 1
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

/** Index of the first `#` outside double quotes, or -1. */
const commentIndex = (text: string): number => {
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') inQuote = !inQuote
    else if (ch === '#' && !inQuote) return i
  }
  return -1
}

/** Split a physical or logical line into its body and trailing `# comment`. */
export const stripComment = (text: string): { body: string; comment?: string } => {
  const idx = commentIndex(text)
  if (idx === -1) return { body: text }
  return { body: text.slice(0, idx), comment: text.slice(idx + 1).trim() }
}

/** Whitespace-separated tokens, respecting double-quoted spans. Quote characters are retained so the caller can tell a quoted value from a bareword. */
const tokenise = (text: string): string[] => {
  const tokens: string[] = []
  let current = ''
  let inQuote = false
  for (const ch of text) {
    if (ch === '"') {
      inQuote = !inQuote
      current += ch
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (current) tokens.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

/** Strip surrounding double quotes, reporting whether they were present. */
const unquote = (raw: string): { value: string; quoted: boolean } => {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return { value: raw.slice(1, -1), quoted: true }
  return { value: raw, quoted: false }
}

const isPredicateKey = (key: string): key is PredicateKey => (PREDICATE_KEYS as readonly string[]).includes(key)

/** Enumerated-value validation. Returns an error message, or null when the value is acceptable for that key. */
const validateValue = (key: PredicateKey, value: string): string | null => {
  if (key === 'type' && !(TYPE_VALUES as readonly string[]).includes(value))
    return `invalid type: "${value}" (expected ${TYPE_VALUES.join(', ')})`
  if (key === 'importance' && !(IMPORTANCE_VALUES as readonly string[]).includes(value))
    return `invalid importance: "${value}" (expected ${IMPORTANCE_VALUES.join(', ')})`
  if (key === 'status' && !(STATUS_VALUES as readonly string[]).includes(value))
    return `invalid status: "${value}" (expected ${STATUS_VALUES.join(', ')})`
  if (key === 'age' && !AGE_RE.test(value)) return `invalid age: "${value}" (expected Nd, e.g. 7d)`
  return null
}

/** Parse one whitespace-separated token into a term, or return an error message. */
const parseTerm = (token: string): { term: Term } | { error: string } => {
  const negated = token.startsWith('!')
  const rest = negated ? token.slice(1) : token

  if (rest === '*') {
    if (negated) return { error: 'the match-everything term `*` cannot be negated' }
    return { term: { kind: 'any' } }
  }

  const colon = rest.indexOf(':')
  if (colon <= 0) return { error: `expected key:value, got "${token}"` }

  const key = rest.slice(0, colon)
  if (!isPredicateKey(key)) return { error: `unknown predicate key "${key}" (expected ${PREDICATE_KEYS.join(', ')})` }

  const { value, quoted } = unquote(rest.slice(colon + 1))
  if (!value) return { error: `empty value for "${key}:"` }

  const invalid = validateValue(key, value)
  if (invalid) return { error: invalid }

  return { term: { kind: 'predicate', key, value, quoted, negated } }
}

/** Parse the predicate side of a rule into its OR-groups. */
const parsePredicates = (text: string): { groups: AndGroup[] } | { error: string } => {
  const groups: AndGroup[] = []
  for (const groupText of splitOutsideQuotes(text, '|')) {
    const tokens = tokenise(groupText.trim())
    if (tokens.length === 0) return { error: 'empty predicate group — check for a stray `|`' }
    const terms: Term[] = []
    for (const token of tokens) {
      const parsed = parseTerm(token)
      if ('error' in parsed) return { error: parsed.error }
      terms.push(parsed.term)
    }
    groups.push({ terms })
  }

  const anyTerms = groups.flatMap((g) => g.terms).filter((t) => t.kind === 'any')
  if (anyTerms.length > 0 && (groups.length > 1 || (groups[0] as AndGroup).terms.length > 1)) {
    return { error: 'the match-everything term `*` is only valid as a rule’s sole term' }
  }

  return { groups }
}

/**
 * Parse the action side of a rule. Action values are read up to the next
 * comma rather than tokenised, because folder names carry spaces unquoted
 * (`move:111 Partner`).
 */
const parseActions = (text: string): { actions: Action[] } | { error: string } => {
  const actions: Action[] = []
  for (const raw of splitOutsideQuotes(text, ',')) {
    const chunk = raw.trim()
    if (!chunk) return { error: 'empty action — check for a stray `,`' }

    if (chunk === 'delete' || chunk === 'suggest') {
      actions.push({ kind: chunk })
      continue
    }

    const colon = chunk.indexOf(':')
    if (colon <= 0) return { error: `expected an action of the form move:/tag:/mark:/delete/suggest, got "${chunk}"` }

    const kind = chunk.slice(0, colon)
    const { value, quoted } = unquote(chunk.slice(colon + 1).trim())
    if (!value) return { error: `empty value for "${kind}:"` }

    if (kind === 'mark') {
      if (!(MARK_VALUES as readonly string[]).includes(value))
        return { error: `invalid mark: "${value}" (expected ${MARK_VALUES.join(', ')})` }
      actions.push({ kind: 'mark', value })
      continue
    }
    if (kind === 'move' || kind === 'tag') {
      actions.push({ kind, value, quoted })
      continue
    }
    return { error: `unknown action "${kind}"` }
  }
  return { actions }
}

/** A logical rule line, reassembled from one or more physical lines (a rule may wrap before `->`). */
interface LogicalLine {
  line: number
  text: string
}

/**
 * Fold physical lines into logical ones. A rule may wrap before its `->`, so
 * lines accumulate until one carries the arrow. Blank and comment lines are
 * formatting only and are dropped — but only while no rule is part-assembled,
 * so a wrapped rule is never silently split by a blank line.
 */
export const assembleLines = (lines: string[], offset: number): { logical: LogicalLine[]; errors: ParseError[] } => {
  const logical: LogicalLine[] = []
  const errors: ParseError[] = []
  let buffer = ''
  let bufferLine = 0

  lines.forEach((raw, index) => {
    const lineNo = offset + index + 1
    const trimmed = raw.trim()
    if (!buffer) {
      if (!trimmed || trimmed.startsWith('#')) return
      bufferLine = lineNo
    }
    buffer = buffer ? `${buffer} ${trimmed}` : trimmed
    if (splitOutsideQuotes(stripComment(buffer).body, '->').length > 1) {
      logical.push({ line: bufferLine, text: buffer })
      buffer = ''
    }
  })

  if (buffer)
    errors.push({ line: bufferLine, message: 'rule has no `->` — expected `predicates -> actions`', source: buffer })
  return { logical, errors }
}

/** Parse one already-assembled logical line into a rule. */
export const parseRule = (logical: LogicalLine): { rule: Rule } | { error: ParseError } => {
  const { body, comment } = stripComment(logical.text)
  const halves = splitOutsideQuotes(body, '->')
  if (halves.length > 2) {
    return { error: { line: logical.line, message: 'more than one `->` in a rule', source: logical.text } }
  }

  const predicateText = (halves[0] as string).trim()
  const actionText = (halves[1] as string).trim()
  if (!predicateText)
    return { error: { line: logical.line, message: 'rule has no predicates before `->`', source: logical.text } }
  if (!actionText)
    return { error: { line: logical.line, message: 'rule has no actions after `->`', source: logical.text } }

  const predicates = parsePredicates(predicateText)
  if ('error' in predicates) return { error: { line: logical.line, message: predicates.error, source: logical.text } }

  const actions = parseActions(actionText)
  if ('error' in actions) return { error: { line: logical.line, message: actions.error, source: logical.text } }

  const rule: Rule = { line: logical.line, groups: predicates.groups, actions: actions.actions, source: logical.text }
  if (comment !== undefined) rule.comment = comment
  return { rule }
}

/** A fenced block located in the source, before its rules are parsed. */
interface RawBlock {
  label: string
  version: string
  startLine: number
  lines: string[]
  /** Whether a closing fence was found. An unterminated block may be truncated, so its rules are not trusted. */
  closed: boolean
}

/**
 * Locate the ```rules fenced blocks in a markdown source, labelling each with
 * its nearest preceding heading (`## Inbound` → `inbound`). Labelling by
 * heading rather than position means the note can gain sections without
 * silently re-pointing a tool at the wrong block.
 */
const findFencedBlocks = (lines: string[]): RawBlock[] => {
  const blocks: RawBlock[] = []
  let heading = ''
  let index = 0

  while (index < lines.length) {
    const line = lines[index] as string
    const headingMatch = HEADING_RE.exec(line)
    if (headingMatch) {
      heading = (headingMatch[1] as string).toLowerCase()
      index++
      continue
    }
    const fence = FENCE_RE.exec(line.trim())
    if (!fence) {
      index++
      continue
    }

    const startLine = index + 1
    const body: string[] = []
    index++
    while (index < lines.length && (lines[index] as string).trim() !== '```') {
      body.push(lines[index] as string)
      index++
    }
    const closed = index < lines.length
    index++
    blocks.push({
      label: heading || `block${blocks.length + 1}`,
      version: fence[1] as string,
      startLine,
      lines: body,
      closed
    })
  }

  return blocks
}

/**
 * Parse a rule source. Accepts either the whole knowledge-base note (rules are
 * read from its ```rules fences) or a bare rule list introduced by a `rules v1`
 * header line.
 */
export const parseRules = (source: string): ParseResult => {
  const lines = source.split(/\r?\n/)
  const errors: ParseError[] = []
  let raw = findFencedBlocks(lines)

  if (raw.length === 0) {
    const headerIndex = lines.findIndex((l) => l.trim() !== '')
    const header = headerIndex === -1 ? null : BARE_HEADER_RE.exec((lines[headerIndex] as string).trim())
    if (!header) {
      return {
        blocks: [],
        errors: [{ line: 1, message: 'no ```rules block found and no `rules <version>` header line' }]
      }
    }
    raw = [
      {
        label: 'default',
        version: header[1] as string,
        startLine: headerIndex + 1,
        lines: lines.slice(headerIndex + 1),
        closed: true
      }
    ]
  }

  const blocks: RuleBlock[] = []
  for (const block of raw) {
    // A block with no closing fence may have been truncated mid-list, so the
    // rules that ARE present cannot be trusted to be the whole ordered list —
    // and order is the entire specification. Refuse it rather than run a
    // partial rule set: `parse-error` is a blocking code for the mutating tools.
    if (!block.closed) {
      errors.push({
        line: block.startLine,
        message: 'unterminated ```rules block — no closing fence, so the rule list may be truncated'
      })
      continue
    }
    if (block.version !== SUPPORTED_VERSION) {
      errors.push({
        line: block.startLine,
        message: `unsupported rules version "${block.version}" — this engine understands ${SUPPORTED_VERSION} only`
      })
      continue
    }

    const { logical, errors: assemblyErrors } = assembleLines(block.lines, block.startLine)
    errors.push(...assemblyErrors)

    const rules: Rule[] = []
    for (const line of logical) {
      const parsed = parseRule(line)
      if ('error' in parsed) errors.push(parsed.error)
      else rules.push(parsed.rule)
    }

    blocks.push({ label: block.label, version: block.version, rules, startLine: block.startLine })
  }

  return { blocks, errors }
}

/**
 * Pick the block a tool should run against. Matches on label, falling back to
 * the sole block when a caller passes a bare rule list rather than the note.
 */
export const selectBlock = (result: ParseResult, label: string): { block: RuleBlock } | { error: string } => {
  const match = result.blocks.find((b) => b.label === label.toLowerCase())
  if (match) return { block: match }
  if (result.blocks.length === 1) return { block: result.blocks[0] as RuleBlock }
  const labels = result.blocks.map((b) => b.label)
  return { error: `no "${label}" rules block found (blocks present: ${labels.length ? labels.join(', ') : 'none'})` }
}

/** Render an AND-group back to DSL text — used as the `ruleset` field in tracking and in lint findings. */
export const renderGroup = (group: AndGroup): string =>
  group.terms
    .map((term) => {
      if (term.kind === 'any') return '*'
      const value = term.quoted ? `"${term.value}"` : term.value
      return `${term.negated ? '!' : ''}${term.key}:${value}`
    })
    .join(' ')

/** Render a whole rule's predicate side, OR-groups included. */
export const renderPredicates = (rule: Rule): string => rule.groups.map(renderGroup).join(' | ')

/** Render an action back to DSL text. */
export const renderAction = (action: Action): string => {
  if (action.value === undefined) return action.kind
  return `${action.kind}:${action.quoted ? `"${action.value}"` : action.value}`
}
