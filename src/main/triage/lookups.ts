/**
 * Cross-message lookups: where is this message's conversation already filed,
 * and has the mailbox owner forwarded it?
 *
 * Pure, like the parser and matcher. The run layer fetches a conversation's
 * messages, or the candidate forward copies, from Graph and hands them here as
 * plain data; this module decides what they mean.
 *
 * Thread-follow: which folders count as "filed", and which one a reply follows.
 *
 * "Filed" is read from the rule file, never configured separately, so the
 * answer moves with the rules:
 *
 * - every `move:` target in the inbound block is filed, except the fallback's
 *   — a sibling in `000 Unknown` says nothing about where the thread belongs;
 * - every archive an aged-block rule feeds from `folder:X` stands for
 *   `_TRIAGE/X`, so a reply to long-archived mail returns to the live folder
 *   rather than the archive. An archive fed from two filed folders cannot say
 *   which, so a sibling there is skipped and reported.
 */
import { isThreadTarget, resolveMoveTarget } from './folders.js'
import { evaluateTerm, type MatchContext } from './matcher.js'
import { identityKey } from './tracking.js'
import type {
  Action,
  AndGroup,
  EmailRecord,
  ForwardMatch,
  PredicateTerm,
  Rule,
  RuleBlock,
  Term,
  ThreadFiling
} from './types.js'

/** The folders a sibling can be found in, and what each one means for a reply. */
export interface FiledFolders {
  /** Lower-cased folder path → the full path a reply to a sibling there is routed to. */
  targets: ReadonlyMap<string, string>
  /** Lower-cased archive paths fed from more than one filed folder. */
  ambiguous: ReadonlySet<string>
}

/** A conversation member, reduced to identity plus where it sits now. */
export interface ThreadSibling {
  subject: string
  from: string
  received: string
  /** Full folder path, original casing. */
  folder: string
}

const isFallback = (rule: Rule): boolean => rule.groups.every((group) => group.terms.every((t) => t.kind === 'any'))

/** Concrete `move:` targets of a rule, as full paths. `@thread` is not a place. */
const moveTargets = (rule: Rule): string[] =>
  rule.actions.filter((action) => action.kind === 'move' && !isThreadTarget(action)).map(resolveMoveTarget)

/** The inbound block by label, or the sole block of a bare rule list. */
const inboundOf = (blocks: readonly RuleBlock[]): RuleBlock | undefined =>
  blocks.find((block) => block.label === 'inbound') ?? (blocks.length === 1 ? blocks[0] : undefined)

/** Derive the filed folders from a parsed rule file. */
export const filedFolders = (blocks: readonly RuleBlock[]): FiledFolders => {
  const targets = new Map<string, string>()
  const ambiguous = new Set<string>()

  const inbound = inboundOf(blocks)
  if (!inbound) return { targets, ambiguous }

  const unfiled = new Set(
    inbound.rules
      .filter(isFallback)
      .flatMap(moveTargets)
      .map((p) => p.toLowerCase())
  )
  for (const rule of inbound.rules) {
    if (isFallback(rule)) continue
    for (const target of moveTargets(rule))
      if (!unfiled.has(target.toLowerCase())) targets.set(target.toLowerCase(), target)
  }

  // Archive → the filed `_TRIAGE` folders that age into it.
  const feeders = new Map<string, Set<string>>()
  for (const rule of blocks.find((block) => block.label === 'aged')?.rules ?? []) {
    const archives = moveTargets(rule)
    for (const group of rule.groups)
      for (const term of group.terms) {
        if (term.kind !== 'predicate' || term.key !== 'folder' || term.negated) continue
        const feeder = targets.get(resolveMoveTarget({ kind: 'move', value: term.value }).toLowerCase())
        if (!feeder) continue
        for (const archive of archives) {
          const set = feeders.get(archive) ?? new Set<string>()
          set.add(feeder)
          feeders.set(archive, set)
        }
      }
  }

  for (const [archive, from] of feeders) {
    const key = archive.toLowerCase()
    if (targets.has(key)) continue
    if (from.size === 1) targets.set(key, [...from][0] as string)
    else ambiguous.add(key)
  }

  return { targets, ambiguous }
}

const receivedAt = (sibling: ThreadSibling): number => {
  const at = Date.parse(sibling.received)
  return Number.isNaN(at) ? Number.NEGATIVE_INFINITY : at
}

/**
 * Choose where a message's conversation is filed.
 *
 * The message itself is excluded by identity — subject, sender and received
 * time — not by Graph id, which a move reissues. The most recent filed sibling
 * decides; other filed folders are reported as alternatives so a split thread
 * is visible. Null when no sibling is filed.
 */
export const resolveThread = (
  self: Pick<EmailRecord, 'subject' | 'from' | 'received'>,
  siblings: readonly ThreadSibling[],
  filed: FiledFolders
): ThreadFiling | null => {
  const own = identityKey(self)
  const ordered = siblings
    .filter((sibling) => identityKey(sibling) !== own)
    .map((sibling, index) => ({ sibling, index }))
    .sort((a, b) => receivedAt(b.sibling) - receivedAt(a.sibling) || a.index - b.index)

  const resolved: string[] = []
  const skipped: string[] = []
  for (const { sibling } of ordered) {
    const key = sibling.folder.toLowerCase()
    const target = filed.targets.get(key)
    if (target) {
      if (!resolved.includes(target)) resolved.push(target)
    } else if (filed.ambiguous.has(key) && !skipped.includes(sibling.folder)) {
      skipped.push(sibling.folder)
    }
  }

  const [folder, ...alternatives] = resolved
  return folder ? { folder, alternatives, skipped } : null
}

/**
 * Index of the first rule that tests `thread:`, negated or not, or -1.
 *
 * The run layer looks a conversation up only when classification without it
 * lands at or below this rule: every rule above it ignores the thread, so its
 * verdict cannot change, and a file with no `thread:` rule costs no lookup.
 */
export const firstThreadRule = (rules: readonly Rule[]): number =>
  rules.findIndex((rule) =>
    rule.groups.some((group) => group.terms.some((term) => term.kind === 'predicate' && term.key === 'thread'))
  )

/**
 * Replace `move:@thread` with the resolved folder, as an absolute target, so
 * the report, the tracking entry and the move all see a concrete path. With no
 * folder the actions are returned unchanged; lint refuses any rule that could
 * reach `@thread` without `thread:filed`, so that case does not run.
 */
export const bindThreadTarget = (actions: readonly Action[], folder: string | undefined): readonly Action[] =>
  folder
    ? actions.map((action): Action => (isThreadTarget(action) ? { kind: 'move', value: folder, quoted: true } : action))
    : actions

/** How long after the original a forward still counts as handing it on. */
export const FORWARD_WINDOW_DAYS = 90

const MS_PER_DAY = 86_400_000
const REPLY_PREFIX_RE = /^\s*(?:re|fwd?)\s*:\s*/i
const FORWARD_PREFIX_RE = /^\s*fwd?\s*:/i

/** A subject with every leading `RE:`, `FW:` and `Fwd:` removed, whitespace collapsed and lower-cased. */
export const normaliseSubject = (subject: string): string => {
  let rest = subject
  while (REPLY_PREFIX_RE.test(rest)) rest = rest.replace(REPLY_PREFIX_RE, '')
  return rest.replace(/\s+/g, ' ').trim().toLowerCase()
}

/** A message that might be the owner's forward of another, as Graph's search returned it. */
export interface ForwardCandidate extends Pick<EmailRecord, 'id' | 'subject' | 'from' | 'to' | 'cc' | 'received'> {
  hasAttachments?: boolean
  /** RFC 5322 Message-ID. The Sent Items copy and the copy returned through a shared address share it. */
  internetMessageId?: string
}

/**
 * The distinct forwards of `original` to `address`, on every test except the
 * attachment one, which needs a further Graph call and so is applied by the
 * caller with {@link sharesAttachmentName} to these survivors only.
 *
 * A candidate is a forward when the mailbox owner sent it, `address` is among
 * its To or CC recipients, its subject is `FW:` or `Fwd:` and normalises to the
 * original's, and it was received after the original and within
 * {@link FORWARD_WINDOW_DAYS}. Copies sharing an `internetMessageId` count
 * once, or every forward to a shared address the owner also receives would
 * read as two.
 */
export const forwardCandidates = (
  original: Pick<EmailRecord, 'subject' | 'received'>,
  address: string,
  owner: readonly string[],
  candidates: readonly ForwardCandidate[]
): ForwardCandidate[] => {
  const start = Date.parse(original.received)
  if (Number.isNaN(start)) return []
  const end = start + FORWARD_WINDOW_DAYS * MS_PER_DAY
  const recipient = address.toLowerCase()
  const owners = new Set(owner.map((a) => a.toLowerCase()))
  const subject = normaliseSubject(original.subject)

  const seen = new Set<string>()
  const kept: ForwardCandidate[] = []
  for (const candidate of candidates) {
    const at = Date.parse(candidate.received)
    if (!owners.has(candidate.from.toLowerCase())) continue
    if (![...candidate.to, ...candidate.cc].some((a) => a.toLowerCase() === recipient)) continue
    if (!FORWARD_PREFIX_RE.test(candidate.subject) || normaliseSubject(candidate.subject) !== subject) continue
    if (!(at > start && at <= end)) continue
    const key = candidate.internetMessageId || identityKey(candidate)
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(candidate)
  }
  return kept
}

/** Do two attachment name lists share a file name, ignoring case? */
export const sharesAttachmentName = (a: readonly string[], b: readonly string[]): boolean => {
  const names = new Set(a.map((name) => name.trim().toLowerCase()).filter(Boolean))
  return b.some((name) => names.has(name.trim().toLowerCase()))
}

const isForwardTerm = (term: Term): term is PredicateTerm => term.kind === 'predicate' && term.key === 'forwarded-to'

/** Does any rule test `forwarded-to:`? A file without one never looks a forward up. */
export const testsForwards = (rules: readonly Rule[]): boolean =>
  rules.some((rule) => rule.groups.some((group) => group.terms.some(isForwardTerm)))

/**
 * The `forwarded-to:` addresses whose answer could change this message's
 * classification and have not been looked up yet.
 *
 * Only rules up to the current match can matter — a later rule is reached only
 * if a lookup unseats the current one, and the caller asks again then — and
 * only a group whose every other term already holds. That keeps the lookup to
 * the messages a rule is actually about: `folder:"Held" forwarded-to:x` costs
 * a search for mail in `Held`, not for every message the pass reads.
 */
export const forwardAddressesToResolve = (
  rules: readonly Rule[],
  record: EmailRecord,
  ctx: MatchContext,
  matchIndex: number
): string[] => {
  const last = matchIndex === -1 ? rules.length - 1 : matchIndex
  const wanted = new Set<string>()
  for (const rule of rules.slice(0, last + 1))
    for (const group of rule.groups) {
      const forwards = group.terms.filter(isForwardTerm)
      if (forwards.length === 0) continue
      if (!group.terms.every((term) => isForwardTerm(term) || evaluateTerm(term, record, ctx))) continue
      for (const term of forwards) {
        const address = term.value.toLowerCase()
        if (!record.forwards?.[address]) wanted.add(address)
      }
    }
  return [...wanted]
}

/** The forward that satisfied a matching group's `forwarded-to:` test, for the report. */
export const forwardFor = (group: AndGroup, record: EmailRecord): ({ address: string } & ForwardMatch) | undefined => {
  for (const term of group.terms) {
    if (!isForwardTerm(term) || term.negated) continue
    const address = term.value.toLowerCase()
    const [only] = record.forwards?.[address] ?? []
    if (only) return { address, ...only }
  }
  return undefined
}
