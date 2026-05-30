import type { Mock, MockInstance } from 'vitest'
import { callGraphAPI } from '../../main/graph-client/index.js'
import { fetchFoldersRecursive, getAllFolders, getFolderIdByName, resolveFolderPath, WELL_KNOWN_FOLDERS } from './folder-utils.js'

vi.mock('../../main/graph-client/index.js', () => ({
  callGraphAPI: vi.fn()
}))

const mockCallGraphAPI = callGraphAPI as Mock

const mockGraphWithFolders = (folders: any[], { pageSize = 100 }: { pageSize?: number } = {}): void => {
  const rootParentId = 'mailbox-root'
  mockCallGraphAPI.mockImplementation(async (_token: any, _method: any, endpoint: string, _body: any, params: any) => {
    let pool: any[]
    const childMatch = endpoint.match(/^me\/mailFolders\/([^/]+)\/childFolders$/)
    if (endpoint === 'me/mailFolders') {
      pool = folders.filter((f) => !f.parentFolderId || f.parentFolderId === rootParentId)
    } else if (childMatch) {
      const parentId = childMatch[1]
      pool = folders.filter((f) => f.parentFolderId === parentId)
    } else {
      const idMatch = endpoint.match(/^me\/mailFolders\/([^/]+)$/)
      if (idMatch) {
        const found = folders.find((f) => f.id === idMatch[1])
        return found || null
      }
      return { value: [] }
    }

    const skip = Number(params?.$skiptoken) || 0
    const page = pool.slice(skip, skip + pageSize)
    const hasMore = skip + pageSize < pool.length
    const result: any = { value: page }
    if (hasMore) {
      result['@odata.nextLink'] = `https://graph.microsoft.com/v1.0/${endpoint}?$skiptoken=${skip + pageSize}`
    }
    return result
  })
}

describe('resolveFolderPath', () => {
  const mockAccessToken = 'dummy_access_token'

  let consoleErrorSpy: MockInstance
  beforeEach(() => {
    mockCallGraphAPI.mockReset()
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  describe('well-known folders', () => {
    test('returns inbox endpoint when no folder name is provided', async () => {
      const result = await resolveFolderPath(mockAccessToken, null)
      expect(result).toBe(WELL_KNOWN_FOLDERS.inbox)
      expect(mockCallGraphAPI).not.toHaveBeenCalled()
    })

    test('returns inbox endpoint for undefined folder name', async () => {
      const result = await resolveFolderPath(mockAccessToken, undefined)
      expect(result).toBe(WELL_KNOWN_FOLDERS.inbox)
      expect(mockCallGraphAPI).not.toHaveBeenCalled()
    })

    test('returns inbox endpoint for empty string', async () => {
      const result = await resolveFolderPath(mockAccessToken, '')
      expect(result).toBe(WELL_KNOWN_FOLDERS.inbox)
      expect(mockCallGraphAPI).not.toHaveBeenCalled()
    })

    test('returns correct endpoint for well-known folders without hitting Graph', async () => {
      const result = await resolveFolderPath(mockAccessToken, 'drafts')
      expect(result).toBe(WELL_KNOWN_FOLDERS.drafts)
      expect(mockCallGraphAPI).not.toHaveBeenCalled()
    })

    test('handles case-insensitive well-known folder names', async () => {
      const result1 = await resolveFolderPath(mockAccessToken, 'INBOX')
      const result2 = await resolveFolderPath(mockAccessToken, 'Drafts')
      const result3 = await resolveFolderPath(mockAccessToken, 'SENT')

      expect(result1).toBe(WELL_KNOWN_FOLDERS.inbox)
      expect(result2).toBe(WELL_KNOWN_FOLDERS.drafts)
      expect(result3).toBe(WELL_KNOWN_FOLDERS.sent)
      expect(mockCallGraphAPI).not.toHaveBeenCalled()
    })
  })

  describe('custom folders', () => {
    test('resolves a top-level custom folder by walking the tree', async () => {
      mockGraphWithFolders([{ id: 'id-projects', displayName: 'Projects', childFolderCount: 0 }])

      const result = await resolveFolderPath(mockAccessToken, 'Projects')
      expect(result).toBe('me/mailFolders/id-projects/messages')
    })

    test('resolves a deeply nested folder (3+ levels deep) by full path', async () => {
      mockGraphWithFolders([
        { id: 'id-inbox', displayName: 'Inbox', parentFolderId: 'mailbox-root', childFolderCount: 1 },
        { id: 'id-shopping', displayName: 'Shopping', parentFolderId: 'id-inbox', childFolderCount: 1 },
        { id: 'id-orders', displayName: 'Orders', parentFolderId: 'id-shopping', childFolderCount: 1 },
        { id: 'id-walmart', displayName: 'Walmart', parentFolderId: 'id-orders', childFolderCount: 0 }
      ])

      const result = await resolveFolderPath(mockAccessToken, 'Inbox/Shopping/Orders/Walmart')
      expect(result).toBe('me/mailFolders/id-walmart/messages')
    })

    test('matches folder names case-insensitively', async () => {
      mockGraphWithFolders([{ id: 'id-alpha', displayName: 'projectalpha', childFolderCount: 0 }])

      const result = await resolveFolderPath(mockAccessToken, 'ProjectAlpha')
      expect(result).toBe('me/mailFolders/id-alpha/messages')
    })

    test('throws when folder is not found', async () => {
      mockGraphWithFolders([{ id: 'id-other', displayName: 'SomethingElse', childFolderCount: 0 }])

      await expect(resolveFolderPath(mockAccessToken, 'NonExistent')).rejects.toThrow('was not found or is ambiguous')
    })

    test('throws when ambiguous (multiple matches)', async () => {
      mockGraphWithFolders([
        { id: 'id-a', displayName: 'Orders', parentFolderId: 'mailbox-root', childFolderCount: 0 },
        { id: 'id-b', displayName: 'Orders', parentFolderId: 'mailbox-root', childFolderCount: 0 }
      ])

      await expect(resolveFolderPath(mockAccessToken, 'Orders')).rejects.toThrow('was not found or is ambiguous')
    })

    test('throws when the Graph call fails', async () => {
      mockCallGraphAPI.mockRejectedValue(new Error('API Error'))

      await expect(resolveFolderPath(mockAccessToken, 'CustomFolder')).rejects.toThrow('Error resolving folder "CustomFolder": API Error')
    })
  })
})

describe('getFolderIdByName', () => {
  const mockAccessToken = 'dummy_access_token'

  beforeEach(() => {
    mockCallGraphAPI.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.error as Mock).mockRestore()
  })

  test('returns folder ID for a top-level match', async () => {
    mockGraphWithFolders([{ id: 'id-test', displayName: 'TestFolder', childFolderCount: 0 }])

    const result = await getFolderIdByName(mockAccessToken, 'TestFolder')
    expect(result).toBe('id-test')
  })

  test('returns folder ID for a case-insensitive match', async () => {
    mockGraphWithFolders([{ id: 'id-test', displayName: 'testfolder', childFolderCount: 0 }])

    const result = await getFolderIdByName(mockAccessToken, 'TestFolder')
    expect(result).toBe('id-test')
  })

  test('returns folder ID for a nested folder by full path', async () => {
    mockGraphWithFolders([
      { id: 'id-parent', displayName: 'Parent', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'id-child', displayName: 'Child', parentFolderId: 'id-parent', childFolderCount: 0 }
    ])

    const result = await getFolderIdByName(mockAccessToken, 'Parent/Child')
    expect(result).toBe('id-child')
  })

  test('returns null for a nested folder leaf name without its full path', async () => {
    mockGraphWithFolders([
      { id: 'id-parent', displayName: 'Parent', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'id-child', displayName: 'Child', parentFolderId: 'id-parent', childFolderCount: 0 }
    ])

    const result = await getFolderIdByName(mockAccessToken, 'Child')
    expect(result).toBeNull()
  })

  test('returns null when folder is not found', async () => {
    mockGraphWithFolders([{ id: 'id-other', displayName: 'OtherFolder', childFolderCount: 0 }])

    const result = await getFolderIdByName(mockAccessToken, 'NonExistent')
    expect(result).toBeNull()
  })

  test('resolves a slash-delimited path to the leaf folder', async () => {
    mockGraphWithFolders([
      { id: 'id-triage', displayName: '_TRIAGE_IN', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'id-nested-junk', displayName: 'Junk', parentFolderId: 'id-triage', childFolderCount: 0 },
      { id: 'id-wellknown-junk', displayName: 'Junk', parentFolderId: 'mailbox-root', childFolderCount: 0 }
    ])

    const result = await getFolderIdByName(mockAccessToken, '_TRIAGE_IN/Junk')
    expect(result).toBe('id-nested-junk')
  })

  test('resolves a 3-segment path', async () => {
    mockGraphWithFolders([
      { id: 'id-inbox', displayName: 'Inbox', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'id-shopping', displayName: 'Shopping', parentFolderId: 'id-inbox', childFolderCount: 1 },
      { id: 'id-orders', displayName: 'Orders', parentFolderId: 'id-shopping', childFolderCount: 0 }
    ])

    const result = await getFolderIdByName(mockAccessToken, 'Inbox/Shopping/Orders')
    expect(result).toBe('id-orders')
  })

  test('returns null for a path whose segments do not form a parent chain', async () => {
    mockGraphWithFolders([
      { id: 'id-a', displayName: 'A', parentFolderId: 'mailbox-root', childFolderCount: 0 },
      { id: 'id-b', displayName: 'B', parentFolderId: 'mailbox-root', childFolderCount: 0 }
    ])

    const result = await getFolderIdByName(mockAccessToken, 'A/B')
    expect(result).toBeNull()
  })

  test('returns null when a nested folder name is passed without its full path', async () => {
    mockGraphWithFolders([
      { id: 'id-parent-a', displayName: 'ParentA', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'id-parent-b', displayName: 'ParentB', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'id-a', displayName: 'Orders', parentFolderId: 'id-parent-a', childFolderCount: 0 },
      { id: 'id-b', displayName: 'Orders', parentFolderId: 'id-parent-b', childFolderCount: 0 }
    ])

    const result = await getFolderIdByName(mockAccessToken, 'Orders')
    expect(result).toBeNull()
  })

  test('throws when the Graph call fails', async () => {
    mockCallGraphAPI.mockRejectedValue(new Error('API Error'))

    await expect(getFolderIdByName(mockAccessToken, 'TestFolder')).rejects.toThrow('API Error')
  })
})

describe('fetchFoldersRecursive', () => {
  const mockAccessToken = 'dummy_access_token'

  beforeEach(() => {
    mockCallGraphAPI.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.error as Mock).mockRestore()
  })

  test('walks the full tree and returns all descendants in a flat array', async () => {
    mockGraphWithFolders([
      { id: 'A', displayName: 'A', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'A1', displayName: 'A1', parentFolderId: 'A', childFolderCount: 1 },
      { id: 'A1a', displayName: 'A1a', parentFolderId: 'A1', childFolderCount: 0 },
      { id: 'B', displayName: 'B', parentFolderId: 'mailbox-root', childFolderCount: 0 }
    ])

    const result = await fetchFoldersRecursive(mockAccessToken, 'me/mailFolders')
    const ids = result.map((f) => f.id).sort()
    expect(ids).toEqual(['A', 'A1', 'A1a', 'B'])
  })

  test('follows @odata.nextLink pagination at each level', async () => {
    mockGraphWithFolders(
      [
        { id: 'F1', displayName: 'F1', parentFolderId: 'mailbox-root', childFolderCount: 0 },
        { id: 'F2', displayName: 'F2', parentFolderId: 'mailbox-root', childFolderCount: 0 },
        { id: 'F3', displayName: 'F3', parentFolderId: 'mailbox-root', childFolderCount: 0 }
      ],
      { pageSize: 2 }
    )

    const result = await fetchFoldersRecursive(mockAccessToken, 'me/mailFolders')
    expect(result.map((f) => f.id).sort()).toEqual(['F1', 'F2', 'F3'])
  })
})

describe('getAllFolders', () => {
  const mockAccessToken = 'dummy_access_token'

  beforeEach(() => {
    mockCallGraphAPI.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    ;(console.error as Mock).mockRestore()
  })

  test('returns every folder in the mailbox (nested included)', async () => {
    mockGraphWithFolders([
      { id: 'id-inbox', displayName: 'Inbox', parentFolderId: 'mailbox-root', childFolderCount: 1 },
      { id: 'id-sub', displayName: 'Sub', parentFolderId: 'id-inbox', childFolderCount: 0 }
    ])

    const result = await getAllFolders(mockAccessToken)
    expect(result.map((f) => f.displayName).sort()).toEqual(['Inbox', 'Sub'])
  })
})
