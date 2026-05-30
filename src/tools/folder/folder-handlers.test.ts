/**
 * Coverage tests for the folder handlers.
 */
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callGraphAPI } from '../../main/graph-client/index.js'
import { ensureAuthenticated } from '../auth/index.js'
import { handleCreateFolder } from './create.js'
import { handleDeleteFolder } from './delete.js'
import { fetchFoldersRecursive, getFolderIdByName } from './folder-utils.js'
import { handleListFolders } from './list.js'
import { handleMoveEmails } from './move.js'
import { handleRenameFolder } from './rename.js'

vi.mock('../../main/graph-client/index.js')
vi.mock('../auth')
vi.mock('./folder-utils')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = ensureAuthenticated as Mock
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
    const r = await handleListFolders({})
    expect(r.content[0].text).toBe('No folders found.')
  })

  it('lists folders flat (well-known first, then alphabetical)', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'p1', displayName: 'Projects', parentFolderId: null, childFolderCount: 0 },
      { id: 'i1', displayName: 'Inbox', parentFolderId: null, childFolderCount: 0 },
      { id: 'a1', displayName: 'Archive', parentFolderId: null, childFolderCount: 0 }
    ])
    const r = await handleListFolders({})
    const inboxIdx = r.content[0].text.indexOf('Inbox')
    const archiveIdx = r.content[0].text.indexOf('Archive')
    const projectsIdx = r.content[0].text.indexOf('Projects')
    expect(inboxIdx).toBeLessThan(archiveIdx)
    expect(archiveIdx).toBeLessThan(projectsIdx)
  })

  it('formats item counts when includeItemCounts=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([{ id: 'i1', displayName: 'Inbox', parentFolderId: null, childFolderCount: 0, totalItemCount: 12, unreadItemCount: 3 }])
    const r = await handleListFolders({ includeItemCounts: true })
    expect(r.content[0].text).toContain('12 items')
    expect(r.content[0].text).toContain('3 unread')
  })

  it('renders a hierarchy when includeChildren=true', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockResolvedValue([
      { id: 'p', displayName: 'Parent', parentFolderId: null, childFolderCount: 1 },
      { id: 'c', displayName: 'Child', parentFolderId: 'p', childFolderCount: 0 }
    ])
    const r = await handleListFolders({ includeChildren: true })
    expect(r.content[0].text).toContain('Parent')
    expect(r.content[0].text).toContain('  Child')
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleListFolders({})
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors with status info', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockFetchFoldersRecursive.mockRejectedValue(new Error('API call failed with status 503: server error'))
    const r = await handleListFolders({})
    expect(r.content[0].text).toMatch(/Microsoft Graph API \(503\)/)
  })
})

describe('handleCreateFolder', () => {
  it('rejects when name is missing', async () => {
    const r = await handleCreateFolder({})
    expect(r.content[0].text).toBe('Folder name is required.')
  })

  it('rejects an existing folder name', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('existing-id')
    const r = await handleCreateFolder({ name: 'Existing' })
    expect(r.content[0].text).toMatch(/already exists/)
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  it('rejects when parent folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null) // child not found
    mockGetFolderIdByName.mockResolvedValueOnce(null) // parent not found
    const r = await handleCreateFolder({ name: 'New', parentFolder: 'Missing' })
    expect(r.content[0].text).toMatch(/Parent folder "Missing" not found/)
  })

  it('creates at root and reports success', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockResolvedValue({ id: 'new-id' })
    const r = await handleCreateFolder({ name: 'Brand New' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'POST', 'me/mailFolders', { displayName: 'Brand New' })
    expect(r.content[0].text).toMatch(/Successfully created folder "Brand New" at the root level/)
  })

  it('creates inside a parent folder', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null) // child not found
    mockGetFolderIdByName.mockResolvedValueOnce('parent-id')
    mockCallGraphAPI.mockResolvedValue({ id: 'new-id' })
    const r = await handleCreateFolder({ name: 'Sub', parentFolder: 'Parent' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'POST', 'me/mailFolders/parent-id/childFolders', { displayName: 'Sub' })
    expect(r.content[0].text).toMatch(/inside "Parent"/)
  })

  it('reports failure when the response has no id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleCreateFolder({ name: 'X' })
    expect(r.content[0].text).toMatch(/server didn't return a folder ID/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleCreateFolder({ name: 'X' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValueOnce(null)
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleCreateFolder({ name: 'X' })
    expect(r.content[0].text).toMatch(/Error creating folder.*boom/s)
  })
})

describe('handleDeleteFolder', () => {
  it('rejects when folder is missing', async () => {
    const r = await handleDeleteFolder({})
    expect(r.content[0].text).toBe('Folder path is required.')
  })

  it('reports not-found when the folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue(null)
    const r = await handleDeleteFolder({ folder: 'Missing' })
    expect(r.content[0].text).toMatch(/not found/)
  })

  it('deletes by resolved id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleDeleteFolder({ folder: 'Old', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'DELETE', 'me/mailFolders/id-1')
    expect(r.content[0].text).toMatch(/Successfully deleted folder "Old"/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDeleteFolder({ folder: 'X', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDeleteFolder({ folder: 'X', dry_run: false })
    expect(r.content[0].text).toMatch(/Error deleting folder.*boom/s)
  })
})

describe('handleRenameFolder', () => {
  it('rejects when folder is missing', async () => {
    const r = await handleRenameFolder({ newName: 'New' })
    expect(r.content[0].text).toBe('Folder path is required.')
  })

  it('rejects when newName is missing', async () => {
    const r = await handleRenameFolder({ folder: 'Old' })
    expect(r.content[0].text).toBe('New folder name is required.')
  })

  it('reports not-found when the folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue(null)
    const r = await handleRenameFolder({ folder: 'Missing', newName: 'New' })
    expect(r.content[0].text).toMatch(/not found/)
  })

  it('PATCHes displayName on the resolved id', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleRenameFolder({ folder: 'Old', newName: 'New' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith('tok', 'PATCH', 'me/mailFolders/id-1', { displayName: 'New' })
    expect(r.content[0].text).toMatch(/renamed folder "Old" to "New"/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleRenameFolder({ folder: 'O', newName: 'N' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors with status info', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValue(new Error('API call failed with status 409: conflict'))
    const r = await handleRenameFolder({ folder: 'O', newName: 'N' })
    expect(r.content[0].text).toMatch(/Microsoft Graph API \(409\)/)
  })
})

describe('handleMoveEmails', () => {
  it('rejects when emailIds missing', async () => {
    const r = await handleMoveEmails({ targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Email IDs are required/)
  })

  it('rejects when targetFolder missing', async () => {
    const r = await handleMoveEmails({ emailIds: 'a' })
    expect(r.content[0].text).toBe('Target folder name is required.')
  })

  it('rejects when emailIds is whitespace-only', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    const r = await handleMoveEmails({ emailIds: ' ,  ', targetFolder: 'X' })
    expect(r.content[0].text).toBe('No valid email IDs provided.')
  })

  it('reports not-found when target folder does not resolve', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue(null)
    const r = await handleMoveEmails({ emailIds: 'a', targetFolder: 'Missing' })
    expect(r.content[0].text).toMatch(/Target folder "Missing" not found/)
  })

  it('reports unreachable when target folder ID is unreachable', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockRejectedValueOnce(new Error('access denied'))
    const r = await handleMoveEmails({ emailIds: 'a', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/not reachable: access denied/)
  })

  it('moves multiple emails, tracking successes and failures', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockGetFolderIdByName.mockResolvedValue('id-1')
    mockCallGraphAPI.mockResolvedValueOnce({}) // GET sanity check
    mockCallGraphAPI.mockResolvedValueOnce({}) // a moved
    mockCallGraphAPI.mockRejectedValueOnce(new Error('forbidden')) // b failed
    mockCallGraphAPI.mockResolvedValueOnce({}) // c moved
    const r = await handleMoveEmails({ emailIds: 'a,b,c', targetFolder: 'X' })
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
    const r = await handleMoveEmails({ emailIds: '1,2,3,4,5', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/and 2 more/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleMoveEmails({ emailIds: 'a', targetFolder: 'X' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })
})
