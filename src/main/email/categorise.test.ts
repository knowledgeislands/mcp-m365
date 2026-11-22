/**
 * Categorising messages and the master category list. The protected-list
 * refusals are in protected/guards.test.ts; these cover the handlers' own work.
 */
import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleCategoriseMessages, handleCreateCategory, handleListCategories, nextCategories } from './categorise.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))

const mockCall = callGraphAPI as Mock
const ensureAuthenticated = vi.fn()
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated }
const body = (r: any) => JSON.parse(r.content[0].text)

beforeEach(() => {
  vi.clearAllMocks()
  ensureAuthenticated.mockResolvedValue('tok')
})

describe('nextCategories', () => {
  it('replaces with set, dropping case variants', () => {
    expect(nextCategories(['A'], { set: ['X', 'x', 'Y'] })).toEqual(['x', 'Y'])
  })

  it('removes then adds, case-insensitively, keeping order', () => {
    expect(nextCategories(['A', 'B', 'c'], { remove: ['b'], add: ['C', 'D'] })).toEqual(['A', 'c', 'D'])
  })

  it('leaves the list alone with nothing to do', () => {
    expect(nextCategories(['A'], {})).toEqual(['A'])
  })
})

describe('handleCategoriseMessages', () => {
  it.each([
    [{ add: ['X'] }, 'At least one message id is required.'],
    [{ messageIds: ['m1'], set: ['X'], add: ['Y'] }, 'Give either set, or add and remove, not both.'],
    [{ messageIds: ['m1'], set: ['X'], remove: ['Y'] }, 'Give either set, or add and remove, not both.'],
    [{ messageIds: ['m1'] }, 'Give set, add or remove.'],
    [{ messageIds: ['m1'], add: [], remove: [] }, 'Give set, add or remove.']
  ])('rejects %j', async (args, message) => {
    const r = await handleCategoriseMessages(ctx, args)
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toBe(message)
    expect(ensureAuthenticated).not.toHaveBeenCalled()
  })

  it('reads each message and writes its new categories', async () => {
    mockCall.mockImplementation(async (_e, _t, method: string, p: string) =>
      method === 'GET' ? { id: p, categories: p.endsWith('m1') ? ['Old'] : undefined } : {}
    )
    const r = await handleCategoriseMessages(ctx, { messageIds: ['m1', 'm2'], add: ['New'], remove: ['old'] })
    expect(r.isError).toBeUndefined()
    expect(body(r)).toEqual({
      updated: 2,
      failed: 0,
      results: [
        { id: 'm1', ok: true, categories: ['New'] },
        { id: 'm2', ok: true, categories: ['New'] }
      ]
    })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'GET', 'me/messages/m1', null, {
      $select: 'id,categories'
    })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'PATCH', 'me/messages/m1', { categories: ['New'] })
  })

  it('reports a per-message failure and carries on', async () => {
    mockCall.mockImplementation(async (_e, _t, method: string, p: string) => {
      if (method === 'PATCH' && p.endsWith('m1')) throw new Error('Gone')
      return {}
    })
    const r = await handleCategoriseMessages(ctx, { messageIds: ['m1', 'm2'], set: ['A'] })
    expect(r.isError).toBe(true)
    expect(body(r)).toMatchObject({
      updated: 1,
      failed: 1,
      results: [{ id: 'm1', ok: false, error: 'Gone' }, { ok: true }]
    })
  })

  it('maps an authentication failure to the sign-in hint', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleCategoriseMessages(ctx, { messageIds: ['m1'], add: ['A'] })
    expect(r.content[0].text).toMatch(/^Authentication required/)
  })

  it('reports any other failure', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('boom'))
    const r = await handleCategoriseMessages(ctx, { messageIds: ['m1'], add: ['A'] })
    expect(r.content[0].text).toBe('Error categorising messages: boom')
  })
})

describe('handleListCategories', () => {
  it('lists the master categories', async () => {
    mockCall.mockResolvedValue({ value: [{ id: 'c1', displayName: 'Evidence', color: 'preset0' }, {}] })
    const r = await handleListCategories(ctx)
    expect(body(r)).toEqual({
      categories: [
        { id: 'c1', displayName: 'Evidence', color: 'preset0' },
        { id: '', displayName: '', color: '' }
      ]
    })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'GET', 'me/outlook/masterCategories')
  })

  it('copes with an empty answer', async () => {
    mockCall.mockResolvedValue(null)
    expect(body(await handleListCategories(ctx))).toEqual({ categories: [] })
  })

  it('reports a failure', async () => {
    mockCall.mockRejectedValue(new Error('Forbidden'))
    expect((await handleListCategories(ctx)).content[0].text).toBe('Error listing categories: Forbidden')
  })
})

describe('handleCreateCategory', () => {
  it('needs a name', async () => {
    expect((await handleCreateCategory(ctx, { displayName: '  ' })).content[0].text).toBe(
      'A category name is required.'
    )
    expect((await handleCreateCategory(ctx, {})).isError).toBe(true)
  })

  it('creates a category with the given colour', async () => {
    mockCall.mockResolvedValue({ id: 'c9', color: 'preset3' })
    const r = await handleCreateCategory(ctx, { displayName: ' Kind/Finance ', color: 'preset3' })
    expect(body(r)).toEqual({ id: 'c9', displayName: 'Kind/Finance', color: 'preset3' })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/outlook/masterCategories', {
      displayName: 'Kind/Finance',
      color: 'preset3'
    })
  })

  it('defaults the colour to none', async () => {
    mockCall.mockResolvedValue(null)
    expect(body(await handleCreateCategory(ctx, { displayName: 'A' }))).toEqual({
      id: '',
      displayName: 'A',
      color: 'none'
    })
    mockCall.mockResolvedValue({})
    expect(body(await handleCreateCategory(ctx, { displayName: 'A', color: 'preset1' })).color).toBe('preset1')
  })

  it('reports a failure', async () => {
    mockCall.mockRejectedValue(new Error('Conflict'))
    expect((await handleCreateCategory(ctx, { displayName: 'A' })).content[0].text).toBe(
      'Error creating category: Conflict'
    )
  })
})
