/**
 * Authentication module for MCP M365 server.
 *
 * Exposes:
 *  - `ensureAuthenticated` for tool handlers to obtain a valid access token.
 *  - `registerAuthTools` to register the auth tools on an `McpServer`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import { getTokenStorage } from '../../main/auth/index.js'
import { READ_ONLY, WRITE_REMOTE } from '../../utils/annotations.js'
import { handleAbout, handleAuthenticate, handleCheckAuthStatus } from './tools.js'

export const ensureAuthenticated = async (forceNew = false): Promise<string> => {
  if (forceNew) {
    throw new Error('Authentication required')
  }

  const accessToken = await getTokenStorage().getValidAccessToken()
  if (!accessToken) {
    throw new Error('Authentication required')
  }

  return accessToken
}

export const registerAuthTools = (server: McpServer, cfg: Config): void => {
  server.registerTool(
    'm365_about',
    {
      description: 'Returns information about this MCP M365 server',
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY
    },
    () => handleAbout(cfg)
  )

  server.registerTool(
    'm365_auth_start',
    {
      description:
        'Authenticate with Microsoft Graph API to access Outlook data. Initiates the OAuth flow and persists tokens to disk on success — registered under the `write` role because of that token-store mutation.',
      inputSchema: z
        .object({
          force: z.boolean().optional().describe('Force re-authentication even if already authenticated')
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    () => handleAuthenticate(cfg)
  )

  server.registerTool(
    'm365_auth_status',
    {
      description: 'Check the current authentication status with Microsoft Graph API. Returns presence + scope/expiry metadata only — never the token values.',
      inputSchema: z.object({}).strict(),
      annotations: READ_ONLY
    },
    handleCheckAuthStatus
  )
}

export { handleAbout, handleAuthenticate, handleCheckAuthStatus }
