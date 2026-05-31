/**
 * Delete folder functionality
 */

import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { getFolderIdByName } from './folder-utils.js'

export const handleDeleteFolder = async (args: any): Promise<any> => {
  const folder = args.folder || ''
  const dry_run = args.dry_run !== false
  const deleteContext = { folder }

  if (!folder) {
    return errorText('Folder path is required.')
  }

  try {
    const accessToken = await ensureAuthenticated()
    const folderId = await getFolderIdByName(accessToken, folder)

    if (!folderId) {
      return errorText(`Folder "${folder}" not found. Use a valid full path for custom folders.`)
    }

    if (dry_run) {
      return {
        content: [
          {
            type: 'text',
            text: `[dry_run] would delete mail folder "${folder}" (id: ${folderId}). Pass dry_run: false to delete.`
          }
        ]
      }
    }

    await callGraphAPI(accessToken, 'DELETE', `me/mailFolders/${folderId}`)

    return {
      content: [{ type: 'text', text: `Successfully deleted folder "${folder}".` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error deleting folder: ${formatFolderDeleteError(error, deleteContext)}`)
  }
}

const formatFolderDeleteError = (error: any, context: any): string => {
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

export default handleDeleteFolder
