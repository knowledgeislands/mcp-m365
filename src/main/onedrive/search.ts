/**
 * OneDrive search files functionality
 */
import { ONEDRIVE_SELECT_FIELDS } from '../../config/index.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleSearchFiles = async (ctx: GraphContext, args: any): Promise<any> => {
  const query = args.query
  const count = args.count || 25

  if (!query) {
    return errorText('Search query is required.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()

    const endpoint = `me/drive/search(q='${encodeURIComponent(query)}')`

    const queryParams = {
      $top: Math.min(50, count),
      $select: ONEDRIVE_SELECT_FIELDS
    }

    const response = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', endpoint, null, queryParams)

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
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error searching files: ${error.message}`)
  }
}

const formatSize = (bytes: number): string => {
  /* v8 ignore next — callers guard with `item.size ?`, so formatSize only sees truthy sizes here */
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}
