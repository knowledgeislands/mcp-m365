/**
 * OneDrive list files/folders functionality
 */
import config from '../../config.js'
import { callGraphAPI } from '../../utils/graph-api.js'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleListFiles = async (args: any): Promise<any> => {
  const path = args.path || ''
  const count = args.count || 25

  try {
    const accessToken = await ensureAuthenticated()

    let endpoint: string
    if (!path || path === '/' || path === 'root') {
      endpoint = 'me/drive/root/children'
    } else {
      const safePath = sanitizeOneDrivePath(path)
      endpoint = `me/drive/root:/${safePath}:/children`
    }

    const queryParams = {
      $top: Math.min(50, count),
      $select: config.ONEDRIVE_SELECT_FIELDS,
      $orderby: 'name'
    }

    const response = await callGraphAPI(accessToken, 'GET', endpoint, null, queryParams)

    if (!response.value || response.value.length === 0) {
      return {
        content: [{ type: 'text', text: `No files found in ${path || 'root'}.` }]
      }
    }

    const fileList = response.value
      .map((item: any, index: number) => {
        const isFolder = item.folder ? '[FOLDER]' : '[FILE]'
        const size = item.size ? formatSize(item.size) : ''
        const modified = new Date(item.lastModifiedDateTime).toLocaleString()

        return `${index + 1}. ${isFolder} ${item.name}${size ? ` (${size})` : ''}\n   Modified: ${modified}\n   ID: ${item.id}`
      })
      .join('\n\n')

    return {
      content: [{ type: 'text', text: `Found ${response.value.length} items in ${path || 'root'}:\n\n${fileList}` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'editor_authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error listing files: ${error.message}` }]
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

export default handleListFiles
