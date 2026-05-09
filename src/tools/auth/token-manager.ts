/**
 * Token management for Microsoft Graph API authentication
 */
import fs from 'node:fs'
import config from '../../config.js'
import type { StoredTokens } from './token-storage.js'

let cachedTokens: StoredTokens | null = null

export const loadTokenCache = (): StoredTokens | null => {
  try {
    const tokenPath = config.AUTH_CONFIG.tokenStorePath

    if (!fs.existsSync(tokenPath)) {
      return null
    }

    const tokenData = fs.readFileSync(tokenPath, 'utf8')

    try {
      const tokens = JSON.parse(tokenData)

      if (!tokens.access_token) {
        return null
      }

      const now = Date.now()
      const expiresAt = tokens.expires_at || 0

      if (now > expiresAt) {
        return null
      }

      cachedTokens = tokens
      return tokens
    } catch (parseError: any) {
      console.error('Error parsing token file:', parseError.message)
      return null
    }
  } catch (error: any) {
    console.error('Error loading token cache:', error.message)
    return null
  }
}

export const saveTokenCache = (tokens: StoredTokens): boolean => {
  try {
    const tokenPath = config.AUTH_CONFIG.tokenStorePath

    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 })

    cachedTokens = tokens
    return true
  } catch (error: any) {
    console.error('Error saving token cache:', error.message)
    return false
  }
}

export const getAccessToken = (): string | null => {
  if (cachedTokens?.access_token) {
    return cachedTokens.access_token
  }

  const tokens = loadTokenCache()
  return tokens ? tokens.access_token || null : null
}
