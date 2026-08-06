/**
 * Configuration loading. `loadConfig()` reads the environment (optionally
 * hydrated from the package's `.env*` files) into a plain `Config` value that is
 * threaded explicitly into the MCP server, the auth layer, and the audit log —
 * so the same code runs as an MCP server, the OAuth callback server, or a
 * standalone script. There is NO module-level config singleton: nothing here
 * reads `process.env` at import time.
 *
 * The static, non-env constants below (server name/version, Graph endpoint,
 * `$select` field lists, page-size defaults, the canonical scope list) remain
 * module-level exports — they read no environment and never differ per run.
 */
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Package root, resolved from this module's own URL — NOT `process.cwd()`,
 * which is wherever the MCP host happened to launch `node dist/mcp-server/...`
 * from. Both layouts put this file two levels below the root
 * (`dist/config/index.js` and `src/config/index.ts`), so `../..` is correct
 * whether built or run from source.
 */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Hydrate `process.env` from the package's `.env*` files, mirroring the set and
 * precedence Bun auto-loads (highest first: `.env.local`, then
 * `.env.${NODE_ENV}` if NODE_ENV is set, then `.env`). `process.loadEnvFile`
 * never overwrites a key already present in `process.env`, so loading
 * highest-precedence first means earlier files win — and any value injected by
 * the host (e.g. the MCP client's `env` block) beats every file. Missing files
 * are skipped silently; under Bun this is largely redundant with its own
 * auto-load, which is fine.
 */
const hydrateEnvFromFiles = (): void => {
  const files = ['.env.local']
  if (process.env.NODE_ENV) files.push(`.env.${process.env.NODE_ENV}`)
  files.push('.env')
  for (const file of files) {
    try {
      process.loadEnvFile(path.join(PACKAGE_ROOT, file))
    } catch {
      // File absent or unreadable — skip; the value may come from the host env.
    }
  }
}

export const SERVER_NAME = 'mcp-m365'
export const SERVER_VERSION = '0.9.0'

/**
 * Canonical scope list. **Single source of truth** — both the auth-server
 * (consent flow) and the token-storage (refresh flow) reference this. Drift
 * between consent-time and refresh-time scopes causes silent 403s on
 * unconsented APIs.
 *
 * `offline_access` is required to receive a refresh_token.
 *
 * Override at runtime via `MCP_M365_SCOPES` (space-separated).
 */
export const M365_DEFAULT_SCOPES = [
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.Read',
  'Calendars.ReadWrite',
  'Files.Read',
  'Files.ReadWrite'
]

export const GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0/'

export const EMAIL_SELECT_FIELDS = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,importance,isRead'
export const EMAIL_DETAIL_FIELDS =
  'id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview,body,hasAttachments,importance,isRead,internetMessageHeaders'

export const CALENDAR_SELECT_FIELDS = 'id,subject,bodyPreview,start,end,location,organizer,attendees,isAllDay,isCancelled'

export const DEFAULT_LIST_SIZE = 10
export const DEFAULT_PAGE_SIZE = 50
export const MAX_RESULT_COUNT = 1000

export const DEFAULT_TIMEZONE = 'Central European Standard Time'

export const ONEDRIVE_SELECT_FIELDS = 'id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference'
export const ONEDRIVE_UPLOAD_THRESHOLD = 4 * 1024 * 1024

/**
 * Single ordinal access level. Each level implies all lower ones:
 *   `read`        — only readOnly tools registered.
 *   `write`       — readOnly + non-destructive mutations (create, send, toggle).
 *   `destructive` — everything, including delete / overwrite / prune.
 *
 * The gate uses ACCESS_LEVEL_RANK for ordinal comparison; a tool registers when
 * its derived level ≤ the configured level.
 */
export type AccessLevel = 'read' | 'write' | 'destructive'
export const ACCESS_LEVELS: readonly AccessLevel[] = ['read', 'write', 'destructive'] as const
export const ACCESS_LEVEL_RANK: Record<AccessLevel, number> = { read: 1, write: 2, destructive: 3 }

/**
 * Scope of tool invocations to record. Default `writes` logs any tool whose
 * derived level is not `read` (i.e. `write` or `destructive`); `all` adds
 * `read` too; `off` disables logging entirely (the wrapper short-circuits and
 * never opens the file).
 */
export type AuditLogMode = 'off' | 'writes' | 'all'

/** The OAuth/token slice of Config the auth layer and auth-server need. */
export interface AuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  scopes: string[]
  tokenStorePath: string
  authServerPort: number
  authServerUrl: string
  tenantId: string
  authorityHost: string
  tokenEndpoint: string
}

export interface Config {
  serverName: string
  serverVersion: string
  graphApiEndpoint: string
  accessLevel: AccessLevel
  auth: AuthConfig
  auditLogMode: AuditLogMode
  auditLogPath: string
  auditLogMaxBytes: number
  auditLogKeep: number
  /**
   * Where the email routing engine keeps its tracking cache. Configuration
   * rather than a tool parameter: a caller-supplied path would let any prompt
   * redirect engine writes to an arbitrary location on disk.
   */
  triageTrackingPath: string
}

const parseScopes = (raw: string | undefined): string[] => {
  if (!raw?.trim()) return M365_DEFAULT_SCOPES
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

const parseAccessLevel = (raw: string | undefined): AccessLevel => {
  const v = raw?.trim()
  if (v === undefined || v === '') return 'read'
  if ((ACCESS_LEVELS as readonly string[]).includes(v)) return v as AccessLevel
  throw new Error(`Invalid MCP_M365_ACCESS_LEVEL="${raw}". Allowed: ${ACCESS_LEVELS.join(', ')}`)
}

const parseAuditLogMode = (raw: string | undefined): AuditLogMode => {
  const v = raw?.trim().toLowerCase()
  if (v === undefined || v === '') return 'writes'
  if (v === 'off' || v === 'writes' || v === 'all') return v
  throw new Error(`Invalid MCP_M365_AUDIT_LOG="${raw}" — expected one of: off, writes, all.`)
}

/**
 * Size-based audit-log rotation. After each append, if `audit.jsonl` exceeds
 * MCP_M365_AUDIT_LOG_MAX_BYTES (default 10 MiB), it's renamed to `audit.jsonl.1`
 * and older rotations shift up. MCP_M365_AUDIT_LOG_KEEP (default 5) controls
 * how many rotated files survive. Set MAX_BYTES=0 to disable rotation.
 */
const parseNonNegativeInt = (raw: string | undefined, fallback: number, varName: string): number => {
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid ${varName}="${raw}" — expected a non-negative integer.`)
  }
  return n
}

/**
 * Load configuration from `env` (defaults to `process.env`, after attempting to
 * hydrate it from the package's `.env*` files). Throws if a value fails validation.
 */
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  hydrateEnvFromFiles()

  const homeDir = env.HOME || env.USERPROFILE || os.homedir() || '/tmp'
  const authPort = Number.parseInt(env.MCP_M365_AUTH_PORT || '3333', 10)
  const tenantId = env.MCP_M365_TENANT_ID || 'common'
  const authorityHost = (env.MCP_M365_AUTHORITY_HOST || 'https://login.microsoftonline.com').replace(/\/+$/, '')

  const auth: AuthConfig = {
    clientId: env.MCP_M365_CLIENT_ID || '',
    clientSecret: env.MCP_M365_CLIENT_SECRET || '',
    redirectUri: env.MCP_M365_REDIRECT_URI || `http://localhost:${authPort}/auth/callback`,
    scopes: parseScopes(env.MCP_M365_SCOPES),
    tokenStorePath: path.join(homeDir, '.mcp-m365-tokens.json'),
    authServerPort: authPort,
    authServerUrl: `http://localhost:${authPort}`,
    tenantId,
    authorityHost,
    tokenEndpoint: env.MCP_M365_TOKEN_ENDPOINT || `${authorityHost}/${tenantId}/oauth2/v2.0/token`
  }

  return {
    serverName: SERVER_NAME,
    serverVersion: SERVER_VERSION,
    graphApiEndpoint: GRAPH_API_ENDPOINT,
    accessLevel: parseAccessLevel(env.MCP_M365_ACCESS_LEVEL),
    auth,
    auditLogMode: parseAuditLogMode(env.MCP_M365_AUDIT_LOG),
    auditLogPath: env.MCP_M365_AUDIT_LOG_PATH?.trim()
      ? path.resolve(env.MCP_M365_AUDIT_LOG_PATH.trim())
      : path.join(homeDir, '.local', 'state', 'mcp-m365', 'audit.jsonl'),
    auditLogMaxBytes: parseNonNegativeInt(env.MCP_M365_AUDIT_LOG_MAX_BYTES, 10 * 1024 * 1024, 'MCP_M365_AUDIT_LOG_MAX_BYTES'),
    auditLogKeep: parseNonNegativeInt(env.MCP_M365_AUDIT_LOG_KEEP, 5, 'MCP_M365_AUDIT_LOG_KEEP'),
    triageTrackingPath: env.MCP_M365_TRIAGE_TRACKING_PATH?.trim()
      ? path.resolve(env.MCP_M365_TRIAGE_TRACKING_PATH.trim())
      : path.join(homeDir, '.local', 'state', 'mcp-m365', 'email-triage', 'tracking.json5')
  }
}
