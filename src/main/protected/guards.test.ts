/**
 * Every guarded write tool against one fake mailbox: a protected folder, its
 * subfolder, a protected category, a mixed batch, an invalid list and no list.
 * A refusal must reach Graph with no write at all.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { handleCategoriseMessages, handleCreateCategory } from '../email/categorise.js'
import { handleDeleteEmail } from '../email/delete.js'
import { getAllFolders, getFolderIdByName } from '../email/folder-utils.js'
import { handleMarkAsRead } from '../email/mark-as-read.js'
import { handleCreateFolder } from '../folder/create.js'
import { handleDeleteFolder } from '../folder/delete.js'
import { handleMoveEmails } from '../folder/move.js'
import { handleRenameFolder } from '../folder/rename.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleCreateRule } from '../rules/create.js'
import { handleEditRuleSequence } from '../rules/edit-sequence.js'
import { handleDeleteRule, handleUpdateRule } from '../rules/manage.js'
import { PROTECTED_LIST_INVALID, PROTECTED_REFUSED } from './index.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('../email/folder-utils.js', () => ({
  getAllFolders: vi.fn(),
  getFolderIdByName: vi.fn(),
  resolveFolderPath: vi.fn(),
  fetchFoldersRecursive: vi.fn(),
  WELL_KNOWN_FOLDERS: {}
}))

const mockCall = callGraphAPI as Mock
const mockFolders = getAllFolders as Mock
const mockFolderId = getFolderIdByName as Mock
const ensureAuthenticated = vi.fn()

const FOLDERS = [
  { id: 'inbox', displayName: 'Inbox' },
  { id: 'legal', displayName: 'Legal', parentFolderId: 'inbox' },
  { id: 'legal-sub', displayName: 'Sub', parentFolderId: 'legal' },
  { id: 'plain', displayName: 'Plain', parentFolderId: 'inbox' }
]
const IDS: Record<string, string> = { Legal: 'legal', 'Legal/Sub': 'legal-sub', Plain: 'plain' }
const MESSAGES: Record<string, unknown> = {
  'm-plain': { id: 'm-plain', parentFolderId: 'plain', categories: [] },
  'm-legal': { id: 'm-legal', parentFolderId: 'legal-sub', categories: [] },
  'm-tagged': { id: 'm-tagged', parentFolderId: 'plain', categories: ['evidence'] }
}
const RULES = [
  { id: 'r-legal', displayName: 'Into Legal', actions: { moveToFolder: 'legal-sub' } },
  { id: 'r-plain', displayName: 'Into Plain', actions: { moveToFolder: 'plain' } },
  { id: 'r-tag', displayName: 'Tagger', actions: { assignCategories: ['Evidence'] } },
  { id: 'r-cond', displayName: 'Cond', conditions: { categories: ['EVIDENCE'] } },
  { id: 'r-except', displayName: 'Except', exceptions: { categories: ['Evidence'] } },
  { id: 'r-copy', displayName: 'Copy', actions: { copyToFolder: 'legal' } }
]
const LIST = `version = 1
[[protected]]
kind = "folder"
id = "legal"
name = "Legal hold"
[[protected]]
kind = "category"
id = "Evidence"
`

let dir: string
let ctx: { graphApiEndpoint: string; ensureAuthenticated: Mock; protectedFile: string | null }
const writes = () => mockCall.mock.calls.filter((c) => c[2] !== 'GET')

beforeEach(() => {
  vi.clearAllMocks()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm365-guards-'))
  const file = path.join(dir, 'protected.toml')
  fs.writeFileSync(file, LIST)
  ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated, protectedFile: file }
  ensureAuthenticated.mockResolvedValue('tok')
  mockFolders.mockResolvedValue(FOLDERS)
  mockFolderId.mockImplementation(async (_e, _t, name: string) => IDS[name] ?? null)
  mockCall.mockImplementation(async (_e, _t, method: string, p: string) => {
    if (method === 'GET' && p.startsWith('me/messages/')) return MESSAGES[p.slice('me/messages/'.length)] ?? {}
    if (method === 'GET' && p === 'me/mailFolders/inbox/messageRules') return { value: RULES }
    return { id: 'new-id' }
  })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const expectRefused = (r: any, tool: string, targets: string[]) => {
  expect(r.isError).toBe(true)
  expect(r.structuredContent).toMatchObject({ code: PROTECTED_REFUSED, tool, targets })
  expect(writes()).toEqual([])
}

/** Each guarded tool: a call that must be refused, and one that must go through. */
const CASES: Array<{
  tool: string
  refused: () => Promise<any>
  targets: string[]
  allowed: () => Promise<any>
}> = [
  {
    tool: 'm365_email_message_delete',
    refused: () => handleDeleteEmail(ctx, { id: 'm-legal', dry_run: false }),
    targets: ['m-legal'],
    allowed: () => handleDeleteEmail(ctx, { id: 'm-plain', dry_run: false })
  },
  {
    tool: 'm365_email_message_mark_read',
    refused: () => handleMarkAsRead(ctx, { id: 'm-tagged' }),
    targets: ['m-tagged'],
    allowed: () => handleMarkAsRead(ctx, { id: 'm-plain' })
  },
  {
    tool: 'm365_email_messages_move',
    refused: () => handleMoveEmails(ctx, { emailIds: 'm-plain,m-legal', targetFolder: 'Plain' }),
    targets: ['m-legal'],
    allowed: () => handleMoveEmails(ctx, { emailIds: 'm-plain', targetFolder: 'Plain' })
  },
  {
    tool: 'm365_email_messages_move',
    refused: () => handleMoveEmails(ctx, { emailIds: 'm-plain', targetFolder: 'Legal/Sub' }),
    targets: ['legal-sub'],
    allowed: () => handleMoveEmails(ctx, { emailIds: 'm-plain', targetFolder: 'Plain' })
  },
  {
    tool: 'm365_email_folder_create',
    refused: () => handleCreateFolder(ctx, { name: 'New', parentFolder: 'Legal/Sub' }),
    targets: ['legal-sub'],
    allowed: () => handleCreateFolder(ctx, { name: 'New', parentFolder: 'Plain' })
  },
  {
    tool: 'm365_email_folder_delete',
    refused: () => handleDeleteFolder(ctx, { folder: 'Legal/Sub', dry_run: false }),
    targets: ['legal-sub'],
    allowed: () => handleDeleteFolder(ctx, { folder: 'Plain', dry_run: false })
  },
  {
    tool: 'm365_email_folder_rename',
    refused: () => handleRenameFolder(ctx, { folder: 'Legal', newName: 'Other' }),
    targets: ['legal'],
    allowed: () => handleRenameFolder(ctx, { folder: 'Plain', newName: 'Other' })
  },
  {
    tool: 'm365_email_rule_create',
    refused: () => handleCreateRule(ctx, { name: 'R', containsSubject: 'x', moveToFolder: 'Legal/Sub' }),
    targets: ['legal-sub'],
    allowed: () => handleCreateRule(ctx, { name: 'R', containsSubject: 'x', moveToFolder: 'Plain' })
  },
  {
    tool: 'm365_email_rules_reorder',
    refused: () => handleEditRuleSequence(ctx, { ruleName: 'Into Legal', sequence: 5 }),
    targets: ['legal-sub'],
    allowed: () => handleEditRuleSequence(ctx, { ruleName: 'Into Plain', sequence: 5 })
  },
  {
    tool: 'm365_email_rule_update',
    refused: () => handleUpdateRule(ctx, { ruleName: 'Into Plain', moveToFolder: 'Legal', dry_run: false }),
    targets: ['legal'],
    allowed: () => handleUpdateRule(ctx, { ruleName: 'Into Plain', isEnabled: false, dry_run: false })
  },
  {
    tool: 'm365_email_rule_update',
    refused: () => handleUpdateRule(ctx, { ruleName: 'Tagger', isEnabled: false, dry_run: false }),
    targets: ['Evidence'],
    allowed: () => handleUpdateRule(ctx, { ruleName: 'Into Plain', categories: ['Other'], dry_run: false })
  },
  {
    tool: 'm365_email_rule_delete',
    refused: () => handleDeleteRule(ctx, { ruleName: 'Copy', dry_run: false }),
    targets: ['legal'],
    allowed: () => handleDeleteRule(ctx, { ruleName: 'Into Plain', dry_run: false })
  },
  {
    tool: 'm365_email_rule_delete',
    refused: () => handleDeleteRule(ctx, { ruleName: 'Cond', dry_run: false }),
    targets: ['EVIDENCE'],
    allowed: () => handleDeleteRule(ctx, { ruleId: 'r-plain', dry_run: false })
  },
  {
    tool: 'm365_email_rule_delete',
    refused: () => handleDeleteRule(ctx, { ruleName: 'Except', dry_run: false }),
    targets: ['Evidence'],
    allowed: () => handleDeleteRule(ctx, { ruleId: 'r-plain', dry_run: false })
  },
  {
    tool: 'm365_email_messages_categorise',
    refused: () => handleCategoriseMessages(ctx, { messageIds: ['m-plain'], add: ['evidence'] }),
    targets: ['evidence'],
    allowed: () => handleCategoriseMessages(ctx, { messageIds: ['m-plain'], add: ['Other'] })
  },
  {
    tool: 'm365_email_messages_categorise',
    refused: () => handleCategoriseMessages(ctx, { messageIds: ['m-plain', 'm-tagged'], remove: ['Other'] }),
    targets: ['m-tagged'],
    allowed: () => handleCategoriseMessages(ctx, { messageIds: ['m-plain'], set: ['Other'] })
  },
  {
    tool: 'm365_email_category_create',
    refused: () => handleCreateCategory(ctx, { displayName: 'EVIDENCE' }),
    targets: ['EVIDENCE'],
    allowed: () => handleCreateCategory(ctx, { displayName: 'Other' })
  }
]

describe.each(CASES)('$tool', ({ tool, refused, targets, allowed }) => {
  it(`refuses ${targets.join(', ')} with no write`, async () => {
    expectRefused(await refused(), tool, targets)
  })

  it('goes through for an unprotected target', async () => {
    const r = await allowed()
    expect(r.isError).toBeFalsy()
    expect(writes().length).toBeGreaterThan(0)
  })

  it('refuses everything while the list is invalid', async () => {
    fs.writeFileSync(ctx.protectedFile as string, 'version = "one"')
    const r = await allowed()
    expect(r.structuredContent).toMatchObject({ code: PROTECTED_LIST_INVALID, tool })
    expect(writes()).toEqual([])
  })

  it('behaves as before with no list', async () => {
    ctx.protectedFile = null
    const r = await refused()
    expect(r.isError).toBeFalsy()
    expect(writes().length).toBeGreaterThan(0)
  })

  it('behaves as before when the list is disabled', async () => {
    fs.writeFileSync(ctx.protectedFile as string, LIST.replace('version = 1', 'version = 1\nenforce = false'))
    const r = await refused()
    expect(r.isError).toBeFalsy()
  })
})

describe('previews', () => {
  it('a dry run meets the same refusal as the real call', async () => {
    expectRefused(await handleDeleteEmail(ctx, { id: 'm-legal' }), 'm365_email_message_delete', ['m-legal'])
    expectRefused(await handleDeleteFolder(ctx, { folder: 'Legal' }), 'm365_email_folder_delete', ['legal'])
    expectRefused(await handleDeleteRule(ctx, { ruleName: 'Into Legal' }), 'm365_email_rule_delete', ['legal-sub'])
    expectRefused(await handleUpdateRule(ctx, { ruleName: 'Into Legal', isEnabled: false }), 'm365_email_rule_update', [
      'legal-sub'
    ])
  })

  it('a protection lift by rename does not happen: the folder is held by id', async () => {
    mockFolders.mockResolvedValue(FOLDERS.map((f) => (f.id === 'legal' ? { ...f, displayName: 'Renamed' } : f)))
    IDS.Renamed = 'legal'
    expectRefused(await handleRenameFolder(ctx, { folder: 'Renamed', newName: 'Free' }), 'm365_email_folder_rename', [
      'legal'
    ])
    delete IDS.Renamed
  })

  it('a failed check refuses the write with an error and writes nothing', async () => {
    mockFolders.mockRejectedValue(new Error('Graph down'))
    const r = await handleMarkAsRead(ctx, { id: 'm-plain' })
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/Graph down/)
    expect(writes()).toEqual([])
  })
})
