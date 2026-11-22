/**
 * The headers-only change read over Graph's message delta query.
 */
import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { DELTA_SELECT_FIELDS, deltaResultSchema, handleMessagesDelta } from './delta.js'
import { resolveFolderPath } from './folder-utils.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('./folder-utils.js', () => ({ resolveFolderPath: vi.fn() }))

const mockCall = callGraphAPI as Mock
const mockResolve = resolveFolderPath as Mock
const ensureAuthenticated = vi.fn()
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated }
const NEXT = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=abc'
const DELTA = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=xyz'

beforeEach(() => {
  vi.clearAllMocks()
  ensureAuthenticated.mockResolvedValue('tok')
  mockResolve.mockResolvedValue('me/mailFolders/inbox/messages')
})

describe('handleMessagesDelta', () => {
  it('starts a round on the folder with a headers-only select', async () => {
    mockCall.mockResolvedValue({
      value: [
        {
          id: 'm1',
          subject: 'Hi',
          from: { emailAddress: { address: 'a@example.com' } },
          receivedDateTime: '2026-11-22T10:00:00Z',
          parentFolderId: 'inbox',
          categories: ['X'],
          isRead: true,
          conversationId: 'c1'
        },
        { id: 'm2' },
        { id: 'm3', '@removed': { reason: 'deleted' } },
        { '@removed': {} },
        {}
      ],
      '@odata.nextLink': NEXT
    })
    const r = await handleMessagesDelta(ctx, { folder: 'Inbox' })
    expect(mockResolve).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'Inbox')
    expect(mockCall).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
      'tok',
      'GET',
      'me/mailFolders/inbox/messages/delta',
      null,
      { $select: DELTA_SELECT_FIELDS }
    )
    expect(DELTA_SELECT_FIELDS).not.toMatch(/body|preview/i)
    expect(deltaResultSchema.parse(r.structuredContent)).toEqual({
      changes: [
        {
          id: 'm1',
          removed: false,
          subject: 'Hi',
          from: 'a@example.com',
          receivedDateTime: '2026-11-22T10:00:00Z',
          parentFolderId: 'inbox',
          categories: ['X'],
          isRead: true,
          conversationId: 'c1'
        },
        {
          id: 'm2',
          removed: false,
          subject: '',
          from: '',
          receivedDateTime: '',
          parentFolderId: '',
          categories: [],
          isRead: false,
          conversationId: ''
        },
        { id: 'm3', removed: true, reason: 'deleted' },
        { id: '', removed: true, reason: '' },
        {
          id: '',
          removed: false,
          subject: '',
          from: '',
          receivedDateTime: '',
          parentFolderId: '',
          categories: [],
          isRead: false,
          conversationId: ''
        }
      ],
      nextLink: NEXT
    })
  })

  it('follows a returned link as given and passes the deltaLink back', async () => {
    mockCall.mockResolvedValue({ value: [], '@odata.deltaLink': DELTA })
    const r = await handleMessagesDelta(ctx, { deltaLink: NEXT })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'GET', NEXT)
    expect(mockResolve).not.toHaveBeenCalled()
    expect(r.structuredContent).toEqual({ changes: [], deltaLink: DELTA })
  })

  it('copes with an empty answer', async () => {
    mockCall.mockResolvedValue(null)
    expect((await handleMessagesDelta(ctx, {})).structuredContent).toEqual({ changes: [] })
  })

  it('refuses a link that is not a message delta link', async () => {
    const r = await handleMessagesDelta(ctx, { deltaLink: 'https://graph.microsoft.com/v1.0/me/messages' })
    expect(r.isError).toBe(true)
    expect(ensureAuthenticated).not.toHaveBeenCalled()
  })

  it('maps an authentication failure to the sign-in hint', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    expect((await handleMessagesDelta(ctx, {})).content[0].text).toMatch(/^Authentication required/)
  })

  it('reports any other failure, such as a link to another host', async () => {
    mockCall.mockRejectedValue(new Error('Refusing to send the token to evil.example'))
    expect((await handleMessagesDelta(ctx, { deltaLink: 'https://evil.example/messages/delta' })).content[0].text).toBe(
      'Error reading mail changes: Refusing to send the token to evil.example'
    )
  })
})
