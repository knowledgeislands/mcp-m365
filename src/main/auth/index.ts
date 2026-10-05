import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Config } from '../../config/index.js'
import { M365_DEFAULT_SCOPES, resolveXdgStateHome } from '../../config/index.js'
import { acquireLegacyTokens } from './msal.js'
import { withTokenLock } from './token-lock.js'

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
    // Defaults below are only fallbacks for fields the caller omits. The MCP
    // server and auth-server pass a fully-populated slice derived from
    // `loadConfig()` (see `createTokenStorage(cfg)`), so in production nothing
    // here is guessed. Tests construct with an explicit `config` literal.
    const tenantId = 'common'
    const authorityHost = 'https://login.microsoftonline.com'

    this.config = {
      /* v8 ignore next — os.homedir() always returns a path on supported platforms; '' is a defensive fallback */
      tokenStorePath: path.join(resolveXdgStateHome({}, os.homedir() || '/tmp'), 'ki', 'mcp-m365', 'oauth-tokens.json'),
      clientId: '',
      clientSecret: '',
      redirectUri: '',
      // The canonical scope list lives in src/config/index.ts as
      // M365_DEFAULT_SCOPES so the consent flow (auth-server) and the refresh
      // flow (here) cannot drift. Microsoft's refresh endpoint treats `scope`
      // as a subset request — a narrower list here would silently downgrade
      // access tokens on first refresh.
      scopes: M365_DEFAULT_SCOPES,
      tenantId,
      tokenEndpoint: `${authorityHost}/${tenantId}/oauth2/v2.0/token`,
      refreshTokenBuffer: 5 * 60 * 1000,
      ...config
    } as Required<TokenStorageConfig>
    this.tokens = null
    this._loadPromise = null
    this._refreshPromise = null
    // An unconfigured OAuth client (missing id/secret) is surfaced as a thrown
    // error from `exchangeCodeForTokens`/`refreshAccessToken` when those flows
    // run — not as a startup log line. `main/` returns/throws data; printing is
    // the CLI's / mcp-server's job.
  }

  async _loadTokensFromFile(): Promise<StoredTokens | null> {
    try {
      const tokenData = await fs.readFile(this.config.tokenStorePath, 'utf8')
      this.tokens = JSON.parse(tokenData)
      return this.tokens
    } catch {
      // No usable token on disk (missing file or unreadable/corrupt cache).
      // main/ returns data, not log lines: callers observe the null return and
      // the tool boundary maps it to the m365_auth_start remediation hint.
      this.tokens = null
      return null
    }
  }

  async _saveTokensToFile(candidate: StoredTokens | null = this.tokens): Promise<boolean> {
    if (!candidate) return false
    const finalPath = this.config.tokenStorePath
    const tmpPath = `${finalPath}.tmp.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
    try {
      await fs.writeFile(tmpPath, JSON.stringify(candidate, null, 2), { mode: 0o600, flag: 'wx' })
      await fs.rename(tmpPath, finalPath)
      return true
    } catch {
      throw new Error('OAuth tokens could not be saved')
    } finally {
      await fs.unlink(tmpPath).catch(() => {})
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
    if (!this.tokens?.access_token) return null
    if (!this.isTokenExpired()) return this.tokens.access_token
    if (!this.tokens.refresh_token) {
      this.tokens = null
      return null
    }
    try {
      return await this.refreshAccessToken()
    } catch {
      this.tokens = null
      return null
    }
  }

  async refreshAccessToken(): Promise<string> {
    if (this._refreshPromise) return this._refreshPromise.then((tokens) => tokens.access_token as string)
    if (!this.tokens?.refresh_token) throw new Error('No refresh token available to refresh the access token.')
    const observed = this.tokens
    this._refreshPromise = withTokenLock(this.config.tokenStorePath, async () => {
      await this._loadTokensFromFile()
      if (!this.tokens?.refresh_token) throw new Error('No refresh token available to refresh the access token.')
      // A different process already refreshed or signed in while we waited.
      if (
        !this.isTokenExpired() &&
        this.tokens.access_token &&
        (this.tokens.access_token !== observed.access_token || this.tokens.expires_at !== observed.expires_at)
      ) {
        return this.tokens
      }
      const prior = this.tokens
      const response = await acquireLegacyTokens(this.config, { refreshToken: prior.refresh_token as string })
      const candidate = {
        ...prior,
        access_token: response.access_token,
        refresh_token: response.refresh_token || prior.refresh_token,
        expires_in: response.expires_in,
        expires_at: response.expires_at
      }
      await this._saveTokensToFile(candidate)
      this.tokens = candidate
      return candidate
    }).finally(() => {
      this._refreshPromise = null
    })
    return this._refreshPromise.then((tokens) => tokens.access_token as string)
  }

  async exchangeCodeForTokens(
    authCode: string,
    codeVerifier?: string,
    preserveResponse = false
  ): Promise<StoredTokens> {
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new Error('Client ID or Client Secret is not configured. Cannot exchange code for tokens.')
    }
    return withTokenLock(this.config.tokenStorePath, async () => {
      await this._loadTokensFromFile()
      const response = await acquireLegacyTokens(this.config, { code: authCode, codeVerifier })
      const candidate: StoredTokens = preserveResponse
        ? response
        : {
            access_token: response.access_token,
            refresh_token: response.refresh_token,
            expires_in: response.expires_in,
            expires_at: response.expires_at,
            scope: response.scope,
            token_type: response.token_type
          }
      if (!candidate.refresh_token && this.tokens?.refresh_token) candidate.refresh_token = this.tokens.refresh_token
      await this._saveTokensToFile(candidate)
      this.tokens = candidate
      return candidate
    })
  }

  async clearTokens(): Promise<void> {
    await withTokenLock(this.config.tokenStorePath, async () => {
      this.tokens = null
      await fs.unlink(this.config.tokenStorePath).catch(() => {})
    })
  }
}

export default TokenStorage

/**
 * Build a `TokenStorage` from a loaded `Config`. The auth slice carries the
 * OAuth client credentials, the redirect URI, the token endpoint, the scope
 * list, and the on-disk token path — everything the refresh/exchange flows
 * need. Nothing is read from `process.env` here.
 */
export const createTokenStorage = (cfg: Config): TokenStorage =>
  new TokenStorage({
    tokenStorePath: cfg.auth.tokenStorePath,
    clientId: cfg.auth.clientId,
    clientSecret: cfg.auth.clientSecret,
    redirectUri: cfg.auth.redirectUri,
    scopes: cfg.auth.scopes,
    tenantId: cfg.auth.tenantId,
    tokenEndpoint: cfg.auth.tokenEndpoint
  })

/**
 * The auth gate every Graph-calling `main/` function awaits first, bound to an
 * **injected** `TokenStorage` (no module-level singleton — standard §1/§2). A
 * server entry point creates the storage from the loaded `Config`
 * (`createTokenStorage(cfg)`), wraps it here once at boot, and threads the
 * resulting gate into the `GraphContext` each handler receives. The returned
 * function yields a valid access token (refreshing if needed), or throws
 * `Error('Authentication required')` when no usable token is available — which
 * the thin tool boundary maps to the `m365_auth_start` remediation hint.
 */
export const makeEnsureAuthenticated =
  (storage: TokenStorage) =>
  async (forceNew = false): Promise<string> => {
    if (forceNew) {
      throw new Error('Authentication required')
    }

    const accessToken = await storage.getValidAccessToken()
    if (!accessToken) {
      throw new Error('Authentication required')
    }

    return accessToken
  }

export { handleAbout, handleAuthenticate, handleCheckAuthStatus } from './handlers.js'
