/**
 * List folders functionality
 */
import { ensureAuthenticated } from '../auth/index.js'
import { fetchFoldersRecursive } from './folder-utils.js'

export const handleListFolders = async (args: any): Promise<any> => {
  const includeItemCounts = args.includeItemCounts === true
  const includeChildren = args.includeChildren === true
  const listContext = { includeItemCounts, includeChildren }

  try {
    const accessToken = await ensureAuthenticated()
    const folders = await getAllFoldersHierarchy(accessToken, includeItemCounts)

    if (includeChildren) {
      return createFolderListResponse(formatFolderHierarchy(folders, includeItemCounts), {
        type: 'folder-list',
        success: true,
        includeItemCounts,
        includeChildren,
        returnedCount: folders.length,
        items: folders
      })
    } else {
      return createFolderListResponse(formatFolderList(folders, includeItemCounts), {
        type: 'folder-list',
        success: true,
        includeItemCounts,
        includeChildren,
        returnedCount: folders.length,
        items: folders
      })
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'editor_authenticate' tool first." }]
      }
    }

    return createFolderListResponse(`Error listing folders: ${formatFolderListError(error, listContext)}`, {
      type: 'folder-list',
      success: false,
      error: error.message || 'Unknown error',
      context: listContext
    })
  }
}

const createFolderListResponse = (text: string, structuredContent: any): any => {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

const formatFolderListError = (error: any, context: any): string => {
  const lines = [error.message || 'Unknown error']
  const statusMatch = /API call failed with status\s+(\d+)/i.exec(error.message || '')

  if (statusMatch) {
    lines.push(`Source: Microsoft Graph API (${statusMatch[1]}).`)
  } else {
    lines.push('Source: MCP/server-side validation or processing.')
  }

  lines.push(`Context: ${JSON.stringify(context)}`)
  return lines.join('\n')
}

const getAllFoldersHierarchy = async (accessToken: string, includeItemCounts: boolean): Promise<any[]> => {
  const selectFields = includeItemCounts ? 'id,displayName,parentFolderId,childFolderCount,totalItemCount,unreadItemCount' : 'id,displayName,parentFolderId,childFolderCount'

  const allFolders = await fetchFoldersRecursive(accessToken, 'me/mailFolders', selectFields)

  const idToName = new Map(allFolders.map((f: any) => [f.id, f.displayName]))
  return allFolders.map((folder: any) => ({
    ...folder,
    isTopLevel: !idToName.has(folder.parentFolderId),
    parentFolder: idToName.get(folder.parentFolderId) || null
  }))
}

const formatFolderList = (folders: any[], includeItemCounts: boolean): string => {
  if (!folders || folders.length === 0) {
    return 'No folders found.'
  }

  const wellKnownFolderNames = ['Inbox', 'Drafts', 'Sent Items', 'Deleted Items', 'Junk Email', 'Archive']

  const sortedFolders = [...folders].sort((a, b) => {
    const aIsWellKnown = wellKnownFolderNames.includes(a.displayName)
    const bIsWellKnown = wellKnownFolderNames.includes(b.displayName)

    if (aIsWellKnown && !bIsWellKnown) return -1
    if (!aIsWellKnown && bIsWellKnown) return 1

    if (aIsWellKnown && bIsWellKnown) {
      return wellKnownFolderNames.indexOf(a.displayName) - wellKnownFolderNames.indexOf(b.displayName)
    }

    return a.displayName.localeCompare(b.displayName)
  })

  const folderLines = sortedFolders.map((folder) => {
    let folderInfo = folder.displayName

    if (folder.parentFolder) {
      folderInfo += ` (in ${folder.parentFolder})`
    }

    if (includeItemCounts) {
      const unreadCount = folder.unreadItemCount || 0
      const totalCount = folder.totalItemCount || 0
      folderInfo += ` - ${totalCount} items`

      if (unreadCount > 0) {
        folderInfo += ` (${unreadCount} unread)`
      }
    }

    return folderInfo
  })

  return `Found ${folders.length} folders:\n\n${folderLines.join('\n')}`
}

const formatFolderHierarchy = (folders: any[], includeItemCounts: boolean): string => {
  if (!folders || folders.length === 0) {
    return 'No folders found.'
  }

  const folderMap = new Map<string, any>()
  const rootFolders: string[] = []

  folders.forEach((folder) => {
    folderMap.set(folder.id, { ...folder, children: [] })

    if (folder.isTopLevel) {
      rootFolders.push(folder.id)
    }
  })

  folders.forEach((folder) => {
    if (!folder.isTopLevel && folder.parentFolderId) {
      const parent = folderMap.get(folder.parentFolderId)
      if (parent) {
        parent.children.push(folder.id)
      } else {
        rootFolders.push(folder.id)
      }
    }
  })

  function formatSubtree(folderId: string, level: number = 0): string {
    const folder = folderMap.get(folderId)
    if (!folder) return ''

    const indent = '  '.repeat(level)
    let line = `${indent}${folder.displayName}`

    if (includeItemCounts) {
      const unreadCount = folder.unreadItemCount || 0
      const totalCount = folder.totalItemCount || 0
      line += ` - ${totalCount} items`

      if (unreadCount > 0) {
        line += ` (${unreadCount} unread)`
      }
    }

    const childLines = folder.children
      .map((childId: string) => formatSubtree(childId, level + 1))
      .filter((l: string) => l.length > 0)
      .join('\n')

    return childLines.length > 0 ? `${line}\n${childLines}` : line
  }

  const formattedHierarchy = rootFolders.map((folderId) => formatSubtree(folderId)).join('\n')

  return `Folder Hierarchy:\n\n${formattedHierarchy}`
}

export default handleListFolders
