/**
 * Append-only JSONL audit log for tool invocations.
 *
 * Scope is controlled by MCP_M365_AUDIT_LOG: `off` (no logging), `writes`
 * (default — any tool whose annotations report `readOnlyHint: false`, covering
 * ADDITIVE_REMOTE / STATE_TOGGLE_REMOTE / DESTRUCTIVE_REMOTE) or `all` (every
 * tool). Path is configurable via MCP_M365_AUDIT_LOG_PATH; defaults to
 * `~/.local/state/mcp-m365/audit.jsonl`.
 *
 * Failures to write the audit line are swallowed (stderr only) — a broken log
 * must never prevent a tool call from completing.
 */
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { AUDIT_LOG_KEEP, AUDIT_LOG_MAX_BYTES, AUDIT_LOG_MODE, AUDIT_LOG_PATH, SERVER_NAME } from '../config.js'

export type Role = 'auditor' | 'cleaner'

export interface AuditEvent {
  ts: string
  server: string
  tool: string
  role: Role
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
const rotateIfNeeded = async (): Promise<void> => {
  if (AUDIT_LOG_MAX_BYTES === 0) return
  let size: number
  try {
    size = (await fs.stat(AUDIT_LOG_PATH)).size
  } catch {
    return
  }
  if (size <= AUDIT_LOG_MAX_BYTES) return
  try {
    if (AUDIT_LOG_KEEP > 0) {
      await fs.rm(`${AUDIT_LOG_PATH}.${AUDIT_LOG_KEEP}`, { force: true })
      for (let i = AUDIT_LOG_KEEP - 1; i >= 1; i--) {
        try {
          await fs.rename(`${AUDIT_LOG_PATH}.${i}`, `${AUDIT_LOG_PATH}.${i + 1}`)
        } catch {
          // missing slot — fine, rotation history may not be full yet
        }
      }
      await fs.rename(AUDIT_LOG_PATH, `${AUDIT_LOG_PATH}.1`)
    } else {
      await fs.rm(AUDIT_LOG_PATH, { force: true })
    }
  } catch (err) {
    console.error(`[audit-log] rotation failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export const appendAuditEvent = async (event: AuditEvent): Promise<void> => {
  try {
    await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true })
    await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(event)}\n`, { encoding: 'utf-8', mode: 0o600 })
    if (!chmodEnsured) {
      try {
        await fs.chmod(AUDIT_LOG_PATH, 0o600)
      } catch {
        // best-effort — log may have been rotated/removed between write and chmod
      }
      chmodEnsured = true
    }
    await rotateIfNeeded()
  } catch (err) {
    console.error(`[audit-log] failed to write: ${err instanceof Error ? err.message : String(err)}`)
  }
}

type ToolCallback = (...callbackArgs: unknown[]) => unknown | Promise<unknown>

const extractErrorText = (result: unknown): string | undefined => {
  const content = (result as { content?: { type: string; text: string }[] }).content
  if (!Array.isArray(content)) return undefined
  const first = content.find((c) => c.type === 'text')
  return first?.text
}

export const withAuditLog = (toolName: string, role: Role, callback: ToolCallback): ToolCallback => {
  if (AUDIT_LOG_MODE === 'off') return callback
  if (role === 'auditor' && AUDIT_LOG_MODE !== 'all') return callback
  return async (...callbackArgs: unknown[]) => {
    const start = Date.now()
    const args = callbackArgs[0]
    try {
      const result = await callback(...callbackArgs)
      const isError = typeof result === 'object' && result !== null && (result as { isError?: boolean }).isError === true
      const errText = isError ? extractErrorText(result) : undefined
      void appendAuditEvent({
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        role,
        ok: !isError,
        duration_ms: Date.now() - start,
        error: errText,
        args: sanitizeArgs(args)
      })
      return result
    } catch (err) {
      void appendAuditEvent({
        ts: new Date().toISOString(),
        server: SERVER_NAME,
        tool: toolName,
        role,
        ok: false,
        duration_ms: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        args: sanitizeArgs(args)
      })
      throw err
    }
  }
}

type RegisterTool = McpServer['registerTool']

/**
 * Wrap `server.registerTool` so every registered tool's callback is decorated
 * with the audit logger. Role is inferred from `annotations.readOnlyHint`.
 */
export const makeAuditedRegister = (server: McpServer): RegisterTool => {
  return new Proxy(server.registerTool.bind(server) as RegisterTool, {
    apply(target, thisArg, args: Parameters<RegisterTool>) {
      const name = args[0]
      const config = args[1] as { annotations?: { readOnlyHint?: boolean } } | undefined
      const role: Role = config?.annotations?.readOnlyHint ? 'auditor' : 'cleaner'
      const wrappedArgs = [...args] as Parameters<RegisterTool>
      const callback = wrappedArgs[2] as ToolCallback
      wrappedArgs[2] = withAuditLog(name, role, callback) as (typeof wrappedArgs)[2]
      return Reflect.apply(target, thisArg, wrappedArgs)
    }
  })
}
