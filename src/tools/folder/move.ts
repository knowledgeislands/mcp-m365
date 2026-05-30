/**
 * Move emails functionality
 */
import { callGraphAPI } from '../../main/graph-client/index.js'
import { ensureAuthenticated } from '../auth/index.js'
import { getFolderIdByName } from './folder-utils.js'

export const handleMoveEmails = async (args: any): Promise<any> => {
  const emailIds = args.emailIds || ''
  const targetFolder = args.targetFolder || ''
  const sourceFolder = args.sourceFolder || ''
  const moveContext = { emailIds, targetFolder, sourceFolder }

  if (!emailIds) {
    return {
      content: [{ type: 'text', text: 'Email IDs are required. Please provide a comma-separated list of email IDs to move.' }]
    }
  }

  if (!targetFolder) {
    return {
      content: [{ type: 'text', text: 'Target folder name is required.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    const ids = emailIds
      .split(',')
      .map((id: string) => id.trim())
      .filter((id: string) => id)

    if (ids.length === 0) {
      return {
        content: [{ type: 'text', text: 'No valid email IDs provided.' }]
      }
    }

    const result = await moveEmailsToFolder(accessToken, ids, targetFolder, sourceFolder)

    return {
      content: [{ type: 'text', text: result.message }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'm365_auth_start' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error moving emails: ${formatMoveError(error, moveContext)}` }]
    }
  }
}

const formatMoveError = (error: any, context: any): string => {
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

interface MoveResult {
  success: boolean
  message: string
  results?: { successful: string[]; failed: { id: string; error: string }[] }
}

const moveEmailsToFolder = async (accessToken: string, emailIds: string[], targetFolderName: string, _sourceFolderName: string): Promise<MoveResult> => {
  try {
    const targetFolderId = await getFolderIdByName(accessToken, targetFolderName)
    if (!targetFolderId) {
      return {
        success: false,
        message: `Target folder "${targetFolderName}" not found. Please specify a valid folder name.`
      }
    }

    try {
      await callGraphAPI(accessToken, 'GET', `me/mailFolders/${targetFolderId}`)
    } catch (error: any) {
      return {
        success: false,
        message: `Resolved folder "${targetFolderName}" to ID ${targetFolderId}, but that folder is not reachable: ${error.message}`
      }
    }

    const results = {
      successful: [] as string[],
      failed: [] as { id: string; error: string }[]
    }

    for (const emailId of emailIds) {
      try {
        await callGraphAPI(accessToken, 'POST', `me/messages/${emailId}/move`, { destinationId: targetFolderId })

        results.successful.push(emailId)
      } catch (error: any) {
        console.error(`Error moving email ${emailId}: ${error.message}`)
        results.failed.push({ id: emailId, error: error.message })
      }
    }

    let message = ''

    if (results.successful.length > 0) {
      message += `Successfully moved ${results.successful.length} email(s) to "${targetFolderName}".`
    }

    if (results.failed.length > 0) {
      if (message) message += '\n\n'
      message += `Failed to move ${results.failed.length} email(s). Errors:`

      const maxErrors = Math.min(results.failed.length, 3)
      for (let i = 0; i < maxErrors; i++) {
        const failure = results.failed[i]
        if (!failure) continue
        message += `\n- Email ${i + 1}: ${failure.error}`
      }

      if (results.failed.length > maxErrors) {
        message += `\n...and ${results.failed.length - maxErrors} more.`
      }
    }

    return {
      success: results.successful.length > 0,
      message,
      results
    }
  } catch (error: any) {
    console.error(`Error in moveEmailsToFolder: ${error.message}`)
    throw error
  }
}

export default handleMoveEmails
