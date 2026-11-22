/**
 * The protected list: file states, resolution against the folder tree, the
 * read-only report, and the all-or-nothing guard. Graph is a fake throughout.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { getAllFolders } from '../email/folder-utils.js'
import { callGraphAPI } from '../graph-client/index.js'
import {
  type EnforcedProtection,
  findHits,
  guardWrite,
  handleListProtected,
  PROTECTED_LIST_INVALID,
  PROTECTED_REFUSED,
  readProtectedFile,
  refusedResult,
  resolveProtection
} from './index.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('../email/folder-utils.js', () => ({ getAllFolders: vi.fn() }))

const mockCall = callGraphAPI as Mock
const mockFolders = getAllFolders as Mock
const ensureAuthenticated = vi.fn()
const TOKEN = 'token'

/** A small tree: Legal (protected, subtree) holds Sub; Notes (protected alone) holds Child. */
const FOLDERS = [
  { id: 'inbox', displayName: 'Inbox' },
  { id: 'legal', displayName: 'Legal', parentFolderId: 'inbox' },
  { id: 'legal-sub', displayName: 'Sub', parentFolderId: 'legal' },
  { id: 'legal-deep', displayName: 'Deep', parentFolderId: 'legal-sub' },
  { id: 'notes', displayName: 'Notes', parentFolderId: 'inbox' },
  { id: 'notes-child', displayName: 'Child', parentFolderId: 'notes' },
  { id: 'plain', displayName: 'Plain', parentFolderId: 'inbox' }
]

const LIST = `version = 1

[[protected]]
kind = "folder"
id = "legal"
name = "Legal hold"
reason = "evidential"

[[protected]]
kind = "folder"
id = "notes"
subtree = false

[[protected]]
kind = "category"
id = "Evidence"
`

let dir: string
const write = (name: string, text: string) => {
  const file = path.join(dir, name)
  fs.writeFileSync(file, text)
  return file
}
const ctxFor = (protectedFile: string | null | undefined) => ({
  graphApiEndpoint: GRAPH_API_ENDPOINT,
  ensureAuthenticated,
  protectedFile
})

beforeEach(() => {
  vi.clearAllMocks()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm365-protected-'))
  mockFolders.mockResolvedValue(FOLDERS)
  ensureAuthenticated.mockResolvedValue(TOKEN)
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('readProtectedFile', () => {
  it('is absent with no file configured', () => {
    expect(readProtectedFile(null)).toEqual({ status: 'absent', source: null })
    expect(readProtectedFile(undefined)).toEqual({ status: 'absent', source: null })
  })

  it('is absent when the configured file does not exist', () => {
    const file = path.join(dir, 'missing.toml')
    expect(readProtectedFile(file)).toEqual({ status: 'absent', source: file })
  })

  it('is invalid when the file cannot be read', () => {
    const state = readProtectedFile(dir)
    expect(state).toMatchObject({ status: 'invalid', source: dir })
    expect((state as { error: string }).error).toMatch(/^cannot read the file/)
  })

  it('is invalid when the file is not TOML', () => {
    const state = readProtectedFile(write('bad.toml', 'version = = 1'))
    expect((state as { error: string }).error).toMatch(/^not valid TOML/)
  })

  it('is invalid when the schema does not hold, naming the field', () => {
    const state = readProtectedFile(write('v2.toml', 'version = 2'))
    expect((state as { error: string }).error).toMatch(/^not a valid protected list: version:/)
  })

  it('is invalid on an unknown top-level key, reported at the root', () => {
    const state = readProtectedFile(write('extra.toml', 'version = 1\noverride = true'))
    expect((state as { error: string }).error).toMatch(/\(root\):/)
  })

  it('is invalid on an unknown entry kind', () => {
    const state = readProtectedFile(write('kind.toml', 'version = 1\n[[protected]]\nkind = "label"\nid = "x"'))
    expect(state.status).toBe('invalid')
  })

  it('is disabled with enforce = false', () => {
    const state = readProtectedFile(write('off.toml', `${LIST.replace('version = 1', 'version = 1\nenforce = false')}`))
    expect(state).toMatchObject({ status: 'disabled' })
  })

  it('is enforced by default, with subtree defaulting to true', () => {
    const state = readProtectedFile(write('on.toml', LIST))
    expect(state.status).toBe('enforced')
    const entries = (state as { entries: Array<{ subtree: boolean }> }).entries
    expect(entries.map((e) => e.subtree)).toEqual([true, false, true])
  })

  it('accepts an empty list', () => {
    expect(readProtectedFile(write('empty.toml', 'version = 1'))).toMatchObject({ status: 'enforced', entries: [] })
  })
})

describe('resolveProtection', () => {
  it('is open with no file', async () => {
    expect(await resolveProtection(ctxFor(null), TOKEN)).toEqual({ mode: 'open', source: null, entries: [] })
    expect(mockFolders).not.toHaveBeenCalled()
  })

  it('is open but keeps the entries when disabled', async () => {
    const p = await resolveProtection(ctxFor(write('off.toml', 'version = 1\nenforce = false')), TOKEN)
    expect(p).toMatchObject({ mode: 'open', entries: [] })
  })

  it('is blocked when the file is invalid', async () => {
    const p = await resolveProtection(ctxFor(write('bad.toml', 'nope')), TOKEN)
    expect(p.mode).toBe('blocked')
  })

  it('resolves folders by id with their subtrees, and categories by name', async () => {
    const p = (await resolveProtection(ctxFor(write('on.toml', LIST)), TOKEN)) as EnforcedProtection
    expect(p.mode).toBe('enforced')
    expect(p.entries[0]).toMatchObject({
      kind: 'folder',
      id: 'legal',
      name: 'Legal hold',
      current_name: 'Inbox/Legal',
      reason: 'evidential',
      covers: [
        { id: 'legal-sub', name: 'Inbox/Legal/Sub' },
        { id: 'legal-deep', name: 'Inbox/Legal/Sub/Deep' }
      ]
    })
    expect(p.entries[1]).toMatchObject({ id: 'notes', name: 'Inbox/Notes', covers: [] })
    expect(p.entries[2]).toMatchObject({ kind: 'category', id: 'Evidence', name: 'Evidence', current_name: 'Evidence' })
    expect([...p.byFolderId.keys()].sort()).toEqual(['legal', 'legal-deep', 'legal-sub', 'notes'])
    expect([...p.byCategory.keys()]).toEqual(['evidence'])
  })

  it('follows a rename: the entry holds by id and reports the current name', async () => {
    mockFolders.mockResolvedValue(FOLDERS.map((f) => (f.id === 'legal' ? { ...f, displayName: 'Renamed' } : f)))
    const p = (await resolveProtection(ctxFor(write('on.toml', LIST)), TOKEN)) as EnforcedProtection
    expect(p.entries[0]).toMatchObject({ name: 'Legal hold', current_name: 'Inbox/Renamed' })
    expect(p.byFolderId.get('legal-sub')?.id).toBe('legal')
  })

  it('makes no folder read for a list of categories only', async () => {
    const file = write('cat.toml', 'version = 1\n[[protected]]\nkind = "category"\nid = "Keep"\nname = "Kept"')
    const p = (await resolveProtection(ctxFor(file), TOKEN)) as EnforcedProtection
    expect(mockFolders).not.toHaveBeenCalled()
    expect(p.entries[0]).toMatchObject({ name: 'Kept', current_name: 'Keep' })
  })

  it('is blocked when a folder id no longer resolves, naming it', async () => {
    const file = write(
      'gone.toml',
      'version = 1\n[[protected]]\nkind = "folder"\nid = "gone"\nname = "Old"\n[[protected]]\nkind = "folder"\nid = "lost"'
    )
    const p = await resolveProtection(ctxFor(file), TOKEN)
    expect(p).toMatchObject({ mode: 'blocked', error: 'entries no longer resolve to a folder: gone (Old), lost' })
  })

  it('keeps the first entry for overlapping folders and repeated categories', async () => {
    const file = write(
      'overlap.toml',
      [
        'version = 1',
        '[[protected]]\nkind = "folder"\nid = "legal"',
        '[[protected]]\nkind = "folder"\nid = "legal-sub"\nname = "Inner"',
        '[[protected]]\nkind = "category"\nid = "Evidence"',
        '[[protected]]\nkind = "category"\nid = "EVIDENCE"\nname = "Again"'
      ].join('\n')
    )
    const p = (await resolveProtection(ctxFor(file), TOKEN)) as EnforcedProtection
    expect(p.byFolderId.get('legal-sub')?.id).toBe('legal')
    expect(p.byCategory.get('evidence')?.name).toBe('Evidence')
  })

  it('copes with a folder without a name and with a parent cycle', async () => {
    mockFolders.mockResolvedValue([
      { id: 'a', parentFolderId: 'b' },
      { id: 'b', displayName: 'B', parentFolderId: 'a' }
    ])
    const file = write('cycle.toml', 'version = 1\n[[protected]]\nkind = "folder"\nid = "a"')
    const p = (await resolveProtection(ctxFor(file), TOKEN)) as EnforcedProtection
    expect(p.entries[0]).toMatchObject({ current_name: 'B/', covers: [{ id: 'b', name: '/B' }] })
  })

  it('lets a Graph error propagate, so no write proceeds on a failed check', async () => {
    mockFolders.mockRejectedValue(new Error('Graph down'))
    await expect(resolveProtection(ctxFor(write('on.toml', LIST)), TOKEN)).rejects.toThrow('Graph down')
  })
})

describe('handleListProtected', () => {
  const now = () => new Date('2026-11-22T23:00:00Z')

  it('reports no file as not enforced', async () => {
    const r = await handleListProtected(ctxFor(undefined), now)
    expect(r.structuredContent).toEqual({
      enforced: false,
      source: null,
      entries: [],
      checked_at: '2026-11-22T23:00:00.000Z'
    })
    expect(ensureAuthenticated).not.toHaveBeenCalled()
  })

  it('reports an enforced list with what each entry covers', async () => {
    const file = write('on.toml', LIST)
    const r = await handleListProtected(ctxFor(file), now)
    expect(r.structuredContent).toMatchObject({ enforced: true, source: file })
    expect((r.structuredContent as { entries: unknown[] }).entries).toHaveLength(3)
    expect(ensureAuthenticated).toHaveBeenCalledOnce()
  })

  it('reports a disabled list with its entries as written', async () => {
    const file = write('off.toml', LIST.replace('version = 1', 'version = 1\nenforce = false'))
    const r = await handleListProtected(ctxFor(file), now)
    expect(r.structuredContent).toMatchObject({
      enforced: false,
      entries: [
        { kind: 'folder', id: 'legal', name: 'Legal hold', current_name: null, reason: 'evidential', covers: [] },
        { kind: 'folder', id: 'notes', name: '', subtree: false },
        { kind: 'category', id: 'Evidence', name: '' }
      ]
    })
    expect(ensureAuthenticated).not.toHaveBeenCalled()
  })

  it('reports an invalid list with its error', async () => {
    const r = await handleListProtected(ctxFor(write('bad.toml', 'version = 3')), now)
    expect(r.structuredContent).toMatchObject({ enforced: false, entries: [] })
    expect((r.structuredContent as { error: string }).error).toMatch(/not a valid protected list/)
  })

  it('reports an unresolved folder with the entries as written', async () => {
    const r = await handleListProtected(
      ctxFor(write('gone.toml', 'version = 1\n[[protected]]\nkind = "folder"\nid = "gone"')),
      now
    )
    expect(r.structuredContent).toMatchObject({
      enforced: false,
      error: expect.stringMatching(/gone/),
      entries: [{ id: 'gone' }]
    })
  })

  it('reports a failed lookup as not enforced', async () => {
    mockFolders.mockRejectedValue(new Error('Graph down'))
    const file = write('on.toml', LIST)
    const r = await handleListProtected(ctxFor(file), now)
    expect(r.structuredContent).toMatchObject({
      enforced: false,
      source: file,
      error: 'could not resolve the list: Graph down'
    })
  })

  it('stamps the current time by default', async () => {
    const r = await handleListProtected(ctxFor(null))
    expect(typeof (r.structuredContent as { checked_at: string }).checked_at).toBe('string')
  })
})

describe('findHits and refusedResult', () => {
  const enforced = async () => (await resolveProtection(ctxFor(write('on.toml', LIST)), TOKEN)) as EnforcedProtection
  const messages: Record<string, unknown> = {
    'm-plain': { id: 'm-plain', parentFolderId: 'plain', categories: ['Other'] },
    'm-legal': { id: 'm-legal', parentFolderId: 'legal-deep', categories: [] },
    'm-tagged': { id: 'm-tagged', parentFolderId: 'plain', categories: ['EVIDENCE'] },
    'm-child': { id: 'm-child', parentFolderId: 'notes-child' },
    'm-bare': { id: 'm-bare' }
  }

  beforeEach(() => {
    mockCall.mockImplementation(async (_e, _t, _m, p: string) => messages[p.replace('me/messages/', '')] ?? null)
  })

  it('finds protected folders, categories and messages, and nothing else', async () => {
    const hits = await findHits(ctxFor(null), TOKEN, await enforced(), {
      folderIds: ['legal-sub', 'plain', 'notes-child'],
      categories: ['evidence', 'Other'],
      messageIds: ['m-plain', 'm-legal', 'm-tagged', 'm-child', 'm-bare', 'm-missing']
    })
    expect(hits.map((h) => [h.target, h.entry.id])).toEqual([
      ['legal-sub', 'legal'],
      ['evidence', 'Evidence'],
      ['m-legal', 'legal'],
      ['m-tagged', 'Evidence']
    ])
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, TOKEN, 'GET', 'me/messages/m-plain', null, {
      $select: 'id,parentFolderId,categories'
    })
  })

  it('finds nothing for an empty target set', async () => {
    expect(await findHits(ctxFor(null), TOKEN, await enforced(), {})).toEqual([])
  })

  it('refuses naming the first entry, every entry and every target', async () => {
    const p = await enforced()
    const hits = await findHits(ctxFor(null), TOKEN, p, { folderIds: ['legal', 'legal-sub'], categories: ['Evidence'] })
    const r = refusedResult('tool_x', hits)
    expect(r?.isError).toBe(true)
    expect(r?.structuredContent).toEqual({
      code: PROTECTED_REFUSED,
      tool: 'tool_x',
      entry: { kind: 'folder', id: 'legal', name: 'Legal hold' },
      entries: [
        { kind: 'folder', id: 'legal', name: 'Legal hold' },
        { kind: 'category', id: 'Evidence', name: 'Evidence' }
      ],
      targets: ['legal', 'legal-sub', 'Evidence']
    })
    expect(r?.content[0]?.text).toMatch(/^Error tool_x: PROTECTED_REFUSED: 3 target\(s\)/)
  })

  it('returns null with no hits', () => {
    expect(refusedResult('tool_x', [])).toBeNull()
  })
})

describe('guardWrite', () => {
  it('lets every write through with no file', async () => {
    expect(await guardWrite(ctxFor(null), TOKEN, 't', { folderIds: ['legal'] })).toBeNull()
  })

  it('lets every write through when the list is disabled', async () => {
    const file = write('off.toml', LIST.replace('version = 1', 'version = 1\nenforce = false'))
    expect(await guardWrite(ctxFor(file), TOKEN, 't', { folderIds: ['legal'] })).toBeNull()
  })

  it('refuses every write while the list is invalid', async () => {
    const file = write('bad.toml', '[[')
    const r = await guardWrite(ctxFor(file), TOKEN, 'tool_y', { folderIds: ['plain'] })
    expect(r?.structuredContent).toMatchObject({ code: PROTECTED_LIST_INVALID, tool: 'tool_y', source: file })
    expect(r?.content[0]?.text).toMatch(/PROTECTED_LIST_INVALID/)
  })

  it('refuses a protected target and passes an unprotected one', async () => {
    const file = write('on.toml', LIST)
    expect(await guardWrite(ctxFor(file), TOKEN, 't', { folderIds: ['plain'] })).toBeNull()
    const r = await guardWrite(ctxFor(file), TOKEN, 't', { folderIds: ['plain', 'notes'] })
    expect(r?.structuredContent).toMatchObject({ code: PROTECTED_REFUSED, targets: ['notes'] })
  })

  it('reads the file afresh on every call', async () => {
    const file = write('live.toml', 'version = 1')
    expect(await guardWrite(ctxFor(file), TOKEN, 't', { categories: ['Evidence'] })).toBeNull()
    fs.writeFileSync(file, LIST)
    expect(await guardWrite(ctxFor(file), TOKEN, 't', { categories: ['Evidence'] })).not.toBeNull()
  })
})
