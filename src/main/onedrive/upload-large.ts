/**
 * OneDrive chunked upload functionality (files > 4MB)
 */
import https from 'node:https'
import { sanitizeOneDrivePath } from '../../utils/odata-helpers.js'
import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'

const CHUNK_SIZE = 320 * 1024 * 10

export const handleUploadLarge = async (args: any): Promise<any> => {
  const path = args.path
  const content = args.content
  const conflictBehavior = args.conflictBehavior || 'rename'

  if (!path) {
    return errorText("Path is required (e.g., '/Documents/largefile.zip').")
  }

  if (!content) {
    return errorText('Content is required.')
  }

  try {
    const accessToken = await ensureAuthenticated()
    const contentBuffer = Buffer.from(content)
    const fileSize = contentBuffer.length

    const sessionEndpoint = `me/drive/root:/${sanitizeOneDrivePath(path)}:/createUploadSession`
    const sessionBody = {
      item: {
        '@microsoft.graph.conflictBehavior': conflictBehavior
      }
    }

    const sessionResponse = await callGraphAPI(accessToken, 'POST', sessionEndpoint, sessionBody)

    if (!sessionResponse?.uploadUrl) {
      return errorText('Failed to create upload session.')
    }

    const uploadUrl = sessionResponse.uploadUrl

    let offset = 0
    let response: any

    while (offset < fileSize) {
      const chunkEnd = Math.min(offset + CHUNK_SIZE, fileSize)
      const chunk = contentBuffer.slice(offset, chunkEnd)

      response = await uploadChunk(uploadUrl, chunk, offset, chunkEnd - 1, fileSize)

      if (response.error) {
        return errorText(`Upload failed at byte ${offset}: ${response.error}`)
      }

      offset = chunkEnd
    }

    if (!response?.id) {
      return errorText('Upload completed but no file info returned.')
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

    return errorText(`Error uploading large file: ${error.message}`)
  }
}

const uploadChunk = async (uploadUrl: string, chunk: Buffer, start: number, end: number, totalSize: number): Promise<any> => {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      method: 'PUT',
      headers: {
        'Content-Length': chunk.length,
        'Content-Range': `bytes ${start}-${end}/${totalSize}`
      }
    }

    const req = https.request(uploadUrl, options, (res) => {
      let responseData = ''

      res.on('data', (data) => {
        responseData += data
      })

      res.on('end', () => {
        /* v8 ignore next — Node always sets statusCode on a delivered response */
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) {
          try {
            resolve(JSON.parse(responseData || '{}'))
          } catch (_e) {
            resolve({})
          }
        } else {
          resolve({ error: `Status ${status}: ${responseData}` })
        }
      })
    })

    req.on('error', (error) => {
      resolve({ error: error.message })
    })

    req.write(chunk)
    req.end()
  })
}

const formatSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

export default handleUploadLarge
