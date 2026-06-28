/**
 * Create folder functionality
 */

import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { getFolderIdByName } from './folder-utils.js'

export const handleCreateFolder = async (ctx: GraphContext, args: any): Promise<any> => {
  const folderName = args.name
  const parentFolder = args.parentFolder || ''
  const createContext = {
    name: folderName || '',
    parentFolder
  }

  if (!folderName) {
    return errorText('Folder name is required.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const result = await createMailFolder(ctx.graphApiEndpoint, accessToken, folderName, parentFolder)

    return {
      content: [{ type: 'text', text: result.message }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error creating folder: ${formatFolderError(error, createContext)}`)
  }
}

const formatFolderError = (error: any, context: any): string => {
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

const createMailFolder = async (
  graphApiEndpoint: string,
  accessToken: string,
  folderName: string,
  parentFolderName: string
): Promise<{ success: boolean; message: string; folderId?: string }> => {
  const existingFolder = await getFolderIdByName(graphApiEndpoint, accessToken, folderName)
  if (existingFolder) {
    return {
      success: false,
      message: `A folder named "${folderName}" already exists.`
    }
  }

  let endpoint = 'me/mailFolders'
  if (parentFolderName) {
    const parentId = await getFolderIdByName(graphApiEndpoint, accessToken, parentFolderName)
    if (!parentId) {
      return {
        success: false,
        message: `Parent folder "${parentFolderName}" not found. Please specify a valid parent folder or leave it blank to create at the root level.`
      }
    }

    endpoint = `me/mailFolders/${parentId}/childFolders`
  }

  const folderData = {
    displayName: folderName
  }

  const response = await callGraphAPI(graphApiEndpoint, accessToken, 'POST', endpoint, folderData)

  if (response?.id) {
    const locationInfo = parentFolderName ? `inside "${parentFolderName}"` : 'at the root level'

    return {
      success: true,
      message: `Successfully created folder "${folderName}" ${locationInfo}.`,
      folderId: response.id
    }
  } else {
    return {
      success: false,
      message: "Failed to create folder. The server didn't return a folder ID."
    }
  }
}
