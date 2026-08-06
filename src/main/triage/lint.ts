/**
 * Static checks over a parsed rule list.
 *
 * The rule file is a flat, ordered, first-match-wins list, so almost every
 * defect it can carry is an ordering defect — a rule that can never fire, or a
 * broad rule sitting above the specific rules it will swallow. Those are the
 * two checks that matter; the rest are hygiene.
 *
 * No mailbox access: lint is a pure function of the rule text (plus, optionally,
 * a caller-supplied list of folders that exist).
 */

import { resolveMoveTarget } from './folders.js'
import { renderAction, renderGroup, renderPredicates } from './parser.js'
import { type AndGroup, BROAD_KEYS, type ParseResult, type PredicateKey, type PredicateTerm, type Rule, type RuleBlock, type Term } from './types.js'

export type LintSeverity = 'error' | 'warning' | 'info'

export interface LintFinding {
  severity: LintSeverity
  code: string
  /** 1-based line number in the source. */
  line: number
  message: string
  source?: string
}

export interface LintOptions {
  /**
   * Folder paths known to exist. When supplied, every `move:` target is checked
   * against it. Omitted (the default) the check is skipped — the server holds no
   * folder state, so the caller passes the taxonomy it considers canonical.
   */
  knownFolders?: readonly string[]
  /** Block labels that must end in a `*` fallback rule. Defaults to `['inbound']`. */
  requireFallbackIn?: readonly string[]
}

/** A rule comment carrying this marker suppresses its broad-rule collision finding. */
export const ALLOW_COLLISION = 'lint:allow-collision'

const ADDRESS_KEYS: readonly PredicateKey[] = ['party', 'sender', 'to', 'cc']
const TEXT_KEYS: readonly PredicateKey[] = ['subject', 'body']

const isPredicate = (term: Term): term is PredicateTerm => term.kind === 'predicate'

/** Does every address matching `narrow` also match `broad`? Conservative — an unclear case returns false. */
const patternSubsumes = (broad: string, narrow: string): boolean => {
  const b = broad.toLowerCase()
  const n = narrow.toLowerCase()
  if (b === n) return true

  const bAt = b.lastIndexOf('@')
  const nAt = n.lastIndexOf('@')
  if (bAt === -1 || nAt === -1) return false

  const bDomain = b.slice(bAt + 1)
  const nDomain = n.slice(nAt + 1)
  const domainOk = bDomain.startsWith('*.') ? nDomain === bDomain.slice(2) || nDomain.endsWith(`.${bDomain.slice(2)}`) : bDomain === nDomain
  if (!domainOk) return false

  const bLocal = b.slice(0, bAt)
  return bLocal === '*' || bLocal === n.slice(0, nAt)
}

/**
 * Does term `u` holding guarantee term `t` holds? Used to decide whether an
 * earlier rule already claims everything a later rule was written for.
 */
const implies = (u: PredicateTerm, t: PredicateTerm): boolean => {
  if (u.key === t.key && u.value.toLowerCase() === t.value.toLowerCase()) return true
  if (ADDRESS_KEYS.includes(t.key) && ADDRESS_KEYS.includes(u.key)) {
    // A direction-specific match implies the direction-agnostic `party:`; the reverse does not hold.
    if (t.key !== 'party' && t.key !== u.key) return false
    return patternSubsumes(t.value, u.value)
  }
  // A longer phrase contains a shorter one: matching `subject:"BFBS Follow"` guarantees matching `subject:BFBS`.
  if (u.key === t.key && TEXT_KEYS.includes(t.key)) return u.value.toLowerCase().includes(t.value.toLowerCase())
  return false
}

/**
 * Does group `h` claim everything group `g` claims? True when every condition
 * `h` imposes is already guaranteed by some condition of `g`.
 *
 * A negated term in `h` makes the answer unknowable here, so we answer false —
 * lint would rather miss a shadow than invent one.
 */
export const groupSubsumes = (h: AndGroup, g: AndGroup): boolean => {
  if (h.terms.some((term) => isPredicate(term) && term.negated)) return false
  return h.terms.every((t) => {
    if (t.kind === 'any') return true
    return g.terms.some((u) => isPredicate(u) && !u.negated && implies(u, t))
  })
}

/** Is `later` unreachable because `earlier` already claims every message it would match? */
export const ruleShadows = (earlier: Rule, later: Rule): boolean =>
  later.groups.length > 0 && later.groups.every((g) => earlier.groups.some((h) => groupSubsumes(h, g)))

/** A rule built only from content-agnostic predicates — it cuts across every topic below it. */
const isBroad = (rule: Rule): boolean =>
  rule.groups.length > 0 &&
  rule.groups.every((group) => group.terms.length > 0 && group.terms.every((term) => isPredicate(term) && BROAD_KEYS.includes(term.key)))

const isFallback = (rule: Rule): boolean => rule.groups.length === 1 && (rule.groups[0] as AndGroup).terms.every((term) => term.kind === 'any')

const destinationOf = (rule: Rule): string | null => {
  const move = rule.actions.find((action) => action.kind === 'move')
  return move ? resolveMoveTarget(move) : null
}

/** Canonical text for a rule, used to spot exact duplicates regardless of spacing or comments. */
const canonical = (rule: Rule): string => `${renderPredicates(rule)} -> ${rule.actions.map(renderAction).join(', ')}`.toLowerCase()

const checkFallback = (block: RuleBlock, findings: LintFinding[]): void => {
  const { rules } = block
  const last = rules[rules.length - 1]
  if (!last || !isFallback(last)) {
    findings.push({
      severity: 'error',
      code: 'missing-fallback',
      line: last ? last.line : block.startLine,
      message: `the "${block.label}" block must end with the fallback rule \`* -> move:000 Unknown, suggest\` so no message is ever silently unclassified`
    })
  }
  rules.forEach((rule, index) => {
    if (isFallback(rule) && index !== rules.length - 1) {
      findings.push({
        severity: 'error',
        code: 'misplaced-fallback',
        line: rule.line,
        message: `the match-everything rule is at position ${index + 1} of ${rules.length} — every rule below it is unreachable`,
        source: rule.source
      })
    }
  })
}

const checkDuplicates = (rules: readonly Rule[], findings: LintFinding[]): void => {
  const seen = new Map<string, Rule>()
  for (const rule of rules) {
    const key = canonical(rule)
    const first = seen.get(key)
    if (first) {
      findings.push({
        severity: 'warning',
        code: 'duplicate-rule',
        line: rule.line,
        message: `duplicates the rule at line ${first.line}`,
        source: rule.source
      })
      continue
    }
    seen.set(key, rule)
  }
}

const checkShadowing = (rules: readonly Rule[], findings: LintFinding[]): void => {
  for (let i = 0; i < rules.length; i++) {
    const later = rules[i] as Rule
    if (isFallback(later)) continue
    for (let j = 0; j < i; j++) {
      const earlier = rules[j] as Rule
      if (!ruleShadows(earlier, later)) continue
      const earlierDest = destinationOf(earlier)
      const laterDest = destinationOf(later)
      findings.push({
        severity: 'error',
        code: 'shadowed-rule',
        line: later.line,
        message:
          `unreachable: the rule at line ${earlier.line} (\`${renderPredicates(earlier)}\`) already claims every message this would match` +
          (earlierDest && laterDest && earlierDest !== laterDest ? ` — mail intended for "${laterDest}" is going to "${earlierDest}"` : ''),
        source: later.source
      })
      break
    }
  }
}

/**
 * Broad rules (`type:`, `status:`, `importance:`, `age:` only) claim mail
 * across every topic below them. That is usually deliberate — but it is also
 * exactly how calendar invites for project mail ended up in the action folder
 * instead of their project folder, so each one is reported once with the
 * destinations it can pre-empt. Add `# lint:allow-collision` to the rule once
 * the precedence is a considered decision.
 */
const checkBroadCollisions = (rules: readonly Rule[], findings: LintFinding[]): void => {
  rules.forEach((rule, index) => {
    if (!isBroad(rule) || rule.comment?.includes(ALLOW_COLLISION)) return
    const own = destinationOf(rule)
    const preempted = new Set<string>()
    for (let j = index + 1; j < rules.length; j++) {
      const later = rules[j] as Rule
      if (isFallback(later) || isBroad(later)) continue
      const dest = destinationOf(later)
      if (dest && dest !== own) preempted.add(dest)
    }
    if (preempted.size === 0) return
    const sample = [...preempted].slice(0, 5).join(', ')
    findings.push({
      severity: 'info',
      code: 'broad-rule-collision',
      line: rule.line,
      message:
        `broad rule — any message it matches goes to "${own ?? 'its actions'}" even when a later rule was written for it ` +
        `(${preempted.size} other destination${preempted.size === 1 ? '' : 's'} below: ${sample}${preempted.size > 5 ? ', …' : ''}). ` +
        `Add \`# ${ALLOW_COLLISION}\` once this precedence is intended.`,
      source: rule.source
    })
  })
}

/**
 * A `sender:` and a `to:`/`cc:` rule over the same domain with the same
 * destination are one `party:` rule written twice.
 */
const checkPartyConsolidation = (rules: readonly Rule[], findings: LintFinding[]): void => {
  const byDomainDest = new Map<string, { rule: Rule; key: PredicateKey }[]>()
  for (const rule of rules) {
    const dest = destinationOf(rule)
    if (!dest) continue
    for (const group of rule.groups) {
      if (group.terms.length !== 1) continue
      const [term] = group.terms
      if (!term || !isPredicate(term) || term.negated) continue
      if (term.key !== 'sender' && term.key !== 'to' && term.key !== 'cc') continue
      const key = `${term.value.toLowerCase()}::${dest}`
      const bucket = byDomainDest.get(key) ?? []
      bucket.push({ rule, key: term.key })
      byDomainDest.set(key, bucket)
    }
  }

  for (const [key, bucket] of byDomainDest) {
    const directions = new Set(bucket.map((b) => b.key))
    if (!directions.has('sender') || directions.size < 2) continue
    const last = bucket[bucket.length - 1] as { rule: Rule; key: PredicateKey }
    const pattern = key.split('::')[0] as string
    findings.push({
      severity: 'info',
      code: 'party-consolidation',
      line: last.rule.line,
      message: `\`${[...directions].sort().join('`/`')}\` rules for ${pattern} share a destination — a single \`party:${pattern}\` rule would cover them`,
      source: last.rule.source
    })
  }
}

const checkAddressPatterns = (rules: readonly Rule[], findings: LintFinding[]): void => {
  for (const rule of rules) {
    for (const group of rule.groups) {
      for (const term of group.terms) {
        if (!isPredicate(term) || !ADDRESS_KEYS.includes(term.key) || term.value.includes('@')) continue
        findings.push({
          severity: 'warning',
          code: 'malformed-address',
          line: rule.line,
          message: `\`${renderGroup(group)}\` — \`${term.key}:\` expects an address or \`*@domain\`; "${term.value}" has no \`@\` and will never match`,
          source: rule.source
        })
      }
    }
  }
}

const checkFolders = (rules: readonly Rule[], known: readonly string[], findings: LintFinding[]): void => {
  const normalised = new Set(known.map((f) => f.toLowerCase()))
  for (const rule of rules) {
    for (const action of rule.actions) {
      if (action.kind !== 'move') continue
      const target = resolveMoveTarget(action)
      if (normalised.has(target.toLowerCase())) continue
      findings.push({
        severity: 'error',
        code: 'unknown-folder',
        line: rule.line,
        message: `move target "${target}" is not among the ${known.length} known folders`,
        source: rule.source
      })
    }
  }
}

/** Run every static check over a parsed rule source. Findings are ordered by line. */
export const lintRules = (parsed: ParseResult, options: LintOptions = {}): LintFinding[] => {
  const findings: LintFinding[] = parsed.errors.map((error) => ({
    severity: 'error' as const,
    code: 'parse-error',
    line: error.line,
    message: error.message,
    ...(error.source === undefined ? {} : { source: error.source })
  }))

  const requireFallbackIn = options.requireFallbackIn ?? ['inbound']

  for (const block of parsed.blocks) {
    if (requireFallbackIn.includes(block.label)) checkFallback(block, findings)
    checkDuplicates(block.rules, findings)
    checkShadowing(block.rules, findings)
    checkBroadCollisions(block.rules, findings)
    checkPartyConsolidation(block.rules, findings)
    checkAddressPatterns(block.rules, findings)
    if (options.knownFolders) checkFolders(block.rules, options.knownFolders, findings)
  }

  return findings.sort((a, b) => a.line - b.line)
}
