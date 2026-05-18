/**
 * Authentication module for MCP M365 server.
 *
 * Exposes:
 *  - `ensureAuthenticated` for tool handlers to obtain a valid access token.
 *  - `registerAuthTools` to register the auth tools on an `McpServer`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { tokenStorage } from '../../auth.js'
import { READ_ONLY, READ_ONLY_REMOTE } from '../../utils/annotations.js'
import { handleAbout, handleAuthenticate, handleCheckAuthStatus } from './tools.js'

export const ensureAuthenticated = async (forceNew = false): Promise<string> => {
  if (forceNew) {
    throw new Error('Authentication required')
  }

  const accessToken = await tokenStorage.getValidAccessToken()
  if (!accessToken) {
    throw new Error('Authentication required')
  }

  return accessToken
}

export const registerAuthTools = (server: McpServer): void => {
  server.registerTool(
    'viewer_about',
    {
      description: 'Returns information about this MCP M365 server',
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY
    },
    handleAbout
  )

  server.registerTool(
    'editor_authenticate',
    {
      description: 'Authenticate with Microsoft Graph API to access Outlook data',
      inputSchema: z
        .object({
          force: z.boolean().optional().describe('Force re-authentication even if already authenticated')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    handleAuthenticate
  )

  server.registerTool(
    'viewer_check-auth-status',
    {
      description: 'Check the current authentication status with Microsoft Graph API. Returns presence + scope/expiry metadata only — never the token values.',
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY
    },
    handleCheckAuthStatus
  )
}

export { handleAbout, handleAuthenticate, handleCheckAuthStatus }
