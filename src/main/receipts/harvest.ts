/**
 * The receipt harvest pass.
 *
 * Reads a mail folder, saves the receipt and invoice PDFs attached to it into
 * the configured destination under a `YYYY-MM-DD_vendor_amount.pdf` name, and
 * archives the mail it harvested.
 *
 * Three properties are deliberate and were each established against real mail
 * in `_TRIAGE/282 HNR Finance` rather than assumed:
 *
 * - **Selection is conservative.** Only mail whose subject *and* whose
 *   attachment names look like a receipt qualifies. The folder legitimately
 *   holds other finance correspondence — one message was a forwarded overdue-
 *   payment letter carrying `Sales Ledger Debtors Letters.pdf` — and a blanket
 *   sweep would file a debtor chase letter as a receipt and then archive the
 *   correspondence out from under the reply it needed.
 * - **Disposal is an archive, never a delete, and never unconditional.** A
 *   message moves only after every one of its attachments is confirmed written
 *   to disk. A partial write leaves the mail exactly where it was, so the next
 *   run retries it.
 * - **The pass is batch-bounded and resumable**, like the triage passes: at
 *   most `maxMessages` per call, with `remaining` telling the caller to loop.
 *   Harvesting is slower per message than routing — an attachment download plus
 *   a `pdftotext` spawn each — so the default batch is smaller.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { errMessage } from '../../utils/errors.js'
import { assertWithinRoots } from '../../utils/paths.js'
import { errorResult, errorText } from '../../utils/results.js'
import { callGraphAPI } from '../graph-client/index.js'
import type { AppliedAction } from '../triage/graph-ops.js'
import { applyActions, buildFolderMap } from '../triage/graph-ops.js'
import { toEmailRecord } from '../triage/message.js'
import type { Action } from '../triage/types.js'
import type { ReceiptsContext } from './context.js'
import {
  amountFromPdfText,
  composeFilename,
  deconflict,
  documentKind,
  RECEIPT_PATTERN,
  slugifyVendor,
  vendorFromSubject
} from './naming.js'

/** The folder the routing rules already fill with vendor receipts. */
export const DEFAULT_SOURCE_FOLDER = '_TRIAGE/282 HNR Finance'

/** Where harvested mail goes afterwards — the same destination the aged retention block uses for this folder. */
export const DEFAULT_ARCHIVE_FOLDER = '_ARCHIVE/Internal/Finance'

const DEFAULT_MAX_MESSAGES = 20

/** Per-attachment ceiling. A receipt PDF is tens of kilobytes; this rejects anything that is not one. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const harvestedFileSchema = z.object({
  /** The name the file was given, or would be given in report mode. */
  filename: z.string(),
  /** The attachment name as the vendor sent it. */
  source: z.string(),
  /** The transaction total read out of the PDF, or null when no labelled total was found. */
  amount: z.string().nullable(),
  /** Currency symbol as printed in the PDF. Not part of the filename — see the convention note. */
  currency: z.string().nullable(),
  written: z.boolean()
})

const harvestedMessageSchema = z.object({
  subject: z.string(),
  from: z.string(),
  received: z.string(),
  vendor: z.string().nullable(),
  files: z.array(harvestedFileSchema),
  /** True once the message has been moved to the archive folder. Always false in report mode. */
  archived: z.boolean()
})

const skippedMessageSchema = z.object({
  subject: z.string(),
  from: z.string(),
  received: z.string(),
  /** Why this message was left alone, in the words a reviewer needs to judge whether the rule is right. */
  reason: z.string()
})

export const harvestResultSchema = z
  .object({
    mode: z.enum(['live', 'report']),
    source: z.string(),
    destination: z.string(),
    archiveTo: z.string(),
    considered: z.number(),
    harvested: z.number(),
    filesWritten: z.number(),
    /** True when the folder held more messages than this batch examined. Loop while `remaining` and progress is being made. */
    remaining: z.boolean(),
    messages: z.array(harvestedMessageSchema),
    skipped: z.array(skippedMessageSchema),
    warnings: z.array(z.string())
  })
  .loose()

export type HarvestResult = z.infer<typeof harvestResultSchema>

const summarise = (result: HarvestResult): string => {
  const lines = [
    `${result.mode === 'report' ? '[report] would harvest' : 'Harvested'} ${result.filesWritten} file(s) from ` +
      `${result.harvested} of ${result.considered} message(s) in "${result.source}".` +
      `${result.remaining ? ' More remain — call again.' : ''}`,
    `Destination: ${result.destination}`,
    `${result.mode === 'report' ? 'Would archive to' : 'Archived to'}: ${result.archiveTo}`
  ]
  for (const message of result.messages) {
    lines.push(`- "${message.subject}"${message.archived ? '' : result.mode === 'live' ? ' (NOT archived)' : ''}`)
    for (const file of message.files) {
      const amount = file.amount ? `${file.currency ?? ''}${file.amount}` : 'no amount found'
      lines.push(`    ${file.filename}  [${amount}]  <- ${file.source}${file.written ? '' : ' — NOT WRITTEN'}`)
    }
  }
  if (result.skipped.length > 0) {
    lines.push('', 'Left in place:', ...result.skipped.map((s) => `- "${s.subject}" — ${s.reason}`))
  }
  if (result.warnings.length > 0) {
    lines.push('', 'Warnings:', ...result.warnings.map((w) => `- ${w}`))
  }
  return lines.join('\n')
}

const envelope = (result: HarvestResult) => ({
  content: [{ type: 'text' as const, text: summarise(result) }],
  structuredContent: result
})

export interface HarvestArgs {
  folder?: string
  archiveTo?: string
  subdirectory?: string
  mode?: string
  maxMessages?: number
}

/** A non-inline PDF attachment, as listed before its bytes are fetched. */
interface AttachmentRef {
  id: string
  name: string
  size: number
}

const listPdfAttachments = async (ctx: ReceiptsContext, token: string, messageId: string): Promise<AttachmentRef[]> => {
  const response: any = await callGraphAPI(
    ctx.graphApiEndpoint,
    token,
    'GET',
    `me/messages/${messageId}/attachments`,
    null,
    { $select: 'id,name,contentType,size,isInline' }
  )
  const items = Array.isArray(response?.value) ? response.value : []
  return items
    .filter((item: any) => !item?.isInline && /\.pdf$/i.test(String(item?.name ?? '')))
    .map((item: any) => ({ id: String(item.id), name: String(item.name), size: Number(item.size ?? 0) }))
}

const fetchAttachmentBytes = async (
  ctx: ReceiptsContext,
  token: string,
  messageId: string,
  attachmentId: string
): Promise<Buffer> => {
  const full: any = await callGraphAPI(
    ctx.graphApiEndpoint,
    token,
    'GET',
    `me/messages/${messageId}/attachments/${attachmentId}`
  )
  if (typeof full?.contentBytes !== 'string') {
    throw new Error('the attachment carried no contentBytes — it may be an item or reference attachment')
  }
  return Buffer.from(full.contentBytes, 'base64')
}

/**
 * Resolve the directory this call writes into.
 *
 * `subdirectory` is relative to the configured destination and exists for the
 * bookkeeping convention of a `_archived/YYYY-MM/` folder per processed month.
 * It is root-checked like every other path, so `../..` buys nothing.
 */
const resolveDestination = async (
  ctx: ReceiptsContext,
  subdirectory: string | undefined
): Promise<{ path: string } | { error: string }> => {
  if (!ctx.destination) {
    return { error: 'No receipts destination configured — set MCP_M365_RECEIPTS_DIR to the staging folder.' }
  }
  const candidate = subdirectory?.trim() ? path.join(ctx.destination, subdirectory.trim()) : ctx.destination
  try {
    return { path: await assertWithinRoots(ctx.roots, candidate, 'receipts destination') }
  } catch (error) {
    return { error: errMessage(error) }
  }
}

/** Names already on disk, so a re-run cannot quietly overwrite a file the bookkeeper has already seen. */
const existingNames = async (directory: string): Promise<Set<string>> => {
  try {
    return new Set(await fs.readdir(directory))
  } catch {
    return new Set()
  }
}

/**
 * Why an archive attempt failed, for the warning a human has to act on.
 *
 * `detail` is where {@link applyActions} puts the reason, but it is optional, so
 * the action name is the fallback — a warning that named nothing would leave the
 * reader with saved receipts, unmoved mail and no idea which.
 */
export const describeFailure = (applied: readonly AppliedAction[]): string =>
  applied
    .filter((action) => !action.ok)
    .map((action) => action.detail ?? action.action)
    .join('; ')

export const handleHarvest = async (ctx: ReceiptsContext, args: HarvestArgs) => {
  const mode = args.mode === 'live' ? 'live' : 'report'
  const sourcePath = args.folder?.trim() || DEFAULT_SOURCE_FOLDER
  const archivePath = args.archiveTo?.trim() || DEFAULT_ARCHIVE_FOLDER
  const maxMessages = args.maxMessages ?? DEFAULT_MAX_MESSAGES

  const destination = await resolveDestination(ctx, args.subdirectory)
  if ('error' in destination) return errorText(destination.error)

  try {
    const token = await ctx.ensureAuthenticated()
    const map = await buildFolderMap(ctx, token)

    const sourceId = map.idByPath.get(sourcePath.toLowerCase())
    if (!sourceId) return errorText(`Source folder "${sourcePath}" was not found in the mailbox.`)
    if (mode === 'live' && !map.idByPath.has(archivePath.toLowerCase())) {
      // Checked up front: discovering this after the first attachment is
      // written would leave harvested mail sitting in the source folder with
      // its receipts already filed, which the next run would duplicate.
      return errorText(`Archive folder "${archivePath}" was not found in the mailbox — nothing was harvested.`)
    }

    const response: any = await callGraphAPI(
      ctx.graphApiEndpoint,
      token,
      'GET',
      `me/mailFolders/${sourceId}/messages`,
      null,
      {
        $top: maxMessages + 1,
        $select: 'id,subject,from,receivedDateTime,hasAttachments',
        $orderby: 'receivedDateTime asc'
      }
    )
    const all: any[] = Array.isArray(response?.value) ? response.value : []
    const batch = all.slice(0, maxMessages)

    if (mode === 'live') await fs.mkdir(destination.path, { recursive: true })
    // Seeded from disk and then extended as this run plans names, because two
    // messages in one batch can agree on a name that neither found on disk.
    const taken = await existingNames(destination.path)

    const messages: z.infer<typeof harvestedMessageSchema>[] = []
    const skipped: z.infer<typeof skippedMessageSchema>[] = []
    const warnings: string[] = []
    let filesWritten = 0

    for (const message of batch) {
      const record = toEmailRecord(message)
      const identity = { subject: record.subject, from: record.from, received: record.received }

      const attachments = message?.hasAttachments ? await listPdfAttachments(ctx, token, String(message.id)) : []
      const subjectLooksReceipty = RECEIPT_PATTERN.test(record.subject)
      const receipts = attachments.filter((attachment) => RECEIPT_PATTERN.test(attachment.name))

      if (attachments.length === 0) {
        skipped.push({ ...identity, reason: 'no non-inline PDF attachment' })
        continue
      }
      if (!subjectLooksReceipty || receipts.length === 0) {
        skipped.push({
          ...identity,
          reason: `not receipt-like (subject: ${subjectLooksReceipty ? 'yes' : 'no'}, attachments: ${attachments
            .map((a) => a.name)
            .join(', ')})`
        })
        continue
      }

      const date = record.received.slice(0, 10)
      const vendor = slugifyVendor(vendorFromSubject(record.subject))
      if (!vendor) warnings.push(`No vendor could be derived from "${record.subject}" — filed as unknown-vendor.`)

      const files: z.infer<typeof harvestedFileSchema>[] = []
      let allWritten = true

      for (const attachment of receipts) {
        if (attachment.size > MAX_ATTACHMENT_BYTES) {
          allWritten = false
          warnings.push(`"${attachment.name}" is ${attachment.size} bytes, over the size limit — skipped.`)
          continue
        }

        let filename = ''
        try {
          const bytes = await fetchAttachmentBytes(ctx, token, String(message.id), attachment.id)
          const text = await ctx.extractPdfText(bytes)
          const found = text ? amountFromPdfText(text) : null
          filename = deconflict(
            composeFilename({ date, vendor, amount: found?.amount ?? null, kind: documentKind(attachment.name) }),
            taken
          )
          taken.add(filename)

          if (mode === 'live') {
            // `wx` rather than a plain write: the deconflict pass should have
            // made the name free, and if it did not, failing is right — these
            // are the only copies of a financial record.
            await fs.writeFile(path.join(destination.path, filename), bytes, { flag: 'wx' })
            filesWritten++
          }
          files.push({
            filename,
            source: attachment.name,
            amount: found?.amount ?? null,
            currency: found?.currency ?? null,
            written: mode === 'live'
          })
          if (!found) warnings.push(`No labelled total found in "${attachment.name}" — filed as no-amount.`)
        } catch (error) {
          allWritten = false
          files.push({
            filename: filename || attachment.name,
            source: attachment.name,
            amount: null,
            currency: null,
            written: false
          })
          warnings.push(`Could not harvest "${attachment.name}": ${errMessage(error)}`)
        }
      }

      // The disposal gate. Anything short of every attachment written leaves
      // the message in the source folder for the next run to retry.
      let archived = false
      if (mode === 'live' && allWritten && files.length > 0) {
        // `quoted` marks the target as an absolute folder path rather than a
        // `_TRIAGE`-relative leaf, so a single-segment archive folder is not
        // silently reinterpreted as a triage subfolder.
        const move: Action = { kind: 'move', value: archivePath, quoted: true }
        const { applied } = await applyActions(ctx, token, record, [move], map)
        archived = applied.every((action) => action.ok)
        if (!archived) {
          warnings.push(
            `Receipts from "${record.subject}" were saved but the message could not be archived: ` +
              `${describeFailure(applied)}. Re-running would duplicate them — archive it by hand.`
          )
        }
      }

      messages.push({ ...identity, vendor, files, archived })
    }

    return envelope({
      mode,
      source: sourcePath,
      destination: destination.path,
      archiveTo: archivePath,
      considered: batch.length,
      harvested: messages.length,
      filesWritten,
      remaining: all.length > batch.length,
      messages,
      skipped,
      warnings
    })
  } catch (error) {
    return errorResult('harvesting receipt attachments', error)
  }
}
