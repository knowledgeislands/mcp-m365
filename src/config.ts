/**
 * Configuration for MCP M365 Server
 */

import os from 'node:os'
import path from 'node:path'

try {
  process.loadEnvFile(`./.env.${process.env.NODE_ENV}`)
} catch {
  // no .env present — that's fine
}

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '/tmp'

export const SERVER_NAME = 'mcp-m365'
export const SERVER_VERSION = '1.0.0'

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
export const M365_DEFAULT_SCOPES = ['offline_access', 'User.Read', 'Mail.Read', 'Mail.ReadWrite', 'Mail.Send', 'Calendars.Read', 'Calendars.ReadWrite', 'Files.Read', 'Files.ReadWrite']

const parseScopes = (raw: string | undefined): string[] => {
  if (!raw?.trim()) return M365_DEFAULT_SCOPES
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

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

const parseAccessLevel = (raw: string | undefined): AccessLevel => {
  const v = raw?.trim()
  if (v === undefined || v === '') return 'read'
  if ((ACCESS_LEVELS as readonly string[]).includes(v)) return v as AccessLevel
  throw new Error(`Invalid MCP_M365_ACCESS_LEVEL="${raw}". Allowed: ${ACCESS_LEVELS.join(', ')}`)
}

export const ACCESS_LEVEL: AccessLevel = parseAccessLevel(process.env.MCP_M365_ACCESS_LEVEL)

const AUTH_PORT = Number.parseInt(process.env.MCP_M365_AUTH_PORT || '3333', 10)

export const AUTH_CONFIG = {
  clientId: process.env.MCP_M365_CLIENT_ID || '',
  clientSecret: process.env.MCP_M365_CLIENT_SECRET || '',
  redirectUri: process.env.MCP_M365_REDIRECT_URI || `http://localhost:${AUTH_PORT}/auth/callback`,
  scopes: parseScopes(process.env.MCP_M365_SCOPES),
  tokenStorePath: path.join(homeDir, '.mcp-m365-tokens.json'),
  authServerPort: AUTH_PORT,
  authServerUrl: `http://localhost:${AUTH_PORT}`
}

export const GRAPH_API_ENDPOINT = 'https://graph.microsoft.com/v1.0/'

export const EMAIL_SELECT_FIELDS = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,bodyPreview,hasAttachments,importance,isRead'
export const EMAIL_DETAIL_FIELDS = 'id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview,body,hasAttachments,importance,isRead,internetMessageHeaders'

export const CALENDAR_SELECT_FIELDS = 'id,subject,bodyPreview,start,end,location,organizer,attendees,isAllDay,isCancelled'

export const DEFAULT_LIST_SIZE = 10
export const DEFAULT_PAGE_SIZE = 50
export const MAX_RESULT_COUNT = 1000

export const DEFAULT_TIMEZONE = 'Central European Standard Time'

export const ONEDRIVE_SELECT_FIELDS = 'id,name,size,lastModifiedDateTime,webUrl,folder,file,parentReference'
export const ONEDRIVE_UPLOAD_THRESHOLD = 4 * 1024 * 1024

export const AUDIT_LOG_PATH: string = process.env.MCP_M365_AUDIT_LOG_PATH?.trim()
  ? path.resolve(process.env.MCP_M365_AUDIT_LOG_PATH.trim())
  : path.join(homeDir, '.local', 'state', 'mcp-m365', 'audit.jsonl')

/**
 * Scope of tool invocations to record. Default `writes` logs any tool whose
 * derived level is not `read` (i.e. `write` or `destructive`); `all` adds
 * `read` too; `off` disables logging entirely (the wrapper short-circuits and
 * never opens the file).
 */
export type AuditLogMode = 'off' | 'writes' | 'all'

const parseAuditLogMode = (raw: string | undefined): AuditLogMode => {
  const v = raw?.trim().toLowerCase()
  if (v === undefined || v === '') return 'writes'
  if (v === 'off' || v === 'writes' || v === 'all') return v
  throw new Error(`Invalid MCP_M365_AUDIT_LOG="${raw}" — expected one of: off, writes, all.`)
}

export const AUDIT_LOG_MODE: AuditLogMode = parseAuditLogMode(process.env.MCP_M365_AUDIT_LOG)

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
export const AUDIT_LOG_MAX_BYTES: number = parseNonNegativeInt(process.env.MCP_M365_AUDIT_LOG_MAX_BYTES, 10 * 1024 * 1024, 'MCP_M365_AUDIT_LOG_MAX_BYTES')
export const AUDIT_LOG_KEEP: number = parseNonNegativeInt(process.env.MCP_M365_AUDIT_LOG_KEEP, 5, 'MCP_M365_AUDIT_LOG_KEEP')

export default {
  SERVER_NAME,
  SERVER_VERSION,
  AUTH_CONFIG,
  GRAPH_API_ENDPOINT,
  EMAIL_SELECT_FIELDS,
  EMAIL_DETAIL_FIELDS,
  CALENDAR_SELECT_FIELDS,
  DEFAULT_LIST_SIZE,
  DEFAULT_PAGE_SIZE,
  MAX_RESULT_COUNT,
  DEFAULT_TIMEZONE,
  ONEDRIVE_SELECT_FIELDS,
  ONEDRIVE_UPLOAD_THRESHOLD,
  AUDIT_LOG_PATH,
  AUDIT_LOG_MODE
}
