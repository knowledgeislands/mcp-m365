/**
 * The triage and aged passes.
 *
 * Both are the same shape — read a folder, classify each message against an
 * ordered rule block, apply the winning rule's actions — and both are
 * **batch-bounded and resumable**. A call executes at most `maxActions`
 * messages and reports whether more remain; the caller loops. That is what
 * keeps a pass inside the client's ~60 s MCP timeout without ever needing a
 * long-running call.
 *
 * Runs are idempotent: classification moves a message out of the folder being
 * scanned, so re-invoking after a partial run or a timeout simply finds less
 * work. Nothing is scheduled, resumed from a cursor, or held in server state.
 */
import fs from 'node:fs/promises'
import { z } from 'zod'
import { errMessage } from '../../utils/errors.js'
import { assertWithinRoots } from '../../utils/paths.js'
import { errorResult, errorText } from '../../utils/results.js'
import type { TriageContext } from './context.js'
import { isThreadTarget, resolveMoveTarget, TRIAGE_ROOT } from './folders.js'
import {
  type ActionContext,
  applyActions,
  attachmentNames,
  buildFolderMap,
  childPaths,
  type FolderMap,
  hasExecutableActions,
  listConversation,
  listFolderMessages,
  mailboxOwner,
  searchForwards
} from './graph-ops.js'
import { type LintFinding, lintRules } from './lint.js'
import {
  bindThreadTarget,
  type FiledFolders,
  type ForwardCandidate,
  filedFolders,
  firstThreadRule,
  forwardAddressesToResolve,
  forwardCandidates,
  forwardFor,
  normaliseSubject,
  resolveThread,
  sharesAttachmentName,
  type ThreadSibling,
  testsForwards
} from './lookups.js'
import { classify } from './matcher.js'
import { toEmailRecord } from './message.js'
import { destinationPaths, parseRules, selectBlock } from './parser.js'
import { readTracking, type TrackingEntry, upsertEntries, writeTracking } from './tracking.js'
import type { Action, AndGroup, EmailRecord, ForwardMatch, Rule, ThreadFiling } from './types.js'

/**
 * Findings that make a run unsafe rather than merely untidy. A rule file can
 * carry an unreachable rule and still route correctly, so shadowing warns; a
 * file that will not parse, or that can leave a message unclassified, does not
 * run at all.
 */
const BLOCKING_CODES = new Set([
  'parse-error',
  'missing-fallback',
  'misplaced-fallback',
  'unknown-destination',
  'destination-outside-roots',
  'thread-target-without-thread',
  'unknown-category'
])

/** Largest rule document read from disk. The compiled rule file is ~35 KB; this is a sanity bound, not a target. */
const MAX_RULES_BYTES = 1024 * 1024

/**
 * Where this call's rules come from.
 *
 * A caller may pass the document inline — the scheduled task does, having read
 * the knowledge-base note itself. Otherwise the server reads the note from the
 * path in its OWN configuration, freshly on each call, so editing the note
 * takes effect without a restart.
 *
 * The path is never a tool parameter. A caller-supplied read path would let any
 * prompt point the engine at an arbitrary file and have its contents echoed
 * back in a lint finding's `source` line. Read failures report the failure and
 * never the contents.
 */
const resolveRules = async (
  ctx: TriageContext,
  args: { rules?: string; rulesPath?: string }
): Promise<{ rules: string } | { error: string }> => {
  if (typeof args.rules === 'string' && args.rules.trim()) return { rules: args.rules }

  const candidate = args.rulesPath?.trim() || ctx.rulesPath
  if (!candidate) {
    return {
      error: 'No rules supplied — pass `rules`, pass `rulesPath`, or set MCP_M365_TRIAGE_RULES_PATH to the rule note.'
    }
  }

  try {
    const file = await assertWithinRoots(ctx.roots, candidate, 'rule file')
    const { size } = await fs.stat(file)
    if (size > MAX_RULES_BYTES)
      return { error: `The rule file is ${size} bytes, over the ${MAX_RULES_BYTES}-byte limit.` }
    return { rules: await fs.readFile(file, 'utf8') }
  } catch (error) {
    return { error: `Could not read the rule file: ${errMessage(error)}` }
  }
}

/**
 * Where this call records what it routed. A caller may override the configured
 * default, but the result always reports which file was used — a wrong-but-
 * allowed path would otherwise fork the routing history silently, and that is
 * the kind of mistake you notice a week late.
 */
const resolveTrackingPath = async (
  ctx: TriageContext,
  args: { trackingPath?: string }
): Promise<{ path: string } | { error: string }> => {
  const candidate = args.trackingPath?.trim() || ctx.trackingPath
  if (!candidate) {
    return { error: 'No tracking cache configured — pass `trackingPath`, or set MCP_M365_TRIAGE_TRACKING_PATH.' }
  }
  try {
    return { path: await assertWithinRoots(ctx.roots, candidate, 'tracking cache') }
  } catch (error) {
    return { error: errMessage(error) }
  }
}

// Not `.loose()`: unlike the raw Graph payloads elsewhere in this server, these
// objects are constructed here and fully specified, so the inferred item types
// stay exact rather than picking up an index signature.
const appliedActionSchema = z.object({ action: z.string(), ok: z.boolean(), detail: z.string().optional() })

const triageItemSchema = z.object({
  subject: z.string(),
  from: z.string(),
  received: z.string(),
  ruleLine: z.number(),
  ruleset: z.string(),
  destination: z.string(),
  applied: z.array(appliedActionSchema),
  /** Present when the item was routed by `move:@thread`: the folder it followed, and any others its thread is filed in. */
  thread: z.object({ folder: z.string(), alternatives: z.array(z.string()), skipped: z.array(z.string()) }).optional(),
  /** Present when the item was matched by `forwarded-to:`: the one forward that satisfied it. */
  forward: z.object({ address: z.string(), subject: z.string(), received: z.string() }).optional()
})

/** A message with two or more distinct forwards to one address: reported for the owner, never acted on. */
const forwardAmbiguitySchema = z.object({
  subject: z.string(),
  from: z.string(),
  received: z.string(),
  address: z.string(),
  candidates: z.number()
})

/** A message a `hold` rule claimed: reported so the owner can see what is being kept, never acted on. */
const heldItemSchema = z.object({
  subject: z.string(),
  from: z.string(),
  received: z.string(),
  ruleLine: z.number(),
  ruleset: z.string()
})

export const triageRunResultSchema = z
  .object({
    mode: z.enum(['live', 'report']),
    block: z.string(),
    considered: z.number(),
    acted: z.number(),
    /** True when the folder held more messages than this batch examined. Loop while `remaining && acted > 0`. */
    remaining: z.boolean(),
    unmatched: z.number(),
    /** The tracking cache this run used. Reported so a mistaken override is visible immediately. */
    trackingPath: z.string(),
    items: z.array(triageItemSchema),
    warnings: z.array(z.string()),
    /** Items in this batch matched by a forward rather than by age or content. Present only when the block tests `forwarded-to:`. */
    forwardMatched: z.number().optional(),
    /** Messages a `forwarded-to:` test found two or more forwards for. Present only when the block tests `forwarded-to:`. */
    forwardAmbiguous: z.array(forwardAmbiguitySchema).optional(),
    /** Messages a `hold` rule claimed and left alone. Present only when the block has a `hold` rule. */
    held: z.array(heldItemSchema).optional()
  })
  .loose()

export type TriageRunResult = z.infer<typeof triageRunResultSchema>

/** Destination described by a rule's actions, for the report and the tracking entry. */
const describeDestination = (actions: readonly Action[]): string => {
  const save = actions.find((action) => action.kind === 'save-attachments')
  const saved = save ? `save-attachments:${save.value} + ` : ''
  const move = actions.find((action) => action.kind === 'move')
  if (move) return `${saved}${resolveMoveTarget(move)}`
  if (actions.some((action) => action.kind === 'delete')) return `${saved}(deleted)`
  return saved ? saved.replace(/ \+ $/, '') : '(no move)'
}

const leafOf = (destination: string): string => destination.slice(destination.lastIndexOf('/') + 1)

const formatFinding = (finding: LintFinding): string =>
  `L${finding.line} [${finding.severity}] ${finding.code}: ${finding.message}`

/** One message's worth of work, before anything is executed. */
interface Candidate {
  record: EmailRecord
  rule: Rule
  /** The rule's actions with `@thread` bound to a concrete folder. */
  actions: readonly Action[]
  ruleset: string
  destination: string
  thread?: ThreadFiling
  forward?: TriageRunResult['items'][number]['forward']
}

/** How a thread-follow item was placed, including a split thread's other folders. */
const viaThread = (item: TriageRunResult['items'][number]): string => {
  if (!item.thread) return ''
  const { alternatives, skipped } = item.thread
  return (
    ' — via thread' +
    (alternatives.length > 0 ? `; also filed in ${alternatives.join(', ')}` : '') +
    (skipped.length > 0 ? `; skipped ${skipped.join(', ')}` : '')
  )
}

/**
 * Where a message's conversation is filed, looked up at most once per
 * conversation per call. A failed lookup is reported and treated as "not
 * filed", so the message falls through to the rules below rather than failing
 * the pass.
 */
const makeThreadResolver = (
  ctx: TriageContext,
  accessToken: string,
  map: FolderMap,
  filed: FiledFolders,
  warnings: string[]
) => {
  const conversations = new Map<string, Promise<any[]>>()
  return async (record: EmailRecord): Promise<ThreadFiling | null> => {
    const id = record.conversationId as string
    let members = conversations.get(id)
    if (!members) {
      members = listConversation(ctx, accessToken, id)
      conversations.set(id, members)
    }
    try {
      const siblings: ThreadSibling[] = []
      for (const member of await members) {
        const folder = map.pathById.get(String(member?.parentFolderId))
        if (!folder) continue
        const { subject, from, received } = toEmailRecord(member)
        siblings.push({ subject, from, received, folder })
      }
      return resolveThread(record, siblings, filed)
    } catch (error) {
      warnings.push(`thread lookup failed for "${record.subject}": ${errMessage(error)}`)
      return null
    }
  }
}

/** How a `forwarded-to:` item was matched. */
const viaForward = (item: TriageRunResult['items'][number]): string =>
  item.forward ? ` — forwarded to ${item.forward.address} (${item.forward.received})` : ''

/** Attach a no-op handler so a cached lookup that fails before anyone awaits it is not an unhandled rejection. */
const cached = <T>(promise: Promise<T>): Promise<T> => {
  promise.catch(() => {})
  return promise
}

const toForwardCandidate = (message: any): ForwardCandidate => {
  const { id, subject, from, to, cc, received, hasAttachments } = toEmailRecord(message)
  return {
    ...(id ? { id } : {}),
    subject,
    from,
    to,
    cc,
    received,
    ...(hasAttachments !== undefined ? { hasAttachments } : {}),
    ...(typeof message?.internetMessageId === 'string' ? { internetMessageId: message.internetMessageId } : {})
  }
}

/**
 * The owner's distinct forwards of a message to one address. The owner's
 * addresses are read once per call, each search once per address and subject,
 * and each message's attachment names once. When both messages carry
 * attachments they must share a file name. A failed lookup is reported and
 * reads as "no forward", so the message is left where it is.
 */
const makeForwardResolver = (ctx: TriageContext, accessToken: string, warnings: string[]) => {
  let owner: Promise<string[]> | undefined
  const searches = new Map<string, Promise<any[]>>()
  const names = new Map<string, Promise<string[]>>()
  const namesOf = (id: string): Promise<string[]> => {
    let listed = names.get(id)
    if (!listed) {
      listed = cached(attachmentNames(ctx, accessToken, id))
      names.set(id, listed)
    }
    return listed
  }
  return async (record: EmailRecord, address: string): Promise<ForwardMatch[]> => {
    owner ??= cached(mailboxOwner(ctx, accessToken))
    const key = `${address}\n${normaliseSubject(record.subject)}`
    let found = searches.get(key)
    if (!found) {
      found = cached(searchForwards(ctx, accessToken, address, record.subject))
      searches.set(key, found)
    }
    try {
      const candidates = forwardCandidates(record, address, await owner, (await found).map(toForwardCandidate))
      const matches: ForwardMatch[] = []
      for (const candidate of candidates) {
        if (record.hasAttachments && candidate.hasAttachments) {
          // Without an id on both sides the names cannot be compared, so the pair is not proved.
          if (!record.id || !candidate.id) continue
          if (!sharesAttachmentName(await namesOf(record.id), await namesOf(candidate.id))) continue
        }
        matches.push({ subject: candidate.subject, received: candidate.received })
      }
      return matches
    } catch (error) {
      warnings.push(`forward lookup failed for "${record.subject}": ${errMessage(error)}`)
      return []
    }
  }
}

const summarise = (result: TriageRunResult): string => {
  const lines = [
    `${result.mode === 'report' ? '[report] would process' : 'Processed'} ${result.acted} of ${result.considered} message(s) in the "${result.block}" pass.` +
      `${result.remaining ? ' More remain — call again.' : ''}` +
      `${result.mode === 'live' ? `\nTracking: ${result.trackingPath}` : ''}`
  ]
  if (result.unmatched > 0) lines.push(`${result.unmatched} message(s) matched no rule — check the fallback.`)
  for (const item of result.items) {
    const outcome =
      item.applied.length === 0
        ? 'pending'
        : item.applied.map((a) => `${a.action}${a.ok ? '' : ` FAILED (${a.detail})`}`).join(', ')
    lines.push(
      `- "${item.subject}" <${item.from}> → ${item.destination} [${item.ruleset}] ${outcome}${viaThread(item)}${viaForward(item)}`
    )
  }
  if (result.forwardMatched) lines.push(`${result.forwardMatched} message(s) matched by a forward.`)
  if (result.held?.length) lines.push(`${result.held.length} message(s) held by a \`hold\` rule and left alone.`)
  if (result.forwardAmbiguous?.length) {
    lines.push(
      '',
      'Ambiguous forwards (nothing moved — decide by hand):',
      ...result.forwardAmbiguous.map(
        (a) => `- "${a.subject}" <${a.from}> ${a.received}: ${a.candidates} forwards to ${a.address}`
      )
    )
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Rule warnings (not blocking):', ...result.warnings.map((w) => `- ${w}`))
  }
  return lines.join('\n')
}

const envelope = (result: TriageRunResult) => ({
  content: [{ type: 'text' as const, text: summarise(result) }],
  structuredContent: result
})

/** Shared driver: everything except which folders are read and which block is used. */
const runPass = async (
  ctx: TriageContext,
  args: { rules?: string; rulesPath?: string; trackingPath?: string; mode?: string; maxActions?: number },
  blockLabel: 'inbound' | 'aged',
  collect: (
    accessToken: string,
    map: FolderMap,
    limit: number,
    rules: Rule[]
  ) => Promise<{ records: EmailRecord[]; truncated: boolean }>
): Promise<any> => {
  const mode = args.mode === 'live' ? 'live' : 'report'
  const maxActions = args.maxActions ?? 50

  const source = await resolveRules(ctx, args)
  if ('error' in source) return errorText(source.error)

  const parsed = parseRules(source.rules)
  const findings = lintRules(parsed, {
    requireFallbackIn: blockLabel === 'inbound' ? ['inbound'] : [],
    attachmentRoots: ctx.attachmentRoots
  })
  const blocking = findings.filter((finding) => BLOCKING_CODES.has(finding.code))
  if (blocking.length > 0) {
    return errorText(
      `Refusing to run — the rule file has ${blocking.length} blocking problem(s):\n${blocking.map(formatFinding).join('\n')}`
    )
  }

  const selected = selectBlock(parsed, blockLabel)
  if ('error' in selected) return errorText(`Error selecting rules: ${selected.error}`)

  // Resolved before any mailbox work: a live run that could not record what it
  // did would leave the drift scan blind to its own engine's actions.
  const tracking = mode === 'live' ? await resolveTrackingPath(ctx, args) : { path: ctx.trackingPath }
  if ('error' in tracking) return errorText(tracking.error)

  const accessToken = await ctx.ensureAuthenticated()
  const map = await buildFolderMap(ctx, accessToken)
  const { records, truncated } = await collect(accessToken, map, maxActions + 1, selected.block.rules)

  const now = new Date()
  const rules = selected.block.rules
  const candidates: Candidate[] = []
  const lookupWarnings: string[] = []
  // Thread-follow is lazy: a rule file with no `thread:` rule makes no lookup,
  // and a message claimed by a rule above the first one makes none either.
  const threadFrom = firstThreadRule(rules)
  const threadOf =
    threadFrom === -1 ? null : makeThreadResolver(ctx, accessToken, map, filedFolders(parsed.blocks), lookupWarnings)
  // Forward lookups are lazier still: only for a group whose other terms hold.
  const forwardOf = testsForwards(rules) ? makeForwardResolver(ctx, accessToken, lookupWarnings) : null
  const forwardAmbiguous: z.infer<typeof forwardAmbiguitySchema>[] = []
  const holds = rules.some((rule) => rule.actions.some((action) => action.kind === 'hold'))
  const held: z.infer<typeof heldItemSchema>[] = []
  let unmatched = 0
  for (const listed of records) {
    let record = listed
    let match = classify(rules, record, { now })
    let threadLooked = false
    // Each lookup can move the match, and a new match may reach a lookup the
    // old one did not, so resolve until classification is stable. It ends:
    // the thread is looked up at most once, and each address once.
    for (;;) {
      if (
        threadOf &&
        !threadLooked &&
        record.conversationId &&
        (match.ruleIndex === -1 || match.ruleIndex >= threadFrom)
      ) {
        threadLooked = true
        const thread = await threadOf(record)
        if (thread) {
          record = { ...record, thread }
          match = classify(rules, record, { now })
        }
        continue
      }
      const addresses = forwardOf ? forwardAddressesToResolve(rules, record, { now }, match.ruleIndex) : []
      if (addresses.length === 0) break
      const forwards: Record<string, readonly ForwardMatch[]> = { ...record.forwards }
      for (const address of addresses) {
        const found = await (forwardOf as NonNullable<typeof forwardOf>)(record, address)
        forwards[address] = found
        if (found.length > 1)
          forwardAmbiguous.push({
            subject: record.subject,
            from: record.from,
            received: record.received,
            address,
            candidates: found.length
          })
      }
      record = { ...record, forwards }
      match = classify(rules, record, { now })
    }
    if (!('rule' in match)) {
      unmatched++
      continue
    }
    // A held message is claimed and deliberately untouched: it is reported, but
    // it is not work, so it neither spends maxActions nor keeps `remaining` set.
    if (match.rule.actions.some((action) => action.kind === 'hold')) {
      held.push({
        subject: record.subject,
        from: record.from,
        received: record.received,
        ruleLine: match.rule.line,
        ruleset: match.ruleset
      })
      continue
    }
    if (!hasExecutableActions(match.rule.actions)) continue
    const actions = bindThreadTarget(match.rule.actions, record.thread?.folder)
    const forward = forwardFor(match.rule.groups[match.groupIndex] as AndGroup, record)
    candidates.push({
      record,
      rule: match.rule,
      actions,
      ruleset: match.ruleset,
      destination: describeDestination(actions),
      ...(match.rule.actions.some(isThreadTarget) ? { thread: record.thread } : {}),
      ...(forward ? { forward } : {})
    })
  }

  // The destinations a `save-attachments:` action may name are declared in the
  // note that was just parsed, so they are per-call data rather than context.
  const actionCtx: ActionContext = { ...ctx, attachmentDestinations: destinationPaths(parsed) }

  const batch = candidates.slice(0, maxActions)
  const items: TriageRunResult['items'] = []
  const entries: TrackingEntry[] = []
  const routedAt = now.toISOString()

  for (const candidate of batch) {
    const applied =
      mode === 'live'
        ? (await applyActions(actionCtx, accessToken, candidate.record, candidate.actions, map)).applied
        : []
    items.push({
      subject: candidate.record.subject,
      from: candidate.record.from,
      received: candidate.record.received,
      ruleLine: candidate.rule.line,
      ruleset: candidate.ruleset,
      destination: candidate.destination,
      applied,
      ...(candidate.thread ? { thread: candidate.thread } : {}),
      ...(candidate.forward ? { forward: candidate.forward } : {})
    })

    if (mode !== 'live' || applied.some((a) => !a.ok)) continue
    const entry: TrackingEntry = {
      subject: candidate.record.subject,
      from: candidate.record.from,
      received: candidate.record.received,
      ruleset: candidate.ruleset,
      routed_to: leafOf(candidate.destination),
      destination: candidate.destination,
      routed_at: routedAt,
      triage_folder: leafOf(candidate.destination)
    }
    if (candidate.record.id) entry.id = candidate.record.id
    entries.push(entry)
  }

  if (entries.length > 0) {
    const existing = await readTracking(tracking.path)
    // A cache that exists but will not parse must never be overwritten: doing so
    // would replace the whole routing history with just this batch.
    if (existing === null) {
      return errorText(
        `Routed ${entries.length} message(s), but the tracking cache at ${tracking.path} exists and could not be parsed, so it was left untouched. ` +
          'Repair or move it before the next run, or the history it holds will be lost.'
      )
    }
    await writeTracking(tracking.path, upsertEntries(existing, entries))
  }

  return envelope({
    mode,
    block: selected.block.label,
    considered: records.length,
    acted: batch.length,
    trackingPath: tracking.path,
    remaining: truncated || candidates.length > batch.length,
    unmatched,
    items,
    warnings: [
      ...findings.filter((finding) => !BLOCKING_CODES.has(finding.code)).map(formatFinding),
      ...lookupWarnings
    ],
    ...(forwardOf ? { forwardMatched: items.filter((item) => item.forward).length, forwardAmbiguous } : {}),
    ...(holds ? { held } : {})
  })
}

/** Classify new mail in the Inbox against the `inbound` block. */
export const handleTriageRun = async (ctx: TriageContext, args: any): Promise<any> => {
  try {
    return await runPass(ctx, args, 'inbound', async (accessToken, map, limit) => {
      const inboxId = map.idByPath.get('inbox')
      if (!inboxId) return { records: [], truncated: false }
      const messages = await listFolderMessages(ctx, accessToken, inboxId, limit)
      return {
        records: messages.slice(0, limit - 1).map((message) => toEmailRecord(message)),
        truncated: messages.length >= limit
      }
    })
  } catch (error) {
    return errorResult('running triage', error)
  }
}

/**
 * `_TRIAGE` subfolder leaf names the block's `folder:` predicates name, lower-cased.
 * Empty when no rule constrains the folder, in which case every subfolder is walked.
 */
const referencedFolders = (rules: Rule[]): Set<string> => {
  const names = new Set<string>()
  for (const rule of rules)
    for (const group of rule.groups)
      for (const term of group.terms)
        if (term.kind === 'predicate' && term.key === 'folder' && !term.negated) names.add(term.value.toLowerCase())
  return names
}

/**
 * Apply the retention policy in the `aged` block across the `_TRIAGE` subfolders.
 *
 * Only folders the block actually names are read, and each gets its own window
 * of `limit` messages (oldest first). A single cumulative window across every
 * subfolder in alphabetical order stalled in production: `000 Unknown` and
 * `101 Do` alone held more mail than the window, none of it subject to any
 * aged rule, so `981 Delete` and `991 Junk` were never reached and the pass
 * reported "more remain" with nothing acted on, forever.
 */
export const handleAgedRun = async (ctx: TriageContext, args: any): Promise<any> => {
  try {
    return await runPass(ctx, args, 'aged', async (accessToken, map, limit, rules) => {
      const records: EmailRecord[] = []
      let truncated = false
      const wanted = referencedFolders(rules)
      for (const folderPath of childPaths(map, TRIAGE_ROOT)) {
        const leaf = leafOf(folderPath)
        if (wanted.size > 0 && !wanted.has(leaf.toLowerCase())) continue
        const folderId = map.idByPath.get(folderPath.toLowerCase()) as string
        const messages = await listFolderMessages(ctx, accessToken, folderId, limit)
        if (messages.length >= limit) truncated = true
        for (const message of messages.slice(0, limit - 1)) records.push(toEmailRecord(message, leaf))
      }
      return { records, truncated }
    })
  } catch (error) {
    return errorResult('running the aged pass', error)
  }
}

/** Static rule-file checks. No mailbox access, so this is safe to run against a proposed edit before it is saved. */
export const handleRulesLint = async (ctx: TriageContext, args: any): Promise<any> => {
  const source = await resolveRules(ctx, args ?? {})
  if ('error' in source) return errorText(source.error)

  const parsed = parseRules(source.rules)
  const knownFolders: string[] | undefined = Array.isArray(args?.knownFolders) ? args.knownFolders : undefined
  // The roots come from the server, not the call: linting a proposed edit
  // should catch a destination this server would refuse before the edit lands.
  const findings = lintRules(parsed, {
    ...(knownFolders ? { knownFolders } : {}),
    attachmentRoots: ctx.attachmentRoots
  })

  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1
    return acc
  }, {})

  const blocks = parsed.blocks.map((block) => `${block.label} (${block.rules.length} rules)`).join(', ') || 'none'
  const header =
    `Parsed blocks: ${blocks}. ` +
    `${findings.length} finding(s): ${counts.error ?? 0} error, ${counts.warning ?? 0} warning, ${counts.info ?? 0} info.` +
    (knownFolders
      ? ''
      : '\nNote: no knownFolders supplied, so move targets were not checked against the folder taxonomy.')

  const detail = findings.map(
    (finding) => `${formatFinding(finding)}${finding.source ? `\n    ${finding.source}` : ''}`
  )
  return { content: [{ type: 'text' as const, text: [header, ...detail].join('\n') }] }
}
