/**
 * Coverage tests for the folder handlers.
 */
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleCreateFolder } from './create.js'
import { handleDeleteFolder } from './delete.js'
import { fetchFoldersRecursive, getFolderIdByName } from './folder-utils.js'
import { handleListFolders } from './list.js'
import { handleMoveEmails } from './move.js'
import { handleRenameFolder } from './rename.js'

vi.mock('../graph-client/index.js')
vi.mock('./folder-utils')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = vi.fn()
// Injected GraphContext: handlers receive the Graph endpoint + the auth gate as
// their first argument (standard §1/§2), so tests pass a ctx instead of mocking
// a module-level singleton.
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: mockEnsureAuthenticated }
const mockGetFolderIdByName = getFolderIdByName as Mock
const mockFetchFoldersRecursive = fetchFoldersRecursive as Mock

let consoleErrorSpy: MockInstance

beforeEach(() => {
  mockCallGraphAPI.mockReset()
  mockEnsureAuthenticated.mockReset()
  mockGetFolderIdByName.mockReset()
  mockFetchFoldersRecursive.mockReset()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('handleListFolders', () => {
  it('returns "No folders found" when the response is empty', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([])
    const r = await handleListFolders(ctx, {})
    expect(r.content[0].text).toBe('No folders found.')
  })

  it('lists folders flat (well-known first, then alphabetical)', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'p1', displayName: 'Projects', parentFolderId: null, childFolderCount: 0 },
      { id: 'i1', displayName: 'Inbox', parentFolderId: null, childFolderCount: 0 },
      { id: 'a1', displayName: 'Archive', parentFolderId: null, childFolderCount: 0 }
    ])
    const r = await handleListFolders(ctx, {})
    const inboxIdx = r.content[0].text.indexOf('Inbox')
    const archiveIdx = r.content[0].text.indexOf('Archive')
    const projectsIdx = r.content[0].text.indexOf('Projects')
    expect(inboxIdx).toBeLessThan(archiveIdx)
    expect(archiveIdx).toBeLessThan(projectsIdx)
  })

  it('formats item counts when includeItemCounts=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'i1', displayName: 'Inbox', parentFolderId: null, childFolderCount: 0, totalItemCount: 12, unreadItemCount: 3 }
    ])
    const r = await handleListFolders(ctx, { includeItemCounts: true })
    expect(r.content[0].text).toContain('12 items')
    expect(r.content[0].text).toContain('3 unread')
  })

  it('renders a hierarchy when includeChildren=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'p', displayName: 'Parent', parentFolderId: null, childFolderCount: 1 },
      { id: 'c', displayName: 'Child', parentFolderId: 'p', childFolderCount: 0 }
    ])
    const r = await handleListFolders(ctx, { includeChildren: true })
    expect(r.content[0].text).toContain('Parent')
    expect(r.content[0].text).toContain('  Child')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleListFolders(ctx, {})
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors with status info', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockRejectedValue(new Error('API call failed with status 503: server error'))
    const r = await handleListFolders(ctx, {})
    expect(r.content[0].text).toMatch(/Microsoft Graph API \(503\)/)
  })

  it('labels a non-status list error as a server-side processing failure', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockRejectedValue(new Error('opaque failure'))
    const r = await handleListFolders(ctx, {})
    expect(r.content[0].text).toMatch(/Source: MCP\/server-side validation or processing\./)
  })

  it('falls back to "Unknown error" when the list failure has no message', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockRejectedValue({ code: 'NO_MSG' })
    const r = await handleListFolders(ctx, {})
    expect(r.content[0].text).toContain('Unknown error')
    expect(r.structuredContent.error).toBe('Unknown error')
  })

  it('orders two well-known folders by their canonical position and annotates nested parents', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    // Sent Items (well-known #3) should sort before Inbox (#1)? No — Inbox first.
    // Include a nested custom folder so the "(in Parent)" annotation renders.
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'zeta', displayName: 'Zeta', parentFolderId: 'root', childFolderCount: 0 },
      { id: 'alpha', displayName: 'Alpha', parentFolderId: 'root', childFolderCount: 0 },
      { id: 'sent', displayName: 'Sent Items', parentFolderId: 'root', childFolderCount: 0 },
      { id: 'inbox', displayName: 'Inbox', parentFolderId: 'root', childFolderCount: 1 },
      { id: 'sub', displayName: 'Sub', parentFolderId: 'inbox', childFolderCount: 0 }
    ])
    const r = await handleListFolders(ctx, {})
    expect(r.content[0].text.indexOf('Inbox')).toBeLessThan(r.content[0].text.indexOf('Sent Items'))
    // Two non-well-known folders sort alphabetically (Alpha before Zeta).
    expect(r.content[0].text.indexOf('Alpha')).toBeLessThan(r.content[0].text.indexOf('Zeta'))
    expect(r.content[0].text).toContain('Sub (in Inbox)')
  })

  it('shows item and unread counts in the flat list', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'inbox', displayName: 'Inbox', parentFolderId: 'root', totalItemCount: 9, unreadItemCount: 4 },
      { id: 'arch', displayName: 'Archive', parentFolderId: 'root', totalItemCount: 0, unreadItemCount: 0 }
    ])
    const r = await handleListFolders(ctx, { includeItemCounts: true })
    expect(r.content[0].text).toContain('9 items')
    expect(r.content[0].text).toContain('(4 unread)')
    expect(r.content[0].text).toContain('0 items')
  })

  it('returns "No folders found" for the hierarchy view when empty', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([])
    const r = await handleListFolders(ctx, { includeChildren: true })
    expect(r.content[0].text).toBe('No folders found.')
  })

  it('renders a hierarchy with item counts and promotes orphans to the root', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'p', displayName: 'Parent', parentFolderId: 'root', childFolderCount: 1, totalItemCount: 5, unreadItemCount: 2 },
      { id: 'c', displayName: 'Child', parentFolderId: 'p', totalItemCount: 1, unreadItemCount: 0 },
      // Orphan: not top-level but its parent id is absent from the set → root.
      { id: 'o', displayName: 'Orphan', parentFolderId: 'ghost', totalItemCount: 0, unreadItemCount: 0 }
    ])
    const r = await handleListFolders(ctx, { includeChildren: true, includeItemCounts: true })
    expect(r.content[0].text).toContain('Parent - 5 items (2 unread)')
    expect(r.content[0].text).toContain('  Child - 1 items')
    expect(r.content[0].text).toContain('Orphan')
  })
})

describe('handleCreateFolder', () => {
  it('rejects when name is missing', async () => {
    const r = await handleCreateFolder(ctx, {})
    expect(r.content[0].text).toBe('Folder name is required.')
  })

  it('rejects an existing folder name', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('existing-id')
    const r = await handleCreateFolder(ctx, { name: 'Existing' })
    expect(r.content[0].text).toMatch(/already exists/)
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  it('rejects when parent folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null) // child not found
    mockGetFolderIdByName.mockResolvedValueOnce(null) // parent not found
    const r = await handleCreateFolder(ctx, { name: 'New', parentFolder: 'Missing' })
    expect(r.content[0].text).toMatch(/Parent folder "Missing" not found/)
  })

  it('creates at root and reports success', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockResolvedValue({ id: 'new-id' })
    const r = await handleCreateFolder(ctx, { name: 'Brand New' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/mailFolders', { displayName: 'Brand New' })
    expect(r.content[0].text).toMatch(/Successfully created folder "Brand New" at the root level/)
  })

  it('creates inside a parent folder', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null) // child not found
    mockGetFolderIdByName.mockResolvedValueOnce('parent-id')
    mockCallGraphAPI.mockResolvedValue({ id: 'new-id' })
    const r = await handleCreateFolder(ctx, { name: 'Sub', parentFolder: 'Parent' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/mailFolders/parent-id/childFolders', {
      displayName: 'Sub'
    })
    expect(r.content[0].text).toMatch(/inside "Parent"/)
  })

  it('reports failure when the response has no id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleCreateFolder(ctx, { name: 'X' })
    expect(r.content[0].text).toMatch(/server didn't return a folder ID/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleCreateFolder(ctx, { name: 'X' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleCreateFolder(ctx, { name: 'X' })
    expect(r.content[0].text).toMatch(/Error creating folder.*boom/s)
  })

  it('annotates a Graph API status error with its source code', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockRejectedValue(new Error('API call failed with status 409: conflict'))
    const r = await handleCreateFolder(ctx, { name: 'X' })
    expect(r.content[0].text).toMatch(/Microsoft Graph API \(409\)/)
  })

  it('falls back to "Unknown error" when the create failure has no message', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockRejectedValue({ code: 'NO_MSG' })
    const r = await handleCreateFolder(ctx, { name: 'X' })
    expect(r.content[0].text).toContain('Unknown error')
  })
})

describe('handleDeleteFolder', () => {
  it('rejects when folder is missing', async () => {
    const r = await handleDeleteFolder(ctx, {})
    expect(r.content[0].text).toBe('Folder path is required.')
  })

  it('reports not-found when the folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue(null)
    const r = await handleDeleteFolder(ctx, { folder: 'Missing' })
    expect(r.content[0].text).toMatch(/not found/)
  })

  it('deletes by resolved id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleDeleteFolder(ctx, { folder: 'Old', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'DELETE', 'me/mailFolders/id-1')
    expect(r.content[0].text).toMatch(/Successfully deleted folder "Old"/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDeleteFolder(ctx, { folder: 'X', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDeleteFolder(ctx, { folder: 'X', dry_run: false })
    expect(r.content[0].text).toMatch(/Error deleting folder.*boom/s)
  })

  it('annotates a Graph API status error with its source code', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue(new Error('API call failed with status 423: locked'))
    const r = await handleDeleteFolder(ctx, { folder: 'X', dry_run: false })
    expect(r.content[0].text).toMatch(/Microsoft Graph API \(423\)/)
  })

  it('falls back to "Unknown error" when the delete failure has no message', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue({ code: 'NO_MSG' })
    const r = await handleDeleteFolder(ctx, { folder: 'X', dry_run: false })
    expect(r.content[0].text).toContain('Unknown error')
  })
})

describe('handleRenameFolder', () => {
  it('rejects when folder is missing', async () => {
    const r = await handleRenameFolder(ctx, { newName: 'New' })
    expect(r.content[0].text).toBe('Folder path is required.')
  })

  it('rejects when newName is missing', async () => {
    const r = await handleRenameFolder(ctx, { folder: 'Old' })
    expect(r.content[0].text).toBe('New folder name is required.')
  })

  it('reports not-found when the folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue(null)
    const r = await handleRenameFolder(ctx, { folder: 'Missing', newName: 'New' })
    expect(r.content[0].text).toMatch(/not found/)
  })

  it('PATCHes displayName on the resolved id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleRenameFolder(ctx, { folder: 'Old', newName: 'New' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'PATCH', 'me/mailFolders/id-1', { displayName: 'New' })
    expect(r.content[0].text).toMatch(/renamed folder "Old" to "New"/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleRenameFolder(ctx, { folder: 'O', newName: 'N' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors with status info', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue(new Error('API call failed with status 409: conflict'))
    const r = await handleRenameFolder(ctx, { folder: 'O', newName: 'N' })
    expect(r.content[0].text).toMatch(/Microsoft Graph API \(409\)/)
  })

  it('labels a non-status error as a server-side processing failure', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleRenameFolder(ctx, { folder: 'O', newName: 'N' })
    expect(r.content[0].text).toMatch(/Source: MCP\/server-side validation or processing\./)
  })

  it('falls back to "Unknown error" when the rename failure has no message', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue({ code: 'NO_MSG' })
    const r = await handleRenameFolder(ctx, { folder: 'O', newName: 'N' })
    expect(r.content[0].text).toContain('Unknown error')
  })
})

describe('handleMoveEmails', () => {
  it('rejects when emailIds missing', async () => {
    const r = await handleMoveEmails(ctx, { targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Email IDs are required/)
  })

  it('rejects when targetFolder missing', async () => {
    const r = await handleMoveEmails(ctx, { emailIds: 'a' })
    expect(r.content[0].text).toBe('Target folder name is required.')
  })

  it('rejects when emailIds is whitespace-only', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    const r = await handleMoveEmails(ctx, { emailIds: ' ,  ', targetFolder: 'X' })
    expect(r.content[0].text).toBe('No valid email IDs provided.')
  })

  it('reports not-found when target folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue(null)
    const r = await handleMoveEmails(ctx, { emailIds: 'a', targetFolder: 'Missing' })
    expect(r.content[0].text).toMatch(/Target folder "Missing" not found/)
  })

  it('reports unreachable when target folder ID is unreachable', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValueOnce(new Error('access denied'))
    const r = await handleMoveEmails(ctx, { emailIds: 'a', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/not reachable: access denied/)
  })

  it('moves multiple emails, tracking successes and failures', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValueOnce({}) // GET sanity check
    mockCallGraphAPI.mockResolvedValueOnce({}) // a moved
    mockCallGraphAPI.mockRejectedValueOnce(new Error('forbidden')) // b failed
    mockCallGraphAPI.mockResolvedValueOnce({}) // c moved
    const r = await handleMoveEmails(ctx, { emailIds: 'a,b,c', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Successfully moved 2 email\(s\) to "X"/)
    expect(r.content[0].text).toMatch(/Failed to move 1 email/)
  })

  it('truncates the failure list to 3 entries with "and N more"', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValueOnce({}) // GET sanity check
    for (let i = 0; i < 5; i++) {
      mockCallGraphAPI.mockRejectedValueOnce(new Error(`err-${i}`))
    }
    const r = await handleMoveEmails(ctx, { emailIds: '1,2,3,4,5', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/and 2 more/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleMoveEmails(ctx, { emailIds: 'a', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('surfaces a Graph status error (with source code) when folder resolution throws', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockRejectedValue(new Error('API call failed with status 500: server error'))
    const r = await handleMoveEmails(ctx, { emailIds: 'a', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Error moving emails:/)
    expect(r.content[0].text).toMatch(/Microsoft Graph API \(500\)/)
  })

  it('labels a non-status move error as a server-side processing failure', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockRejectedValue(new Error('opaque'))
    const r = await handleMoveEmails(ctx, { emailIds: 'a', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Source: MCP\/server-side validation or processing\./)
  })

  it('falls back to "Unknown error" when the move failure has no message', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockRejectedValue({ code: 'NO_MSG' })
    const r = await handleMoveEmails(ctx, { emailIds: 'a', targetFolder: 'X' })
    expect(r.content[0].text).toContain('Unknown error')
  })

  it('reports a clean all-success move with no failure section', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValue({}) // GET sanity check + each move
    const r = await handleMoveEmails(ctx, { emailIds: 'a,b', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Successfully moved 2 email\(s\) to "X"\.$/)
    expect(r.content[0].text).not.toMatch(/Failed to move/)
  })
})
