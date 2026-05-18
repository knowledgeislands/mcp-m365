/**
 * OneDrive get download URL functionality
 */
import { callGraphAPI } from '../../utils/graph-api.js'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleDownload = async (args: any): Promise<any> => {
  const itemId = args.itemId
  const path = args.path

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

    const queryParams = {
      $select: 'id,name,size,@microsoft.graph.downloadUrl'
    }

    const response = await callGraphAPI(accessToken, 'GET', endpoint, null, queryParams)

    if (!response) {
      return {
        content: [{ type: 'text', text: 'File not found.' }]
      }
    }

    const downloadUrl = response['@microsoft.graph.downloadUrl']

    if (!downloadUrl) {
      if (response.folder) {
        return {
          content: [{ type: 'text', text: `"${response.name}" is a folder and cannot be downloaded directly.` }]
        }
      }

      return {
        content: [{ type: 'text', text: 'Could not get download URL for this item.' }]
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Download URL for "${response.name}" (${formatSize(response.size)}):\n\n${downloadUrl}\n\nNote: This URL is pre-authenticated and expires after a short time.`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'editor_authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error getting download URL: ${error.message}` }]
    }
  }
}

const formatSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

export default handleDownload
