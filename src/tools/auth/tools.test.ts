import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../../config/index.js'
import { _resetTokenStorage, getTokenStorage, initTokenStorage } from '../../main/auth/index.js'
import { handleAbout, handleAuthenticate, handleCheckAuthStatus } from './tools.js'

const cfg = loadConfig({ HOME: '/mock/home', MCP_M365_CLIENT_ID: 'test-client', MCP_M365_AUTH_PORT: '3333' } as NodeJS.ProcessEnv)

let getTokensSpy: Mock
let isExpiredSpy: Mock
let consoleErrorSpy: MockInstance

beforeEach(() => {
  initTokenStorage(cfg)
  const tokenStorage = getTokenStorage()
  getTokensSpy = vi.fn()
  isExpiredSpy = vi.fn()
  vi.spyOn(tokenStorage, 'getTokens').mockImplementation(getTokensSpy)
  vi.spyOn(tokenStorage, 'isTokenExpired').mockImplementation(isExpiredSpy)
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  consoleErrorSpy.mockRestore()
  _resetTokenStorage()
})

describe('handleAbout', () => {
  it('returns server name, version, and module summary', async () => {
    const r = await handleAbout(cfg)
    expect(r.content[0].text).toMatch(/MCP M365 Server v/)
    expect(r.content[0].text).toContain('Outlook')
    expect(r.content[0].text).toContain('OneDrive')
  })
})

describe('handleAuthenticate', () => {
  it('returns the auth URL', async () => {
    const r = await handleAuthenticate(cfg)
    expect(r.content[0].text).toMatch(/Please visit the following URL/)
    expect(r.content[0].text).toMatch(/client_id=/)
  })
})

describe('handleCheckAuthStatus', () => {
  it('reports not-authenticated when no tokens are persisted', async () => {
    getTokensSpy.mockResolvedValue(null)
    const r = await handleCheckAuthStatus()
    const payload = JSON.parse(r.content[0].text)
    expect(payload).toMatchObject({ authenticated: false, hasRefreshToken: false, scope: [] })
  })

  it('reports not-authenticated when tokens lack access_token', async () => {
    getTokensSpy.mockResolvedValue({ refresh_token: 'r' })
    const r = await handleCheckAuthStatus()
    const payload = JSON.parse(r.content[0].text)
    expect(payload.authenticated).toBe(false)
  })

  it('reports authenticated with redacted summary when access_token is present', async () => {
    const expiresAt = Date.now() + 60_000
    getTokensSpy.mockResolvedValue({ access_token: 'SECRET_ACCESS', refresh_token: 'SECRET_REFRESH', scope: 'User.Read Mail.Read', expires_at: expiresAt })
    isExpiredSpy.mockReturnValue(false)
    const r = await handleCheckAuthStatus()
    const payload = JSON.parse(r.content[0].text)
    expect(payload).toMatchObject({
      authenticated: true,
      hasRefreshToken: true,
      scope: ['User.Read', 'Mail.Read'],
      expiresAt,
      expired: false
    })
  })

  it('never leaks access_token or refresh_token values', async () => {
    getTokensSpy.mockResolvedValue({ access_token: 'SECRET_ACCESS_VALUE', refresh_token: 'SECRET_REFRESH_VALUE', scope: 'User.Read', expires_at: Date.now() })
    isExpiredSpy.mockReturnValue(false)
    const r = await handleCheckAuthStatus()
    expect(r.content[0].text).not.toContain('SECRET_ACCESS_VALUE')
    expect(r.content[0].text).not.toContain('SECRET_REFRESH_VALUE')
  })

  it('surfaces expiry as a boolean derived from tokenStorage', async () => {
    getTokensSpy.mockResolvedValue({ access_token: 'a', expires_at: 0 })
    isExpiredSpy.mockReturnValue(true)
    const r = await handleCheckAuthStatus()
    const payload = JSON.parse(r.content[0].text)
    expect(payload.expired).toBe(true)
  })
})
