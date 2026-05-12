/**
 * OneDrive search files functionality
 */
import config from '../../config.js'
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleSearchFiles = async (args: any): Promise<any> => {
  const query = args.query
  const count = args.count || 25

  if (!query) {
    return {
      content: [{ type: 'text', text: 'Search query is required.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    const endpoint = `me/drive/search(q='${encodeURIComponent(query)}')`

    const queryParams = {
      $top: Math.min(50, count),
      $select: config.ONEDRIVE_SELECT_FIELDS
    }

    const response = await callGraphAPI(accessToken, 'GET', endpoint, null, queryParams)

    if (!response.value || response.value.length === 0) {
      return {
        content: [{ type: 'text', text: `No files found matching "${query}".` }]
      }
    }

    const fileList = response.value
      .map((item: any, index: number) => {
        const isFolder = item.folder ? '[FOLDER]' : '[FILE]'
        const size = item.size ? formatSize(item.size) : ''
        const modified = new Date(item.lastModifiedDateTime).toLocaleString()
        const path = item.parentReference?.path?.replace('/drive/root:', '') || '/'

        return `${index + 1}. ${isFolder} ${item.name}${size ? ` (${size})` : ''}\n   Path: ${path}\n   Modified: ${modified}\n   ID: ${item.id}`
      })
      .join('\n\n')

    return {
      content: [{ type: 'text', text: `Found ${response.value.length} items matching "${query}":\n\n${fileList}` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error searching files: ${error.message}` }]
    }
  }
}

const formatSize = (bytes: number): string => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

export default handleSearchFiles
