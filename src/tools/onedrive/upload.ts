/**
 * OneDrive simple upload functionality (files < 4MB)
 */
import config from '../../config.js'
import { callGraphAPI } from '../../utils/graph-api.js'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleUpload = async (args: any): Promise<any> => {
  const path = args.path
  const content = args.content
  const conflictBehavior = args.conflictBehavior || 'rename'

  if (!path) {
    return {
      content: [{ type: 'text', text: "Path is required (e.g., '/Documents/myfile.txt')." }]
    }
  }

  if (!content) {
    return {
      content: [{ type: 'text', text: 'Content is required.' }]
    }
  }

  const contentSize = Buffer.byteLength(content, 'utf8')
  if (contentSize > config.ONEDRIVE_UPLOAD_THRESHOLD) {
    return {
      content: [{ type: 'text', text: `File is too large for simple upload (${formatSize(contentSize)}). Use onedrive-upload-large for files over 4MB.` }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    const endpoint = `me/drive/root:/${sanitizeOneDrivePath(path)}:/content`

    const queryParams = {
      '@microsoft.graph.conflictBehavior': conflictBehavior
    }

    const response = await callGraphAPI(accessToken, 'PUT', endpoint, content, queryParams)

    if (!response?.id) {
      return {
        content: [{ type: 'text', text: 'Upload failed - no response from server.' }]
      }
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
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'editor_authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error uploading file: ${error.message}` }]
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

export default handleUpload
