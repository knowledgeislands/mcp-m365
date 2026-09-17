import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { getAllFolders } from '../email/folder-utils.js'
import { callGraphAPI } from '../graph-client/index.js'
import type { ReceiptsContext } from './context.js'
import { describeFailure, handleHarvest } from './harvest.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('../email/folder-utils.js', () => ({ getAllFolders: vi.fn() }))

const mockCall = callGraphAPI as Mock
const mockGetAllFolders = getAllFolders as Mock

const FOLDERS = [
  { id: 'triage-id', displayName: '_TRIAGE', parentFolderId: 'root' },
  { id: 'finance-id', displayName: '282 HNR Finance', parentFolderId: 'triage-id' },
  { id: 'archive-id', displayName: '_ARCHIVE', parentFolderId: 'root' },
  { id: 'internal-id', displayName: 'Internal', parentFolderId: 'archive-id' },
  { id: 'archive-finance-id', displayName: 'Finance', parentFolderId: 'internal-id' }
]

/** A Stripe-shaped receipt message with a paired invoice and receipt PDF. */
const anthropic = {
  id: 'msg-anthropic',
  subject: 'Your receipt from Anthropic, PBC #2842-9910',
  from: { emailAddress: { address: 'invoice+statements@mail.anthropic.com' } },
  receivedDateTime: '2026-09-13T07:14:00Z',
  hasAttachments: true
}

/** The message that makes a blanket sweep unsafe: finance mail that is not a receipt. */
const debtors = {
  id: 'msg-debtors',
  subject: 'FW: Appcheck Ltd - Overdue Payment',
  from: { emailAddress: { address: 'kris@humansnotrobots.com' } },
  receivedDateTime: '2026-09-11T11:02:00Z',
  hasAttachments: true
}

const attachment = (id: string, name: string, size = 40_000) => ({
  id,
  name,
  contentType: 'application/pdf',
  size,
  isInline: false
})

interface MailboxFixture {
  /** The messages the source folder holds, or a raw Graph payload for the malformed-response cases. */
  messages: Record<string, unknown>[] | Record<string, unknown>
  attachments: Record<string, unknown[]> | ((messageId: string) => unknown)
  /** Bytes returned for an attachment fetch. Default is a plausible PDF payload. */
  onFetch?: (attachmentId: string) => unknown
  /** Result of the archive move. Default is a successful move with a reissued id. */
  onMove?: () => unknown
}

/** Route mocked Graph calls by method and path, so tests describe a mailbox rather than a call sequence. */
const mailbox = (fixture: MailboxFixture) => {
  mockGetAllFolders.mockResolvedValue(FOLDERS)
  const messageList = Array.isArray(fixture.messages) ? fixture.messages : []
  mockCall.mockImplementation(async (_endpoint, _token, method: string, url: string) => {
    if (method === 'GET' && url === 'me/mailFolders/finance-id/messages') {
      return Array.isArray(fixture.messages) ? { value: fixture.messages } : fixture.messages
    }
    const list = url.match(/^me\/messages\/([^/]+)\/attachments$/)
    if (method === 'GET' && list) {
      const id = list[1] as string
      return typeof fixture.attachments === 'function'
        ? fixture.attachments(id)
        : { value: fixture.attachments[id] ?? [] }
    }
    const fetchOne = url.match(/^me\/messages\/([^/]+)\/attachments\/([^/]+)$/)
    if (method === 'GET' && fetchOne) {
      const id = fetchOne[2] as string
      return fixture.onFetch ? fixture.onFetch(id) : { contentBytes: Buffer.from(`pdf-for-${id}`).toString('base64') }
    }
    if (method === 'GET' && /^me\/messages\/[^/]+$/.test(url)) {
      return messageList.find((message) => url.endsWith(String((message as { id: string }).id)))
    }
    if (method === 'POST' && /\/move$/.test(url)) return fixture.onMove ? fixture.onMove() : { id: 'reissued-id' }
    throw new Error(`unexpected Graph call: ${method} ${url}`)
  })
}

let destination: string

const makeCtx = (over: Partial<ReceiptsContext> = {}): ReceiptsContext => ({
  graphApiEndpoint: GRAPH_API_ENDPOINT,
  ensureAuthenticated: vi.fn().mockResolvedValue('token'),
  roots: [destination],
  destination,
  extractPdfText: vi.fn().mockResolvedValue('Amount paid   £5.14'),
  ...over
})

beforeEach(async () => {
  vi.clearAllMocks()
  destination = await fs.mkdtemp(path.join(os.tmpdir(), 'receipts-'))
})

afterEach(async () => {
  await fs.rm(destination, { recursive: true, force: true })
})

const structured = (result: unknown) => (result as { structuredContent: any }).structuredContent

describe('report mode', () => {
  it('names every file without writing anything or touching the mailbox', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] }
    })

    const result = structured(await handleHarvest(makeCtx(), {}))

    expect(result.mode).toBe('report')
    expect(result.messages[0].files[0]).toMatchObject({
      filename: '2026-09-13_anthropic_5.14.pdf',
      amount: '5.14',
      currency: '£',
      written: false
    })
    expect(result.filesWritten).toBe(0)
    expect(result.messages[0].archived).toBe(false)
    expect(await fs.readdir(destination)).toEqual([])
    expect(mockCall.mock.calls.some(([, , method]) => method !== 'GET')).toBe(false)
  })
})

describe('selection', () => {
  it('leaves finance mail that is not a receipt in place', async () => {
    mailbox({
      messages: [debtors],
      attachments: { 'msg-debtors': [attachment('att-d', 'Sales Ledger Debtors Letters.pdf')] }
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.harvested).toBe(0)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain('not receipt-like')
    expect(await fs.readdir(destination)).toEqual([])
  })

  it('skips mail whose subject gives no sign of being a receipt', async () => {
    mailbox({
      messages: [{ ...anthropic, id: 'msg-statement', subject: 'Your monthly statement is ready' }],
      attachments: { 'msg-statement': [attachment('att-s', 'Statement-Sept.pdf')] }
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.harvested).toBe(0)
    expect(result.skipped[0].reason).toContain('subject: no')
    expect(result.skipped[0].reason).toContain('Statement-Sept.pdf')
  })

  it('skips mail with no PDF attachment', async () => {
    mailbox({ messages: [{ ...anthropic, hasAttachments: false }], attachments: {} })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.skipped[0].reason).toBe('no non-inline PDF attachment')
  })
})

describe('live mode', () => {
  it('writes both halves of an invoice/receipt pair under distinct names and archives the mail', async () => {
    mailbox({
      messages: [anthropic],
      attachments: {
        'msg-anthropic': [attachment('att-i', 'Invoice-2842-9910.pdf'), attachment('att-r', 'Receipt-2842-9910.pdf')]
      }
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.filesWritten).toBe(2)
    expect((await fs.readdir(destination)).sort()).toEqual([
      '2026-09-13_anthropic_5.14.pdf',
      '2026-09-13_anthropic_5.14_invoice.pdf'
    ])
    expect(result.messages[0].archived).toBe(true)
    const move = mockCall.mock.calls.find(([, , method, url]) => method === 'POST' && String(url).endsWith('/move'))
    expect(move?.[4]).toEqual({ destinationId: 'archive-finance-id' })
  })

  it('writes into a subdirectory when one is named', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] }
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live', subdirectory: '_archived/2026-09' }))

    expect(result.destination).toBe(path.join(await fs.realpath(destination), '_archived/2026-09'))
    expect(await fs.readdir(path.join(destination, '_archived/2026-09'))).toEqual(['2026-09-13_anthropic_5.14.pdf'])
  })

  it('does not overwrite a name already on disk', async () => {
    await fs.writeFile(path.join(destination, '2026-09-13_anthropic_5.14.pdf'), 'earlier run')
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] }
    })

    await handleHarvest(makeCtx(), { mode: 'live' })

    expect(await fs.readFile(path.join(destination, '2026-09-13_anthropic_5.14.pdf'), 'utf8')).toBe('earlier run')
    expect(await fs.readdir(destination)).toContain('2026-09-13_anthropic_5.14-2.pdf')
  })

  it('files a PDF whose total it cannot read as no-amount rather than guessing', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] }
    })

    const result = structured(
      await handleHarvest(makeCtx({ extractPdfText: vi.fn().mockResolvedValue(null) }), { mode: 'live' })
    )

    expect(result.messages[0].files[0].filename).toBe('2026-09-13_anthropic_no-amount.pdf')
    expect(result.warnings.join(' ')).toContain('No labelled total')
    expect(result.messages[0].archived).toBe(true)
  })
})

describe('disposal gate', () => {
  it('leaves the message in place when an attachment could not be saved', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf', 99 * 1024 * 1024)] }
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.messages[0].archived).toBe(false)
    expect(result.warnings.join(' ')).toContain('over the size limit')
    expect(mockCall.mock.calls.some(([, , method]) => method === 'POST')).toBe(false)
  })

  it('warns loudly when receipts were saved but the mail could not be archived', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] },
      onMove: () => {
        throw new Error('mailbox quota exceeded')
      }
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.filesWritten).toBe(1)
    expect(result.messages[0].archived).toBe(false)
    expect(result.warnings.join(' ')).toContain('archive it by hand')
  })

  it('refuses the whole run when the archive folder does not exist', async () => {
    mailbox({ messages: [anthropic], attachments: {} })

    const result = (await handleHarvest(makeCtx(), { mode: 'live', archiveTo: '_ARCHIVE/Nope' })) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('nothing was harvested')
  })
})

describe('path constraint', () => {
  it('refuses a subdirectory that escapes the configured roots', async () => {
    mailbox({ messages: [], attachments: {} })

    const result = (await handleHarvest(makeCtx(), { subdirectory: '../../elsewhere' })) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('resolves outside the configured roots')
  })

  it('refuses to run at all with no destination configured', async () => {
    const result = (await handleHarvest(makeCtx({ destination: '' }), {})) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('MCP_M365_RECEIPTS_DIR')
  })
})

describe('batching', () => {
  it('reports more remaining when the folder holds more than the batch', async () => {
    mailbox({
      messages: [anthropic, { ...anthropic, id: 'msg-2' }],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] }
    })

    const result = structured(await handleHarvest(makeCtx(), { maxMessages: 1 }))

    expect(result.considered).toBe(1)
    expect(result.remaining).toBe(true)
  })
})

describe('Graph responses that are not the happy shape', () => {
  it('treats a message list with no value array as an empty folder', async () => {
    mailbox({ messages: {}, attachments: {} })

    const result = structured(await handleHarvest(makeCtx(), {}))

    expect(result.considered).toBe(0)
    expect(result.remaining).toBe(false)
  })

  it('treats an attachment list with no value array as no attachments', async () => {
    mailbox({ messages: [anthropic], attachments: () => ({}) })

    const result = structured(await handleHarvest(makeCtx(), {}))

    expect(result.skipped[0].reason).toBe('no non-inline PDF attachment')
  })

  it('ignores inline images, non-PDFs and unnamed parts', async () => {
    mailbox({
      messages: [anthropic],
      attachments: {
        'msg-anthropic': [
          { ...attachment('att-logo', 'logo.pdf'), isInline: true },
          attachment('att-csv', 'receipt.csv'),
          { id: 'att-nameless', contentType: 'application/pdf', isInline: false },
          { id: 'att-r', name: 'Receipt-2842-9910.pdf', contentType: 'application/pdf', isInline: false }
        ]
      }
    })

    const result = structured(await handleHarvest(makeCtx(), {}))

    // The one real receipt is taken; the sizeless part is tolerated, not crashed on.
    expect(result.messages[0].files).toHaveLength(1)
    expect(result.messages[0].files[0].source).toBe('Receipt-2842-9910.pdf')
  })

  it('reports an attachment carrying no bytes and leaves the mail in place', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] },
      // An item or reference attachment: listed as an attachment, no contentBytes.
      onFetch: () => ({ '@odata.type': '#microsoft.graph.itemAttachment' })
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.messages[0].files[0]).toMatchObject({ source: 'Receipt-2842-9910.pdf', written: false })
    expect(result.messages[0].archived).toBe(false)
    expect(result.warnings.join(' ')).toContain('no contentBytes')
  })

  it('reports a Graph failure as a tool error rather than throwing', async () => {
    mockGetAllFolders.mockRejectedValue(new Error('Graph is having a day'))

    const result = (await handleHarvest(makeCtx(), {})) as { isError: boolean; content: { text: string }[] }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('Graph is having a day')
  })

  it('refuses a source folder that does not exist', async () => {
    mailbox({ messages: [], attachments: {} })

    const result = (await handleHarvest(makeCtx(), { folder: '_TRIAGE/999 Nope' })) as {
      isError: boolean
      content: { text: string }[]
    }

    expect(result.isError).toBe(true)
    expect(result.content[0]?.text).toContain('was not found in the mailbox')
  })
})

describe('report output', () => {
  it('reads as a review of what would happen', async () => {
    mailbox({
      messages: [anthropic, debtors],
      attachments: {
        'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')],
        'msg-debtors': [attachment('att-d', 'Sales Ledger Debtors Letters.pdf')]
      }
    })

    // A document printing its total with no currency symbol, which the report
    // must still render.
    const result = (await handleHarvest(makeCtx({ extractPdfText: vi.fn().mockResolvedValue('Total 5.14') }), {})) as {
      content: { text: string }[]
    }
    const text = result.content[0]?.text ?? ''

    expect(text).toContain('[report] would harvest 0 file(s) from 1 of 2 message(s)')
    expect(text).toContain('2026-09-13_anthropic_5.14.pdf  [5.14]')
    expect(text).toContain('Left in place:')
    expect(text).toContain('Sales Ledger Debtors Letters.pdf')
  })

  it('does not fail on a destination that does not exist yet', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] }
    })

    const result = structured(await handleHarvest(makeCtx(), { subdirectory: 'not-created-yet' }))

    expect(result.messages[0].files[0].filename).toBe('2026-09-13_anthropic_5.14.pdf')
  })

  it('names a live run and its failures plainly', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] },
      onMove: () => {
        throw new Error('quota')
      }
    })

    const result = (await handleHarvest(makeCtx(), { mode: 'live' })) as { content: { text: string }[] }
    const text = result.content[0]?.text ?? ''

    expect(text).toContain('Harvested 1 file(s)')
    expect(text).toContain('(NOT archived)')
  })
})

describe('vendor and amount gaps', () => {
  it('warns when no vendor can be derived and files it as unknown', async () => {
    mailbox({
      messages: [{ ...anthropic, id: 'msg-bare', subject: 'Receipt' }],
      attachments: { 'msg-bare': [attachment('att-r', 'receipt.pdf')] }
    })

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    expect(result.messages[0].vendor).toBeNull()
    expect(result.messages[0].files[0].filename).toBe('2026-09-13_unknown-vendor_5.14.pdf')
    expect(result.warnings.join(' ')).toContain('No vendor could be derived')
  })

  it('leaves the mail in place when the file cannot be written to disk', async () => {
    mailbox({
      messages: [anthropic],
      attachments: { 'msg-anthropic': [attachment('att-r', 'Receipt-2842-9910.pdf')] }
    })
    await fs.chmod(destination, 0o500)

    const result = structured(await handleHarvest(makeCtx(), { mode: 'live' }))

    await fs.chmod(destination, 0o700)
    expect(result.filesWritten).toBe(0)
    expect(result.messages[0].files[0]).toMatchObject({
      // The name it was about to use is reported, so the failure is diagnosable.
      filename: '2026-09-13_anthropic_5.14.pdf',
      written: false
    })
    expect(result.messages[0].archived).toBe(false)
    expect(result.warnings.join(' ')).toContain('Could not harvest')
  })
})

describe('describeFailure', () => {
  it('prefers the detail Graph gave', () => {
    expect(describeFailure([{ action: 'move:_ARCHIVE/Internal/Finance', ok: false, detail: 'quota exceeded' }])).toBe(
      'quota exceeded'
    )
  })

  it('falls back to the action name when there is no detail', () => {
    expect(describeFailure([{ action: 'move:_ARCHIVE/Internal/Finance', ok: false }])).toBe(
      'move:_ARCHIVE/Internal/Finance'
    )
  })

  it('ignores the actions that succeeded', () => {
    expect(
      describeFailure([
        { action: 'resolve', ok: true },
        { action: 'move:x', ok: false, detail: 'gone' }
      ])
    ).toBe('gone')
  })
})
