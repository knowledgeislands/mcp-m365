import type { Mock } from 'vitest'
import { callGraphAPI } from '../../main/graph-client/index.js'
import { ensureAuthenticated } from '../auth/index.js'
import { handleDeleteFolder } from './delete.js'
import { getFolderIdByName } from './folder-utils.js'
import { handleRenameFolder } from './rename.js'

vi.mock('../../main/graph-client/index.js')
vi.mock('../auth')
vi.mock('./folder-utils')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = ensureAuthenticated as Mock
const mockGetFolderIdByName = getFolderIdByName as Mock

describe('folder management handlers', () => {
  const mockAccessToken = 'dummy_access_token'

  beforeEach(() => {
    mockCallGraphAPI.mockClear()
    mockEnsureAuthenticated.mockClear()
    mockGetFolderIdByName.mockClear()
  })

  test('renames a folder', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockGetFolderIdByName.mockResolvedValue('folder-123')
    mockCallGraphAPI.mockResolvedValue({})
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await handleRenameFolder({ folder: 'Projects/2024', newName: '2025' })

    consoleErrorSpy.mockRestore()
    expect(mockCallGraphAPI).toHaveBeenCalledWith(mockAccessToken, 'PATCH', 'me/mailFolders/folder-123', { displayName: '2025' })
    expect(result.content[0].text).toContain('Successfully renamed folder')
  })

  test('deletes a folder', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockGetFolderIdByName.mockResolvedValue('folder-456')
    mockCallGraphAPI.mockResolvedValue({})

    const result = await handleDeleteFolder({ folder: 'Projects/2024', dry_run: false })

    expect(mockCallGraphAPI).toHaveBeenCalledWith(mockAccessToken, 'DELETE', 'me/mailFolders/folder-456')
    expect(result.content[0].text).toContain('Successfully deleted folder')
  })

  test('returns a [dry_run] preview without deleting by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockGetFolderIdByName.mockResolvedValue('folder-456')

    const result = await handleDeleteFolder({ folder: 'Projects/2024' })

    expect(mockCallGraphAPI).not.toHaveBeenCalled()
    expect(result.content[0].text).toMatch(/^\[dry_run\] would delete mail folder "Projects\/2024"/)
  })

  test('returns a friendly message when rename target is missing', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockGetFolderIdByName.mockResolvedValue(null)

    const result = await handleRenameFolder({ folder: 'Missing/Folder', newName: 'NewName' })

    expect(result.content[0].text).toContain('not found')
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  test('returns a friendly message when delete target is missing', async () => {
    mockEnsureAuthenticated.mockResolvedValue(mockAccessToken)
    mockGetFolderIdByName.mockResolvedValue(null)

    const result = await handleDeleteFolder({ folder: 'Missing/Folder' })

    expect(result.content[0].text).toContain('not found')
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })
})
