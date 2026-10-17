/**
 * Thread-follow resolution: where is this message's conversation already filed?
 *
 * Pure, like the parser and matcher. The run layer fetches a conversation's
 * messages from Graph and hands them here as plain data; this module decides
 * which of their folders count as "filed" and which one a reply follows.
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
import { identityKey } from './tracking.js'
import type { Action, EmailRecord, Rule, RuleBlock, ThreadFiling } from './types.js'

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
