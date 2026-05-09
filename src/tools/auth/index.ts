/**
 * Authentication module for MCP M365 server
 */
import * as tokenManager from './token-manager.js'
import TokenStorage from './token-storage.js'
import { authTools } from './tools.js'

const tokenStorage = new TokenStorage()

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

export { authTools, tokenManager }
