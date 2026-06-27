/**
 * Coverage tests for the small email handlers (read/draft/send/delete/mark-as-read).
 * list/search/folder-utils have their own focused test files.
 */
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { processHtmlEmail } from '../../utils/html-sanitizer.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleDeleteEmail } from './delete.js'
import { handleDraftEmail } from './draft.js'
import { handleMarkAsRead } from './mark-as-read.js'
import { handleReadEmail } from './read.js'
import { handleSendEmail } from './send.js'

vi.mock('../graph-client/index.js')
vi.mock('../../utils/html-sanitizer')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = vi.fn()
// Injected GraphContext: handlers receive the Graph endpoint + the auth gate as
// their first argument (standard §1/§2), so tests pass a ctx instead of mocking
// a module-level singleton.
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: mockEnsureAuthenticated }
const mockProcessHtmlEmail = processHtmlEmail as Mock

let consoleErrorSpy: MockInstance

beforeEach(() => {
  mockCallGraphAPI.mockReset()
  mockEnsureAuthenticated.mockReset()
  mockProcessHtmlEmail.mockReset()
  mockProcessHtmlEmail.mockImplementation((s: string) => s ?? '')
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('handleReadEmail', () => {
  const baseEmail = {
    id: 'm1',
    subject: 'Hi',
    from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
    toRecipients: [{ emailAddress: { name: 'Bob', address: 'bob@example.com' } }],
    receivedDateTime: '2026-01-01T10:00:00Z',
    importance: 'normal',
    hasAttachments: false,
    body: { contentType: 'text', content: 'Hello' }
  }

  it('formats a plain-text email', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue(baseEmail)
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toContain('From: Alice (alice@example.com)')
    expect(r.content[0].text).toContain('Subject: Hi')
    expect(r.content[0].text).not.toContain('HTML email')
  })

  it('marks HTML emails as sanitized', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ ...baseEmail, body: { contentType: 'html', content: '<p>Hi</p>' } })
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toContain('HTML email - sanitized')
  })

  it('appends raw HTML when includeRawHtml=true and content is HTML', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ ...baseEmail, body: { contentType: 'html', content: '<p>raw</p>' } })
    const r = await handleReadEmail(ctx, { id: 'm1', includeRawHtml: true })
    expect(r.content[0].text).toContain('--- RAW HTML')
    expect(r.content[0].text).toContain('<p>raw</p>')
  })

  it('falls back to bodyPreview when there is no body', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ ...baseEmail, body: undefined, bodyPreview: 'preview-only' })
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toContain('preview-only')
  })

  it('rejects when id is missing', async () => {
    const r = await handleReadEmail(ctx, {})
    expect(r.content[0].text).toBe('Email ID is required.')
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
  })

  it('returns the dedicated message when Graph reports a mismatched mailbox', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error("the email doesn't belong to the targeted mailbox"))
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/email ID seems invalid/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/Failed to read email: boom/)
  })

  it('reports not-found when Graph returns a falsy email', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue(null)
    const r = await handleReadEmail(ctx, { id: 'missing' })
    expect(r.content[0].text).toBe('Email with ID missing not found.')
  })

  it('surfaces a non-auth ensureAuthenticated failure via the outer catch', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('network down'))
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/Error accessing email: network down/)
  })

  it('uses placeholder fields when sender, recipients, body, bodyPreview and importance are absent', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'm1', subject: 'Bare', receivedDateTime: '2026-01-01T10:00:00Z' })
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toContain('From: Unknown')
    expect(r.content[0].text).toContain('To: None')
    expect(r.content[0].text).toContain('No content')
    expect(r.content[0].text).toContain('Importance: normal')
  })

  it('marks attachments present in the formatted output', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ ...baseEmail, hasAttachments: true })
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toContain('Has Attachments: Yes')
  })

  it('formats CC/BCC recipient lists when present', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      ...baseEmail,
      ccRecipients: [{ emailAddress: { name: 'C', address: 'c@x.com' } }],
      bccRecipients: [{ emailAddress: { name: 'D', address: 'd@x.com' } }]
    })
    const r = await handleReadEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toContain('CC: C (c@x.com)')
    expect(r.content[0].text).toContain('BCC: D (d@x.com)')
  })
})

describe('handleDraftEmail', () => {
  it('creates a draft with parsed recipient lists', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd1', subject: 'Hi' })
    const r = await handleDraftEmail(ctx, { to: 'a@x.com, b@x.com', cc: 'c@x.com', bcc: 'd@x.com', subject: 'Hi', body: 'plain' })
    const callBody = mockCallGraphAPI.mock.calls[0][4]
    expect(callBody.toRecipients).toHaveLength(2)
    expect(callBody.ccRecipients).toHaveLength(1)
    expect(callBody.bccRecipients).toHaveLength(1)
    expect(callBody.body.contentType).toBe('text')
    expect(r.content[0].text).toMatch(/Draft created successfully/)
    expect(r.content[0].text).toContain('Draft ID: d1')
  })

  it('detects HTML body content type when body contains <html', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd1' })
    await handleDraftEmail(ctx, { to: 'a@x.com', subject: 'h', body: '<html><body>Hi</body></html>' })
    expect(mockCallGraphAPI.mock.calls[0][4].body.contentType).toBe('html')
  })

  it('omits empty recipient lists', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd1' })
    await handleDraftEmail(ctx, { subject: 'h', body: 'b' })
    const callBody = mockCallGraphAPI.mock.calls[0][4]
    expect(callBody.toRecipients).toBeUndefined()
    expect(callBody.ccRecipients).toBeUndefined()
    expect(callBody.bccRecipients).toBeUndefined()
  })

  it('defaults to an empty args object when called with none', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd1' })
    const r = await handleDraftEmail(ctx, undefined)
    expect(r.content[0].text).toMatch(/Draft created successfully/)
    const callBody = mockCallGraphAPI.mock.calls[0][4]
    expect(callBody.subject).toBe('')
  })

  it('returns the dedicated 403 message when Graph reports a scope error', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('API call failed with status 403: ...'))
    const r = await handleDraftEmail(ctx, { subject: 'h', body: 'b' })
    expect(r.content[0].text).toMatch(/lacks Mail.ReadWrite/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDraftEmail(ctx, { subject: 'h', body: 'b' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDraftEmail(ctx, { subject: 'h', body: 'b' })
    expect(r.content[0].text).toMatch(/Error creating draft email: boom/)
  })
})

describe('handleSendEmail', () => {
  it('sends to multiple recipients and saves to Sent Items by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleSendEmail(ctx, { to: 'a@x.com,b@x.com', subject: 'Hi', body: 'Hello' })
    const callBody = mockCallGraphAPI.mock.calls[0][4]
    expect(callBody.message.toRecipients).toHaveLength(2)
    expect(callBody.saveToSentItems).toBe(true)
    expect(r.content[0].text).toMatch(/Email sent successfully/)
  })

  it('trims cc and bcc recipient addresses', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleSendEmail(ctx, { to: 'a@x.com', cc: ' c@x.com , c2@x.com ', bcc: ' d@x.com ', subject: 's', body: 'b' })
    const msg = mockCallGraphAPI.mock.calls[0][4].message
    expect(msg.ccRecipients).toEqual([{ emailAddress: { address: 'c@x.com' } }, { emailAddress: { address: 'c2@x.com' } }])
    expect(msg.bccRecipients).toEqual([{ emailAddress: { address: 'd@x.com' } }])
  })

  it('forces HTML when isHtml=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleSendEmail(ctx, { to: 'a@x.com', subject: 's', body: 'plain', isHtml: true })
    expect(mockCallGraphAPI.mock.calls[0][4].message.body.contentType).toBe('html')
  })

  it('forces text when isHtml=false', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleSendEmail(ctx, { to: 'a@x.com', subject: 's', body: '<html>x</html>', isHtml: false })
    expect(mockCallGraphAPI.mock.calls[0][4].message.body.contentType).toBe('text')
  })

  it('auto-detects HTML when body contains <HTML', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleSendEmail(ctx, { to: 'a@x.com', subject: 's', body: '<HTML>X</HTML>' })
    expect(mockCallGraphAPI.mock.calls[0][4].message.body.contentType).toBe('html')
  })

  it('rejects when to is missing', async () => {
    const r = await handleSendEmail(ctx, { subject: 's', body: 'b' })
    expect(r.content[0].text).toBe('Recipient (to) is required.')
  })

  it('rejects when subject is missing', async () => {
    const r = await handleSendEmail(ctx, { to: 'a@x.com', body: 'b' })
    expect(r.content[0].text).toBe('Subject is required.')
  })

  it('rejects when body is missing', async () => {
    const r = await handleSendEmail(ctx, { to: 'a@x.com', subject: 's' })
    expect(r.content[0].text).toBe('Body content is required.')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleSendEmail(ctx, { to: 'a@x.com', subject: 's', body: 'b' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleSendEmail(ctx, { to: 'a@x.com', subject: 's', body: 'b' })
    expect(r.content[0].text).toMatch(/Error sending email: boom/)
  })
})

describe('handleDeleteEmail', () => {
  it('moves to Deleted Items by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd-id' })
    const r = await handleDeleteEmail(ctx, { id: 'm1', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/messages/m1/move', {
      destinationId: 'deleteditems'
    })
    expect(r.content[0].text).toContain('Email moved to Deleted Items. ID: d-id')
  })

  it('permanently deletes when permanent=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleDeleteEmail(ctx, { id: 'm1', permanent: true, dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/messages/m1/permanentDelete')
    expect(r.content[0].text).toBe('Email permanently deleted.')
  })

  it('returns a [dry_run] preview without deleting by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({
      id: 'm1',
      subject: 'Receipt',
      from: { emailAddress: { address: 'biller@x' } },
      receivedDateTime: '2026-01-04T00:00Z'
    })
    const r = await handleDeleteEmail(ctx, { id: 'm1' })
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'GET', expect.stringContaining('me/messages/m1?'))
    expect(r.content[0].text).toMatch(/^\[dry_run\] would move to Deleted Items: "Receipt" from biller@x/)
  })

  it('reports the permanent-delete verb in the dry_run preview when permanent=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'm1', subject: 'Receipt' })
    const r = await handleDeleteEmail(ctx, { id: 'm1', permanent: true })
    expect(r.content[0].text).toMatch(/^\[dry_run\] would permanently delete: "Receipt"/)
  })

  it('uses placeholder fields in the dry_run preview when message metadata is absent', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'm1' })
    const r = await handleDeleteEmail(ctx, { id: 'm1' })
    expect(r.content[0].text).toContain('"" from ? (?)')
  })

  it('rejects when id is missing', async () => {
    const r = await handleDeleteEmail(ctx, {})
    expect(r.content[0].text).toBe('Email ID is required.')
  })

  it('handles UNAUTHORIZED as an auth error', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('UNAUTHORIZED'))
    const r = await handleDeleteEmail(ctx, { id: 'm1', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDeleteEmail(ctx, { id: 'm1', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDeleteEmail(ctx, { id: 'm1', dry_run: false })
    expect(r.content[0].text).toMatch(/Failed to delete email: boom/)
  })
})

describe('handleMarkAsRead', () => {
  it('marks read by default and PATCHes isRead:true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleMarkAsRead(ctx, { id: 'm1' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'PATCH', 'me/messages/m1', { isRead: true })
    expect(r.content[0].text).toMatch(/marked as read/)
  })

  it('marks unread when isRead=false', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleMarkAsRead(ctx, { id: 'm1', isRead: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'PATCH', 'me/messages/m1', { isRead: false })
    expect(r.content[0].text).toMatch(/marked as unread/)
  })

  it('rejects when id is missing', async () => {
    const r = await handleMarkAsRead(ctx, {})
    expect(r.content[0].text).toBe('Email ID is required.')
  })

  it('returns the mailbox-mismatch message on that specific Graph error', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error("the email doesn't belong to the targeted mailbox"))
    const r = await handleMarkAsRead(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/email ID seems invalid/)
  })

  it('returns auth-failed message on UNAUTHORIZED responses', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('UNAUTHORIZED'))
    const r = await handleMarkAsRead(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication failed/)
  })

  it('handles authentication errors at ensureAuthenticated', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleMarkAsRead(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleMarkAsRead(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/Failed to mark email as read: boom/)
  })

  it('surfaces a non-auth ensureAuthenticated failure via the outer catch', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('network down'))
    const r = await handleMarkAsRead(ctx, { id: 'm1' })
    expect(r.content[0].text).toMatch(/Error accessing email: network down/)
  })

  it('reports the unread verb in the generic failure message', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleMarkAsRead(ctx, { id: 'm1', isRead: false })
    expect(r.content[0].text).toMatch(/Failed to mark email as unread: boom/)
  })
})
