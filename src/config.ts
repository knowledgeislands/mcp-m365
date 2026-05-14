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
export const AUDIT_LOG_ALL: boolean = process.env.MCP_M365_AUDIT_LOG_ALL === '1'

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
  AUDIT_LOG_ALL
}
