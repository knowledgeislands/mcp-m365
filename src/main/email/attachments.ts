/** Bounded, caller-scoped Graph message attachments. Returned bytes are untrusted data. */
import { z } from 'zod'
import { errorResult } from '../../utils/results.js'
import { assertGraphUrl, callGraphAPI, type GraphContext } from '../graph-client/index.js'

const MAX_DOWNLOAD_BYTES = 256 * 1024
const MAX_INLINE_BYTES = 2 * 1024 * 1024
const MAX_REQUEST_BYTES = 4_000_000
const MAX_ATTACHMENTS = 10
const LIST_RESPONSE_BYTES = 256 * 1024
const GET_RESPONSE_BYTES = 512 * 1024

export const inlineAttachmentSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(255)
      .refine((value) => !/[\r\n]/.test(value), 'name contains a newline'),
    contentType: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^\s/;]+\/[^\s;]+$/),
    contentBytes: z
      .string()
      .min(1)
      .max(Math.ceil(MAX_INLINE_BYTES / 3) * 4)
  })
  .strict()

export const inlineAttachmentsSchema = z.array(inlineAttachmentSchema).max(MAX_ATTACHMENTS)

export const attachmentListResultSchema = z
  .object({
    type: z.literal('attachment-list'),
    messageId: z.string(),
    items: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          contentType: z.string(),
          size: z.number(),
          isInline: z.boolean(),
          kind: z.string()
        })
        .strict()
    ),
    nextLink: z.string().nullable()
  })
  .strict()

export const attachmentGetResultSchema = z
  .object({
    type: z.literal('file-attachment'),
    trust: z.literal('untrusted-data'),
    messageId: z.string(),
    id: z.string(),
    name: z.string(),
    contentType: z.string(),
    size: z.number(),
    contentBytes: z.string()
  })
  .strict()

type GraphAttachment = {
  id?: unknown
  name?: unknown
  contentType?: unknown
  size?: unknown
  isInline?: unknown
  contentBytes?: unknown
  '@odata.type'?: unknown
}

const kindOf = (attachment: GraphAttachment): string => {
  const raw = attachment['@odata.type']
  return typeof raw === 'string' && /^#microsoft\.graph\.[A-Za-z]+Attachment$/.test(raw)
    ? raw.slice('#microsoft.graph.'.length)
    : 'unsupported'
}

const metadataOf = (attachment: GraphAttachment) => {
  if (
    typeof attachment.id !== 'string' ||
    typeof attachment.name !== 'string' ||
    typeof attachment.size !== 'number' ||
    !Number.isSafeInteger(attachment.size) ||
    attachment.size < 0
  )
    throw new Error('Graph returned invalid attachment metadata.')
  return {
    id: attachment.id,
    name: attachment.name,
    contentType: typeof attachment.contentType === 'string' ? attachment.contentType : '',
    size: attachment.size,
    isInline: attachment.isInline === true,
    kind: kindOf(attachment)
  }
}

const messagePath = (id: string): string => `me/messages/${id}/attachments`

const validateNextLink = (ctx: GraphContext, messageId: string, nextLink: string): void => {
  try {
    assertGraphUrl(ctx.graphApiEndpoint, nextLink)
    const expected = new URL(`${ctx.graphApiEndpoint}${messagePath(messageId)}`)
    if (new URL(nextLink).pathname !== expected.pathname) throw new Error('Wrong message')
  } catch {
    throw new Error('Invalid attachment continuation for this message or Graph host.')
  }
}

const result = (value: unknown) => ({
  resultType: 'complete' as const,
  structuredContent: value,
  content: [{ type: 'text' as const, text: JSON.stringify(value) }]
})

export const handleListAttachments = async (
  ctx: GraphContext,
  args: { id: string; count?: number; nextLink?: string }
) => {
  try {
    if (args.nextLink) validateNextLink(ctx, args.id, args.nextLink)
    const token = await ctx.ensureAuthenticated()
    const response = await callGraphAPI<{ value?: unknown; '@odata.nextLink'?: unknown }>(
      ctx.graphApiEndpoint,
      token,
      'GET',
      args.nextLink ?? messagePath(args.id),
      null,
      args.nextLink ? {} : { $top: args.count ?? 50, $select: 'id,name,contentType,size,isInline' },
      { maxResponseBytes: LIST_RESPONSE_BYTES, redactErrorBody: true }
    )
    if (!Array.isArray(response.value) || response.value.length > 100)
      throw new Error('Graph returned an invalid attachment page.')
    const items = response.value.map((entry) => metadataOf(entry as GraphAttachment))
    const nextLink = response['@odata.nextLink']
    if (nextLink !== undefined && typeof nextLink !== 'string')
      throw new Error('Graph returned an invalid continuation.')
    if (nextLink) validateNextLink(ctx, args.id, nextLink)
    return result(
      attachmentListResultSchema.parse({
        type: 'attachment-list',
        messageId: args.id,
        items,
        nextLink: nextLink ?? null
      })
    )
  } catch (error) {
    return errorResult('listing attachments', error instanceof Error ? error : new Error('unknown error'))
  }
}

export const handleGetAttachment = async (ctx: GraphContext, args: { id: string; attachmentId: string }) => {
  try {
    const token = await ctx.ensureAuthenticated()
    const path = `${messagePath(args.id)}/${args.attachmentId}`
    const metadata = metadataOf(
      await callGraphAPI<GraphAttachment>(
        ctx.graphApiEndpoint,
        token,
        'GET',
        path,
        null,
        { $select: 'id,name,contentType,size,isInline' },
        { maxResponseBytes: LIST_RESPONSE_BYTES, redactErrorBody: true }
      )
    )
    if (metadata.kind !== 'fileAttachment') throw new Error('Only file attachments can be downloaded.')
    if (metadata.size > MAX_DOWNLOAD_BYTES) throw new Error('Attachment exceeds the 256 KiB download limit.')
    const full = await callGraphAPI<GraphAttachment>(
      ctx.graphApiEndpoint,
      token,
      'GET',
      path,
      null,
      {},
      { maxResponseBytes: GET_RESPONSE_BYTES, redactErrorBody: true }
    )
    const current = metadataOf(full)
    if (JSON.stringify(current) !== JSON.stringify(metadata)) {
      throw new Error('Attachment metadata changed before download.')
    }
    const bytes = decodeBase64(full.contentBytes, MAX_DOWNLOAD_BYTES)
    if (bytes.byteLength !== current.size) throw new Error('Attachment size disagrees with downloaded bytes.')
    return result(
      attachmentGetResultSchema.parse({
        type: 'file-attachment',
        trust: 'untrusted-data',
        messageId: args.id,
        id: current.id,
        name: current.name,
        contentType: current.contentType,
        size: current.size,
        contentBytes: full.contentBytes
      })
    )
  } catch (error) {
    return errorResult('downloading attachment', error instanceof Error ? error : new Error('unknown error'))
  }
}

const decodeBase64 = (value: unknown, maxBytes: number): Buffer => {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Attachment contentBytes must be canonical base64.')
  }
  if (value.length > Math.ceil(maxBytes / 3) * 4) throw new Error('Attachment exceeds the inline byte limit.')
  const bytes = Buffer.from(value, 'base64')
  if (bytes.byteLength > maxBytes || bytes.toString('base64') !== value) {
    throw new Error('Attachment contentBytes is invalid or exceeds the byte limit.')
  }
  return bytes
}

export const prepareInlineAttachments = (attachments: unknown) => {
  if (attachments === undefined) return undefined
  const parsed = inlineAttachmentsSchema.safeParse(attachments)
  if (!parsed.success)
    throw new Error('Attachments require at most 10 files with name, MIME type, and base64 contentBytes.')
  let total = 0
  return parsed.data.map((attachment) => {
    total += decodeBase64(attachment.contentBytes, MAX_INLINE_BYTES).byteLength
    if (total > MAX_INLINE_BYTES) throw new Error('Attachments exceed the 2 MiB aggregate inline limit.')
    return { '@odata.type': '#microsoft.graph.fileAttachment', ...attachment }
  })
}

export const assertAttachmentRequestSize = (body: unknown): void => {
  if (Buffer.byteLength(JSON.stringify(body), 'utf8') >= MAX_REQUEST_BYTES) {
    throw new Error('Message exceeds the 4,000,000-byte inline request limit.')
  }
}
