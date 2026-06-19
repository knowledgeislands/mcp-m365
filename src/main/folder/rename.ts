/**
 * Rename folder functionality
 */

import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { getFolderIdByName } from './folder-utils.js'

export const handleRenameFolder = async (ctx: GraphContext, args: any): Promise<any> => {
  const folder = args.folder || ''
  const newName = args.newName || ''
  const renameContext = { folder, newName }

  if (!folder) {
    return errorText('Folder path is required.')
  }

  if (!newName) {
    return errorText('New folder name is required.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const folderId = await getFolderIdByName(ctx.graphApiEndpoint, accessToken, folder)

    if (!folderId) {
      return errorText(`Folder "${folder}" not found. Use a valid full path for custom folders.`)
    }

    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'PATCH', `me/mailFolders/${folderId}`, {
      displayName: newName
    })

    return {
      content: [{ type: 'text', text: `Successfully renamed folder "${folder}" to "${newName}".` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error renaming folder: ${formatFolderMutationError(error, renameContext)}`)
  }
}

const formatFolderMutationError = (error: any, context: any): string => {
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

export default handleRenameFolder
