import type { Config } from '../../config/index.js'
import TokenStorage, { type StoredTokens } from './index.js'

/** Preserve the callback server's derived endpoint and full token-response shape. */
export function exchangeCallbackTokens(
  auth: Config['auth'],
  code: string,
  codeVerifier: string
): Promise<StoredTokens> {
  const host = auth.authorityHost.replace(/^https?:\/\//, '').split('/')[0]
  const storage = new TokenStorage({
    tokenStorePath: auth.tokenStorePath,
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
    redirectUri: auth.redirectUri,
    scopes: auth.scopes,
    tenantId: auth.tenantId,
    tokenEndpoint: `https://${host}/${auth.tenantId}/oauth2/v2.0/token`
  })
  return storage.exchangeCodeForTokens(code, codeVerifier, true)
}
