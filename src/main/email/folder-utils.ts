/**
 * Email folder utilities
 */
import { callGraphAPI } from '../graph-client/index.js'

export const WELL_KNOWN_FOLDERS = {
  inbox: 'me/mailFolders/inbox/messages',
  drafts: 'me/mailFolders/drafts/messages',
  sent: 'me/mailFolders/sentItems/messages',
  deleted: 'me/mailFolders/deletedItems/messages',
  junk: 'me/mailFolders/junkemail/messages',
  archive: 'me/mailFolders/archive/messages'
} as const

type WellKnownFolderKey = keyof typeof WELL_KNOWN_FOLDERS

const lookupWellKnown = (name: string): string | undefined => (name in WELL_KNOWN_FOLDERS ? WELL_KNOWN_FOLDERS[name as WellKnownFolderKey] : undefined)

export const FOLDER_SELECT_FIELDS = 'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount'

const CHILD_FETCH_CONCURRENCY = 5

export const resolveFolderPath = async (accessToken: string, folderName: string | null | undefined): Promise<string> => {
  if (!folderName) {
    return WELL_KNOWN_FOLDERS.inbox
  }

  const wellKnown = lookupWellKnown(folderName.toLowerCase())
  if (wellKnown) {
    return wellKnown
  }

  try {
    const folderId = await getFolderIdByName(accessToken, folderName)
    if (folderId) {
      return `me/mailFolders/${folderId}/messages`
    }
    throw new Error(`Folder "${folderName}" was not found or is ambiguous. Use a full slash-delimited path such as "Top/Sub".`)
  } catch (error: any) {
    if (error.message?.includes('was not found or is ambiguous')) {
      throw error
    }
    throw new Error(`Error resolving folder "${folderName}": ${error.message}`)
  }
}

export const getFolderIdByName = async (accessToken: string, folderName: string): Promise<string | null> => {
  const allFolders = await fetchFoldersRecursive(accessToken, 'me/mailFolders')
  if (allFolders.length === 0) {
    return null
  }

  const segments = folderName
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)

  return resolvePathSegments(allFolders, segments)
}

const resolvePathSegments = (allFolders: any[], segments: string[]): string | null => {
  const [first] = segments
  if (first === undefined) return null
  const knownIds = new Set(allFolders.map((f) => f.id))
  const byLowerName = new Map<string, any[]>()
  for (const f of allFolders) {
    if (!f.displayName) continue
    const key = f.displayName.toLowerCase()
    if (!byLowerName.has(key)) byLowerName.set(key, [])
    byLowerName.get(key)?.push(f)
  }

  let candidates = (byLowerName.get(first.toLowerCase()) || []).filter((f: any) => !knownIds.has(f.parentFolderId))

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i]
    /* v8 ignore next — bounded loop index, segments[i] is never undefined */
    if (seg === undefined) continue
    const next = byLowerName.get(seg.toLowerCase()) || []
    const parentIds = new Set(candidates.map((f) => f.id))
    candidates = next.filter((f: any) => parentIds.has(f.parentFolderId))
  }

  // Resolve only on an unambiguous single match; an ambiguous (>1) or absent
  // match both yield null so the caller surfaces a "not found or ambiguous" hint.
  return candidates.length === 1 ? candidates[0].id : null
}

export const getAllFolders = async (accessToken: string): Promise<any[]> => {
  return fetchFoldersRecursive(accessToken, 'me/mailFolders')
}

export const fetchFoldersRecursive = async (accessToken: string, endpoint: string, selectFields: string = FOLDER_SELECT_FIELDS): Promise<any[]> => {
  const folders = await fetchAllPages(accessToken, endpoint, {
    $top: 100,
    $select: selectFields
  })

  if (folders.length === 0) {
    return []
  }

  const parents = folders.filter((f: any) => f.childFolderCount > 0)
  const childBatches = await mapWithConcurrency(parents, CHILD_FETCH_CONCURRENCY, (folder: any) => fetchFoldersRecursive(accessToken, `me/mailFolders/${folder.id}/childFolders`, selectFields))

  return [...folders, ...childBatches.flat()]
}

const fetchAllPages = async (accessToken: string, endpoint: string, initialParams: Record<string, any>): Promise<any[]> => {
  const all: any[] = []
  let nextEndpoint: string | null = endpoint
  let nextParams = initialParams

  while (nextEndpoint) {
    const response: any = await callGraphAPI(accessToken, 'GET', nextEndpoint, null, nextParams)
    if (response && Array.isArray(response.value)) {
      all.push(...response.value)
    }

    const nextLink: string | undefined = response?.['@odata.nextLink']
    if (nextLink) {
      const nextUrl = new URL(nextLink)
      nextEndpoint = nextUrl.pathname.replace(/^\/v\d+(?:\.\d+)?\//, '')
      nextParams = Object.fromEntries(nextUrl.searchParams.entries())
    } else {
      nextEndpoint = null
    }
  }

  return all
}

const mapWithConcurrency = async <T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> => {
  const results = new Array(items.length)
  let cursor = 0

  async function worker() {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      const item = items[index]
      /* v8 ignore next — items is dense; an in-bounds index is never undefined */
      if (item === undefined) continue
      results[index] = await fn(item, index)
    }
  }

  const workerCount = Math.min(limit, items.length)
  const workers = Array.from({ length: workerCount }, () => worker())
  await Promise.all(workers)
  return results
}
