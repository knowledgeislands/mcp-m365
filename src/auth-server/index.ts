#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import querystring from 'node:querystring'
import url from 'node:url'
import { loadConfig } from '../config/index.js'
import * as templates from './templates.js'

const config = loadConfig()

console.log('Starting m365 Authentication Server')

// Each entry pairs the single-use `state` with its PKCE `codeVerifier` and a
// creation timestamp for expiry. The verifier is generated per authorize
// request and consumed exactly once at the callback (alongside the state).
interface PendingAuth {
  ts: number
  codeVerifier: string
}
const pendingStates = new Map<string, PendingAuth>()
const TEN_MINUTES = 10 * 60 * 1000

setInterval(
  () => {
    const now = Date.now()
    for (const [key, entry] of pendingStates.entries()) {
      if (now - entry.ts > TEN_MINUTES) pendingStates.delete(key)
    }
  },
  5 * 60 * 1000
).unref()

/** RFC 7636 S256 PKCE: base64url(SHA-256(verifier)). */
const base64UrlEncode = (buf: Buffer): string => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const pkceChallengeS256 = (verifier: string): string => base64UrlEncode(crypto.createHash('sha256').update(verifier).digest())

// The OAuth slice of the loaded Config. The canonical scope list lives in
// src/config/index.ts as M365_DEFAULT_SCOPES so the consent flow (here) and
// the refresh flow (src/main/auth/index.ts) cannot drift.
const AUTH_CONFIG = config.auth

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url ?? '/', true)
  const pathname = parsedUrl.pathname

  console.log(`Request received: ${pathname}`)

  if (pathname === '/auth/callback') {
    const query = parsedUrl.query as Record<string, string>

    const pending = query.state ? pendingStates.get(query.state) : undefined
    if (!query.state || !pending) {
      console.error('Invalid or missing OAuth state parameter')
      res.writeHead(403, { 'Content-Type': 'text/html' })
      res.end(templates.invalidState())
      return
    }
    // Single-use: consume the state + its PKCE verifier now.
    pendingStates.delete(query.state)

    if (query.error) {
      console.error(`Authentication error: ${query.error}`)
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(templates.authError(query.error, query.error_description))
      return
    }

    if (query.code) {
      console.log('Authorization code received, exchanging for tokens...')

      exchangeCodeForTokens(query.code, pending.codeVerifier)
        .then(() => {
          console.log('Token exchange successful')
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(templates.authSuccess())
        })
        .catch((error: Error) => {
          console.error(`Token exchange error: ${error.message}`)
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end(templates.tokenExchangeError(error.message))
        })
    } else {
      console.error('No authorization code provided')
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(templates.missingCode())
    }
  } else if (pathname === '/auth') {
    console.log('Auth request received, redirecting to Microsoft login...')

    if (!AUTH_CONFIG.clientId || !AUTH_CONFIG.clientSecret) {
      res.writeHead(500, { 'Content-Type': 'text/html' })
      res.end(templates.configError())
      return
    }

    const state = crypto.randomBytes(32).toString('hex')
    // PKCE (RFC 7636): a fresh high-entropy verifier per flow, stored server-side
    // alongside the state and sent only as its S256 challenge on the authorize
    // URL. m365 is a confidential client (has a client_secret), so PKCE is
    // defense-in-depth on top of the existing secret + single-use state.
    const codeVerifier = base64UrlEncode(crypto.randomBytes(32))
    pendingStates.set(state, { ts: Date.now(), codeVerifier })

    const authParams = {
      client_id: AUTH_CONFIG.clientId,
      response_type: 'code',
      redirect_uri: AUTH_CONFIG.redirectUri,
      scope: AUTH_CONFIG.scopes.join(' '),
      response_mode: 'query',
      state,
      code_challenge: pkceChallengeS256(codeVerifier),
      code_challenge_method: 'S256'
    }

    const authUrl = `${AUTH_CONFIG.authorityHost}/${AUTH_CONFIG.tenantId}/oauth2/v2.0/authorize?${querystring.stringify(authParams)}`
    console.log(`Redirecting to: ${authUrl}`)

    res.writeHead(302, { Location: authUrl })
    res.end()
  } else if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(templates.rootInfo(AUTH_CONFIG.authServerUrl))
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
})

const exchangeCodeForTokens = (code: string, codeVerifier: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      client_id: AUTH_CONFIG.clientId,
      client_secret: AUTH_CONFIG.clientSecret,
      code: code,
      redirect_uri: AUTH_CONFIG.redirectUri,
      grant_type: 'authorization_code',
      scope: AUTH_CONFIG.scopes.join(' '),
      code_verifier: codeVerifier
    })

    const options: https.RequestOptions = {
      hostname: AUTH_CONFIG.authorityHost.replace(/^https?:\/\//, '').split('/')[0],
      path: `/${AUTH_CONFIG.tenantId}/oauth2/v2.0/token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) {
          try {
            const tokenResponse = JSON.parse(data)
            const expiresAt = Date.now() + tokenResponse.expires_in * 1000
            tokenResponse.expires_at = expiresAt

            fs.writeFileSync(AUTH_CONFIG.tokenStorePath, JSON.stringify(tokenResponse, null, 2), { encoding: 'utf8', mode: 0o600 })
            console.log(`Tokens saved to ${AUTH_CONFIG.tokenStorePath}`)

            resolve(tokenResponse)
          } catch (error: any) {
            reject(new Error(`Error parsing token response: ${error.message}`))
          }
        } else {
          reject(new Error(`Token exchange failed with status ${status}: ${data}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(error)
    })

    req.write(postData)
    req.end()
  })
}

const PORT = AUTH_CONFIG.authServerPort
server.listen(PORT, () => {
  console.log(`Authentication server running at http://localhost:${PORT}`)
  console.log(`Waiting for authentication callback at ${AUTH_CONFIG.redirectUri}`)
  console.log(`Token will be stored at: ${AUTH_CONFIG.tokenStorePath}`)

  if (!AUTH_CONFIG.clientId || !AUTH_CONFIG.clientSecret) {
    console.log('\n⚠️  WARNING: Microsoft Graph API credentials are not set.')
    console.log('   Please set the MCP_M365_CLIENT_ID and MCP_M365_CLIENT_SECRET environment variables.')
  }
})

process.on('SIGINT', () => {
  console.log('Authentication server shutting down')
  process.exit(0)
})

process.on('SIGTERM', () => {
  console.log('Authentication server shutting down')
  process.exit(0)
})
