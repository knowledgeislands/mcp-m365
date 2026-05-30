/**
 * OneDrive folder operations (create/delete)
 */
import { callGraphAPI } from '../../main/graph-client/index.js'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleCreateFolder = async (args: any): Promise<any> => {
  const path = args.path
  const name = args.name

  if (!name) {
    return {
      content: [{ type: 'text', text: 'Folder name is required.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    let endpoint: string
    if (!path || path === '/' || path === 'root') {
      endpoint = 'me/drive/root/children'
    } else {
      endpoint = `me/drive/root:/${sanitizeOneDrivePath(path)}:/children`
    }

    const body = {
      name: name,
      folder: {},
      '@microsoft.graph.conflictBehavior': 'rename'
    }

    const response = await callGraphAPI(accessToken, 'POST', endpoint, body)

    if (!response?.id) {
      return {
        content: [{ type: 'text', text: 'Failed to create folder.' }]
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Successfully created folder "${response.name}"\n\nID: ${response.id}\nWeb URL: ${response.webUrl}`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'm365_auth_start' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error creating folder: ${error.message}` }]
    }
  }
}

export const handleDeleteItem = async (args: any): Promise<any> => {
  const itemId = args.itemId
  const path = args.path
  const dry_run = args.dry_run !== false

  if (!itemId && !path) {
    return {
      content: [{ type: 'text', text: 'Either itemId or path is required.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    let endpoint: string
    if (itemId) {
      endpoint = `me/drive/items/${encodeURIComponent(itemId)}`
    } else {
      endpoint = `me/drive/root:/${sanitizeOneDrivePath(path)}`
    }

    const itemInfo = await callGraphAPI(accessToken, 'GET', endpoint)

    if (!itemInfo?.id) {
      return {
        content: [{ type: 'text', text: 'Item not found.' }]
      }
    }

    const itemName = itemInfo.name
    const isFolder = !!itemInfo.folder

    if (dry_run) {
      return {
        content: [
          {
            type: 'text',
            text: `[dry_run] would delete ${isFolder ? 'folder' : 'file'} "${itemName}" (id: ${itemInfo.id}, size: ${itemInfo.size ?? '?'}B). Pass dry_run: false to delete.`
          }
        ]
      }
    }

    const deleteEndpoint = `me/drive/items/${itemInfo.id}`
    await callGraphAPI(accessToken, 'DELETE', deleteEndpoint)

    return {
      content: [
        {
          type: 'text',
          text: `Successfully deleted ${isFolder ? 'folder' : 'file'} "${itemName}".`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'm365_auth_start' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error deleting item: ${error.message}` }]
    }
  }
}
