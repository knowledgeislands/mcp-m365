/**
 * Coverage tests for the small email handlers (read/draft/send/delete/mark-as-read).
 * list/search/folder-utils have their own focused test files.
 */
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callGraphAPI } from '../../utils/graph-api.js'
import { processHtmlEmail } from '../../utils/html-sanitizer.js'
import { ensureAuthenticated } from '../auth/index.js'
import { handleDeleteEmail } from './delete.js'
import { handleDraftEmail } from './draft.js'
import { handleMarkAsRead } from './mark-as-read.js'
import { handleReadEmail } from './read.js'
import { handleSendEmail } from './send.js'

vi.mock('../../utils/graph-api')
vi.mock('../../utils/html-sanitizer')
vi.mock('../auth')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = ensureAuthenticated as Mock
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
    const r = await handleReadEmail({ id: 'm1' })
    expect(r.content[0].text).toContain('From: Alice (alice@example.com)')
    expect(r.content[0].text).toContain('Subject: Hi')
    expect(r.content[0].text).not.toContain('HTML email')
  })

  it('marks HTML emails as sanitized', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ ...baseEmail, body: { contentType: 'html', content: '<p>Hi</p>' } })
    const r = await handleReadEmail({ id: 'm1' })
    expect(r.content[0].text).toContain('HTML email - sanitized')
  })

  it('appends raw HTML when includeRawHtml=true and content is HTML', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ ...baseEmail, body: { contentType: 'html', content: '<p>raw</p>' } })
    const r = await handleReadEmail({ id: 'm1', includeRawHtml: true })
    expect(r.content[0].text).toContain('--- RAW HTML')
    expect(r.content[0].text).toContain('<p>raw</p>')
  })

  it('falls back to bodyPreview when there is no body', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ ...baseEmail, body: undefined, bodyPreview: 'preview-only' })
    const r = await handleReadEmail({ id: 'm1' })
    expect(r.content[0].text).toContain('preview-only')
  })

  it('rejects when id is missing', async () => {
    const r = await handleReadEmail({})
    expect(r.content[0].text).toBe('Email ID is required.')
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
  })

  it('returns the dedicated message when Graph reports a mismatched mailbox', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error("the email doesn't belong to the targeted mailbox"))
    const r = await handleReadEmail({ id: 'm1' })
    expect(r.content[0].text).toMatch(/email ID seems invalid/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleReadEmail({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleReadEmail({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Failed to read email: boom/)
  })

  it('formats CC/BCC recipient lists when present', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      ...baseEmail,
      ccRecipients: [{ emailAddress: { name: 'C', address: 'c@x.com' } }],
      bccRecipients: [{ emailAddress: { name: 'D', address: 'd@x.com' } }]
    })
    const r = await handleReadEmail({ id: 'm1' })
    expect(r.content[0].text).toContain('CC: C (c@x.com)')
    expect(r.content[0].text).toContain('BCC: D (d@x.com)')
  })
})

describe('handleDraftEmail', () => {
  it('creates a draft with parsed recipient lists', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd1', subject: 'Hi' })
    const r = await handleDraftEmail({ to: 'a@x.com, b@x.com', cc: 'c@x.com', bcc: 'd@x.com', subject: 'Hi', body: 'plain' })
    const callBody = mockCallGraphAPI.mock.calls[0][3]
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
    await handleDraftEmail({ to: 'a@x.com', subject: 'h', body: '<html><body>Hi</body></html>' })
    expect(mockCallGraphAPI.mock.calls[0][3].body.contentType).toBe('html')
  })

  it('omits empty recipient lists', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd1' })
    await handleDraftEmail({ subject: 'h', body: 'b' })
    const callBody = mockCallGraphAPI.mock.calls[0][3]
    expect(callBody.toRecipients).toBeUndefined()
    expect(callBody.ccRecipients).toBeUndefined()
    expect(callBody.bccRecipients).toBeUndefined()
  })

  it('returns the dedicated 403 message when Graph reports a scope error', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('API call failed with status 403: ...'))
    const r = await handleDraftEmail({ subject: 'h', body: 'b' })
    expect(r.content[0].text).toMatch(/lacks Mail.ReadWrite/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDraftEmail({ subject: 'h', body: 'b' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDraftEmail({ subject: 'h', body: 'b' })
    expect(r.content[0].text).toMatch(/Error creating draft email: boom/)
  })
})

describe('handleSendEmail', () => {
  it('sends to multiple recipients and saves to Sent Items by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleSendEmail({ to: 'a@x.com,b@x.com', subject: 'Hi', body: 'Hello' })
    const callBody = mockCallGraphAPI.mock.calls[0][3]
    expect(callBody.message.toRecipients).toHaveLength(2)
    expect(callBody.saveToSentItems).toBe(true)
    expect(r.content[0].text).toMatch(/Email sent successfully/)
  })

  it('forces HTML when isHtml=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleSendEmail({ to: 'a@x.com', subject: 's', body: 'plain', isHtml: true })
    expect(mockCallGraphAPI.mock.calls[0][3].message.body.contentType).toBe('html')
  })

  it('forces text when isHtml=false', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleSendEmail({ to: 'a@x.com', subject: 's', body: '<html>x</html>', isHtml: false })
    expect(mockCallGraphAPI.mock.calls[0][3].message.body.contentType).toBe('text')
  })

  it('auto-detects HTML when body contains <HTML', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleSendEmail({ to: 'a@x.com', subject: 's', body: '<HTML>X</HTML>' })
    expect(mockCallGraphAPI.mock.calls[0][3].message.body.contentType).toBe('html')
  })

  it('rejects when to is missing', async () => {
    const r = await handleSendEmail({ subject: 's', body: 'b' })
    expect(r.content[0].text).toBe('Recipient (to) is required.')
  })

  it('rejects when subject is missing', async () => {
    const r = await handleSendEmail({ to: 'a@x.com', body: 'b' })
    expect(r.content[0].text).toBe('Subject is required.')
  })

  it('rejects when body is missing', async () => {
    const r = await handleSendEmail({ to: 'a@x.com', subject: 's' })
    expect(r.content[0].text).toBe('Body content is required.')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleSendEmail({ to: 'a@x.com', subject: 's', body: 'b' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleSendEmail({ to: 'a@x.com', subject: 's', body: 'b' })
    expect(r.content[0].text).toMatch(/Error sending email: boom/)
  })
})

describe('handleDeleteEmail', () => {
  it('moves to Deleted Items by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'd-id' })
    const r = await handleDeleteEmail({ id: 'm1' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'POST', 'me/messages/m1/move', { destinationId: 'deleteditems' })
    expect(r.content[0].text).toContain('Email moved to Deleted Items. ID: d-id')
  })

  it('permanently deletes when permanent=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleDeleteEmail({ id: 'm1', permanent: true })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'POST', 'me/messages/m1/permanentDelete')
    expect(r.content[0].text).toBe('Email permanently deleted.')
  })

  it('rejects when id is missing', async () => {
    const r = await handleDeleteEmail({})
    expect(r.content[0].text).toBe('Email ID is required.')
  })

  it('handles UNAUTHORIZED as an auth error', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('UNAUTHORIZED'))
    const r = await handleDeleteEmail({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDeleteEmail({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDeleteEmail({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Failed to delete email: boom/)
  })
})

describe('handleMarkAsRead', () => {
  it('marks read by default and PATCHes isRead:true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleMarkAsRead({ id: 'm1' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'PATCH', 'me/messages/m1', { isRead: true })
    expect(r.content[0].text).toMatch(/marked as read/)
  })

  it('marks unread when isRead=false', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleMarkAsRead({ id: 'm1', isRead: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'PATCH', 'me/messages/m1', { isRead: false })
    expect(r.content[0].text).toMatch(/marked as unread/)
  })

  it('rejects when id is missing', async () => {
    const r = await handleMarkAsRead({})
    expect(r.content[0].text).toBe('Email ID is required.')
  })

  it('returns the mailbox-mismatch message on that specific Graph error', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error("the email doesn't belong to the targeted mailbox"))
    const r = await handleMarkAsRead({ id: 'm1' })
    expect(r.content[0].text).toMatch(/email ID seems invalid/)
  })

  it('returns auth-failed message on UNAUTHORIZED responses', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('UNAUTHORIZED'))
    const r = await handleMarkAsRead({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication failed/)
  })

  it('handles authentication errors at ensureAuthenticated', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleMarkAsRead({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles other Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleMarkAsRead({ id: 'm1' })
    expect(r.content[0].text).toMatch(/Failed to mark email as read: boom/)
  })
})
