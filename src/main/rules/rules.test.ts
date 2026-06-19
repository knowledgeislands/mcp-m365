/**
 * Coverage tests for the rules handlers (list, create, edit-sequence).
 */
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { getFolderIdByName } from '../folder/folder-utils.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleCreateRule } from './create.js'
import { handleEditRuleSequence } from './edit-sequence.js'
import { handleListRules } from './list.js'

vi.mock('../graph-client/index.js')
vi.mock('../folder/folder-utils')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = vi.fn()
// Injected GraphContext: handlers receive the Graph endpoint + the auth gate as
// their first argument (standard §1/§2), so tests pass a ctx instead of mocking
// a module-level singleton.
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: mockEnsureAuthenticated }
const mockGetFolderIdByName = getFolderIdByName as Mock

let consoleErrorSpy: MockInstance

beforeEach(() => {
  mockCallGraphAPI.mockReset()
  mockEnsureAuthenticated.mockReset()
  mockGetFolderIdByName.mockReset()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('handleListRules', () => {
  it('returns the empty-state message when there are no rules', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ value: [] })
    const r = await handleListRules(ctx, {})
    expect(r.content[0].text).toMatch(/No inbox rules found/)
  })

  it('lists rules sorted by sequence (simple form)', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        { id: 'r1', displayName: 'Bravo', isEnabled: true, sequence: 200 },
        { id: 'r2', displayName: 'Alpha', isEnabled: true, sequence: 100 }
      ]
    })
    const r = await handleListRules(ctx, {})
    const aIdx = r.content[0].text.indexOf('Alpha')
    const bIdx = r.content[0].text.indexOf('Bravo')
    expect(aIdx).toBeGreaterThan(0)
    expect(aIdx).toBeLessThan(bIdx)
  })

  it('marks disabled rules', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [{ id: 'r1', displayName: 'Off', isEnabled: false, sequence: 100 }]
    })
    const r = await handleListRules(ctx, {})
    expect(r.content[0].text).toContain('(Disabled)')
  })

  it('renders detailed rules with conditions and actions when includeDetails=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'r1',
          displayName: 'TriageA',
          isEnabled: true,
          sequence: 100,
          conditions: {
            fromAddresses: [{ emailAddress: { address: 'a@x.com' } }],
            subjectContains: ['urgent'],
            bodyContains: ['secret'],
            hasAttachment: true,
            importance: 'high'
          },
          actions: {
            moveToFolder: 'fid',
            copyToFolder: 'cid',
            markAsRead: true,
            markImportance: 'high',
            forwardTo: [{ emailAddress: { address: 'team@x.com' } }],
            delete: true
          }
        }
      ]
    })
    const r = await handleListRules(ctx, { includeDetails: true })
    expect(r.content[0].text).toContain('From: a@x.com')
    expect(r.content[0].text).toContain('Subject contains: "urgent"')
    expect(r.content[0].text).toContain('Body contains: "secret"')
    expect(r.content[0].text).toContain('Has attachment')
    expect(r.content[0].text).toContain('Importance: high')
    expect(r.content[0].text).toContain('Move to folder')
    expect(r.content[0].text).toContain('Copy to folder')
    expect(r.content[0].text).toContain('Mark as read')
    expect(r.content[0].text).toContain('Forward to: team@x.com')
    expect(r.content[0].text).toContain('Delete')
  })

  it('renders detailed rules with no conditions or actions', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [{ id: 'r1', displayName: 'Bare', isEnabled: true, sequence: 100, conditions: {}, actions: {} }]
    })
    const r = await handleListRules(ctx, { includeDetails: true })
    expect(r.content[0].text).toContain('Bare')
    expect(r.content[0].text).not.toContain('Conditions:')
    expect(r.content[0].text).not.toContain('Actions:')
  })

  it('falls back to "N/A" when sequence is missing', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [{ id: 'r1', displayName: 'NoSeq', isEnabled: true }]
    })
    const r = await handleListRules(ctx, {})
    expect(r.content[0].text).toContain('Sequence: N/A')
  })

  it('sorts sequence-less rules to the back (both treated as 9999)', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        { id: 'r1', displayName: 'NoSeqA', isEnabled: true },
        { id: 'r2', displayName: 'First', isEnabled: true, sequence: 1 },
        { id: 'r3', displayName: 'NoSeqB', isEnabled: true }
      ]
    })
    const r = await handleListRules(ctx, {})
    expect(r.content[0].text.indexOf('First')).toBeLessThan(r.content[0].text.indexOf('NoSeqA'))
  })

  it('falls back to "N/A" for a sequence-less rule in detailed view', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [{ id: 'r1', displayName: 'NoSeq', isEnabled: false }]
    })
    const r = await handleListRules(ctx, { includeDetails: true })
    expect(r.content[0].text).toContain('(Disabled) - Sequence: N/A')
  })

  it('treats a missing value array from Graph as no rules', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleListRules(ctx, {})
    expect(r.content[0].text).toMatch(/No inbox rules found/)
  })

  it('renders each detailed-rule subset independently (subject only)', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'r1',
          displayName: 'SubjectOnly',
          isEnabled: true,
          sequence: 100,
          conditions: { subjectContains: ['foo'] },
          actions: { copyToFolder: 'fid' }
        }
      ]
    })
    const r = await handleListRules(ctx, { includeDetails: true })
    expect(r.content[0].text).toContain('Subject contains: "foo"')
    expect(r.content[0].text).toContain('Copy to folder')
    expect(r.content[0].text).not.toContain('From:')
    expect(r.content[0].text).not.toContain('Body contains:')
    expect(r.content[0].text).not.toContain('Has attachment')
    expect(r.content[0].text).not.toContain('Importance:')
    expect(r.content[0].text).not.toContain('Move to folder')
    expect(r.content[0].text).not.toContain('Mark as read')
    expect(r.content[0].text).not.toContain('Forward to:')
    expect(r.content[0].text).not.toContain('Delete')
  })

  it('renders importance-only condition with markImportance-only action', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'r1',
          displayName: 'ImpOnly',
          isEnabled: true,
          sequence: 100,
          conditions: { importance: 'low' },
          actions: { markImportance: 'low' }
        }
      ]
    })
    const r = await handleListRules(ctx, { includeDetails: true })
    expect(r.content[0].text).toContain('Importance: low')
    expect(r.content[0].text).toContain('Mark importance: low')
  })

  it('renders body-contains and forward-to / delete actions', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'r1',
          displayName: 'BodyForward',
          isEnabled: true,
          sequence: 100,
          conditions: { bodyContains: ['urgent'] },
          actions: { forwardTo: [{ emailAddress: { address: 'team@x.com' } }], delete: true }
        }
      ]
    })
    const r = await handleListRules(ctx, { includeDetails: true })
    expect(r.content[0].text).toContain('Body contains: "urgent"')
    expect(r.content[0].text).toContain('Forward to: team@x.com')
    expect(r.content[0].text).toContain('Delete')
  })

  it('renders has-attachment condition + move-to-folder action', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'r1',
          displayName: 'AttachMove',
          isEnabled: true,
          sequence: 100,
          conditions: { hasAttachment: true },
          actions: { moveToFolder: 'fid' }
        }
      ]
    })
    const r = await handleListRules(ctx, { includeDetails: true })
    expect(r.content[0].text).toContain('Has attachment')
    expect(r.content[0].text).toContain('Move to folder')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleListRules(ctx, {})
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleListRules(ctx, {})
    expect(r.content[0].text).toMatch(/Error listing rules: boom/)
  })
})

describe('handleEditRuleSequence', () => {
  it('rejects when ruleName is missing', async () => {
    const r = await handleEditRuleSequence(ctx, { sequence: 100 })
    expect(r.content[0].text).toMatch(/Rule name is required/)
  })

  it('rejects when sequence is missing or non-positive', async () => {
    expect((await handleEditRuleSequence(ctx, { ruleName: 'X' })).content[0].text).toMatch(/positive sequence/)
    expect((await handleEditRuleSequence(ctx, { ruleName: 'X', sequence: 0 })).content[0].text).toMatch(/positive sequence/)
    expect((await handleEditRuleSequence(ctx, { ruleName: 'X', sequence: -5 })).content[0].text).toMatch(/positive sequence/)
  })

  it('reports not-found when no rule matches the name', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ value: [{ id: 'r1', displayName: 'Other', sequence: 1 }] })
    const r = await handleEditRuleSequence(ctx, { ruleName: 'Missing', sequence: 50 })
    expect(r.content[0].text).toMatch(/not found/)
  })

  it('PATCHes the matched rule with the new sequence', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [{ id: 'r1', displayName: 'Triage', sequence: 100 }] })
    mockCallGraphAPI.mockResolvedValueOnce({})
    const r = await handleEditRuleSequence(ctx, { ruleName: 'Triage', sequence: 50 })
    expect(mockCallGraphAPI).toHaveBeenLastCalledWith(GRAPH_API_ENDPOINT, 'tok', 'PATCH', 'me/mailFolders/inbox/messageRules/r1', { sequence: 50 })
    expect(r.content[0].text).toMatch(/Successfully updated/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleEditRuleSequence(ctx, { ruleName: 'X', sequence: 1 })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleEditRuleSequence(ctx, { ruleName: 'X', sequence: 1 })
    expect(r.content[0].text).toMatch(/Error updating rule sequence: boom/)
  })
})

describe('handleCreateRule', () => {
  it('rejects when name is missing', async () => {
    const r = await handleCreateRule(ctx, { fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toBe('Rule name is required.')
  })

  it('rejects when sequence is invalid', async () => {
    const r = await handleCreateRule(ctx, { name: 'r', sequence: 0, fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/Sequence must be a positive number/)
  })

  it('rejects when no condition is supplied', async () => {
    const r = await handleCreateRule(ctx, { name: 'r', markAsRead: true })
    expect(r.content[0].text).toMatch(/At least one condition/)
  })

  it('rejects when no action is supplied', async () => {
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com' })
    expect(r.content[0].text).toMatch(/At least one action/)
  })

  it('creates a rule with auto-assigned sequence based on existing rules', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [{ sequence: 250 }] }) // listing
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'newrule' }) // POST
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/Successfully created rule "r" with sequence 251/)
  })

  it('uses default sequence 100 when there are no existing rules', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] })
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'newrule' })
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/sequence 100/)
  })

  it('falls back to default 100 when listing rules fails during sequence detection', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValueOnce(new Error('list failed'))
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'newrule' })
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/sequence 100/)
  })

  it('uses an explicit sequence when supplied', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ id: 'newrule' })
    const r = await handleCreateRule(ctx, { name: 'r', sequence: 7, fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/sequence 7/)
  })

  it('reports not-found when moveToFolder cannot be resolved', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] })
    mockGetFolderIdByName.mockResolvedValue(null)
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', moveToFolder: 'Missing' })
    expect(r.content[0].text).toMatch(/Target folder "Missing" not found/)
  })

  it('reports an error when folder resolution itself fails', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] })
    mockGetFolderIdByName.mockRejectedValue(new Error('graph down'))
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', moveToFolder: 'X' })
    expect(r.content[0].text).toMatch(/Error resolving folder "X": graph down/)
  })

  it('attaches the resolved folder id to the move-to-folder action', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] }) // listing for sequence
    mockGetFolderIdByName.mockResolvedValue('folder-id-1')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'newrule' }) // POST
    await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', moveToFolder: 'Archive' })
    const ruleBody = mockCallGraphAPI.mock.calls.at(-1)?.[4]
    expect(ruleBody.actions.moveToFolder).toBe('folder-id-1')
  })

  it('omits fromAddresses when every entry is blank after trimming', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] })
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'newrule' })
    await handleCreateRule(ctx, { name: 'r', fromAddresses: ' , , ', containsSubject: 'x', markAsRead: true })
    const ruleBody = mockCallGraphAPI.mock.calls.at(-1)?.[4]
    expect(ruleBody.conditions.fromAddresses).toBeUndefined()
  })

  it('auto-sequences past an existing rule that has no sequence field', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [{ displayName: 'no-seq' }] }) // sequence undefined → treated as 0
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'newrule' })
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/sequence 100/)
  })

  it('reports failure when the create response has no id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] })
    mockCallGraphAPI.mockResolvedValueOnce({})
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/server didn't return a rule ID/)
  })

  it('serialises hasAttachments and containsSubject conditions', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] })
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'newrule' })
    await handleCreateRule(ctx, { name: 'r', containsSubject: 'urgent', hasAttachments: true, markAsRead: true })
    const ruleBody = mockCallGraphAPI.mock.calls.at(-1)?.[4]
    expect(ruleBody.conditions.subjectContains).toEqual(['urgent'])
    expect(ruleBody.conditions.hasAttachment).toBe(true)
    expect(ruleBody.actions.markAsRead).toBe(true)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors during creation', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ value: [] })
    mockCallGraphAPI.mockRejectedValueOnce(new Error('boom'))
    const r = await handleCreateRule(ctx, { name: 'r', fromAddresses: 'a@x.com', markAsRead: true })
    expect(r.content[0].text).toMatch(/Error creating rule: boom/)
  })
})
