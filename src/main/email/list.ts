/**
 * List emails functionality
 */
import { z } from 'zod'
import { DEFAULT_LIST_SIZE, DEFAULT_PAGE_SIZE, EMAIL_SELECT_FIELDS, MAX_RESULT_COUNT } from '../../config/index.js'
import { callGraphAPIPaginated, type GraphContext } from '../graph-client/index.js'
import { resolveFolderPath } from './folder-utils.js'

/**
 * Shape of the `structuredContent` returned by `handleListEmails`, and (via the
 * same schema) the `outputSchema` declared by the `m365_email_messages_list`
 * tool — so the declared schema and the emitted object cannot drift. `.loose()`
 * keeps the raw Graph `items` and any future field permissive.
 */
export const emailListResultSchema = z
  .object({
    type: z.literal('email-list'),
    success: z.boolean(),
    folder: z.string().optional(),
    folderId: z.string().optional(),
    requestedCount: z.number().optional(),
    returnedCount: z.number().optional(),
    totalMatching: z.number().nullable().optional(),
    includeCount: z.boolean().optional(),
    items: z.array(z.any()).optional()
  })
  .loose()

export type EmailListResult = z.infer<typeof emailListResultSchema>

export const handleListEmails = async (ctx: GraphContext, args: any): Promise<any> => {
  const folder = args.folder || 'inbox'
  const folderId = args.folderId || ''
  const folderRef = folderId ? `folderId:${folderId}` : folder
  const requestedCount = Math.max(1, Math.min(args.count || DEFAULT_LIST_SIZE, MAX_RESULT_COUNT))
  const includeCount = args.includeCount === true
  const listContext = {
    folder,
    folderId,
    count: requestedCount,
    includeCount
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()

    const effectiveFolderId = folderId

    const endpoint = effectiveFolderId ? `me/mailFolders/${effectiveFolderId}/messages` : await resolveFolderPath(ctx.graphApiEndpoint, accessToken, folder)

    const queryParams: Record<string, any> = {
      $top: Math.min(DEFAULT_PAGE_SIZE, requestedCount),
      $orderby: 'receivedDateTime desc',
      $select: EMAIL_SELECT_FIELDS
    }

    if (includeCount) {
      queryParams.$count = true
    }

    const response = await callGraphAPIPaginated(ctx.graphApiEndpoint, accessToken, 'GET', endpoint, queryParams, requestedCount)

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
        isError: true as const,
        content: [{ type: 'text', text: "Authentication required. Please use the 'm365_auth_start' tool first." }]
      }
    }
    return {
      isError: true as const,
      content: [{ type: 'text', text: `Error listing emails: ${formatListError(error, listContext)}` }],
      structuredContent: {
        type: 'email-list',
        success: false,
        error: error.message || 'Unknown error',
        context: listContext
      }
    }
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
