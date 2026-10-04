interface GraphErrorShape {
  message?: string
  status?: number
  statusCode?: number
  code?: string | number
  response?: {
    status?: number
    data?: { error?: { code?: string; message?: string } }
  }
}

// Appended to error messages when Microsoft Graph returns 401, so callers see
// the remedy in-line rather than a bare HTTP code. `m365_auth_start` persists
// tokens, so it is a write tool absent at the default read level; the hint
// therefore leads with the browser route, which works at every level. It names
// the callback server's `/auth` path rather than an address, because the
// callback URL is operator configuration.
export const AUTH_HINT =
  'Sign in again in a browser: start the OAuth callback server (`bun run ki:server:auth:dev`) and open its ' +
  '`/auth` page. The `m365_auth_start` tool runs the same flow but is registered only at ' +
  'MCP_M365_ACCESS_LEVEL=write or above, and changing the level needs a client restart.'

/** Returned by handlers when no usable token exists (`Error('Authentication required')`). */
export const AUTH_REQUIRED_MESSAGE = `Authentication required. ${AUTH_HINT}`

const looksLikeAuthFailure = (status: number | undefined, msg: string): boolean => {
  if (status === 401) return true
  return /\b(401|Unauthorized|InvalidAuthenticationToken|TokenExpired)\b/i.test(msg)
}

const withAuthHint = (status: number | undefined, msg: string): string =>
  looksLikeAuthFailure(status, msg) ? `${msg} — ${AUTH_HINT}` : msg

export const errMessage = (error: unknown): string => {
  if (error && typeof error === 'object') {
    const e = error as GraphErrorShape
    const status =
      e.response?.status ??
      e.statusCode ??
      e.status ??
      (typeof e.code === 'string' && /^\d+$/.test(e.code) ? Number(e.code) : undefined)
    const apiMsg = e.response?.data?.error?.message
    if (status && apiMsg) return withAuthHint(status, `HTTP ${status}: ${apiMsg}`)
    if (status && e.message) return withAuthHint(status, `HTTP ${status}: ${e.message}`)
    if (apiMsg) return withAuthHint(status, apiMsg)
    if (e.message) return withAuthHint(status, e.message)
  }
  /* v8 ignore next — unreachable: the object branch above already handles `instanceof Error` (Error has a `message` field) */
  if (error instanceof Error) return withAuthHint(undefined, error.message)
  if (typeof error === 'string') return withAuthHint(undefined, error)
  return String(error)
}

export const errCode = (error: unknown): string | undefined => {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}
