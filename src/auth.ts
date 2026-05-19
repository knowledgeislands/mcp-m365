import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import querystring from 'node:querystring'
import { AUTH_CONFIG, M365_DEFAULT_SCOPES } from './config.js'

export interface TokenStorageConfig {
  tokenStorePath?: string
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  scopes?: string[]
  tenantId?: string
  tokenEndpoint?: string
  refreshTokenBuffer?: number
}

export interface StoredTokens {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  expires_at?: number
  scope?: string
  token_type?: string
  [key: string]: any
}

class TokenStorage {
  config: Required<TokenStorageConfig>
  tokens: StoredTokens | null
  _loadPromise: Promise<StoredTokens | null> | null
  _refreshPromise: Promise<StoredTokens> | null

  constructor(config: TokenStorageConfig = {}) {
    const tenantId = process.env.MCP_M365_TENANT_ID || 'common'
    const authorityHost = (process.env.MCP_M365_AUTHORITY_HOST || 'https://login.microsoftonline.com').replace(/\/+$/, '')

    const clientId = process.env.MCP_M365_CLIENT_ID
    const clientSecret = process.env.MCP_M365_CLIENT_SECRET

    this.config = {
      tokenStorePath: path.join(process.env.HOME || process.env.USERPROFILE || '', '.mcp-m365-tokens.json'),
      clientId: clientId || '',
      clientSecret: clientSecret || '',
      redirectUri: AUTH_CONFIG.redirectUri,
      // Use the canonical scope list from src/config.ts so the consent flow
      // (auth-server) and the refresh flow (here) cannot drift. Microsoft's
      // refresh endpoint treats `scope` as a subset request — a narrower list
      // here would silently downgrade access tokens on first refresh.
      scopes: process.env.MCP_M365_SCOPES ? process.env.MCP_M365_SCOPES.split(/\s+/).filter(Boolean) : M365_DEFAULT_SCOPES,
      tenantId,
      tokenEndpoint: process.env.MCP_M365_TOKEN_ENDPOINT || `${authorityHost}/${tenantId}/oauth2/v2.0/token`,
      refreshTokenBuffer: 5 * 60 * 1000,
      ...config
    } as Required<TokenStorageConfig>
    this.tokens = null
    this._loadPromise = null
    this._refreshPromise = null

    if (!this.config.clientId || !this.config.clientSecret) {
      console.warn('TokenStorage: MCP_M365_CLIENT_ID or MCP_M365_CLIENT_SECRET is not configured. Token refresh will fail.')
    }
  }

  async _loadTokensFromFile(): Promise<StoredTokens | null> {
    try {
      const tokenData = await fs.readFile(this.config.tokenStorePath, 'utf8')
      this.tokens = JSON.parse(tokenData)
      console.log('Tokens loaded from file.')
      return this.tokens
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('Token file not found. No tokens loaded.')
      } else {
        console.error('Error loading token cache:', error)
      }
      this.tokens = null
      return null
    }
  }

  async _saveTokensToFile(): Promise<boolean> {
    if (!this.tokens) {
      console.warn('No tokens to save.')
      return false
    }
    try {
      // Atomic write: temp file + rename. POSIX guarantees `rename` is atomic
      // on the same filesystem, so a crash mid-write cannot leave the token
      // file truncated.
      const finalPath = this.config.tokenStorePath
      const tmpPath = `${finalPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
      await fs.writeFile(tmpPath, JSON.stringify(this.tokens, null, 2), { mode: 0o600 })
      await fs.rename(tmpPath, finalPath)
      console.log('Tokens saved successfully.')
      return true
    } catch (error) {
      console.error('Error saving token cache:', error)
      throw error
    }
  }

  async getTokens(): Promise<StoredTokens | null> {
    if (this.tokens) {
      return this.tokens
    }
    if (!this._loadPromise) {
      this._loadPromise = this._loadTokensFromFile().finally(() => {
        this._loadPromise = null
      })
    }
    return this._loadPromise
  }

  getExpiryTime(): number {
    return this.tokens?.expires_at ? this.tokens.expires_at : 0
  }

  isTokenExpired(): boolean {
    if (!this.tokens?.expires_at) {
      return true
    }
    return Date.now() >= this.tokens.expires_at - this.config.refreshTokenBuffer
  }

  async getValidAccessToken(): Promise<string | null> {
    await this.getTokens()

    if (!this.tokens?.access_token) {
      console.log('No access token available.')
      return null
    }

    if (this.isTokenExpired()) {
      console.log('Access token expired or nearing expiration. Attempting refresh.')
      if (this.tokens.refresh_token) {
        try {
          return await this.refreshAccessToken()
        } catch (refreshError) {
          console.error('Failed to refresh access token:', refreshError)
          this.tokens = null
          await this._saveTokensToFile()
          return null
        }
      } else {
        console.warn('No refresh token available. Cannot refresh access token.')
        this.tokens = null
        await this._saveTokensToFile()
        return null
      }
    }
    return this.tokens.access_token
  }

  async refreshAccessToken(): Promise<string> {
    if (!this.tokens?.refresh_token) {
      throw new Error('No refresh token available to refresh the access token.')
    }

    const tokens = this.tokens
    const accessTokenOrThrow = (t: StoredTokens): string => {
      if (!t.access_token) throw new Error('Refresh succeeded but no access token returned.')
      return t.access_token
    }

    if (this._refreshPromise) {
      console.log('Refresh already in progress, returning existing promise.')
      return this._refreshPromise.then(accessTokenOrThrow)
    }

    console.log('Attempting to refresh access token...')
    const postData = querystring.stringify({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      scope: this.config.scopes.join(' ')
    })

    const requestOptions: https.RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    this._refreshPromise = new Promise<StoredTokens>((resolve, reject) => {
      const req = https.request(this.config.tokenEndpoint, requestOptions, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', async () => {
          try {
            const responseBody = JSON.parse(data)
            const status = res.statusCode ?? 0
            if (status >= 200 && status < 300) {
              tokens.access_token = responseBody.access_token
              if (responseBody.refresh_token) {
                tokens.refresh_token = responseBody.refresh_token
              }
              tokens.expires_in = responseBody.expires_in
              tokens.expires_at = Date.now() + responseBody.expires_in * 1000
              try {
                await this._saveTokensToFile()
                console.log('Access token refreshed and saved successfully.')
                resolve(tokens)
              } catch (saveError: any) {
                console.error('Failed to save refreshed tokens:', saveError)
                reject(new Error(`Access token refreshed but failed to save: ${saveError.message}`))
              }
            } else {
              console.error('Error refreshing token:', responseBody)
              reject(new Error(responseBody.error_description || `Token refresh failed with status ${status}`))
            }
          } catch (e) {
            console.error('Error processing refresh token response or saving tokens:', e)
            reject(e)
          } finally {
            this._refreshPromise = null
          }
        })
      })
      req.on('error', (error) => {
        console.error('HTTP error during token refresh:', error)
        reject(error)
        this._refreshPromise = null
      })
      req.write(postData)
      req.end()
    })

    return this._refreshPromise.then(accessTokenOrThrow)
  }

  async exchangeCodeForTokens(authCode: string): Promise<StoredTokens> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Client ID or Client Secret is not configured. Cannot exchange code for tokens.')
    }
    console.log('Exchanging authorization code for tokens...')
    const postData = querystring.stringify({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'authorization_code',
      code: authCode,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' ')
    })

    const requestOptions: https.RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    return new Promise<StoredTokens>((resolve, reject) => {
      const req = https.request(this.config.tokenEndpoint, requestOptions, (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', async () => {
          try {
            const responseBody = JSON.parse(data)
            const status = res.statusCode ?? 0
            if (status >= 200 && status < 300) {
              this.tokens = {
                access_token: responseBody.access_token,
                refresh_token: responseBody.refresh_token,
                expires_in: responseBody.expires_in,
                expires_at: Date.now() + responseBody.expires_in * 1000,
                scope: responseBody.scope,
                token_type: responseBody.token_type
              }
              try {
                await this._saveTokensToFile()
                console.log('Tokens exchanged and saved successfully.')
                resolve(this.tokens)
              } catch (saveError: any) {
                console.error('Failed to save exchanged tokens:', saveError)
                reject(new Error(`Tokens exchanged but failed to save: ${saveError.message}`))
              }
            } else {
              console.error('Error exchanging code for tokens:', responseBody)
              reject(new Error(responseBody.error_description || `Token exchange failed with status ${status}`))
            }
          } catch (e: any) {
            console.error('Error processing token exchange response or saving tokens:', e, 'Raw data:', data)
            reject(new Error(`Error processing token response: ${e.message}. Response data: ${data}`))
          }
        })
      })
      req.on('error', (error) => {
        console.error('HTTP error during code exchange:', error)
        reject(error)
      })
      req.write(postData)
      req.end()
    })
  }

  async clearTokens(): Promise<void> {
    this.tokens = null
    try {
      await fs.unlink(this.config.tokenStorePath)
      console.log('Token file deleted successfully.')
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log('Token file not found, nothing to delete.')
      } else {
        console.error('Error deleting token file:', error)
      }
    }
  }
}

export default TokenStorage

/**
 * Shared `TokenStorage` instance.
 *
 * Both `registerAuthTools` (for `ensureAuthenticated`) and `handleCheckAuthStatus`
 * need to read the persisted token. Sharing one instance avoids duplicate
 * caches and keeps refresh deduplication working across callers.
 */
export const tokenStorage = new TokenStorage()
