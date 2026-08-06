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
import { z } from 'zod'
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
      `${result.remaining ? ' More remain — call again.' : ''}`
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
  args: { rules?: string; mode?: string; maxActions?: number },
  blockLabel: 'inbound' | 'aged',
  collect: (accessToken: string, map: FolderMap, limit: number) => Promise<{ records: EmailRecord[]; truncated: boolean }>
): Promise<any> => {
  const mode = args.mode === 'live' ? 'live' : 'report'
  const maxActions = args.maxActions ?? 50

  const parsed = parseRules(args.rules ?? '')
  const findings = lintRules(parsed, { requireFallbackIn: blockLabel === 'inbound' ? ['inbound'] : [] })
  const blocking = findings.filter((finding) => BLOCKING_CODES.has(finding.code))
  if (blocking.length > 0) {
    return errorText(`Refusing to run — the rule file has ${blocking.length} blocking problem(s):\n${blocking.map(formatFinding).join('\n')}`)
  }

  const selected = selectBlock(parsed, blockLabel)
  if ('error' in selected) return errorText(`Error selecting rules: ${selected.error}`)

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
    const tracking = await readTracking(ctx.trackingPath)
    await writeTracking(ctx.trackingPath, upsertEntries(tracking, entries))
  }

  return envelope({
    mode,
    block: selected.block.label,
    considered: records.length,
    acted: batch.length,
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
export const handleRulesLint = async (_ctx: TriageContext, args: any): Promise<any> => {
  const parsed = parseRules(args?.rules ?? '')
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
