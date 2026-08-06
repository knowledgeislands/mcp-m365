import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { getAllFolders } from '../email/folder-utils.js'
import { callGraphAPI } from '../graph-client/index.js'
import {
  applyActions,
  buildFolderMap,
  childPaths,
  findMessage,
  hasExecutableActions,
  listFolderMessages,
  resolveMessageId
} from './graph-ops.js'
import type { EmailRecord } from './types.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('../email/folder-utils.js', () => ({ getAllFolders: vi.fn() }))

const mockCall = callGraphAPI as Mock
const mockGetAllFolders = getAllFolders as Mock
const ensureAuthenticated = vi.fn()
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated }
const TOKEN = 'token'

const FOLDERS = [
  { id: 'inbox-id', displayName: 'Inbox', parentFolderId: 'root' },
  { id: 'triage-id', displayName: '_TRIAGE', parentFolderId: 'root' },
  { id: 'unknown-id', displayName: '000 Unknown', parentFolderId: 'triage-id' },
  { id: 'emerge-id', displayName: '111 Partner', parentFolderId: 'triage-id' },
  { id: 'deep-id', displayName: 'Nested', parentFolderId: 'emerge-id' }
]

const record = (over: Partial<EmailRecord> = {}): EmailRecord => ({
  subject: 'Subject',
  body: '',
  from: 'a@example.com',
  to: [],
  cc: [],
  received: '2026-08-01T09:00:00Z',
  ...over
})

/** A Graph message matching `record()`. */
const graphMessage = (over: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  subject: 'Subject',
  from: { emailAddress: { address: 'a@example.com' } },
  receivedDateTime: '2026-08-01T09:00:00Z',
  parentFolderId: 'unknown-id',
  ...over
})

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAllFolders.mockResolvedValue(FOLDERS)
})

describe('buildFolderMap', () => {
  it('builds full paths from the parent chain', async () => {
    const map = await buildFolderMap(ctx, TOKEN)
    expect(map.idByPath.get('_triage/111 partner')).toBe('emerge-id')
    expect(map.pathById.get('deep-id')).toBe('_TRIAGE/111 Partner/Nested')
    expect(map.paths).toContain('Inbox')
  })

  it('does not loop on a folder that is its own ancestor', async () => {
    mockGetAllFolders.mockResolvedValue([{ id: 'a', displayName: 'A', parentFolderId: 'a' }])
    expect((await buildFolderMap(ctx, TOKEN)).pathById.get('a')).toBe('A')
  })
})

describe('childPaths', () => {
  it('returns immediate children only', async () => {
    const map = await buildFolderMap(ctx, TOKEN)
    expect(childPaths(map, '_TRIAGE')).toEqual(['_TRIAGE/000 Unknown', '_TRIAGE/111 Partner'])
  })
})

describe('listFolderMessages', () => {
  it('reads oldest first so repeated batched runs make progress', async () => {
    mockCall.mockResolvedValue({ value: [graphMessage()] })
    await listFolderMessages(ctx, TOKEN, 'inbox-id', 10)
    expect(mockCall).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
      TOKEN,
      'GET',
      'me/mailFolders/inbox-id/messages',
      null,
      expect.objectContaining({ $top: 10, $orderby: 'receivedDateTime asc' })
    )
  })

  it('returns an empty list when Graph sends no value array', async () => {
    mockCall.mockResolvedValue({})
    expect(await listFolderMessages(ctx, TOKEN, 'inbox-id', 10)).toEqual([])
  })
})

describe('findMessage — identity, not id', () => {
  it('accepts a cached id when the message it returns still has the same identity', async () => {
    mockCall.mockResolvedValue(graphMessage())
    expect(await resolveMessageId(ctx, TOKEN, record({ id: 'msg-1' }))).toBe('msg-1')
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('rejects a cached id that now points at a different message', async () => {
    mockCall
      .mockResolvedValueOnce(graphMessage({ subject: 'Something else' }))
      .mockResolvedValueOnce({ value: [graphMessage({ id: 'msg-2' })] })
    expect(await resolveMessageId(ctx, TOKEN, record({ id: 'msg-1' }))).toBe('msg-2')
  })

  it('falls back to an identity search when the cached id has been reissued', async () => {
    mockCall.mockRejectedValueOnce(new Error('404')).mockResolvedValueOnce({ value: [graphMessage({ id: 'msg-9' })] })
    expect(await resolveMessageId(ctx, TOKEN, record({ id: 'stale' }))).toBe('msg-9')
    expect(mockCall).toHaveBeenLastCalledWith(
      GRAPH_API_ENDPOINT,
      TOKEN,
      'GET',
      'me/messages',
      null,
      expect.objectContaining({ $filter: 'receivedDateTime eq 2026-08-01T09:00:00Z' })
    )
  })

  it('searches by identity when there is no cached id at all', async () => {
    mockCall.mockResolvedValue({ value: [graphMessage()] })
    expect(await resolveMessageId(ctx, TOKEN, record())).toBe('msg-1')
  })

  it('returns null when no candidate shares the identity', async () => {
    mockCall.mockResolvedValue({ value: [graphMessage({ from: { emailAddress: { address: 'other@example.com' } } })] })
    expect(await resolveMessageId(ctx, TOKEN, record())).toBeNull()
  })

  it('returns null when the search itself fails', async () => {
    mockCall.mockRejectedValue(new Error('boom'))
    expect(await resolveMessageId(ctx, TOKEN, record())).toBeNull()
  })

  it('returns null when Graph sends no candidates', async () => {
    mockCall.mockResolvedValue({})
    expect(await resolveMessageId(ctx, TOKEN, record())).toBeNull()
  })

  it('returns null without calling Graph when there is no received timestamp to search on', async () => {
    expect(await findMessage(ctx, TOKEN, record({ received: '' }))).toBeNull()
    expect(mockCall).not.toHaveBeenCalled()
  })
})

describe('hasExecutableActions', () => {
  it('is false for a rule that only marks a message for suggestion', () => {
    expect(hasExecutableActions([{ kind: 'suggest' }])).toBe(false)
    expect(hasExecutableActions([{ kind: 'suggest' }, { kind: 'move', value: 'X' }])).toBe(true)
  })
})

describe('applyActions', () => {
  const withMap = async () => buildFolderMap(ctx, TOKEN)

  it('refuses to act when the message can no longer be identified', async () => {
    mockCall.mockResolvedValue({ value: [] })
    const { applied, resolvedId } = await applyActions(
      ctx,
      TOKEN,
      record(),
      [{ kind: 'move', value: '111 Partner' }],
      await withMap()
    )
    expect(resolvedId).toBeNull()
    expect(applied[0]).toMatchObject({ action: 'resolve', ok: false })
  })

  it('moves a message and threads the reissued id into the actions that follow', async () => {
    const map = await withMap()
    mockCall
      .mockResolvedValueOnce(graphMessage())
      .mockResolvedValueOnce({ id: 'msg-after-move' })
      .mockResolvedValueOnce({})

    const { applied } = await applyActions(
      ctx,
      TOKEN,
      record({ id: 'msg-1' }),
      [
        { kind: 'move', value: '111 Partner' },
        { kind: 'mark', value: 'read' }
      ],
      map
    )

    expect(applied).toEqual([
      { action: 'move:_TRIAGE/111 Partner', ok: true },
      { action: 'mark:read', ok: true }
    ])
    expect(mockCall).toHaveBeenNthCalledWith(2, GRAPH_API_ENDPOINT, TOKEN, 'POST', 'me/messages/msg-1/move', {
      destinationId: 'emerge-id'
    })
    expect(mockCall).toHaveBeenNthCalledWith(3, GRAPH_API_ENDPOINT, TOKEN, 'PATCH', 'me/messages/msg-after-move', {
      isRead: true
    })
  })

  it('keeps the original id when the move response carries none', async () => {
    mockCall.mockResolvedValueOnce(graphMessage()).mockResolvedValueOnce({}).mockResolvedValueOnce({})
    await applyActions(
      ctx,
      TOKEN,
      record({ id: 'msg-1' }),
      [
        { kind: 'move', value: '111 Partner' },
        { kind: 'mark', value: 'read' }
      ],
      await withMap()
    )
    expect(mockCall).toHaveBeenNthCalledWith(3, GRAPH_API_ENDPOINT, TOKEN, 'PATCH', 'me/messages/msg-1', {
      isRead: true
    })
  })

  it('stops when the destination folder does not exist', async () => {
    mockCall.mockResolvedValueOnce(graphMessage())
    const { applied } = await applyActions(
      ctx,
      TOKEN,
      record({ id: 'msg-1' }),
      [
        { kind: 'move', value: 'Nowhere' },
        { kind: 'mark', value: 'read' }
      ],
      await withMap()
    )
    expect(applied).toEqual([
      { action: 'move:_TRIAGE/Nowhere', ok: false, detail: 'destination folder does not exist' }
    ])
  })

  it.each([
    ['read', { isRead: true }],
    ['unread', { isRead: false }],
    ['flagged', { flag: { flagStatus: 'flagged' } }],
    ['unflagged', { flag: { flagStatus: 'notFlagged' } }]
  ])('applies mark:%s', async (value, body) => {
    mockCall.mockResolvedValueOnce(graphMessage()).mockResolvedValueOnce({})
    await applyActions(ctx, TOKEN, record({ id: 'msg-1' }), [{ kind: 'mark', value }], await withMap())
    expect(mockCall).toHaveBeenNthCalledWith(2, GRAPH_API_ENDPOINT, TOKEN, 'PATCH', 'me/messages/msg-1', body)
  })

  it('appends a category without disturbing the ones already there', async () => {
    mockCall
      .mockResolvedValueOnce(graphMessage())
      .mockResolvedValueOnce({ categories: ['Existing'] })
      .mockResolvedValueOnce({})
    await applyActions(ctx, TOKEN, record({ id: 'msg-1' }), [{ kind: 'tag', value: 'Partner' }], await withMap())
    expect(mockCall).toHaveBeenNthCalledWith(3, GRAPH_API_ENDPOINT, TOKEN, 'PATCH', 'me/messages/msg-1', {
      categories: ['Existing', 'Partner']
    })
  })

  it('does not add a category twice', async () => {
    mockCall
      .mockResolvedValueOnce(graphMessage())
      .mockResolvedValueOnce({ categories: ['Partner'] })
      .mockResolvedValueOnce({})
    await applyActions(ctx, TOKEN, record({ id: 'msg-1' }), [{ kind: 'tag', value: 'Partner' }], await withMap())
    expect(mockCall).toHaveBeenNthCalledWith(3, GRAPH_API_ENDPOINT, TOKEN, 'PATCH', 'me/messages/msg-1', {
      categories: ['Partner']
    })
  })

  it('tolerates a message with no categories field', async () => {
    mockCall.mockResolvedValueOnce(graphMessage()).mockResolvedValueOnce({}).mockResolvedValueOnce({})
    await applyActions(ctx, TOKEN, record({ id: 'msg-1' }), [{ kind: 'tag', value: 'X' }], await withMap())
    expect(mockCall).toHaveBeenNthCalledWith(3, GRAPH_API_ENDPOINT, TOKEN, 'PATCH', 'me/messages/msg-1', {
      categories: ['X']
    })
  })

  it('deletes', async () => {
    mockCall.mockResolvedValueOnce(graphMessage()).mockResolvedValueOnce({})
    const { applied } = await applyActions(ctx, TOKEN, record({ id: 'msg-1' }), [{ kind: 'delete' }], await withMap())
    expect(applied).toEqual([{ action: 'delete', ok: true }])
    expect(mockCall).toHaveBeenNthCalledWith(2, GRAPH_API_ENDPOINT, TOKEN, 'DELETE', 'me/messages/msg-1')
  })

  it('skips suggest, which has no mailbox effect', async () => {
    mockCall.mockResolvedValueOnce(graphMessage()).mockResolvedValueOnce({ id: 'msg-2' })
    const { applied } = await applyActions(
      ctx,
      TOKEN,
      record({ id: 'msg-1' }),
      [{ kind: 'move', value: '000 Unknown' }, { kind: 'suggest' }],
      await withMap()
    )
    expect(applied).toEqual([{ action: 'move:_TRIAGE/000 Unknown', ok: true }])
  })

  it('records a Graph failure and stops rather than pressing on', async () => {
    mockCall.mockResolvedValueOnce(graphMessage()).mockRejectedValueOnce(new Error('rate limited'))
    const { applied } = await applyActions(
      ctx,
      TOKEN,
      record({ id: 'msg-1' }),
      [{ kind: 'mark', value: 'read' }, { kind: 'delete' }],
      await withMap()
    )
    expect(applied).toEqual([{ action: 'mark', ok: false, detail: 'rate limited' }])
  })

  it('records a thrown non-Error without losing it', async () => {
    mockCall.mockResolvedValueOnce(graphMessage()).mockRejectedValueOnce('just a string')
    const { applied } = await applyActions(ctx, TOKEN, record({ id: 'msg-1' }), [{ kind: 'delete' }], await withMap())
    expect(applied[0]).toMatchObject({ ok: false, detail: 'just a string' })
  })
})
