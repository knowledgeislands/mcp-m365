/**
 * Updating and deleting inbox rules. Protected-list refusals are in
 * protected/guards.test.ts; these cover finding the rule, the patch and the
 * preview.
 */
import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { getFolderIdByName } from '../folder/folder-utils.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleDeleteRule, handleUpdateRule, ruleTargets } from './manage.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('../folder/folder-utils.js', () => ({ getFolderIdByName: vi.fn() }))

const mockCall = callGraphAPI as Mock
const mockFolderId = getFolderIdByName as Mock
const ensureAuthenticated = vi.fn()
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated }
const body = (r: any) => JSON.parse(r.content[0].text)
const RULES = [
  {
    id: 'r1',
    displayName: 'News',
    isEnabled: true,
    conditions: { subjectContains: ['news'] },
    actions: { moveToFolder: 'f-old', stopProcessingRules: true }
  },
  {
    id: 'r4',
    displayName: 'Relay',
    isEnabled: false,
    actions: { forwardTo: [{ emailAddress: { address: 'a@example.com' } }], redirectTo: [] }
  },
  { id: 'r2', displayName: 'Twin' },
  { id: 'r3', displayName: 'Twin' }
]

beforeEach(() => {
  vi.clearAllMocks()
  ensureAuthenticated.mockResolvedValue('tok')
  mockCall.mockImplementation(async (_e, _t, method: string) =>
    method === 'GET' ? { value: RULES } : method === 'PATCH' ? { displayName: 'Renamed' } : {}
  )
})

describe('ruleTargets', () => {
  it('collects folders and categories from actions, conditions and exceptions', () => {
    expect(
      ruleTargets({
        actions: { moveToFolder: 'a', copyToFolder: 'b', assignCategories: ['X'] },
        conditions: { categories: ['Y'] },
        exceptions: { categories: ['Z'] }
      })
    ).toEqual({ folderIds: ['a', 'b'], categories: ['X', 'Y', 'Z'] })
    expect(ruleTargets(undefined)).toEqual({ folderIds: [], categories: [] })
  })
})

describe('finding the rule', () => {
  it.each([
    [{}, 'Give exactly one of ruleId or ruleName.'],
    [{ ruleId: 'r1', ruleName: 'News' }, 'Give exactly one of ruleId or ruleName.'],
    [{ ruleId: 'nope' }, 'Rule nope not found.'],
    [{ ruleName: 'Nope' }, 'Rule "Nope" not found.'],
    [{ ruleName: 'Twin' }, '2 rules are named "Twin"; give ruleId instead.']
  ])('%j is refused', async (args, message) => {
    expect((await handleDeleteRule(ctx, args)).content[0].text).toBe(message)
    expect((await handleUpdateRule(ctx, { ...args, isEnabled: false })).content[0].text).toBe(message)
  })
})

describe('handleUpdateRule', () => {
  it('previews by default, merging conditions and actions into the current rule', async () => {
    mockFolderId.mockResolvedValue('f-new')
    const r = await handleUpdateRule(ctx, {
      ruleName: 'News',
      name: 'Newsletters',
      isEnabled: false,
      sequence: 7,
      fromAddresses: 'a@example.com, ,b@example.com',
      containsSubject: 'digest',
      hasAttachments: false,
      moveToFolder: 'Reading',
      markAsRead: true,
      categories: ['Kind/News']
    })
    expect(body(r)).toEqual({
      dry_run: true,
      updated: false,
      ruleId: 'r1',
      name: 'News',
      patch: {
        displayName: 'Newsletters',
        isEnabled: false,
        sequence: 7,
        conditions: {
          subjectContains: ['digest'],
          fromAddresses: [
            { emailAddress: { address: 'a@example.com' } },
            { emailAddress: { address: 'b@example.com' } }
          ],
          hasAttachment: false
        },
        actions: {
          moveToFolder: 'f-new',
          stopProcessingRules: true,
          markAsRead: true,
          assignCategories: ['Kind/News']
        }
      }
    })
    expect(mockCall.mock.calls.filter((c) => c[2] !== 'GET')).toEqual([])
  })

  it('patches the rule with dry_run false', async () => {
    const r = await handleUpdateRule(ctx, { ruleId: 'r1', isEnabled: false, dry_run: false })
    expect(body(r)).toEqual({
      dry_run: false,
      updated: true,
      ruleId: 'r1',
      name: 'Renamed',
      patch: { isEnabled: false }
    })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'PATCH', 'me/mailFolders/inbox/messageRules/r1', {
      isEnabled: false
    })
  })

  it('keeps the old name when Graph returns none, and starts from empty conditions and actions', async () => {
    mockCall.mockImplementation(async (_e, _t, method: string) =>
      method === 'GET' ? { value: [{ id: 'r9', displayName: 'Bare' }] } : null
    )
    const r = await handleUpdateRule(ctx, { ruleId: 'r9', containsSubject: 'x', markAsRead: true, dry_run: false })
    expect(body(r)).toMatchObject({
      name: 'Bare',
      patch: { conditions: { subjectContains: ['x'] }, actions: { markAsRead: true } }
    })
  })

  it.each([true, false])('never turns on a rule that forwards mail (dry_run %s)', async (dry_run) => {
    const r = await handleUpdateRule(ctx, { ruleId: 'r4', isEnabled: true, dry_run })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toBe(
      'Refused: rule "Relay" forwards or redirects mail (forwardTo), and this server never sends. Enable it from Outlook if that is intended.'
    )
    expect(mockCall.mock.calls.some((call) => call[2] === 'PATCH')).toBe(false)
  })

  it('still lets a forwarding rule be disabled', async () => {
    const r = await handleUpdateRule(ctx, { ruleId: 'r4', isEnabled: false, dry_run: false })
    expect(body(r)).toMatchObject({ updated: true, patch: { isEnabled: false } })
  })

  it('refuses a missing target folder', async () => {
    mockFolderId.mockResolvedValue(null)
    const r = await handleUpdateRule(ctx, { ruleId: 'r1', moveToFolder: 'Nowhere' })
    expect(r.content[0].text).toBe('Target folder "Nowhere" not found.')
  })

  it('refuses an update with nothing to change', async () => {
    expect((await handleUpdateRule(ctx, { ruleId: 'r1' })).content[0].text).toBe(
      'Nothing to change: give at least one field to update.'
    )
  })

  it('maps an authentication failure to the sign-in hint', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    expect((await handleUpdateRule(ctx, { ruleId: 'r1', isEnabled: true })).content[0].text).toMatch(
      /^Authentication required/
    )
  })

  it('reports any other failure', async () => {
    mockCall.mockRejectedValue(new Error('boom'))
    expect((await handleUpdateRule(ctx, { ruleId: 'r1', isEnabled: true })).content[0].text).toBe(
      'Error updating rule: boom'
    )
  })
})

describe('handleDeleteRule', () => {
  it('previews by default', async () => {
    expect(body(await handleDeleteRule(ctx, { ruleName: 'News' }))).toEqual({
      dry_run: true,
      deleted: false,
      ruleId: 'r1',
      name: 'News'
    })
    expect(mockCall.mock.calls.filter((c) => c[2] !== 'GET')).toEqual([])
  })

  it('deletes with dry_run false', async () => {
    expect(body(await handleDeleteRule(ctx, { ruleId: 'r1', dry_run: false }))).toMatchObject({ deleted: true })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'DELETE', 'me/mailFolders/inbox/messageRules/r1')
  })

  it('reports a failure', async () => {
    mockCall.mockRejectedValue(new Error('boom'))
    expect((await handleDeleteRule(ctx, { ruleId: 'r1' })).content[0].text).toBe('Error deleting rule: boom')
  })
})
