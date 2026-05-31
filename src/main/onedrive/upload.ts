/**
 * OneDrive simple upload functionality (files < 4MB)
 */
import { ONEDRIVE_UPLOAD_THRESHOLD } from '../../config/index.js'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'

export const handleUpload = async (args: any): Promise<any> => {
  const path = args.path
  const content = args.content
  const conflictBehavior = args.conflictBehavior || 'rename'

  if (!path) {
    return errorText("Path is required (e.g., '/Documents/myfile.txt').")
  }

  if (!content) {
    return errorText('Content is required.')
  }

  const contentSize = Buffer.byteLength(content, 'utf8')
  if (contentSize > ONEDRIVE_UPLOAD_THRESHOLD) {
    return errorText(`File is too large for simple upload (${formatSize(contentSize)}). Use onedrive-upload-large for files over 4MB.`)
  }

  try {
    const accessToken = await ensureAuthenticated()

    const endpoint = `me/drive/root:/${sanitizeOneDrivePath(path)}:/content`

    const queryParams = {
      '@microsoft.graph.conflictBehavior': conflictBehavior
    }

    const response = await callGraphAPI(accessToken, 'PUT', endpoint, content, queryParams)

    if (!response?.id) {
      return errorText('Upload failed - no response from server.')
    }

    return {
      content: [
        {
          type: 'text',
          text: `Successfully uploaded "${response.name}" (${formatSize(response.size)})\n\nID: ${response.id}\nWeb URL: ${response.webUrl}`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error uploading file: ${error.message}`)
  }
}

const formatSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

export default handleUpload
