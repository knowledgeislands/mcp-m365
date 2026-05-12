/**
 * Tests for env-var-driven config branches. config.ts captures env at module
 * load time, so each test resets modules and re-imports with different env.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ENV_KEYS = ['M365_CLIENT_ID', 'M365_CLIENT_SECRET', 'M365_SCOPES', 'HOME', 'USERPROFILE'] as const

const snapshot: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV_KEYS) snapshot[k] = process.env[k]
  vi.resetModules()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k]
    else process.env[k] = snapshot[k]
  }
})

describe('parseScopes (via AUTH_CONFIG.scopes)', () => {
  it('defaults to M365_DEFAULT_SCOPES when M365_SCOPES is unset', async () => {
    delete process.env.M365_SCOPES
    const { AUTH_CONFIG, M365_DEFAULT_SCOPES } = await import('./config.js')
    expect(AUTH_CONFIG.scopes).toEqual(M365_DEFAULT_SCOPES)
  })

  it('parses a space-separated M365_SCOPES value', async () => {
    process.env.M365_SCOPES = 'offline_access User.Read Mail.Read'
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.scopes).toEqual(['offline_access', 'User.Read', 'Mail.Read'])
  })

  it('tolerates mixed whitespace (newlines, tabs, multiple spaces) between scopes', async () => {
    process.env.M365_SCOPES = '  offline_access   User.Read\tMail.Read\n Mail.Send '
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.scopes).toEqual(['offline_access', 'User.Read', 'Mail.Read', 'Mail.Send'])
  })

  it('falls back to the default when M365_SCOPES is set but empty/whitespace', async () => {
    process.env.M365_SCOPES = '   '
    const { AUTH_CONFIG, M365_DEFAULT_SCOPES } = await import('./config.js')
    expect(AUTH_CONFIG.scopes).toEqual(M365_DEFAULT_SCOPES)
  })
})

describe('homeDir fallback chain (HOME || USERPROFILE || os.homedir() || "/tmp")', () => {
  it('uses HOME when set (token path under $HOME)', async () => {
    process.env.HOME = '/home/alice'
    delete process.env.USERPROFILE
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.tokenStorePath).toBe('/home/alice/.mcp-m365-tokens.json')
  })

  it('falls back to USERPROFILE when HOME is unset (Windows-style)', async () => {
    delete process.env.HOME
    process.env.USERPROFILE = 'C:\\Users\\bob'
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.tokenStorePath.endsWith('.mcp-m365-tokens.json')).toBe(true)
  })

  it('falls back to os.homedir() when both HOME and USERPROFILE are unset', async () => {
    delete process.env.HOME
    delete process.env.USERPROFILE
    vi.doMock('node:os', async () => {
      const real = await vi.importActual<typeof import('node:os')>('node:os')
      return { ...real, default: { ...real, homedir: () => '/fake/homedir' }, homedir: () => '/fake/homedir' }
    })
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.tokenStorePath).toBe('/fake/homedir/.mcp-m365-tokens.json')
    vi.doUnmock('node:os')
  })

  it('falls back to /tmp when HOME, USERPROFILE, and os.homedir() all yield falsy', async () => {
    delete process.env.HOME
    delete process.env.USERPROFILE
    vi.doMock('node:os', async () => {
      const real = await vi.importActual<typeof import('node:os')>('node:os')
      return { ...real, default: { ...real, homedir: () => '' }, homedir: () => '' }
    })
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.tokenStorePath).toBe('/tmp/.mcp-m365-tokens.json')
    vi.doUnmock('node:os')
  })
})

describe('AUTH_CONFIG client credentials', () => {
  it('defaults clientId/clientSecret to empty strings when env vars are unset', async () => {
    delete process.env.M365_CLIENT_ID
    delete process.env.M365_CLIENT_SECRET
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.clientId).toBe('')
    expect(AUTH_CONFIG.clientSecret).toBe('')
  })

  it('reads clientId/clientSecret from env when set', async () => {
    process.env.M365_CLIENT_ID = 'my-client-id'
    process.env.M365_CLIENT_SECRET = 'my-secret'
    const { AUTH_CONFIG } = await import('./config.js')
    expect(AUTH_CONFIG.clientId).toBe('my-client-id')
    expect(AUTH_CONFIG.clientSecret).toBe('my-secret')
  })
})
