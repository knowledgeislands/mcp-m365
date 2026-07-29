/**
 * Auth tool group — thin registration shells. The implementation
 * (`handleAbout` / `handleAuthenticate` / `handleCheckAuthStatus`, and the
 * `ensureAuthenticated` gate) lives in `main/auth`; this file only validates
 * args and wires the handlers behind the access-gated `registerTool` proxy.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Config } from '../../config/index.js'
import type TokenStorage from '../../main/auth/index.js'
import { handleAbout, handleAuthenticate, handleCheckAuthStatus } from '../../main/auth/index.js'
import { READ_ONLY, WRITE_REMOTE } from '../../utils/annotations.js'

export const registerAuthTools = (server: McpServer, cfg: Config, storage: TokenStorage): void => {
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
    () => handleCheckAuthStatus(storage)
  )
}
