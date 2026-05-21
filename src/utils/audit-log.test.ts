import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('appendAuditEvent / withAuditLog (mcp-m365)', () => {
  const tmpDir = path.join(os.tmpdir(), 'mcp-m365-audit-log-tests', `run-${process.pid}-${Date.now()}`)
  const logPath = path.join(tmpDir, 'audit.jsonl')

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    vi.resetModules()
    process.env.MCP_M365_AUDIT_LOG_PATH = logPath
    delete process.env.MCP_M365_AUDIT_LOG
    delete process.env.MCP_M365_ACCESS_LEVEL
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.MCP_M365_AUDIT_LOG_PATH
    delete process.env.MCP_M365_AUDIT_LOG
    delete process.env.MCP_M365_ACCESS_LEVEL
  })

  it('appends an event for a destructive-level tool with the server name set', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ id: 'm1' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.server).toBe('mcp-m365')
    expect(event.tool).toBe('m365_email_message_delete')
    expect(event.level).toBe('destructive')
    expect(event.ok).toBe(true)
    expect(event.args).toEqual({ id: 'm1' })
  })

  it('redacts body / htmlBody / content / data / fileContent / OAuth code+state fields', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_send', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({
      to: 'a@x',
      body: 'plain body',
      htmlBody: '<p>html</p>',
      content: 'file content',
      data: 'b64',
      fileContent: 'xxx',
      code: 'oauth-code',
      state: 'oauth-state'
    })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    for (const k of ['body', 'htmlBody', 'content', 'data', 'fileContent', 'code', 'state']) {
      expect(event.args[k]).toMatch(/^\[redacted \d+B\]$/)
    }
    expect(event.args.to).toBe('a@x')
  })

  it('records ok:false + error text when isError:true', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => ({ isError: true, content: [{ type: 'text', text: 'gone' }] }))
    await wrapped({ id: 'm1' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('gone')
  })

  it('skips read-level tools by default', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('m365_email_messages_list', 'read', handler)).toBe(handler)
  })

  it('logs read-level tools when MCP_M365_AUDIT_LOG=all', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_messages_list', 'read', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.level).toBe('read')
  })

  it('skips all levels when MCP_M365_AUDIT_LOG=off', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'off'
    const { withAuditLog } = await import('./audit-log.js')
    const writeHandler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('m365_email_message_delete', 'destructive', writeHandler)).toBe(writeHandler)
    await writeHandler({})
    await new Promise((r) => setTimeout(r, 20))
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('rejects unknown MCP_M365_AUDIT_LOG values at config load', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'sometimes'
    await expect(import('./audit-log.js')).rejects.toThrow(/Invalid MCP_M365_AUDIT_LOG/)
  })

  it('creates the audit log with mode 0o600 and chmods an existing 0o644 log down to 0o600', async () => {
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, '', { mode: 0o644 })
    expect(((await fs.stat(logPath)).mode & 0o777).toString(8)).toBe('644')

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))

    const mode = (await fs.stat(logPath)).mode & 0o777
    expect(mode.toString(8)).toBe('600')
  })

  it('infers level from annotations via makeAccessGatedRegister', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'all'
    process.env.MCP_M365_ACCESS_LEVEL = 'destructive'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string; handler: (args: unknown) => Promise<unknown> }[] = []
    const stub = { registerTool: (name: string, _config: unknown, handler: (args: unknown) => Promise<unknown>) => calls.push({ name, handler }) }
    const wrapped = makeAccessGatedRegister(stub as any)
    wrapped('m365_email_messages_list', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_send', { annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_delete', { annotations: { readOnlyHint: false, destructiveHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await calls[0].handler({})
    await calls[1].handler({})
    await calls[2].handler({})
    await new Promise((r) => setTimeout(r, 20))
    const events = (await fs.readFile(logPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(events.find((e) => e.tool === 'm365_email_messages_list').level).toBe('read')
    expect(events.find((e) => e.tool === 'm365_email_message_send').level).toBe('write')
    expect(events.find((e) => e.tool === 'm365_email_message_delete').level).toBe('destructive')
  })

  it('skips registration for tools whose level exceeds MCP_M365_ACCESS_LEVEL (default = read)', async () => {
    process.env.MCP_M365_ACCESS_LEVEL = 'read'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string }[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: (args: unknown) => Promise<unknown>) => calls.push({ name }) }
    const wrapped = makeAccessGatedRegister(stub as any)
    wrapped('m365_email_messages_list', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_send', { annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_delete', { annotations: { readOnlyHint: false, destructiveHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(calls.map((c) => c.name)).toEqual(['m365_email_messages_list'])
  })

  it('registers read + non-destructive writes but skips destructive when MCP_M365_ACCESS_LEVEL=write', async () => {
    process.env.MCP_M365_ACCESS_LEVEL = 'write'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string }[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: (args: unknown) => Promise<unknown>) => calls.push({ name }) }
    const wrapped = makeAccessGatedRegister(stub as any)
    wrapped('m365_email_messages_list', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_send', { annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_delete', { annotations: { readOnlyHint: false, destructiveHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(calls.map((c) => c.name)).toEqual(['m365_email_messages_list', 'm365_email_message_send'])
  })

  it('treats an unannotated tool as destructive (fail-safe — skipped when only read is configured)', async () => {
    process.env.MCP_M365_ACCESS_LEVEL = 'read'
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string }[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: (args: unknown) => Promise<unknown>) => calls.push({ name }) }
    const wrapped = makeAccessGatedRegister(stub as any)
    wrapped('unannotated_tool', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(calls).toEqual([])
  })

  it('truncates args when the serialized form exceeds MAX_ARG_CHARS', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ huge: 'x'.repeat(5000) })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args._truncated).toBe(true)
    expect(typeof event.args.preview).toBe('string')
  })

  it('rotates the audit log when it exceeds MCP_M365_AUDIT_LOG_MAX_BYTES (keeps history)', async () => {
    process.env.MCP_M365_AUDIT_LOG_MAX_BYTES = '100'
    process.env.MCP_M365_AUDIT_LOG_KEEP = '2'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    await expect(fs.access(`${logPath}.1`)).resolves.toBeUndefined()
    delete process.env.MCP_M365_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_M365_AUDIT_LOG_KEEP
  })

  it('rotates by truncating the log when KEEP=0 (no history)', async () => {
    process.env.MCP_M365_AUDIT_LOG_MAX_BYTES = '100'
    process.env.MCP_M365_AUDIT_LOG_KEEP = '0'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
    delete process.env.MCP_M365_AUDIT_LOG_MAX_BYTES
    delete process.env.MCP_M365_AUDIT_LOG_KEEP
  })

  it('records ok:false + error message when the handler throws', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => {
      throw new Error('kaboom')
    })
    await expect(wrapped({ id: 'm1' })).rejects.toThrow(/kaboom/)
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('kaboom')
  })

  it('coerces non-Error thrown values via String() when recording the error field', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => {
      throw 'bare string thrown'
    })
    await expect(wrapped({})).rejects.toBe('bare string thrown')
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.error).toBe('bare string thrown')
  })

  it('swallows appendFile failures (e.g. path is a directory) without throwing', async () => {
    await fs.mkdir(logPath, { recursive: true })
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('m365_email_message_delete', 'destructive', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await expect(wrapped({})).resolves.toBeDefined()
  })
})
