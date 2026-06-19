import type { Mock, MockInstance } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPIPaginated } from '../graph-client/index.js'
import { resolveFolderPath, WELL_KNOWN_FOLDERS } from './folder-utils.js'
import { handleListEmails } from './list.js'

vi.mock('../graph-client/index.js', () => ({
  callGraphAPIPaginated: vi.fn()
}))
vi.mock('./folder-utils')

const mockCallGraphAPIPaginated = callGraphAPIPaginated as Mock
const mockEnsureAuthenticated = vi.fn()
// Injected GraphContext: handlers receive the Graph endpoint + the auth gate as
// their first argument (standard §1/§2), so tests pass a ctx instead of mocking
// a module-level singleton.
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: mockEnsureAuthenticated }
const mockResolveFolderPath = resolveFolderPath as Mock

describe('handleListEmails', () => {
  const mockAccessToken = 'dummy_access_token'
  const testFolderId = 'TEST_FOLDER_ID_123'
  const mockEmails = [
    {
      id: 'email-1',
      subject: 'Test Email 1',
      from: {
        emailAddress: {
          name: 'John Doe',
          address: 'john@example.com'
        }
      },
      receivedDateTime: '2024-01-15T10:30:00Z',
      isRead: false
    },
    {
      id: 'email-2',
      subject: 'Test Email 2',
      from: {
        emailAddress: {
          name: 'Jane Smith',
          address: 'jane@example.com'
        }
      },
      receivedDateTime: '2024-01-14T15:20:00Z',
      isRead: true
    }
  ]

  let consoleErrorSpy: MockInstance
  beforeEach(() => {
    mockCallGraphAPIPaginated.mockClear()
    mockEnsureAuthenticated.mockClear()
    mockResolveFolderPath.mockClear()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('successful email retrieval', () => {
    test('should list emails from inbox by default', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

      const result = await handleListEmails(ctx, {})

      expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
      expect(mockResolveFolderPath).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, mockAccessToken, 'inbox')
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
        GRAPH_API_ENDPOINT,
        mockAccessToken,
        'GET',
        WELL_KNOWN_FOLDERS.inbox,
        expect.objectContaining({
          $top: 10,
          $orderby: 'receivedDateTime desc'
        }),
        10
      )
      expect(result.content[0].text).toContain('Found 2 emails in inbox')
      expect(result.content[0].text).toContain('Test Email 1')
      expect(result.content[0].text).toContain('[UNREAD]')
    })

    test('should list emails from specified folder', async () => {
      const customFolder = 'drafts'
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.drafts)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

      const result = await handleListEmails(ctx, { folder: customFolder })

      expect(mockResolveFolderPath).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, mockAccessToken, customFolder)
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, mockAccessToken, 'GET', WELL_KNOWN_FOLDERS.drafts, expect.any(Object), expect.any(Number))
      expect(result.content[0].text).toContain('Found 2 emails in drafts')
    })

    test('should use explicit folderId without resolving folder path', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

      const result = await handleListEmails(ctx, { folderId: testFolderId })

      expect(mockResolveFolderPath).not.toHaveBeenCalled()
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, mockAccessToken, 'GET', `me/mailFolders/${testFolderId}/messages`, expect.any(Object), 10)
      expect(result.content[0].text).toContain(`folderId:${testFolderId}`)
    })

    test('should respect custom count parameter', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [mockEmails[0]] })

      await handleListEmails(ctx, { count: 5 })

      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
        GRAPH_API_ENDPOINT,
        mockAccessToken,
        'GET',
        WELL_KNOWN_FOLDERS.inbox,
        expect.objectContaining({
          $top: 5
        }),
        5
      )
    })

    test('should include Graph total count when includeCount is true', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails, '@odata.count': 250 })

      const result = await handleListEmails(ctx, { includeCount: true })

      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
        GRAPH_API_ENDPOINT,
        mockAccessToken,
        'GET',
        WELL_KNOWN_FOLDERS.inbox,
        expect.objectContaining({
          $count: true
        }),
        10
      )
      expect(result.content[0].text).toContain('total matching: 250')
    })

    test('should not include Graph total count when includeCount is false', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails, '@odata.count': 250 })

      const result = await handleListEmails(ctx, { includeCount: false })

      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
        GRAPH_API_ENDPOINT,
        mockAccessToken,
        'GET',
        WELL_KNOWN_FOLDERS.inbox,
        expect.not.objectContaining({
          $count: true
        }),
        10
      )
      expect(result.content[0].text).not.toContain('total matching:')
    })

    test('should format email list correctly with sender info', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

      const result = await handleListEmails(ctx, {})

      expect(result.content[0].text).toContain('John Doe (john@example.com)')
      expect(result.content[0].text).toContain('Jane Smith (jane@example.com)')
      expect(result.content[0].text).toContain('Subject: Test Email 1')
      expect(result.content[0].text).toContain('ID: email-1')
    })

    test('should handle email without sender info', async () => {
      const emailWithoutSender = {
        id: 'email-3',
        subject: 'No Sender Email',
        receivedDateTime: '2024-01-13T12:00:00Z',
        isRead: true
      }

      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [emailWithoutSender] })

      const result = await handleListEmails(ctx, {})

      expect(result.content[0].text).toContain('Unknown (unknown)')
    })
  })

  describe('empty results', () => {
    test('should return appropriate message when no emails found', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [] })

      const result = await handleListEmails(ctx, {})

      expect(result.content[0].text).toBe('No emails found in inbox.')
    })

    test('should return appropriate message when folder has no emails', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.archive)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [] })

      const result = await handleListEmails(ctx, { folder: 'archive' })

      expect(result.content[0].text).toBe('No emails found in archive.')
    })

    test('records the Graph total in structuredContent on an empty result when includeCount is set', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [], '@odata.count': 42 })

      const result = await handleListEmails(ctx, { includeCount: true })

      expect(result.structuredContent.totalMatching).toBe(42)
    })
  })

  describe('error handling', () => {
    test('should handle authentication error', async () => {
      mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))

      const result = await handleListEmails(ctx, {})

      expect(result.content[0].text).toBe("Authentication required. Please use the 'm365_auth_start' tool first.")
      expect(mockCallGraphAPIPaginated).not.toHaveBeenCalled()
    })

    test('should handle Graph API error', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockRejectedValue(new Error('Graph API Error'))

      const result = await handleListEmails(ctx, {})

      expect(result.content[0].text).toContain('Error listing emails: Graph API Error')
      expect(result.content[0].text).toContain('Source: MCP/server-side validation or processing.')
      expect(result.content[0].text).toContain('Context:')
    })

    test('should annotate a Graph API status error with its source code', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockRejectedValue(new Error('API call failed with status 503: service unavailable'))

      const result = await handleListEmails(ctx, {})

      expect(result.content[0].text).toContain('Source: Microsoft Graph API (503).')
    })

    test('falls back to "Unknown error" when the thrown error carries no message', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockRejectedValue({ code: 'WEIRD' })

      const result = await handleListEmails(ctx, {})

      expect(result.content[0].text).toContain('Unknown error')
      expect(result.structuredContent.error).toBe('Unknown error')
    })

    test('should handle folder resolution error', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockRejectedValue(new Error('Folder resolution failed'))

      const result = await handleListEmails(ctx, { folder: 'InvalidFolder' })

      expect(result.content[0].text).toContain('Error listing emails: Folder resolution failed')
      expect(result.content[0].text).toContain('Source: MCP/server-side validation or processing.')
      expect(result.content[0].text).toContain('Context:')
    })
  })

  describe('inbox endpoint verification', () => {
    test('should use me/mailFolders/inbox/messages for inbox folder', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

      await handleListEmails(ctx, { folder: 'inbox' })

      expect(mockResolveFolderPath).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, mockAccessToken, 'inbox')
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, mockAccessToken, 'GET', 'me/mailFolders/inbox/messages', expect.any(Object), expect.any(Number))
    })
  })
})
