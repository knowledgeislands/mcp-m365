/**
 * Tests for env-var-driven config branches. `loadConfig(env)` takes an explicit
 * env object, so each case passes a literal `NodeJS.ProcessEnv` slice rather
 * than mutating `process.env` and re-importing the module.
 */
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { loadConfig, M365_DEFAULT_SCOPES } from './index.js'

const baseEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({ HOME: '/home/alice', ...over }) as NodeJS.ProcessEnv

describe('parseScopes (via auth.scopes)', () => {
  it('defaults to M365_DEFAULT_SCOPES when MCP_M365_SCOPES is unset', () => {
    const cfg = loadConfig(baseEnv())
    expect(cfg.auth.scopes).toEqual(M365_DEFAULT_SCOPES)
  })

  it('parses a space-separated MCP_M365_SCOPES value', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_SCOPES: 'offline_access User.Read Mail.Read' }))
    expect(cfg.auth.scopes).toEqual(['offline_access', 'User.Read', 'Mail.Read'])
  })

  it('tolerates mixed whitespace (newlines, tabs, multiple spaces) between scopes', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_SCOPES: '  offline_access   User.Read\tMail.Read\n Mail.Send ' }))
    expect(cfg.auth.scopes).toEqual(['offline_access', 'User.Read', 'Mail.Read', 'Mail.Send'])
  })

  it('falls back to the default when MCP_M365_SCOPES is set but empty/whitespace', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_SCOPES: '   ' }))
    expect(cfg.auth.scopes).toEqual(M365_DEFAULT_SCOPES)
  })
})

describe('homeDir fallback chain (HOME || USERPROFILE || os.homedir() || "/tmp")', () => {
  it('uses HOME when set (token path under $HOME)', () => {
    const cfg = loadConfig(baseEnv({ HOME: '/home/alice', USERPROFILE: undefined }))
    expect(cfg.auth.tokenStorePath).toBe('/home/alice/.mcp-m365-tokens.json')
  })

  it('falls back to USERPROFILE when HOME is unset (Windows-style)', () => {
    const cfg = loadConfig(baseEnv({ HOME: undefined, USERPROFILE: 'C:\\Users\\bob' }))
    expect(cfg.auth.tokenStorePath.endsWith('.mcp-m365-tokens.json')).toBe(true)
  })

  it('falls back to os.homedir() when both HOME and USERPROFILE are unset', async () => {
    vi.resetModules()
    vi.doMock('node:os', async () => {
      const real = await vi.importActual<typeof import('node:os')>('node:os')
      return { ...real, default: { ...real, homedir: () => '/fake/homedir' }, homedir: () => '/fake/homedir' }
    })
    const { loadConfig: loadFresh } = await import('./index.js')
    const cfg = loadFresh(baseEnv({ HOME: undefined, USERPROFILE: undefined }))
    expect(cfg.auth.tokenStorePath).toBe('/fake/homedir/.mcp-m365-tokens.json')
    vi.doUnmock('node:os')
    vi.resetModules()
  })

  it('falls back to /tmp when HOME, USERPROFILE, and os.homedir() all yield falsy', async () => {
    vi.resetModules()
    vi.doMock('node:os', async () => {
      const real = await vi.importActual<typeof import('node:os')>('node:os')
      return { ...real, default: { ...real, homedir: () => '' }, homedir: () => '' }
    })
    const { loadConfig: loadFresh } = await import('./index.js')
    const cfg = loadFresh(baseEnv({ HOME: undefined, USERPROFILE: undefined }))
    expect(cfg.auth.tokenStorePath).toBe('/tmp/.mcp-m365-tokens.json')
    vi.doUnmock('node:os')
    vi.resetModules()
  })
})

describe('auth client credentials', () => {
  it('defaults clientId/clientSecret to empty strings when env vars are unset', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_CLIENT_ID: undefined, MCP_M365_CLIENT_SECRET: undefined }))
    expect(cfg.auth.clientId).toBe('')
    expect(cfg.auth.clientSecret).toBe('')
  })

  it('reads clientId/clientSecret from env when set', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_CLIENT_ID: 'my-client-id', MCP_M365_CLIENT_SECRET: 'my-secret' }))
    expect(cfg.auth.clientId).toBe('my-client-id')
    expect(cfg.auth.clientSecret).toBe('my-secret')
  })
})

describe('parseAccessLevel', () => {
  it('throws on an unknown value', () => {
    expect(() => loadConfig(baseEnv({ MCP_M365_ACCESS_LEVEL: 'godmode' }))).toThrow(
      /Invalid MCP_M365_ACCESS_LEVEL="godmode"/
    )
  })

  it('defaults to read when unset', () => {
    expect(loadConfig(baseEnv()).accessLevel).toBe('read')
  })

  it('accepts an explicit valid value', () => {
    expect(loadConfig(baseEnv({ MCP_M365_ACCESS_LEVEL: 'write' })).accessLevel).toBe('write')
  })
})

describe('parseAuditLogMode', () => {
  it('defaults to writes when unset', () => {
    expect(loadConfig(baseEnv()).auditLogMode).toBe('writes')
  })

  it('throws on an unknown value', () => {
    expect(() => loadConfig(baseEnv({ MCP_M365_AUDIT_LOG: 'sometimes' }))).toThrow(/Invalid MCP_M365_AUDIT_LOG/)
  })

  it('accepts each valid mode (off / writes / all), case-insensitively', () => {
    expect(loadConfig(baseEnv({ MCP_M365_AUDIT_LOG: 'off' })).auditLogMode).toBe('off')
    expect(loadConfig(baseEnv({ MCP_M365_AUDIT_LOG: 'WRITES' })).auditLogMode).toBe('writes')
    expect(loadConfig(baseEnv({ MCP_M365_AUDIT_LOG: 'All' })).auditLogMode).toBe('all')
  })
})

describe('auditLogPath', () => {
  it('resolves an explicit MCP_M365_AUDIT_LOG_PATH to an absolute path', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_AUDIT_LOG_PATH: 'relative/audit.jsonl' }))
    expect(cfg.auditLogPath.endsWith('relative/audit.jsonl')).toBe(true)
    expect(cfg.auditLogPath.startsWith('/')).toBe(true)
  })

  it('falls back to the default state path when MCP_M365_AUDIT_LOG_PATH is blank', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_AUDIT_LOG_PATH: '   ' }))
    expect(cfg.auditLogPath).toMatch(/\.local\/state\/mcp-m365\/audit\.jsonl$/)
  })
})

describe('triageTrackingPath', () => {
  it('resolves an explicit MCP_M365_TRIAGE_TRACKING_PATH to an absolute path', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_TRIAGE_TRACKING_PATH: 'tasks/email-triage/tracking.json5' }))
    expect(cfg.triageTrackingPath.endsWith('tasks/email-triage/tracking.json5')).toBe(true)
    expect(cfg.triageTrackingPath.startsWith('/')).toBe(true)
  })

  it('defaults to a predictable location inside the first root, beside the data it describes', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_TRIAGE_ROOTS: '/repo/kb' }))
    expect(cfg.triageTrackingPath).toBe('/repo/kb/.mcp-m365/email-triage/tracking.json5')
  })

  it('uses that default when the variable is blank', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_TRIAGE_ROOTS: '/repo/kb', MCP_M365_TRIAGE_TRACKING_PATH: '   ' }))
    expect(cfg.triageTrackingPath).toBe('/repo/kb/.mcp-m365/email-triage/tracking.json5')
  })

  it('has no default at all without roots, rather than inventing a hidden location', () => {
    // Silently starting a second routing history somewhere unexpected is worse
    // than refusing until told where the cache lives.
    expect(loadConfig(baseEnv({})).triageTrackingPath).toBe('')
  })
})

describe('triageRoots', () => {
  it('parses a delimiter-separated list', () => {
    expect(loadConfig(baseEnv({ MCP_M365_TRIAGE_ROOTS: ['/a', '/b'].join(path.delimiter) })).triageRoots).toEqual([
      '/a',
      '/b'
    ])
  })

  it('is empty when unset, which disables engine file access', () => {
    expect(loadConfig(baseEnv({})).triageRoots).toEqual([])
  })
})

describe('triageRulesPath', () => {
  it('resolves an explicit MCP_M365_TRIAGE_RULES_PATH to an absolute path', () => {
    const cfg = loadConfig(baseEnv({ MCP_M365_TRIAGE_RULES_PATH: 'kb/Email Routing Rules.md' }))
    expect(cfg.triageRulesPath.endsWith('kb/Email Routing Rules.md')).toBe(true)
    expect(cfg.triageRulesPath.startsWith('/')).toBe(true)
  })

  it('is empty when unset, so `rules` stays required', () => {
    expect(loadConfig(baseEnv({})).triageRulesPath).toBe('')
  })

  it('is empty when blank', () => {
    expect(loadConfig(baseEnv({ MCP_M365_TRIAGE_RULES_PATH: '   ' })).triageRulesPath).toBe('')
  })
})

describe('parseNonNegativeInt (via auditLogMaxBytes)', () => {
  it('parses a valid integer', () => {
    expect(loadConfig(baseEnv({ MCP_M365_AUDIT_LOG_MAX_BYTES: '2048' })).auditLogMaxBytes).toBe(2048)
  })

  it('throws on a non-numeric value', () => {
    expect(() => loadConfig(baseEnv({ MCP_M365_AUDIT_LOG_MAX_BYTES: 'oops' }))).toThrow(
      /Invalid MCP_M365_AUDIT_LOG_MAX_BYTES="oops"/
    )
  })

  it('throws on a negative value', () => {
    expect(() => loadConfig(baseEnv({ MCP_M365_AUDIT_LOG_MAX_BYTES: '-5' }))).toThrow(
      /Invalid MCP_M365_AUDIT_LOG_MAX_BYTES="-5"/
    )
  })
})

describe('hydrateEnvFromFiles (via loadConfig)', () => {
  // Every loadConfig call hydrates process.env from the package's `.env*`
  // files; that step branches on whether NODE_ENV is set. Exercise both arms.
  // Values still come from the explicit env literal, so the observable
  // contract is that hydration is NODE_ENV-agnostic and never throws.
  it('loads regardless of whether NODE_ENV is set', () => {
    const original = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      expect(loadConfig(baseEnv({ MCP_M365_ACCESS_LEVEL: 'write' })).accessLevel).toBe('write')
      delete process.env.NODE_ENV
      expect(loadConfig(baseEnv({ MCP_M365_ACCESS_LEVEL: 'write' })).accessLevel).toBe('write')
    } finally {
      if (original === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = original
    }
  })
})
