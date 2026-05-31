import type { Mock, MockInstance } from 'vitest'
import { callGraphAPIPaginated } from '../../main/graph-client/index.js'
import { ensureAuthenticated } from '../auth/index.js'
import { resolveFolderPath, WELL_KNOWN_FOLDERS } from './folder-utils.js'
import { handleSearchEmails } from './search.js'

vi.mock('../../main/graph-client/index.js', () => ({
  callGraphAPIPaginated: vi.fn()
}))
vi.mock('../auth')
vi.mock('./folder-utils')

const mockCallGraphAPIPaginated = callGraphAPIPaginated as Mock
const mockEnsureAuthenticated = ensureAuthenticated as Mock
const mockResolveFolderPath = resolveFolderPath as Mock

describe('handleSearchEmails', () => {
  const mockAccessToken = 'dummy_access_token'
  const testFolderId = 'TEST_FOLDER_ID_123'
  const mockEmails = [
    {
      id: 'email-1',
      subject: 'Flagged update',
      from: {
        emailAddress: {
          name: 'John Doe',
          address: 'john@example.com'
        }
      },
      receivedDateTime: '2024-01-15T10:30:00Z',
      isRead: false
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

  test('applies unread filter when unreadOnly is true without search terms', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails({ unreadOnly: true, count: 10 })

    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      WELL_KNOWN_FOLDERS.inbox,
      expect.objectContaining({
        $filter: 'isRead eq false'
      }),
      10
    )
  })

  test('includes unread term in search KQL when unreadOnly is true with query', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails({ query: 'release', unreadOnly: true, count: 10 })

    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      WELL_KNOWN_FOLDERS.inbox,
      expect.objectContaining({
        $search: expect.stringContaining('isRead:false')
      }),
      10
    )
  })

  test('uses explicit folderId without resolving folder path', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails({ query: 'release', folderId: testFolderId, count: 10 })

    expect(mockResolveFolderPath).not.toHaveBeenCalled()
    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(mockAccessToken, 'GET', `me/mailFolders/${testFolderId}/messages`, expect.any(Object), 10)
  })

  test('applies date range filters when searching without text terms', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails({
      receivedAfter: '2024-01-01T00:00:00Z',
      receivedBefore: '2024-01-31T23:59:59Z',
      count: 10
    })

    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      WELL_KNOWN_FOLDERS.inbox,
      expect.objectContaining({
        $filter: 'receivedDateTime ge 2024-01-01T00:00:00Z and receivedDateTime le 2024-01-31T23:59:59Z'
      }),
      10
    )
  })

  test('does not include date range terms in KQL when text search is used', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails({
      query: 'release',
      receivedAfter: '2024-01-01T00:00:00Z',
      receivedBefore: '2024-01-31T23:59:59Z',
      count: 10
    })

    const firstCallParams = mockCallGraphAPIPaginated.mock.calls[0][3]
    expect(firstCallParams.$search).toContain('release')
    expect(firstCallParams.$search).not.toContain('received>=')
    expect(firstCallParams.$search).not.toContain('received<=')
  })

  test('returns detailed error info including source and context', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockRejectedValue(new Error('API call failed with status 400: {"error":{"code":"BadRequest"}}'))

    const result = await handleSearchEmails({ query: 'release', count: 10 })

    expect(result.content[0].text).toContain('Error searching emails:')
    expect(result.content[0].text).toContain('Source: Microsoft Graph API (400).')
    expect(result.content[0].text).toContain('Context:')
  })

  test('returns an isError envelope for an invalid date filter without calling Graph', async () => {
    const result = await handleSearchEmails({ receivedAfter: 'not-a-date' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Invalid date value "not-a-date"/)
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
  })

  test('escapes a double-quote so a search term cannot break out of the KQL phrase', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails({ subject: 'a" OR from:"evil', count: 10 })

    const params = mockCallGraphAPIPaginated.mock.calls[0]?.[3] as { $search?: string }
    expect(params.$search).not.toContain('a"')
    expect(params.$search).toContain('subject:"a OR from:evil"')
  })

  test('reports no matches when the search returns an empty result set', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: [] })

    const result = await handleSearchEmails({ query: 'nothingmatches', count: 10 })

    expect(result.content[0].text).toContain('No emails found matching your search criteria.')
    expect(result.isError).toBeUndefined()
  })
})
