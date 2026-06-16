/**
 * Append-only JSONL audit log for tool invocations.
 *
 * Scope is controlled by MCP_M365_AUDIT_LOG: `off` (no logging), `writes`
 * (default — `write` and `destructive` levels only, i.e. anything not
 * annotated `readOnlyHint: true`) or `all` (every tool, including read).
 * Level is derived from each tool's MCP annotations by `makeAccessGatedRegister`.
 * Path is configurable via MCP_M365_AUDIT_LOG_PATH; defaults to
 * `~/.local/state/mcp-m365/audit.jsonl`.
 *
 * The mode/path/size config is passed in as an `AuditConfig` (the audit slice
 * of the loaded `Config`), keeping this util MCP-agnostic — nothing here reads
 * env. Failures to write the audit line are swallowed (stderr only) — a broken
 * log must never prevent a tool call from completing.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { type AccessLevel, type AuditLogMode, SERVER_NAME } from '../config/index.js'

export type { AccessLevel } from '../config/index.js'

/** The audit-log slice of Config the caller passes in (keeps this util MCP-agnostic). */
export interface AuditConfig {
  mode: AuditLogMode
  path: string
  maxBytes: number
  keep: number
}

export interface AuditEvent {
  ts: string
  server: string
  tool: string
  level: AccessLevel
  ok: boolean
  duration_ms: number
  error?: string
  args: unknown
}

const MAX_ARG_CHARS = 4096

const REDACT_FIELDS = new Set([
  // Outgoing message bodies — large and may contain PII
  'body',
  'htmlBody',
  'content',
  // OneDrive upload payloads
  'data',
  'fileContent',
  // OAuth flow secrets
  'code',
  'state'
])

/**
 * Redact `user:pass@` / `token@` userinfo from any URL-like string, so a
 * credential-bearing URL can never reach the audit log verbatim. Only the
 * authority userinfo after `scheme://` is matched — scp-style `git@host:path`
 * (no `//`) and bare `@mentions` are left untouched.
 */
const redactUrlCredentials = (value: unknown): unknown => {
  if (typeof value === 'string') return value.replace(/(\/\/)[^/@\s]+@/g, '$1<redacted>@')
  if (Array.isArray(value)) return value.map(redactUrlCredentials)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactUrlCredentials(v)]))
  }
  return value
}

const sanitizeArgs = (args: unknown): unknown => {
  let safe: unknown = args
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    const copy: Record<string, unknown> = { ...(args as Record<string, unknown>) }
    for (const key of Object.keys(copy)) {
      if (REDACT_FIELDS.has(key) && typeof copy[key] === 'string') {
        copy[key] = `[redacted ${Buffer.byteLength(copy[key] as string, 'utf-8')}B]`
      }
    }
    safe = copy
  }
  safe = redactUrlCredentials(safe)
  const serialized = JSON.stringify(safe)
  if (serialized.length > MAX_ARG_CHARS) {
    return { _truncated: true, preview: serialized.slice(0, MAX_ARG_CHARS) }
  }
  return safe
}

// Once per process, chmod the log to 0o600 after the first successful append
// — covers logs created before this safeguard existed (which would otherwise
// keep 0o644). `appendFile`'s `mode` option only applies on creation.
let chmodEnsured = false

/**
 * If the live log is over the size cap, shift `.1` → `.2` → … → `.N` (dropping
 * the oldest) and rename the live file to `.1`. Mode `0o600` is preserved by
 * `fs.rename`. Best-effort: any failure logs to stderr and leaves the file in
 * place so the next append still succeeds.
 */
const rotateIfNeeded = async (audit: AuditConfig): Promise<void> => {
  if (audit.maxBytes === 0) return
  let size: number
  try {
    size = (await fs.stat(audit.path)).size
  } catch {
    /* v8 ignore next — defensive: log was just appended; stat failing here is a TOCTOU race we accept */
    return
  }
  if (size <= audit.maxBytes) return
  try {
    if (audit.keep > 0) {
      await fs.rm(`${audit.path}.${audit.keep}`, { force: true })
      for (let i = audit.keep - 1; i >= 1; i--) {
        try {
          await fs.rename(`${audit.path}.${i}`, `${audit.path}.${i + 1}`)
        } catch {
          // missing slot — fine, rotation history may not be full yet
        }
      }
      await fs.rename(audit.path, `${audit.path}.1`)
    } else {
      await fs.rm(audit.path, { force: true })
    }
  } catch (err) {
    /* v8 ignore next — fs rejects with Error objects; the String() coercion is a defensive fallback */
    console.error(`[audit-log] rotation failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

const writeAuditEvent = async (audit: AuditConfig, event: AuditEvent): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(audit.path), { recursive: true })
    await fs.appendFile(audit.path, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', mode: 0o600 })
    if (!chmodEnsured) {
      try {
        await fs.chmod(audit.path, 0o600)
      } catch {
        // best-effort — log may have been rotated/removed between write and chmod
      }
      chmodEnsured = true
    }
    await rotateIfNeeded(audit)
  } catch (err) {
    /* v8 ignore next — fs rejects with Error objects; the String() coercion is a defensive fallback */
    console.error(`[audit-log] failed to write: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Serialize appends through a single chain so concurrent callers can't race on
// the append → stat → rotate sequence (two simultaneous rotations would have
// one `rename(live → .1)` lose with ENOENT). Each call awaits the prior one;
// errors are swallowed inside writeAuditEvent so the chain never rejects.
let auditQueue: Promise<void> = Promise.resolve()

export const appendAuditEvent = (audit: AuditConfig, event: AuditEvent): Promise<void> => {
  auditQueue = auditQueue.then(() => writeAuditEvent(audit, event))
  return auditQueue
}

type ToolCallback = (...callbackArgs: unknown[]) => unknown | Promise<unknown>

const extractErrorText = (result: unknown): string | undefined => {
  const content = (result as { content?: { type: string; text: string }[] }).content
  if (!Array.isArray(content)) return undefined
  const first = content.find((c) => c.type === 'text')
  return first?.text
}

export const withAuditLog = (audit: AuditConfig, toolName: string, level: AccessLevel, callback: ToolCallback): ToolCallback => {
  if (audit.mode === 'off') return callback
  if (level === 'read' && audit.mode !== 'all') return callback
  return async (...callbackArgs: unknown[]) => {
    const start = Date.now()
    const args = callbackArgs[0]
    try {
      const result = await callback(...callbackArgs)
      const isError = typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
      const errText = isError ? extractErrorText(result) : undefined
      void appendAuditEvent(audit, {
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        level,
        ok: !isError,
        duration_ms: Date.now() - start,
        error: errText,
        args: sanitizeArgs(args)
      })
      return result
    } catch (err) {
      void appendAuditEvent(audit, {
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        level,
        ok: false,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        args: sanitizeArgs(args)
      })
      throw err
    }
  }
}
