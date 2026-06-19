/**
 * OneDrive list files/folders functionality
 */
import { ONEDRIVE_SELECT_FIELDS } from '../../config/index.js'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleListFiles = async (ctx: GraphContext, args: any): Promise<any> => {
  const path = args.path || ''
  const count = args.count || 25

  try {
    const accessToken = await ctx.ensureAuthenticated()

    let endpoint: string
    if (!path || path === '/' || path === 'root') {
      endpoint = 'me/drive/root/children'
    } else {
      const safePath = sanitizeOneDrivePath(path)
      endpoint = `me/drive/root:/${safePath}:/children`
    }

    const queryParams = {
      $top: Math.min(50, count),
      $select: ONEDRIVE_SELECT_FIELDS,
      $orderby: 'name'
    }

    const response = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', endpoint, null, queryParams)

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
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error listing files: ${error.message}`)
  }
}

const formatSize = (bytes: number): string => {
  /* v8 ignore next — callers guard with `item.size ?`, so formatSize only sees truthy sizes here */
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

export default handleListFiles
