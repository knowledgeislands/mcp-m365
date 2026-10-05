import https from 'node:https'
import {
  ConfidentialClientApplication,
  type INetworkModule,
  type NetworkRequestOptions,
  type NetworkResponse
} from '@azure/msal-node'
import type { StoredTokens, TokenStorageConfig } from './index.js'

/** No discovery, redirects, retries or provider error text can escape this transport. */
export const tokenNetwork: INetworkModule = {
  async sendGetRequestAsync<T>(): Promise<NetworkResponse<T>> {
    throw new Error('OAuth discovery is disabled')
  },
  async sendPostRequestAsync<T>(endpoint: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        endpoint,
        { method: 'POST', headers: options?.headers, signal: AbortSignal.timeout(15_000) },
        (res) => {
          let data = ''
          res.on('data', (chunk: Buffer) => {
            data += chunk
            if (Buffer.byteLength(data) > 1024 * 1024) req.destroy(new Error('OAuth response too large'))
          })
          res.on('error', () => reject(new Error('OAuth response failed')))
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode ?? 0, headers: {}, body: JSON.parse(data) })
            } catch {
              reject(new Error('OAuth response is not valid JSON'))
            }
          })
        }
      )
      req.on('error', () => reject(new Error('OAuth request failed')))
      req.end(options?.body)
    })
  }
}

export function assertTokenDestination(target: string, endpoint: URL): void {
  const candidate = new URL(target)
  const expected = new URL(endpoint)
  candidate.searchParams.delete('client-request-id')
  expected.searchParams.delete('client-request-id')
  if (candidate.href !== expected.href) throw new Error('Unexpected OAuth destination')
}

/** A fresh public client per operation: the legacy file, never MSAL's cache, is authoritative. */
export async function acquireLegacyTokens(
  config: Required<TokenStorageConfig>,
  request: { refreshToken: string } | { code: string; codeVerifier?: string },
  network: INetworkModule = tokenNetwork
): Promise<StoredTokens> {
  const endpoint = new URL(config.tokenEndpoint)
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) {
    throw new Error('Invalid OAuth token endpoint')
  }
  const authority = `${endpoint.origin}/${encodeURIComponent(config.tenantId)}`
  let raw: StoredTokens | undefined
  const transport: INetworkModule = {
    sendGetRequestAsync: tokenNetwork.sendGetRequestAsync,
    async sendPostRequestAsync<T>(target: string, options?: NetworkRequestOptions): Promise<NetworkResponse<T>> {
      assertTokenDestination(target, endpoint)
      // MSAL adds OIDC defaults. Preserve the exact configured permission request
      // (including explicit OIDC scopes) rather than broadening a custom list.
      const form = new URLSearchParams(options?.body)
      form.set('scope', config.scopes.join(' '))
      const response = await network.sendPostRequestAsync<StoredTokens>(endpoint.href, {
        ...options,
        body: form.toString()
      })
      if (response.status >= 200 && response.status < 300) raw = { ...response.body }
      return response as NetworkResponse<T>
    }
  }
  const client = new ConfidentialClientApplication({
    auth: {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      authority,
      knownAuthorities: [endpoint.hostname],
      authorityMetadata: JSON.stringify({
        authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
        token_endpoint: endpoint.href,
        issuer: `${authority}/v2.0`,
        jwks_uri: `${authority}/discovery/v2.0/keys`,
        end_session_endpoint: `${authority}/oauth2/v2.0/logout`
      })
    },
    system: {
      networkClient: transport,
      disableInternalRetries: true,
      loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} }
    }
  })
  try {
    const result =
      'refreshToken' in request
        ? await client.acquireTokenByRefreshToken({ refreshToken: request.refreshToken, scopes: config.scopes })
        : await client.acquireTokenByCode({
            code: request.code,
            codeVerifier: request.codeVerifier,
            redirectUri: config.redirectUri,
            scopes: config.scopes
          })
    const expiry: unknown = raw?.expires_in
    const scalarExpiry =
      typeof expiry === 'number' ||
      (typeof expiry === 'string' && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(expiry.trim()))
    const lifetime = scalarExpiry ? Number(expiry) : Number.NaN
    const expiresAt = Date.now() + lifetime * 1000
    if (
      !result?.accessToken ||
      !raw ||
      typeof raw.access_token !== 'string' ||
      !Number.isFinite(lifetime) ||
      lifetime <= 0 ||
      !Number.isSafeInteger(expiresAt) ||
      (raw.refresh_token !== undefined &&
        (typeof raw.refresh_token !== 'string' || raw.refresh_token.trim().length === 0))
    ) {
      throw new Error('Invalid OAuth token response')
    }
    return { ...raw, expires_at: expiresAt }
  } catch {
    // MSAL/transport exceptions can contain reflected secrets, request codes,
    // URLs or response bodies. None is safe for the callback HTML or stderr.
    throw new Error('OAuth token acquisition failed')
  }
}
