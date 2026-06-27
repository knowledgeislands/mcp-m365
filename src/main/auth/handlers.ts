/**
 * Authentication-related tools for the MCP M365 server.
 *
 * `handleCheckAuthStatus` returns metadata (presence, scope, expiry) only —
 * never the access_token or refresh_token values. This is a defense-in-depth
 * measure: nothing in the MCP tool response surface should ever expose token
 * material to the LLM.
 */

import type { Config } from '../../config/index.js'
import type TokenStorage from './index.js'

export const handleAbout = async (cfg: Config): Promise<any> => {
  return {
    content: [
      {
        type: 'text',
        text: `MCP M365 Server v${cfg.serverVersion}\n\nProvides access to Microsoft 365 services through Microsoft Graph API:\n- Outlook (email, calendar, folders, rules)\n- OneDrive (files, folders, sharing)\n\nModular architecture for improved maintainability.`
      }
    ]
  }
}

export const handleAuthenticate = async (cfg: Config): Promise<any> => {
  const authUrl = `${cfg.auth.authServerUrl}/auth?client_id=${cfg.auth.clientId}`

  return {
    content: [
      {
        type: 'text',
        text: `Authentication required. Please visit the following URL to authenticate with Microsoft: ${authUrl}\n\nAfter authentication, you will be redirected back to this application.`
      }
    ]
  }
}

export const handleCheckAuthStatus = async (tokenStorage: TokenStorage): Promise<any> => {
  const tokens = await tokenStorage.getTokens()

  if (!tokens?.access_token) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ authenticated: false, hasRefreshToken: false, scope: [], expiresAt: null, expired: false }, null, 2)
        }
      ]
    }
  }

  const summary = {
    authenticated: true,
    hasRefreshToken: Boolean(tokens.refresh_token),
    scope: typeof tokens.scope === 'string' ? tokens.scope.split(/\s+/).filter(Boolean) : [],
    expiresAt: tokens.expires_at ?? null,
    expired: tokenStorage.isTokenExpired()
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
  }
}
