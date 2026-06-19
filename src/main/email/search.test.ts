import type { Mock, MockInstance } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPIPaginated } from '../graph-client/index.js'
import { resolveFolderPath, WELL_KNOWN_FOLDERS } from './folder-utils.js'
import { formatSearchResults, handleSearchEmails } from './search.js'

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

    await handleSearchEmails(ctx, { unreadOnly: true, count: 10 })

    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
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

    await handleSearchEmails(ctx, { query: 'release', unreadOnly: true, count: 10 })

    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
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

    await handleSearchEmails(ctx, { query: 'release', folderId: testFolderId, count: 10 })

    expect(mockResolveFolderPath).not.toHaveBeenCalled()
    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, mockAccessToken, 'GET', `me/mailFolders/${testFolderId}/messages`, expect.any(Object), 10)
  })

  test('applies date range filters when searching without text terms', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails(ctx, {
      receivedAfter: '2024-01-01T00:00:00Z',
      receivedBefore: '2024-01-31T23:59:59Z',
      count: 10
    })

    expect(mockCallGraphAPIPaginated).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
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

    await handleSearchEmails(ctx, {
      query: 'release',
      receivedAfter: '2024-01-01T00:00:00Z',
      receivedBefore: '2024-01-31T23:59:59Z',
      count: 10
    })

    const firstCallParams = mockCallGraphAPIPaginated.mock.calls[0][4]
    expect(firstCallParams.$search).toContain('release')
    expect(firstCallParams.$search).not.toContain('received>=')
    expect(firstCallParams.$search).not.toContain('received<=')
  })

  test('returns detailed error info including source and context', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockRejectedValue(new Error('API call failed with status 400: {"error":{"code":"BadRequest"}}'))

    const result = await handleSearchEmails(ctx, { query: 'release', count: 10 })

    expect(result.content[0].text).toContain('Error searching emails:')
    expect(result.content[0].text).toContain('Source: Microsoft Graph API (400).')
    expect(result.content[0].text).toContain('Context:')
  })

  test('returns an isError envelope for an invalid date filter without calling Graph', async () => {
    const result = await handleSearchEmails(ctx, { receivedAfter: 'not-a-date' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/Invalid date value "not-a-date"/)
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
  })

  test('escapes a double-quote so a search term cannot break out of the KQL phrase', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails(ctx, { subject: 'a" OR from:"evil', count: 10 })

    const params = mockCallGraphAPIPaginated.mock.calls[0]?.[4] as { $search?: string }
    expect(params.$search).not.toContain('a"')
    expect(params.$search).toContain('subject:"a OR from:evil"')
  })

  test('reports no matches when the search returns an empty result set', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: [] })

    const result = await handleSearchEmails(ctx, { query: 'nothingmatches', count: 10 })

    expect(result.content[0].text).toContain('No emails found matching your search criteria.')
    expect(result.isError).toBeUndefined()
  })

  test('reports the combined-search strategy in the summary for a non-empty combined-search result', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    // First (combined-search) call returns matches → early return path.
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    const result = await handleSearchEmails(ctx, { query: 'release', count: 10 })

    expect(result.content[0].text).toContain('Found 1 emails matching your search criteria:')
    expect(result.content[0].text).toContain('(Search used combined-search strategy)')
    expect(result.structuredContent.attempts).toEqual(['combined-search'])
    expect(result.structuredContent.items).toHaveLength(1)
    expect(result.isError).toBeUndefined()
  })

  test('falls back to a single-term search when the combined search yields nothing', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined-search: empty
      .mockResolvedValueOnce({ value: mockEmails }) // single-term-subject: hit

    const result = await handleSearchEmails(ctx, { subject: 'Flagged', count: 10 })

    expect(result.content[0].text).toContain('(Search used single-term-subject strategy)')
    expect(result.structuredContent.attempts).toEqual(['combined-search', 'single-term-subject'])
  })

  test('recovers a single-term failure and continues to the next strategy', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined-search: empty
      .mockRejectedValueOnce(new Error('single subject boom')) // single-term-subject: error
      .mockResolvedValueOnce({ value: mockEmails }) // single-term-from: hit

    const result = await handleSearchEmails(ctx, { subject: 'X', from: 'a@b.com', count: 10 })

    expect(result.structuredContent.attempts).toContain('single-term-from')
  })

  test('falls back to a boolean-filters-only search when text strategies miss', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined-search: empty
      .mockResolvedValueOnce({ value: [] }) // single-term-query: empty
      .mockResolvedValueOnce({ value: mockEmails }) // boolean-filters-only: hit

    const result = await handleSearchEmails(ctx, { query: 'q', hasAttachments: true, count: 10 })

    expect(result.structuredContent.attempts).toContain('boolean-filters-only')
  })

  test('recovers a boolean-filters-only failure and falls through to recent emails', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined-search: empty
      .mockResolvedValueOnce({ value: [] }) // single-term-query: empty
      .mockRejectedValueOnce(new Error('filter boom')) // boolean-filters-only: error
      .mockResolvedValueOnce({ value: mockEmails }) // recent-emails: hit

    const result = await handleSearchEmails(ctx, { query: 'q', unreadOnly: true, count: 10 })

    expect(result.structuredContent.attempts).toContain('recent-emails')
  })

  test('throws-then-reports when every strategy including the recent-emails fallback fails', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated
      .mockResolvedValueOnce({ value: [] }) // combined-search: empty
      .mockResolvedValueOnce({ value: [] }) // single-term-query: empty
      .mockRejectedValueOnce(new Error('recent boom')) // recent-emails: error

    const result = await handleSearchEmails(ctx, { query: 'q', count: 10 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('All search strategies failed')
  })

  test('builds a combined KQL search including the "to" term', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails(ctx, { to: 'boss@x.com', count: 10 })

    const params = mockCallGraphAPIPaginated.mock.calls[0]?.[4] as { $search?: string }
    expect(params.$search).toContain('to:"boss@x.com"')
  })

  test('orders by date with no filter clause when neither text nor filters are given', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockResolveFolderPath.mockResolvedValue(WELL_KNOWN_FOLDERS.inbox)
    mockCallGraphAPIPaginated.mockResolvedValue({ value: mockEmails })

    await handleSearchEmails(ctx, { count: 10 })

    const params = mockCallGraphAPIPaginated.mock.calls[0]?.[4] as { $orderby?: string; $filter?: string; $search?: string }
    expect(params.$orderby).toBe('receivedDateTime desc')
    expect(params.$filter).toBeUndefined()
    expect(params.$search).toBeUndefined()
  })

  test('falls back to "Unknown error" in the structured error when the failure has no message', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    // Reject folder resolution with a message-less object so the handler catch
    // hits the `error.message || 'Unknown error'` fallback.
    mockResolveFolderPath.mockRejectedValue({ code: 'NO_MSG' })

    const result = await handleSearchEmails(ctx, { count: 10 })

    expect(result.isError).toBe(true)
    expect(result.structuredContent.error).toBe('Unknown error')
  })

  test('returns the structured auth envelope when ensureAuthenticated rejects', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))

    const result = await handleSearchEmails(ctx, { query: 'q', count: 10 })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain("'m365_auth_start'")
    expect(result.structuredContent).toMatchObject({ type: 'email-search', success: false, error: 'Authentication required' })
  })
})

describe('formatSearchResults (robustness guards)', () => {
  test('does not throw on a non-empty result whose _searchInfo lacks strategies', () => {
    const r = formatSearchResults({ value: [{ id: 'e1', subject: 'S', isRead: true, receivedDateTime: '2026-01-01T00:00:00Z' }], _searchInfo: { folder: 'inbox' } })
    expect(r.content[0].text).toContain('Found 1 emails matching your search criteria:')
    // No strategies → no "(Search used …)" suffix.
    expect(r.content[0].text).not.toContain('Search used')
    expect(r.structuredContent.attempts).toEqual([])
  })

  test('defaults the entire envelope when _searchInfo is absent', () => {
    const r = formatSearchResults({ value: [{ id: 'e1', isRead: false, receivedDateTime: '2026-01-01T00:00:00Z' }] })
    expect(r.structuredContent.attempts).toEqual([])
    expect(r.structuredContent.errors).toEqual([])
    expect(r.structuredContent.originalTerms).toEqual({})
  })

  test('handles a non-array strategies value and an email missing its sender', () => {
    const r = formatSearchResults({
      value: [{ id: 'e1', isRead: true, receivedDateTime: '2026-01-01T00:00:00Z', subject: 'no sender' }],
      _searchInfo: { strategies: 'oops', errors: [], originalTerms: {}, filterTerms: {} }
    })
    expect(r.content[0].text).toContain('From: Unknown (unknown)')
    expect(r.structuredContent.attempts).toEqual([])
  })

  test('reports an empty result set with no strategies', () => {
    const r = formatSearchResults({ value: [] })
    expect(r.content[0].text).toBe('No emails found matching your search criteria.')
    expect(r.structuredContent.returnedCount).toBe(0)
  })
})
