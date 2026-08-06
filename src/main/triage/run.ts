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
import { resolveMoveTarget, TRIAGE_ROOT } from './folders.js'
import { applyActions, buildFolderMap, childPaths, type FolderMap, hasExecutableActions, listFolderMessages } from './graph-ops.js'
import { type LintFinding, lintRules } from './lint.js'
import { classify } from './matcher.js'
import { toEmailRecord } from './message.js'
import { parseRules, selectBlock } from './parser.js'
import { readTracking, type TrackingEntry, upsertEntries, writeTracking } from './tracking.js'
import type { Action, EmailRecord, Rule } from './types.js'

/**
 * Findings that make a run unsafe rather than merely untidy. A rule file can
 * carry an unreachable rule and still route correctly, so shadowing warns; a
 * file that will not parse, or that can leave a message unclassified, does not
 * run at all.
 */
const BLOCKING_CODES = new Set(['parse-error', 'missing-fallback', 'misplaced-fallback'])

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
const resolveRules = async (ctx: TriageContext, args: { rules?: string; rulesPath?: string }): Promise<{ rules: string } | { error: string }> => {
  if (typeof args.rules === 'string' && args.rules.trim()) return { rules: args.rules }

  const candidate = args.rulesPath?.trim() || ctx.rulesPath
  if (!candidate) {
    return { error: 'No rules supplied — pass `rules`, pass `rulesPath`, or set MCP_M365_TRIAGE_RULES_PATH to the rule note.' }
  }

  try {
    const file = await assertWithinRoots(ctx.roots, candidate, 'rule file')
    const { size } = await fs.stat(file)
    if (size > MAX_RULES_BYTES) return { error: `The rule file is ${size} bytes, over the ${MAX_RULES_BYTES}-byte limit.` }
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
const resolveTrackingPath = async (ctx: TriageContext, args: { trackingPath?: string }): Promise<{ path: string } | { error: string }> => {
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
  applied: z.array(appliedActionSchema)
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
    warnings: z.array(z.string())
  })
  .loose()

export type TriageRunResult = z.infer<typeof triageRunResultSchema>

/** Destination described by a rule's actions, for the report and the tracking entry. */
const describeDestination = (actions: readonly Action[]): string => {
  const move = actions.find((action) => action.kind === 'move')
  if (move) return resolveMoveTarget(move)
  if (actions.some((action) => action.kind === 'delete')) return '(deleted)'
  return '(no move)'
}

const leafOf = (destination: string): string => destination.slice(destination.lastIndexOf('/') + 1)

const formatFinding = (finding: LintFinding): string => `L${finding.line} [${finding.severity}] ${finding.code}: ${finding.message}`

/** One message's worth of work, before anything is executed. */
interface Candidate {
  record: EmailRecord
  rule: Rule
  ruleset: string
  destination: string
}

const summarise = (result: TriageRunResult): string => {
  const lines = [
    `${result.mode === 'report' ? '[report] would process' : 'Processed'} ${result.acted} of ${result.considered} message(s) in the "${result.block}" pass.` +
      `${result.remaining ? ' More remain — call again.' : ''}` +
      `${result.mode === 'live' ? `\nTracking: ${result.trackingPath}` : ''}`
  ]
  if (result.unmatched > 0) lines.push(`${result.unmatched} message(s) matched no rule — check the fallback.`)
  for (const item of result.items) {
    const outcome = item.applied.length === 0 ? 'pending' : item.applied.map((a) => `${a.action}${a.ok ? '' : ` FAILED (${a.detail})`}`).join(', ')
    lines.push(`- "${item.subject}" <${item.from}> → ${item.destination} [${item.ruleset}] ${outcome}`)
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
  collect: (accessToken: string, map: FolderMap, limit: number) => Promise<{ records: EmailRecord[]; truncated: boolean }>
): Promise<any> => {
  const mode = args.mode === 'live' ? 'live' : 'report'
  const maxActions = args.maxActions ?? 50

  const source = await resolveRules(ctx, args)
  if ('error' in source) return errorText(source.error)

  const parsed = parseRules(source.rules)
  const findings = lintRules(parsed, { requireFallbackIn: blockLabel === 'inbound' ? ['inbound'] : [] })
  const blocking = findings.filter((finding) => BLOCKING_CODES.has(finding.code))
  if (blocking.length > 0) {
    return errorText(`Refusing to run — the rule file has ${blocking.length} blocking problem(s):\n${blocking.map(formatFinding).join('\n')}`)
  }

  const selected = selectBlock(parsed, blockLabel)
  if ('error' in selected) return errorText(`Error selecting rules: ${selected.error}`)

  // Resolved before any mailbox work: a live run that could not record what it
  // did would leave the drift scan blind to its own engine's actions.
  const tracking = mode === 'live' ? await resolveTrackingPath(ctx, args) : { path: ctx.trackingPath }
  if ('error' in tracking) return errorText(tracking.error)

  const accessToken = await ctx.ensureAuthenticated()
  const map = await buildFolderMap(ctx, accessToken)
  const { records, truncated } = await collect(accessToken, map, maxActions + 1)

  const now = new Date()
  const candidates: Candidate[] = []
  let unmatched = 0
  for (const record of records) {
    const match = classify(selected.block.rules, record, { now })
    if (!('rule' in match)) {
      unmatched++
      continue
    }
    if (!hasExecutableActions(match.rule.actions)) continue
    candidates.push({ record, rule: match.rule, ruleset: match.ruleset, destination: describeDestination(match.rule.actions) })
  }

  const batch = candidates.slice(0, maxActions)
  const items: TriageRunResult['items'] = []
  const entries: TrackingEntry[] = []
  const routedAt = now.toISOString()

  for (const candidate of batch) {
    const applied = mode === 'live' ? (await applyActions(ctx, accessToken, candidate.record, candidate.rule.actions, map)).applied : []
    items.push({
      subject: candidate.record.subject,
      from: candidate.record.from,
      received: candidate.record.received,
      ruleLine: candidate.rule.line,
      ruleset: candidate.ruleset,
      destination: candidate.destination,
      applied
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
    warnings: findings.filter((finding) => !BLOCKING_CODES.has(finding.code)).map(formatFinding)
  })
}

/** Classify new mail in the Inbox against the `inbound` block. */
export const handleTriageRun = async (ctx: TriageContext, args: any): Promise<any> => {
  try {
    return await runPass(ctx, args, 'inbound', async (accessToken, map, limit) => {
      const inboxId = map.idByPath.get('inbox')
      if (!inboxId) return { records: [], truncated: false }
      const messages = await listFolderMessages(ctx, accessToken, inboxId, limit)
      return { records: messages.slice(0, limit - 1).map((message) => toEmailRecord(message)), truncated: messages.length >= limit }
    })
  } catch (error) {
    return errorResult('running triage', error)
  }
}

/** Apply the retention policy in the `aged` block across every `_TRIAGE` subfolder. */
export const handleAgedRun = async (ctx: TriageContext, args: any): Promise<any> => {
  try {
    return await runPass(ctx, args, 'aged', async (accessToken, map, limit) => {
      const records: EmailRecord[] = []
      let truncated = false
      for (const folderPath of childPaths(map, TRIAGE_ROOT)) {
        if (records.length >= limit) {
          truncated = true
          break
        }
        const folderId = map.idByPath.get(folderPath.toLowerCase()) as string
        const messages = await listFolderMessages(ctx, accessToken, folderId, limit - records.length)
        for (const message of messages) records.push(toEmailRecord(message, folderPath.slice(folderPath.lastIndexOf('/') + 1)))
      }
      if (records.length >= limit) {
        truncated = true
        records.length = limit - 1
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
  const findings = lintRules(parsed, knownFolders ? { knownFolders } : {})

  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1
    return acc
  }, {})

  const blocks = parsed.blocks.map((block) => `${block.label} (${block.rules.length} rules)`).join(', ') || 'none'
  const header =
    `Parsed blocks: ${blocks}. ` +
    `${findings.length} finding(s): ${counts.error ?? 0} error, ${counts.warning ?? 0} warning, ${counts.info ?? 0} info.` +
    (knownFolders ? '' : '\nNote: no knownFolders supplied, so move targets were not checked against the folder taxonomy.')

  const detail = findings.map((finding) => `${formatFinding(finding)}${finding.source ? `\n    ${finding.source}` : ''}`)
  return { content: [{ type: 'text' as const, text: [header, ...detail].join('\n') }] }
}
