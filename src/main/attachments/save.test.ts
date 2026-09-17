import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import type { EmailRecord } from '../triage/types.js'
import { MAX_ATTACHMENT_BYTES, makeAttachmentSaver } from './save.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))

const mockCall = callGraphAPI as Mock
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: vi.fn() }
const TOKEN = 'token'

/** The bytes are never parsed here — the extractor is injected — so any buffer will do. */
const PDF = Buffer.from('%PDF-1.4 pretend document')
const asBase64 = PDF.toString('base64')

let root: string
let destination: string

const record = (over: Partial<EmailRecord> = {}): EmailRecord => ({
  subject: 'Your receipt from Anthropic, PBC',
  body: '',
  from: 'billing@vendor.example.com',
  to: [],
  cc: [],
  received: '2026-08-13T09:00:00Z',
  ...over
})

/** Attachment metadata as the list call returns it. */
const item = (over: Record<string, unknown> = {}) => ({
  id: 'att-1',
  name: 'receipt.pdf',
  contentType: 'application/pdf',
  size: 1024,
  isInline: false,
  ...over
})

/**
 * Answer the two Graph calls the saver makes: one list, then one fetch per
 * attachment. Fetches are keyed by id so the order of writes is visible in the
 * assertions rather than implied.
 */
const graphReturns = (attachments: Record<string, unknown>[], bytes: Record<string, unknown> = {}): void => {
  mockCall.mockImplementation(async (_endpoint, _token, _method, url: string) => {
    if (url.endsWith('/attachments')) return { value: attachments }
    const id = url.slice(url.lastIndexOf('/') + 1)
    return bytes[id] ?? { contentBytes: asBase64 }
  })
}

const saver = (over: Partial<Parameters<typeof makeAttachmentSaver>[1]> = {}) =>
  makeAttachmentSaver(ctx, {
    roots: [root],
    destinations: { receipts: destination },
    extractPdfText: async () => 'Amount paid  £5.14',
    ...over
  })

beforeEach(async () => {
  vi.clearAllMocks()
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'attachments-'))
  destination = path.join(root, 'Receipts')
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('destination resolution', () => {
  it('refuses a name that is not configured, naming the ones that are', async () => {
    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'invoices' })
    expect(outcome).toEqual({
      ok: false,
      files: [],
      detail: 'destination "invoices" is not configured (have: receipts)'
    })
    // Nothing was fetched: the name is rejected before the message is touched.
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('says so plainly when the server has no destinations at all', async () => {
    const outcome = await saver({ destinations: {} })({
      accessToken: TOKEN,
      messageId: 'msg-1',
      record: record(),
      destination: 'receipts'
    })
    expect(outcome.detail).toBe('no attachment destinations are configured on this server')
  })

  it('refuses a configured path that sits outside the permitted roots', async () => {
    // The roots are the safety boundary, and a destination is only as trusted
    // as the root it falls inside — a typo in one env var must not widen it.
    const outcome = await saver({ destinations: { receipts: path.join(os.tmpdir(), 'elsewhere') } })({
      accessToken: TOKEN,
      messageId: 'msg-1',
      record: record(),
      destination: 'receipts'
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain('attachment destination "receipts"')
    expect(mockCall).not.toHaveBeenCalled()
  })
})

describe('selecting attachments', () => {
  it('saves the PDFs, named from the received date, the subject and the amount in the document', async () => {
    graphReturns([item({ id: 'a', name: 'Receipt-2026-08.pdf' }), item({ id: 'b', name: 'Invoice-2026-08.pdf' })])

    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })

    expect(outcome.ok).toBe(true)
    expect(outcome.files).toEqual([
      { filename: '2026-08-13_anthropic_5.14.pdf', source: 'Receipt-2026-08.pdf', amount: '5.14', written: true },
      {
        filename: '2026-08-13_anthropic_5.14_invoice.pdf',
        source: 'Invoice-2026-08.pdf',
        amount: '5.14',
        written: true
      }
    ])
    expect((await fs.readdir(destination)).sort()).toEqual([
      '2026-08-13_anthropic_5.14.pdf',
      '2026-08-13_anthropic_5.14_invoice.pdf'
    ])
  })

  it('ignores inline images and anything that is not a PDF', async () => {
    graphReturns([
      item({ id: 'a', name: 'logo.png' }),
      item({ id: 'b', name: 'signature.pdf', isInline: true }),
      item({ id: 'c', name: 'receipt.pdf' })
    ])
    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })
    expect(outcome.files.map((file) => file.source)).toEqual(['receipt.pdf'])
  })

  it('tolerates a malformed entry in the collection', async () => {
    // Graph is being taken at its word about names and sizes, so an entry
    // missing either must not throw on the way past.
    graphReturns([null as unknown as Record<string, unknown>, { id: 'att-1', name: 'receipt.pdf' }])
    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })
    expect(outcome.ok).toBe(true)
    expect(outcome.files.map((file) => file.source)).toEqual(['receipt.pdf'])
  })

  it('treats a message with no PDF attachment as a success', async () => {
    // `has:attachment` is true of an inline image too. Failing here would block
    // the rule's `move:` and wedge the mail in the triage folder on every run.
    graphReturns([item({ name: 'logo.png' })])
    expect(
      await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })
    ).toEqual({ ok: true, files: [] })
    await expect(fs.readdir(destination)).rejects.toThrow()
  })

  it('tolerates a response carrying no attachment collection', async () => {
    mockCall.mockResolvedValue({})
    expect(
      await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })
    ).toEqual({ ok: true, files: [] })
  })
})

describe('naming on disk', () => {
  it('deconflicts against a file already in the folder rather than overwriting it', async () => {
    await fs.mkdir(destination, { recursive: true })
    await fs.writeFile(path.join(destination, '2026-08-13_anthropic_5.14.pdf'), 'earlier run')
    graphReturns([item()])

    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })

    expect(outcome.files[0]?.filename).toBe('2026-08-13_anthropic_5.14-2.pdf')
    expect(await fs.readFile(path.join(destination, '2026-08-13_anthropic_5.14.pdf'), 'utf8')).toBe('earlier run')
  })

  it('names an unreadable total `no-amount`, which is visible in the folder', async () => {
    graphReturns([item()])
    const outcome = await saver({ extractPdfText: async () => null })({
      accessToken: TOKEN,
      messageId: 'msg-1',
      record: record(),
      destination: 'receipts'
    })
    expect(outcome.files).toEqual([
      { filename: '2026-08-13_anthropic_no-amount.pdf', source: 'receipt.pdf', amount: null, written: true }
    ])
  })
})

describe('failure', () => {
  it('rolls back what it had already written when a later attachment is too large', async () => {
    graphReturns([
      item({ id: 'a', name: 'receipt.pdf' }),
      item({ id: 'b', name: 'invoice.pdf', size: 40 * 1024 * 1024 })
    ])

    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })

    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toBe(`"invoice.pdf" is 41943040 bytes, over the ${MAX_ATTACHMENT_BYTES}-byte limit`)
    // The rule's `move:` is blocked by this failure, so the message is retried
    // next run — and the retry must not find a half-saved set to duplicate.
    expect(outcome.files.every((file) => !file.written)).toBe(true)
    expect(await fs.readdir(destination)).toEqual([])
  })

  it('reports a write it could not make', async () => {
    // Readable but not writable: the folder can be listed, so the naming pass
    // runs and it is the write that fails.
    await fs.mkdir(destination, { recursive: true })
    await fs.chmod(destination, 0o500)
    graphReturns([item()])

    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })

    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain('could not write "2026-08-13_anthropic_5.14.pdf"')
    expect(outcome.files).toEqual([])
    await fs.chmod(destination, 0o700)
    expect(await fs.readdir(destination)).toEqual([])
  })

  it('reports an item or reference attachment rather than writing an empty file', async () => {
    graphReturns([item()], { 'att-1': { name: 'receipt.pdf' } })
    const outcome = await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })
    expect(outcome).toEqual({
      ok: false,
      files: [],
      detail: 'the attachment carried no contentBytes — it may be an item or reference attachment'
    })
  })

  it('reports a Graph failure as a failed outcome, not a throw', async () => {
    mockCall.mockRejectedValue(new Error('Graph unreachable'))
    expect(
      await saver()({ accessToken: TOKEN, messageId: 'msg-1', record: record(), destination: 'receipts' })
    ).toEqual({ ok: false, files: [], detail: 'Graph unreachable' })
  })
})
