import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import {
  assertAttachmentRequestSize,
  handleGetAttachment,
  handleListAttachments,
  prepareInlineAttachments
} from './attachments.js'

vi.mock('../graph-client/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../graph-client/index.js')>()
  return { ...actual, callGraphAPI: vi.fn() }
})

const graph = callGraphAPI as Mock
const auth = vi.fn()
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: auth }
const id = 'message1'
const file = {
  id: 'attachment1',
  name: 'a.txt',
  contentType: 'text/plain',
  size: 3,
  isInline: false,
  '@odata.type': '#microsoft.graph.fileAttachment'
}

beforeEach(() => {
  graph.mockReset()
  auth.mockReset().mockResolvedValue('token')
})

describe('metadata-only attachment listing', () => {
  it('returns bounded metadata without Graph contentBytes', async () => {
    graph.mockResolvedValue({
      value: [
        { ...file, contentBytes: 'c2VjcmV0' },
        { ...file, id: 'item', '@odata.type': '#microsoft.graph.itemAttachment' }
      ]
    })
    const output = await handleListAttachments(ctx, { id, count: 2 })
    expect(output).toMatchObject({
      structuredContent: {
        items: [
          {
            id: file.id,
            name: file.name,
            contentType: file.contentType,
            size: 3,
            isInline: false,
            kind: 'fileAttachment'
          },
          {
            id: 'item',
            name: file.name,
            contentType: file.contentType,
            size: 3,
            isInline: false,
            kind: 'itemAttachment'
          }
        ]
      }
    })
    expect(JSON.stringify(output)).not.toContain('c2VjcmV0')
    expect(graph.mock.calls[0][6]).toEqual({ maxResponseBytes: 256 * 1024, redactErrorBody: true })
  })

  it('follows a pinned continuation for the same message', async () => {
    const nextLink = `${GRAPH_API_ENDPOINT}me/messages/${id}/attachments?$skip=2`
    graph.mockResolvedValue({ value: [], '@odata.nextLink': nextLink })
    expect(await handleListAttachments(ctx, { id })).toMatchObject({ structuredContent: { nextLink } })
    await handleListAttachments(ctx, { id, nextLink })
    expect(graph.mock.calls[1][3]).toBe(nextLink)
    expect(graph.mock.calls[1][5]).toEqual({})
  })

  it.each([
    'https://attacker.example/me/messages/message1/attachments',
    `${GRAPH_API_ENDPOINT}me/messages/other/attachments`,
    'not-a-url'
  ])('rejects a foreign or malformed continuation before auth', async (nextLink) => {
    const output = await handleListAttachments(ctx, { id, nextLink })
    expect(output).toMatchObject({ isError: true })
    expect(output.content[0].text).not.toContain(nextLink)
    expect(auth).not.toHaveBeenCalled()
  })

  it('rejects malformed or excessive Graph metadata without echoing bytes', async () => {
    for (const value of [undefined, Array(101).fill(file), [{ ...file, size: -1 }], [{ ...file, id: 3 }]]) {
      graph.mockResolvedValueOnce({ value })
      expect(await handleListAttachments(ctx, { id })).toMatchObject({ isError: true })
    }
    graph.mockResolvedValueOnce({ value: [], '@odata.nextLink': 7 })
    expect(await handleListAttachments(ctx, { id })).toMatchObject({ isError: true })
  })

  it('returns a generic error when Graph rejects the call', async () => {
    graph.mockRejectedValue(new Error('UNAUTHORIZED'))
    expect((await handleListAttachments(ctx, { id })).content[0].text).toContain('UNAUTHORIZED')
    graph.mockRejectedValueOnce('non-error failure')
    expect((await handleListAttachments(ctx, { id })).content[0].text).toContain('unknown error')
  })

  it('defaults absent MIME metadata without returning file bytes', async () => {
    graph.mockResolvedValue({ value: [{ ...file, contentType: undefined, isInline: true }] })
    expect(await handleListAttachments(ctx, { id })).toMatchObject({
      structuredContent: { items: [{ contentType: '', isInline: true }] }
    })
  })
})

describe('explicit file download', () => {
  it('routes authorization failures to the normal sign-in hint', async () => {
    auth.mockRejectedValue(new Error('UNAUTHORIZED'))
    const output = await handleGetAttachment(ctx, { id, attachmentId: file.id })
    expect(output).toMatchObject({ isError: true })
    expect(output.content[0].text).toContain('m365_auth_start')
    expect(graph).not.toHaveBeenCalled()
  })
  it('returns a generic error for a non-Error provider failure', async () => {
    graph.mockRejectedValue('non-error failure')
    expect((await handleGetAttachment(ctx, { id, attachmentId: file.id })).content[0].text).toContain('unknown error')
  })
  it('checks metadata before fetching bytes and marks the result untrusted', async () => {
    graph.mockResolvedValueOnce(file).mockResolvedValueOnce({ ...file, contentBytes: 'YWJj' })
    const output = await handleGetAttachment(ctx, { id, attachmentId: file.id })
    expect(output).toMatchObject({
      structuredContent: { type: 'file-attachment', trust: 'untrusted-data', contentBytes: 'YWJj' }
    })
    expect(graph.mock.calls).toHaveLength(2)
    expect(graph.mock.calls[0][5]).toEqual({ $select: 'id,name,contentType,size,isInline' })
    expect(graph.mock.calls[1][6]).toEqual({ maxResponseBytes: 512 * 1024, redactErrorBody: true })
  })

  it.each([
    [{ ...file, size: 256 * 1024 + 1 }, '256 KiB'],
    [{ ...file, '@odata.type': '#microsoft.graph.itemAttachment' }, 'Only file attachments'],
    [{ ...file, '@odata.type': '#microsoft.graph.referenceAttachment' }, 'Only file attachments'],
    [{ ...file, '@odata.type': '#other.type' }, 'Only file attachments']
  ])('rejects unsupported or oversized metadata before bytes', async (metadata, message) => {
    graph.mockResolvedValueOnce(metadata)
    expect((await handleGetAttachment(ctx, { id, attachmentId: file.id })).content[0].text).toContain(message)
    expect(graph).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ ...file, id: 'other', contentBytes: 'YWJj' }, 'changed'],
    [{ ...file, size: 4, contentBytes: 'YWJj' }, 'changed'],
    [{ ...file, contentBytes: '@@@' }, 'canonical base64'],
    [{ ...file, contentBytes: 'YWJ=' }, 'invalid'],
    [{ ...file, contentBytes: 'YWJjZA==' }, 'disagrees']
  ])('rejects changed or malformed downloaded content', async (full, message) => {
    graph.mockResolvedValueOnce(file).mockResolvedValueOnce(full)
    expect((await handleGetAttachment(ctx, { id, attachmentId: file.id })).content[0].text).toContain(message)
  })

  it('rejects a provider response whose encoded bytes exceed the download ceiling', async () => {
    graph
      .mockResolvedValueOnce(file)
      .mockResolvedValueOnce({ ...file, contentBytes: Buffer.alloc(256 * 1024 + 4).toString('base64') })
    expect((await handleGetAttachment(ctx, { id, attachmentId: file.id })).content[0].text).toContain(
      'inline byte limit'
    )
  })
})

describe('inline attachment validation', () => {
  const attachment = { name: 'a.txt', contentType: 'text/plain', contentBytes: 'YWJj' }

  it('passes absent attachments through and wraps a valid file', () => {
    expect(prepareInlineAttachments(undefined)).toBeUndefined()
    expect(prepareInlineAttachments([attachment])).toEqual([
      { '@odata.type': '#microsoft.graph.fileAttachment', ...attachment }
    ])
  })

  it.each([
    [{ ...attachment, contentBytes: 'Y WJj' }],
    [{ ...attachment, contentBytes: 'YWJ=' }],
    [{ ...attachment, contentBytes: '' }],
    [{ ...attachment, name: 'a\nb' }],
    [{ ...attachment, contentType: 'bad' }],
    Array(11).fill(attachment)
  ])('rejects malformed files', (value) => {
    expect(() => prepareInlineAttachments(value)).toThrow()
  })

  it('enforces exact decoded per-file and aggregate boundaries', () => {
    const atLimit = Buffer.alloc(2 * 1024 * 1024).toString('base64')
    expect(prepareInlineAttachments([{ ...attachment, contentBytes: atLimit }])).toHaveLength(1)
    expect(() =>
      prepareInlineAttachments([{ ...attachment, contentBytes: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }])
    ).toThrow('byte limit')
    expect(() =>
      prepareInlineAttachments([{ ...attachment, contentBytes: Buffer.alloc(2 * 1024 * 1024 + 4).toString('base64') }])
    ).toThrow('at most 10 files')
    expect(() => prepareInlineAttachments([{ ...attachment, contentBytes: atLimit }, attachment])).toThrow('aggregate')
  })

  it('caps the final serialized Graph request including the body', () => {
    expect(() => assertAttachmentRequestSize({ body: 'a'.repeat(3_999_988) })).not.toThrow()
    expect(() => assertAttachmentRequestSize({ body: 'a'.repeat(4_000_000) })).toThrow('request limit')
  })
})
