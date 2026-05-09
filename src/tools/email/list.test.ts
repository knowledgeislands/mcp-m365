import type { Mock, MockInstance } from 'vitest'
import { callGraphAPIPaginated } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'
import { resolveFolderPath, WELL_KNOWN_FOLDERS } from './folder-utils.js'
import { handleListEmails } from './list.js'

vi.mock('../../utils/graph-api', () => ({
  callGraphAPIPaginated: vi.fn()
}))
vi.mock('../auth')
vi.mock('./folder-utils')

const mockCallGraphAPIPaginated = callGraphAPIPaginated as Mock
const mockEnsureAuthenticated = ensureAuthenticated as Mock
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

      const result = await handleListEmails({})

      expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
      expect(mockResolveFolderPath).toHaveBeenCalledWith(mockAccessToken, 'inbox')
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
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

      const result = await handleListEmails({ folder: customFolder })

      expect(mockResolveFolderPath).toHaveBeenCalledWith(mockAccessToken, customFolder)
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(mockAccessToken, 'GET', WELL_KNOWN_FOLDERS.drafts, expect.any(Object), expect.any(Number))
      expect(result.content[0].text).toContain('Found 2 emails in drafts')
    })

    test('should use explicit folderId without resolving folder path', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

      const result = await handleListEmails({ folderId: testFolderId })

      expect(mockResolveFolderPath).not.toHaveBeenCalled()
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(mockAccessToken, 'GET', `me/mailFolders/${testFolderId}/messages`, expect.any(Object), 10)
      expect(result.content[0].text).toContain(`folderId:${testFolderId}`)
    })

    test('should respect custom count parameter', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [mockEmails[0]] })

      await handleListEmails({ count: 5 })

      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
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

      const result = await handleListEmails({ includeCount: true })

      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
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

      const result = await handleListEmails({ includeCount: false })

      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
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

      const result = await handleListEmails({})

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

      const result = await handleListEmails({})

      expect(result.content[0].text).toContain('Unknown (unknown)')
    })
  })

  describe('empty results', () => {
    test('should return appropriate message when no emails found', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [] })

      const result = await handleListEmails({})

      expect(result.content[0].text).toBe('No emails found in inbox.')
    })

    test('should return appropriate message when folder has no emails', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.archive)
      mockCallGraphAPIPaginated.mockResolvedValue({ value: [] })

      const result = await handleListEmails({ folder: 'archive' })

      expect(result.content[0].text).toBe('No emails found in archive.')
    })
  })

  describe('error handling', () => {
    test('should handle authentication error', async () => {
      mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))

      const result = await handleListEmails({})

      expect(result.content[0].text).toBe("Authentication required. Please use the 'authenticate' tool first.")
      expect(mockCallGraphAPIPaginated).not.toHaveBeenCalled()
    })

    test('should handle Graph API error', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
      mockCallGraphAPIPaginated.mockRejectedValue(new Error('Graph API Error'))

      const result = await handleListEmails({})

      expect(result.content[0].text).toContain('Error listing emails: Graph API Error')
      expect(result.content[0].text).toContain('Source: MCP/server-side validation or processing.')
      expect(result.content[0].text).toContain('Context:')
    })

    test('should handle folder resolution error', async () => {
      mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
      mockResolveFolderPath.mockRejectedValue(new Error('Folder resolution failed'))

      const result = await handleListEmails({ folder: 'InvalidFolder' })

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

      await handleListEmails({ folder: 'inbox' })

      expect(mockResolveFolderPath).toHaveBeenCalledWith(mockAccessToken, 'inbox')
      expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(mockAccessToken, 'GET', 'me/mailFolders/inbox/messages', expect.any(Object), expect.any(Number))
    })
  })
})
