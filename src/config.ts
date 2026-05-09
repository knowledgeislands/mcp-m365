/**
 * Configuration for MCP M365 Server
 */

import os from 'node:os'
import path from 'node:path'

const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir() || '/tmp'

export const SERVER_NAME = 'mcp-m365'
export const SERVER_VERSION = '1.0.0'

export const AUTH_CONFIG = {
  clientId: process.env.M365_CLIENT_ID || '',
  clientSecret: process.env.M365_CLIENT_SECRET || '',
  redirectUri: 'http://localhost:3333/auth/callback',
  scopes: ['Mail.Read', 'Mail.ReadWrite', 'Mail.Send', 'User.Read', 'Calendars.Read', 'Calendars.ReadWrite', 'Files.Read', 'Files.ReadWrite'],
  tokenStorePath: path.join(homeDir, '.mcp-m365-tokens.json'),
  authServerUrl: 'http://localhost:3333'
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
  ONEDRIVE_UPLOAD_THRESHOLD
}
