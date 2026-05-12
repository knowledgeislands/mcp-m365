/**
 * Authentication module for MCP M365 server.
 *
 * Exposes:
 *  - `ensureAuthenticated` for tool handlers to obtain a valid access token.
 *  - `registerAuthTools` to register the auth tools on an `McpServer`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { tokenStorage } from './storage.js'
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

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const
const READ_ONLY_REMOTE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const

export const registerAuthTools = (server: McpServer): void => {
  server.registerTool(
    'about',
    {
      description: 'Returns information about this MCP M365 server',
      inputSchema: {},
      annotations: READ_ONLY
    },
    handleAbout
  )

  server.registerTool(
    'authenticate',
    {
      description: 'Authenticate with Microsoft Graph API to access Outlook data',
      inputSchema: {
        force: z.boolean().optional().describe('Force re-authentication even if already authenticated')
      },
      annotations: READ_ONLY_REMOTE
    },
    handleAuthenticate
  )

  server.registerTool(
    'check-auth-status',
    {
      description: 'Check the current authentication status with Microsoft Graph API. Returns presence + scope/expiry metadata only — never the token values.',
      inputSchema: {},
      annotations: READ_ONLY
    },
    handleCheckAuthStatus
  )
}

export { handleAbout, handleAuthenticate, handleCheckAuthStatus }
