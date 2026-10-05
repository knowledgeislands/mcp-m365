/**
 * Token shapes shared by the auth modules. They live apart from `index.ts` so
 * that `msal.ts` and `handlers.ts` can name them without importing the module
 * that imports them back; `index.ts` re-exports them unchanged.
 */

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

/** The read-only view of token storage that the auth-status handler needs. */
export interface TokenStatusReader {
  getTokens(): Promise<StoredTokens | null>
  isTokenExpired(): boolean
}
