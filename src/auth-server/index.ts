#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import querystring from 'node:querystring'
import url from 'node:url'
import * as templates from './templates.js'
import 'dotenv/config'

console.log('Starting m365 Authentication Server')

const pendingStates = new Map<string, number>()
const TEN_MINUTES = 10 * 60 * 1000

setInterval(
  () => {
    const now = Date.now()
    for (const [key, timestamp] of pendingStates.entries()) {
      if (now - timestamp > TEN_MINUTES) pendingStates.delete(key)
    }
  },
  5 * 60 * 1000
).unref()

const AUTH_CONFIG = {
  clientId: process.env.M365_CLIENT_ID || '',
  clientSecret: process.env.M365_CLIENT_SECRET || '',
  tenantId: process.env.M365_TENANT_ID || 'common',
  authorityHost: (process.env.M365_AUTHORITY_HOST || 'https://login.microsoftonline.com').replace(/\/+$/, ''),
  redirectUri: 'http://localhost:3333/auth/callback',
  scopes: ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Send', 'Calendars.Read', 'Calendars.ReadWrite', 'Contacts.Read'],
  tokenStorePath: path.join(process.env.HOME || process.env.USERPROFILE || '', '.mcp-m365-tokens.json')
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url ?? '/', true)
  const pathname = parsedUrl.pathname

  console.log(`Request received: ${pathname}`)

  if (pathname === '/auth/callback') {
    const query = parsedUrl.query as Record<string, string>

    if (!query.state || !pendingStates.has(query.state)) {
      console.error('Invalid or missing OAuth state parameter')
      res.writeHead(403, { 'Content-Type': 'text/html' })
      res.end(templates.invalidState())
      return
    }
    pendingStates.delete(query.state)

    if (query.error) {
      console.error(`Authentication error: ${query.error}`)
      res.writeHead(400, { 'Content-Type': 'text/html' })
      res.end(templates.authError(query.error, query.error_description))
      return
    }

    if (query.code) {
      console.log('Authorization code received, exchanging for tokens...')

      exchangeCodeForTokens(query.code)
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
    pendingStates.set(state, Date.now())

    const authParams = {
      client_id: AUTH_CONFIG.clientId,
      response_type: 'code',
      redirect_uri: AUTH_CONFIG.redirectUri,
      scope: AUTH_CONFIG.scopes.join(' '),
      response_mode: 'query',
      state
    }

    const authUrl = `${AUTH_CONFIG.authorityHost}/${AUTH_CONFIG.tenantId}/oauth2/v2.0/authorize?${querystring.stringify(authParams)}`
    console.log(`Redirecting to: ${authUrl}`)

    res.writeHead(302, { Location: authUrl })
    res.end()
  } else if (pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(templates.rootInfo())
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }
})

const exchangeCodeForTokens = (code: string): Promise<any> => {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      client_id: AUTH_CONFIG.clientId,
      client_secret: AUTH_CONFIG.clientSecret,
      code: code,
      redirect_uri: AUTH_CONFIG.redirectUri,
      grant_type: 'authorization_code',
      scope: AUTH_CONFIG.scopes.join(' ')
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

const PORT = 3333
server.listen(PORT, () => {
  console.log(`Authentication server running at http://localhost:${PORT}`)
  console.log(`Waiting for authentication callback at ${AUTH_CONFIG.redirectUri}`)
  console.log(`Token will be stored at: ${AUTH_CONFIG.tokenStorePath}`)

  if (!AUTH_CONFIG.clientId || !AUTH_CONFIG.clientSecret) {
    console.log('\n⚠️  WARNING: Microsoft Graph API credentials are not set.')
    console.log('   Please set the M365_CLIENT_ID and M365_CLIENT_SECRET environment variables.')
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
