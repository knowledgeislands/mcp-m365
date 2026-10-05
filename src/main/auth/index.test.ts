import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../../config/index.js'
import { exchangeCallbackTokens } from './callback.js'
import TokenStorage, { createTokenStorage, makeEnsureAuthenticated, type StoredTokens } from './index.js'
import { tokenNetwork } from './msal.js'

const response = {
  access_token: 'fixture-new',
  refresh_token: 'fixture-rotated',
  expires_in: 3600,
  scope: 'Mail.Read',
  token_type: 'Bearer',
  extra: 'retained-callback-field'
}
const expired = {
  access_token: 'fixture-old',
  refresh_token: 'fixture-legacy',
  expires_at: 1,
  scope: 'legacy-scope',
  extra: 'legacy-extension'
}
let dir: string
let storage: TokenStorage
let network: ReturnType<typeof vi.spyOn>
const read = async (): Promise<StoredTokens> => JSON.parse(await fs.readFile(storage.config.tokenStorePath, 'utf8'))
const seed = async (tokens: StoredTokens = expired) => {
  await fs.writeFile(storage.config.tokenStorePath, JSON.stringify(tokens), { mode: 0o600 })
  storage.tokens = null
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm365-auth-test-'))
  storage = new TokenStorage({
    tokenStorePath: path.join(dir, 'tokens.json'),
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
    redirectUri: 'http://localhost/callback',
    scopes: ['Mail.Read'],
    tokenEndpoint: 'https://custom.example/exact/token'
  })
  network = vi
    .spyOn(tokenNetwork, 'sendPostRequestAsync')
    .mockResolvedValue({ status: 200, headers: {}, body: response })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(dir, { recursive: true, force: true })
})

it('keeps config-injected defaults/factories and does not read environment at import', () => {
  const cfg = loadConfig({ HOME: '/fixture/home', MCP_M365_CLIENT_ID: 'id', MCP_M365_CLIENT_SECRET: 'secret' })
  expect(createTokenStorage(cfg).config).toMatchObject({
    clientId: 'id',
    clientSecret: 'secret',
    scopes: cfg.auth.scopes,
    tokenEndpoint: cfg.auth.tokenEndpoint,
    tokenStorePath: cfg.auth.tokenStorePath
  })
  const defaults = new TokenStorage()
  expect(defaults.config.tenantId).toBe('common')
  expect(defaults.config.refreshTokenBuffer).toBe(300000)
  expect(defaults.config.clientId).toBe('')
})
it('loads populated legacy JSON without reauth or rewriting a valid file', async () => {
  const valid = { ...expired, expires_at: Date.now() + 3600000 }
  await seed(valid)
  const bytes = await fs.readFile(storage.config.tokenStorePath)
  await expect(makeEnsureAuthenticated(storage)()).resolves.toBe(expired.access_token)
  expect(await fs.readFile(storage.config.tokenStorePath)).toEqual(bytes)
  expect(network).not.toHaveBeenCalled()
  expect(storage.getExpiryTime()).toBe(valid.expires_at)
  expect(await storage.getTokens()).toBe(storage.tokens)
})
it('deduplicates concurrent legacy loads', async () => {
  await seed()
  const load = vi.spyOn(storage, '_loadTokensFromFile')
  const results = await Promise.all([storage.getTokens(), storage.getTokens()])
  expect(results[0]).toBe(results[1])
  expect(load).toHaveBeenCalledTimes(1)
  expect(storage._loadPromise).toBeNull()
})
it('handles missing, malformed and unreadable stores as unauthenticated without logging', async () => {
  const log = vi.spyOn(console, 'error')
  expect(await storage.getTokens()).toBeNull()
  expect(storage.getExpiryTime()).toBe(0)
  expect(storage.isTokenExpired()).toBe(true)
  await fs.writeFile(storage.config.tokenStorePath, '{broken')
  expect(await storage._loadTokensFromFile()).toBeNull()
  vi.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('unreadable'))
  expect(await storage._loadTokensFromFile()).toBeNull()
  await expect(makeEnsureAuthenticated(storage)()).rejects.toThrow('Authentication required')
  expect(log).not.toHaveBeenCalled()
})
it('checks missing expiry, expiry buffering, and forced authentication without touching storage', async () => {
  storage.tokens = { access_token: 'fixture' }
  expect(storage.isTokenExpired()).toBe(true)
  storage.tokens.expires_at = Date.now() + 299999
  expect(storage.isTokenExpired()).toBe(true)
  const get = vi.spyOn(storage, 'getValidAccessToken')
  await expect(makeEnsureAuthenticated(storage)(true)).rejects.toThrow('Authentication required')
  expect(get).not.toHaveBeenCalled()
})
it.each([true, false])('refresh retains legacy fields and handles rotation=%s atomically at 0600', async (rotate) => {
  await seed()
  await storage.getTokens()
  network.mockResolvedValue({
    status: 200,
    headers: {},
    body: { ...response, refresh_token: rotate ? response.refresh_token : undefined }
  })
  expect(await storage.getValidAccessToken()).toBe(response.access_token)
  expect(await read()).toMatchObject({
    ...expired,
    access_token: response.access_token,
    refresh_token: rotate ? response.refresh_token : expired.refresh_token,
    expires_at: expect.any(Number),
    expires_in: 3600
  })
  expect((await fs.stat(storage.config.tokenStorePath)).mode & 0o777).toBe(0o600)
  expect(await fs.readdir(dir)).toEqual(['tokens.json'])
  expect(new URLSearchParams(network.mock.calls[0]?.[1].body).get('refresh_token')).toBe(expired.refresh_token)
})
it('retains same-process singleflight and returns the same refresh to all callers', async () => {
  await seed()
  await storage.getTokens()
  const values = await Promise.all([
    storage.refreshAccessToken(),
    storage.refreshAccessToken(),
    storage.getValidAccessToken()
  ])
  expect(values).toEqual(Array(3).fill(response.access_token))
  expect(network).toHaveBeenCalledTimes(1)
  expect(storage._refreshPromise).toBeNull()
})
it('reloads a token refreshed by another storage instance and skips a redundant refresh', async () => {
  await seed()
  await storage.getTokens()
  const other = new TokenStorage(storage.config)
  await other.getTokens()
  await storage.refreshAccessToken()
  expect(await other.refreshAccessToken()).toBe(response.access_token)
  expect(network).toHaveBeenCalledTimes(1)
})
it('still refreshes a valid unchanged token explicitly (Graph 401)', async () => {
  await seed({ ...expired, expires_at: Date.now() + 3600000 })
  await storage.getTokens()
  expect(await storage.refreshAccessToken()).toBe(response.access_token)
  expect(network).toHaveBeenCalledTimes(1)
})
it('serializes refresh and code exchange, reloads latest state and keeps the exchange result', async () => {
  await seed()
  await storage.getTokens()
  let release: (() => void) | undefined
  network
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 200, headers: {}, body: response })
        })
    )
    .mockResolvedValueOnce({
      status: 200,
      headers: {},
      body: { ...response, access_token: 'fixture-code', refresh_token: 'fixture-code-rotation' }
    })
  const refreshing = storage.refreshAccessToken()
  await vi.waitFor(() => expect(release).toBeDefined())
  const exchanging = storage.exchangeCodeForTokens('fixture-code')
  ;(release as () => void)()
  await Promise.all([refreshing, exchanging])
  expect(await read()).toMatchObject({ access_token: 'fixture-code', refresh_token: 'fixture-code-rotation' })
  expect(network).toHaveBeenCalledTimes(2)
})
it('code exchange preserves the public legacy six-field shape and old refresh on omission', async () => {
  await seed()
  network.mockResolvedValueOnce({ status: 200, headers: {}, body: { ...response, refresh_token: undefined } })
  const tokens = await storage.exchangeCodeForTokens('fixture-code')
  expect(tokens).toEqual({
    access_token: response.access_token,
    refresh_token: expired.refresh_token,
    expires_in: 3600,
    expires_at: expect.any(Number),
    scope: response.scope,
    token_type: 'Bearer'
  })
  expect(await read()).toEqual(tokens)
})
it('standalone callback retains derived host/tenant endpoint, PKCE and full response fields', async () => {
  const auth = {
    ...loadConfig({ HOME: dir }).auth,
    tokenStorePath: storage.config.tokenStorePath,
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
    authorityHost: 'https://callback.example/ignored-path',
    tenantId: 'tenant',
    tokenEndpoint: 'https://ignored.example/token',
    scopes: ['Mail.Read']
  }
  const tokens = await exchangeCallbackTokens(auth, 'fixture-code', 'fixture-verifier')
  expect(tokens.extra).toBe(response.extra)
  expect(network.mock.calls[0]?.[0]).toBe('https://callback.example/tenant/oauth2/v2.0/token')
  expect(new URLSearchParams(network.mock.calls[0]?.[1].body).get('code_verifier')).toBe('fixture-verifier')
})
it('exchange with an empty store handles omitted refresh token without inventing one', async () => {
  network.mockResolvedValueOnce({ status: 200, headers: {}, body: { ...response, refresh_token: undefined } })
  expect((await storage.exchangeCodeForTokens('fixture-code')).refresh_token).toBeUndefined()
})
it('fails for unconfigured code exchange, absent refresh and deletion observed under lock', async () => {
  storage.config.clientId = ''
  await expect(storage.exchangeCodeForTokens('fixture-code')).rejects.toThrow(
    'Client ID or Client Secret is not configured'
  )
  await expect(storage.refreshAccessToken()).rejects.toThrow('No refresh token available')
  await seed()
  await storage.getTokens()
  await fs.unlink(storage.config.tokenStorePath)
  await expect(storage.refreshAccessToken()).rejects.toThrow('No refresh token available')
  expect(storage._refreshPromise).toBeNull()
})
it.each(['provider', 'rename', 'write'])(
  'leaves previous file and tokens unchanged after %s failure without exposing secrets',
  async (kind) => {
    await seed()
    await storage.getTokens()
    const bytes = await fs.readFile(storage.config.tokenStorePath)
    if (kind === 'provider') network.mockRejectedValueOnce(new Error('fixture-secret fixture-access fixture-code'))
    if (kind === 'rename') vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('fixture-secret'))
    if (kind === 'write') {
      const original = fs.writeFile
      vi.spyOn(fs, 'writeFile').mockImplementation(async (...args) => {
        if (String(args[0]).includes('.tmp.')) throw new Error('fixture-secret')
        return original(...args)
      })
    }
    const error = await storage.exchangeCodeForTokens('fixture-code').catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toMatch(/fixture-(secret|access|code)/)
    expect(await fs.readFile(storage.config.tokenStorePath)).toEqual(bytes)
    expect(storage.tokens).toEqual(expired)
    expect(await fs.readdir(dir)).toEqual(['tokens.json'])
  }
)
it('failed refresh leaves disk intact, then authentication gate gives its original error', async () => {
  await seed()
  const bytes = await fs.readFile(storage.config.tokenStorePath)
  network.mockResolvedValue({
    status: 400,
    headers: {},
    body: { error: 'invalid_grant', error_description: 'fixture-secret' }
  })
  await expect(makeEnsureAuthenticated(storage)()).rejects.toThrow('Authentication required')
  expect(storage.tokens).toBeNull()
  expect(await fs.readFile(storage.config.tokenStorePath)).toEqual(bytes)
})
it.each([
  ['refresh', { refresh_token: { bad: true } }],
  ['refresh', { refresh_token: 4 }],
  ['refresh', { refresh_token: '' }],
  ['code', { refresh_token: null }],
  ['code', { refresh_token: '   ' }],
  ['code', { expires_in: 1e308 }],
  ['refresh', { expires_in: Number.MAX_SAFE_INTEGER }]
])('rejects malformed %s grant fields before persistence and retains the prior file', async (grant, fields) => {
  await seed()
  await storage.getTokens()
  const bytes = await fs.readFile(storage.config.tokenStorePath)
  network.mockResolvedValueOnce({ status: 200, headers: {}, body: { ...response, ...fields } })
  const operation = grant === 'refresh' ? storage.refreshAccessToken() : storage.exchangeCodeForTokens('fixture-code')
  await expect(operation).rejects.toThrow('OAuth token acquisition failed')
  expect(await fs.readFile(storage.config.tokenStorePath)).toEqual(bytes)
  expect(storage.tokens).toEqual(expired)
  expect(await fs.readdir(dir)).toEqual(['tokens.json'])
})
it('expired token without a refresh token returns null without rewriting disk', async () => {
  await seed({ access_token: 'fixture-expired' })
  const bytes = await fs.readFile(storage.config.tokenStorePath)
  expect(await storage.getValidAccessToken()).toBeNull()
  expect(storage.tokens).toBeNull()
  expect(await fs.readFile(storage.config.tokenStorePath)).toEqual(bytes)
})
it('atomic save handles absent tokens and clears memory/file under the same lock', async () => {
  expect(await storage._saveTokensToFile()).toBe(false)
  await seed()
  await storage.getTokens()
  await storage.clearTokens()
  expect(storage.tokens).toBeNull()
  expect(await fs.readdir(dir)).toEqual([])
  await storage.clearTokens()
})
