/**
 * The `save-attachments:` rule action.
 *
 * Saving an attachment out of a message is a *mechanism*. Which messages it
 * happens to, and what happens to the mail afterwards, are *policy*, and policy
 * in this system lives in one ordered rule list in the knowledge base — not in
 * this server. So there is no harvest tool and no configured source folder
 * here: a rule says
 *
 * ```rules
 * folder:"282 HNR Finance" has:attachment subject:receipt -> save-attachments:receipts, move:_ARCHIVE/Internal/Finance, mark:read
 * ```
 *
 * and the aged pass carries it out. The disposal gate comes free from the
 * engine: `applyActions` runs a rule's actions in written order and stops at
 * the first failure, so a save that fails takes the `move:` with it and the
 * mail stays where it was for the next run to retry.
 *
 * Where `receipts` points is policy too, so the note declares that as well, in
 * a ```destinations block beside the rules. What remains configuration is the
 * one thing a note must not be able to choose: the directories this server may
 * write into at all. Attachments are attacker-supplied bytes and rules are data
 * read from a file, so the roots are the boundary — a note picks a folder
 * inside them, never outside.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { errMessage } from '../../utils/errors.js'
import { assertWithinRoots } from '../../utils/paths.js'
import type { GraphContext } from '../graph-client/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import type { EmailRecord } from '../triage/types.js'
import {
  amountFromPdfText,
  composeFilename,
  deconflict,
  documentKind,
  slugifyVendor,
  vendorFromSubject
} from './naming.js'
import type { PdfTextExtractor } from './pdf-text.js'

/** Per-attachment ceiling. A receipt PDF is tens of kilobytes; this rejects anything that is not one. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

/** One file the saver wrote, or would have written. */
export interface SavedFile {
  filename: string
  /** The attachment name as the sender wrote it. */
  source: string
  /** The transaction total read out of the PDF, or null when no labelled total was found. */
  amount: string | null
  written: boolean
}

export interface SaveRequest {
  accessToken: string
  /** The message id as resolved by the caller; a move reissues it, so the caller owns ordering. */
  messageId: string
  /** Supplies the date and the subject the vendor is read from. */
  record: EmailRecord
  /** The destination name from the rule line. */
  destination: string
  /** Name → path, as declared in the rule note this run parsed. */
  destinations: Readonly<Record<string, string>>
}

export interface SaveOutcome {
  ok: boolean
  files: SavedFile[]
  /** Why it failed, in the words a reviewer needs. Absent on success. */
  detail?: string
}

/**
 * Saves the attachments of one message. Injected into the triage context so the
 * engine has no filesystem or PDF concerns of its own, and so the tests need
 * neither `pdftotext` nor a real document.
 */
export type AttachmentSaver = (request: SaveRequest) => Promise<SaveOutcome>

export interface AttachmentsConfig {
  /** Directories the saver may write into. Empty means no rule can save anything. */
  roots: readonly string[]
  /** PDF text extraction, for reading the transaction total. */
  extractPdfText: PdfTextExtractor
}

/** A non-inline PDF attachment, as listed before its bytes are fetched. */
interface AttachmentRef {
  id: string
  name: string
  size: number
}

const listPdfAttachments = async (ctx: GraphContext, token: string, messageId: string): Promise<AttachmentRef[]> => {
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
  ctx: GraphContext,
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

/** Build the saver the triage context injects. */
export const makeAttachmentSaver =
  (ctx: GraphContext, config: AttachmentsConfig): AttachmentSaver =>
  async ({ accessToken, messageId, record, destination, destinations }: SaveRequest): Promise<SaveOutcome> => {
    if (config.roots.length === 0) {
      return {
        ok: false,
        files: [],
        detail: 'this server has no attachment roots configured, so no rule may save attachments'
      }
    }

    const declared = destinations[destination]
    if (!declared) {
      const known = Object.keys(destinations)
      return {
        ok: false,
        files: [],
        detail:
          known.length === 0
            ? `destination "${destination}" is not declared — the rule note has no destinations block`
            : `destination "${destination}" is not declared in the rule note (declared: ${known.join(', ')})`
      }
    }

    let directory: string
    try {
      directory = await assertWithinRoots(config.roots, declared, `attachment destination "${destination}"`)
    } catch (error) {
      return { ok: false, files: [], detail: errMessage(error) }
    }

    try {
      const attachments = await listPdfAttachments(ctx, accessToken, messageId)
      // Nothing to save is a success. `has:attachment` is true for an inline
      // image too, and failing here would block the rule's `move:` and leave
      // the mail wedged in the triage folder on every subsequent run.
      if (attachments.length === 0) return { ok: true, files: [] }

      await fs.mkdir(directory, { recursive: true })
      // Names already on disk, so a second run deconflicts rather than
      // colliding with a file the consumer has already seen.
      const taken = new Set(await fs.readdir(directory))

      const date = record.received.slice(0, 10)
      const vendor = slugifyVendor(vendorFromSubject(record.subject))
      const files: SavedFile[] = []
      const written: string[] = []

      // A part-written message is rolled back rather than left behind. The
      // rule's `move:` is blocked by the failure, so the mail is retried on the
      // next run; without the rollback that retry would write `-2` copies of
      // everything that had already succeeded.
      const rollback = async (detail: string): Promise<SaveOutcome> => {
        await Promise.all(written.map((file) => fs.rm(file, { force: true })))
        return { ok: false, files: files.map((file) => ({ ...file, written: false })), detail }
      }

      for (const attachment of attachments) {
        if (attachment.size > MAX_ATTACHMENT_BYTES) {
          return await rollback(
            `"${attachment.name}" is ${attachment.size} bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit`
          )
        }

        const pdf = await fetchAttachmentBytes(ctx, accessToken, messageId, attachment.id)
        const text = await config.extractPdfText(pdf)
        const found = text ? amountFromPdfText(text) : null
        const filename = deconflict(
          composeFilename({ date, vendor, amount: found?.amount ?? null, kind: documentKind(attachment.name) }),
          taken
        )
        taken.add(filename)

        // `wx` fails rather than overwriting: a name that already exists is
        // either a duplicate run or a genuine collision the deconflicter
        // missed, and both are better reported than silently resolved.
        const target = path.join(directory, filename)
        try {
          await fs.writeFile(target, pdf, { flag: 'wx' })
        } catch (error) {
          return await rollback(`could not write "${filename}": ${errMessage(error)}`)
        }
        written.push(target)
        files.push({ filename, source: attachment.name, amount: found?.amount ?? null, written: true })
      }

      return { ok: true, files }
    } catch (error) {
      return { ok: false, files: [], detail: errMessage(error) }
    }
  }
