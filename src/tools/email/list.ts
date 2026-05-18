/**
 * List emails functionality
 */
import config from '../../config.js'
import { callGraphAPIPaginated } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'
import { resolveFolderPath } from './folder-utils.js'

export const handleListEmails = async (args: any): Promise<any> => {
  const folder = args.folder || 'inbox'
  const folderId = args.folderId || ''
  const folderRef = folderId ? `folderId:${folderId}` : folder
  const requestedCount = Math.max(1, Math.min(args.count || config.DEFAULT_LIST_SIZE, config.MAX_RESULT_COUNT))
  const includeCount = args.includeCount === true
  const listContext = {
    folder,
    folderId,
    count: requestedCount,
    includeCount
  }

  try {
    const accessToken = await ensureAuthenticated()

    const effectiveFolderId = folderId

    const endpoint = effectiveFolderId ? `me/mailFolders/${effectiveFolderId}/messages` : await resolveFolderPath(accessToken, folder)

    const queryParams: Record<string, any> = {
      $top: Math.min(config.DEFAULT_PAGE_SIZE, requestedCount),
      $orderby: 'receivedDateTime desc',
      $select: config.EMAIL_SELECT_FIELDS
    }

    if (includeCount) {
      queryParams.$count = true
    }

    const response = await callGraphAPIPaginated(accessToken, 'GET', endpoint, queryParams, requestedCount)

    if (!response.value || response.value.length === 0) {
      return createResponse(`No emails found in ${folderRef}.`, {
        type: 'email-list',
        success: true,
        folder,
        folderId: effectiveFolderId || folderId,
        requestedCount,
        returnedCount: 0,
        totalMatching: includeCount && Number.isFinite(response['@odata.count']) ? response['@odata.count'] : null,
        items: []
      })
    }

    const emailList = response.value
      .map((email: any, index: number) => {
        const sender = email.from ? email.from.emailAddress : { name: 'Unknown', address: 'unknown' }
        const date = new Date(email.receivedDateTime).toLocaleString()
        const readStatus = email.isRead ? '' : '[UNREAD] '
        return `${index + 1}. ${readStatus}${date} - From: ${sender.name} (${sender.address})\nSubject: ${email.subject}\nID: ${email.id}\n`
      })
      .join('\n')

    const totalCountText = includeCount && Number.isFinite(response['@odata.count']) ? ` (total matching: ${response['@odata.count']})` : ''

    return createResponse(`Found ${response.value.length} emails in ${folderRef}${totalCountText}:\n\n${emailList}`, {
      type: 'email-list',
      success: true,
      folder,
      folderId: effectiveFolderId || folderId,
      requestedCount,
      returnedCount: response.value.length,
      totalMatching: includeCount && Number.isFinite(response['@odata.count']) ? response['@odata.count'] : null,
      includeCount,
      items: response.value
    })
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'editor_authenticate' tool first." }]
      }
    }
    return createResponse(`Error listing emails: ${formatListError(error, listContext)}`, {
      type: 'email-list',
      success: false,
      error: error.message || 'Unknown error',
      context: listContext
    })
  }
}

const createResponse = (text: string, structuredContent: any): any => {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

const formatListError = (error: any, context: any): string => {
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

export default handleListEmails
