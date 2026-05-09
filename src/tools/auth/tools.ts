/**
 * Authentication-related tools for the MCP M365 server
 */
import config from '../../config.js'
import * as tokenManager from './token-manager.js'

export const handleAbout = async (): Promise<any> => {
  return {
    content: [
      {
        type: 'text',
        text: `MCP M365 Server v${config.SERVER_VERSION}\n\nProvides access to Microsoft 365 services through Microsoft Graph API:\n- Outlook (email, calendar, folders, rules)\n- OneDrive (files, folders, sharing)\n\nModular architecture for improved maintainability.`
      }
    ]
  }
}

export const handleAuthenticate = async (_args: any): Promise<any> => {
  const authUrl = `${config.AUTH_CONFIG.authServerUrl}/auth?client_id=${config.AUTH_CONFIG.clientId}`

  return {
    content: [
      {
        type: 'text',
        text: `Authentication required. Please visit the following URL to authenticate with Microsoft: ${authUrl}\n\nAfter authentication, you will be redirected back to this application.`
      }
    ]
  }
}

export const handleCheckAuthStatus = async (): Promise<any> => {
  console.error('[CHECK-AUTH-STATUS] Starting authentication status check')

  const tokens = tokenManager.loadTokenCache()

  console.error(`[CHECK-AUTH-STATUS] Tokens loaded: ${tokens ? 'YES' : 'NO'}`)

  if (!tokens?.access_token) {
    console.error('[CHECK-AUTH-STATUS] No valid access token found')
    return {
      content: [{ type: 'text', text: 'Not authenticated' }]
    }
  }

  console.error('[CHECK-AUTH-STATUS] Access token present')
  console.error(`[CHECK-AUTH-STATUS] Token expires at: ${tokens.expires_at}`)
  console.error(`[CHECK-AUTH-STATUS] Current time: ${Date.now()}`)

  return {
    content: [{ type: 'text', text: 'Authenticated and ready' }]
  }
}

export const authTools = [
  {
    name: 'about',
    description: 'Returns information about this MCP M365 server',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    handler: handleAbout
  },
  {
    name: 'authenticate',
    description: 'Authenticate with Microsoft Graph API to access Outlook data',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description: 'Force re-authentication even if already authenticated'
        }
      },
      required: []
    },
    handler: handleAuthenticate
  },
  {
    name: 'check-auth-status',
    description: 'Check the current authentication status with Microsoft Graph API',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    handler: handleCheckAuthStatus
  }
]
