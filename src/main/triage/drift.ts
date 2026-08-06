/**
 * The drift pass — mechanical half only.
 *
 * Drift detection asks one question of every tracked message: is it still where
 * the engine put it? A message the user has moved by hand is a signal that the
 * rules disagree with the user, and the diff of those moves is the raw material
 * for rule induction. Generalising that diff into proposed rules is judgement
 * and stays with Claude; this tool does the counting, comparing and pruning and
 * writes no suggestions.
 *
 * Note that a tracked entry's `ruleset` records what the automation originally
 * matched while `triage_folder` records where the message sits now, so the two
 * disagreeing is exactly the signal — not an inconsistency to repair.
 */
import { z } from 'zod'
import { errorResult } from '../../utils/results.js'
import type { TriageContext } from './context.js'
import { buildFolderMap, findMessage } from './graph-ops.js'
import { pruneOlderThan, readTracking, type TrackingEntry, writeTracking } from './tracking.js'

/** Entries routed longer ago than this are dropped; the corpus stays a rolling window, not an archive. */
export const RETENTION_DAYS = 21

const reRouteSchema = z.object({
  subject: z.string(),
  from: z.string(),
  received: z.string(),
  ruleset: z.string(),
  from_folder: z.string(),
  to_folder: z.string()
})

export const driftScanResultSchema = z
  .object({
    scanned: z.number(),
    /** Entries left unexamined by this batch. Call again to continue. */
    remaining: z.number(),
    reRouted: z.array(reRouteSchema),
    prunedMissing: z.number(),
    prunedExpired: z.number(),
    trackedAfter: z.number()
  })
  .loose()

export type DriftScanResult = z.infer<typeof driftScanResultSchema>

const leafOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const summarise = (result: DriftScanResult): string => {
  const lines = [
    `Scanned ${result.scanned} tracked message(s)${result.remaining > 0 ? `, ${result.remaining} not yet examined — call again` : ''}.`,
    `${result.reRouted.length} manual re-route(s); pruned ${result.prunedMissing} missing and ${result.prunedExpired} expired; ${result.trackedAfter} entries tracked.`
  ]
  for (const item of result.reRouted) {
    lines.push(`- "${item.subject}" <${item.from}> ${item.from_folder} → ${item.to_folder} (matched \`${item.ruleset}\`)`)
  }
  if (result.reRouted.length > 0) {
    lines.push(
      '',
      'Each re-route is a case where the rules disagreed with the user. Generalise before proposing a rule — a pattern matching more than ~10% of the tracked corpus must be flagged for review, not queued silently.'
    )
  }
  return lines.join('\n')
}

/**
 * Compare every tracked message against its current folder, prune what has gone
 * or aged out, and return the re-route diff.
 *
 * Bounded by `maxEntries` for the same reason the triage pass is: one Graph
 * round trip per entry against a corpus of several hundred would not finish
 * inside the client timeout.
 */
export const handleDriftScan = async (ctx: TriageContext, args: any): Promise<any> => {
  try {
    const maxEntries: number = args?.maxEntries ?? 50
    const tracking = await readTracking(ctx.trackingPath)

    const { kept, pruned: expired } = pruneOlderThan(tracking, RETENTION_DAYS, new Date())
    const batch = kept.entries.slice(0, maxEntries)

    if (batch.length === 0) {
      if (expired.length > 0) await writeTracking(ctx.trackingPath, kept)
      return envelope({ scanned: 0, remaining: 0, reRouted: [], prunedMissing: 0, prunedExpired: expired.length, trackedAfter: kept.entries.length })
    }

    const accessToken = await ctx.ensureAuthenticated()
    const map = await buildFolderMap(ctx, accessToken)

    const reRouted: DriftScanResult['reRouted'] = []
    const survivors: TrackingEntry[] = []
    let prunedMissing = 0

    for (const entry of batch) {
      const message = await findMessage(ctx, accessToken, {
        subject: entry.subject,
        from: entry.from,
        received: entry.received,
        body: '',
        to: [],
        cc: [],
        ...(entry.id ? { id: entry.id } : {})
      })
      if (!message) {
        prunedMissing++
        continue
      }

      const currentPath = map.pathById.get(String(message.parentFolderId)) ?? ''
      const currentLeaf = leafOf(currentPath)
      const updated: TrackingEntry = { ...entry, id: String(message.id) }

      if (currentLeaf && currentLeaf !== entry.triage_folder) {
        reRouted.push({
          subject: entry.subject,
          from: entry.from,
          received: entry.received,
          ruleset: entry.ruleset,
          from_folder: entry.triage_folder,
          to_folder: currentLeaf
        })
        updated.triage_folder = currentLeaf
      }
      survivors.push(updated)
    }

    const nextEntries = [...survivors, ...kept.entries.slice(maxEntries)]
    await writeTracking(ctx.trackingPath, { entries: nextEntries })

    return envelope({
      scanned: batch.length,
      remaining: Math.max(0, kept.entries.length - maxEntries),
      reRouted,
      prunedMissing,
      prunedExpired: expired.length,
      trackedAfter: nextEntries.length
    })
  } catch (error) {
    return errorResult('scanning for drift', error)
  }
}

const envelope = (result: DriftScanResult) => ({
  content: [{ type: 'text' as const, text: summarise(result) }],
  structuredContent: result
})
