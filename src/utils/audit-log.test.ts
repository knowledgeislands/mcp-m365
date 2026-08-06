import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuditConfig } from './audit-log.js'

describe('appendAuditEvent / withAuditLog (mcp-m365)', () => {
  const tmpDir = path.join(os.tmpdir(), 'mcp-m365-audit-log-tests', `run-${process.pid}-${Date.now()}`)
  const logPath = path.join(tmpDir, 'audit.jsonl')

  // The audit-log module keeps internal state (chmodEnsured, the append queue),
  // so reset modules per test for isolation. Config is passed in explicitly.
  const auditCfg = (o: Partial<AuditConfig> = {}): AuditConfig => ({
    mode: 'writes',
    path: logPath,
    maxBytes: 10 * 1024 * 1024,
    keep: 5,
    ...o
  })

  beforeEach(async () => {
    await fs.mkdir(tmpDir, { recursive: true })
    vi.resetModules()
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  const flushAsync = () => new Promise((r) => setTimeout(r, 20))

  it('appends an event for a destructive-level tool with the server name set', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({ id: 'm1' })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.server).toBe('mcp-m365')
    expect(event.tool).toBe('m365_email_message_delete')
    expect(event.level).toBe('destructive')
    expect(event.ok).toBe(true)
    expect(event.args).toEqual({ id: 'm1' })
  })

  it('redacts a rule document, which would otherwise be logged verbatim on every scheduled routing run', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_routing_triage', 'destructive', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ mode: 'live', rules: '```rules v1\nparty:*@partner.example -> move:111 Project   # commercially sensitive\n```' })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args.rules).toMatch(/^\[redacted \d+B\]$/)
    expect(event.args.mode).toBe('live')
  })

  it('redacts body / htmlBody / content / data / fileContent / OAuth code+state fields', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_send', 'write', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
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
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    for (const k of ['body', 'htmlBody', 'content', 'data', 'fileContent', 'code', 'state']) {
      expect(event.args[k]).toMatch(/^\[redacted \d+B\]$/)
    }
    expect(event.args.to).toBe('a@x')
  })

  it('redacts scheme://user:pass@host credentials in strings, arrays, nested objects (primitives pass through)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ mode: 'all' }), 'm365_email_messages_list', 'read', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({
      url: 'https://user:tok3n@example.com/x',
      urls: ['https://user:tok3n@example.com/a', 'https://example.com/safe'],
      nested: { inner: 'https://user:tok3n@example.com/y' },
      count: 42
    })
    await flushAsync()
    const line = (await fs.readFile(logPath, 'utf-8')).trim()
    expect(line).not.toContain('tok3n')
    expect(line).toContain('<redacted>')
    const event = JSON.parse(line)
    expect(event.args.url).toBe('https://<redacted>@example.com/x')
    expect(event.args.urls).toEqual(['https://<redacted>@example.com/a', 'https://example.com/safe'])
    expect(event.args.nested.inner).toBe('https://<redacted>@example.com/y')
    expect(event.args.count).toBe(42)
  })

  it('records ok:false + error text when isError:true', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => ({
      isError: true,
      content: [{ type: 'text', text: 'gone' }]
    }))
    await wrapped({ id: 'm1' })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('gone')
  })

  it('skips read-level tools by default', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog(auditCfg(), 'm365_email_messages_list', 'read', handler)).toBe(handler)
  })

  it('logs read-level tools when audit mode is "all"', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ mode: 'all' }), 'm365_email_messages_list', 'read', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({})
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.level).toBe('read')
  })

  it('skips all levels when audit mode is "off"', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const writeHandler = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog(auditCfg({ mode: 'off' }), 'm365_email_message_delete', 'destructive', writeHandler)).toBe(writeHandler)
    await writeHandler({})
    await flushAsync()
    await expect(fs.access(logPath)).rejects.toThrow()
  })

  it('creates the audit log with mode 0o600 and chmods an existing 0o644 log down to 0o600', async () => {
    await fs.mkdir(path.dirname(logPath), { recursive: true })
    await fs.writeFile(logPath, '', { mode: 0o644 })
    expect(((await fs.stat(logPath)).mode & 0o777).toString(8)).toBe('644')

    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({})
    await flushAsync()

    const mode = (await fs.stat(logPath)).mode & 0o777
    expect(mode.toString(8)).toBe('600')
  })

  it('infers level from annotations via makeAccessGatedRegister', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string; handler: (args: unknown) => Promise<unknown> }[] = []
    const stub = {
      registerTool: (name: string, _config: unknown, handler: (args: unknown) => Promise<unknown>) => calls.push({ name, handler })
    }
    const wrapped = makeAccessGatedRegister(stub as any, 'destructive', auditCfg({ mode: 'all' }))
    wrapped('m365_email_messages_list', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_send', { annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    wrapped('m365_email_message_delete', { annotations: { readOnlyHint: false, destructiveHint: true } }, async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await calls[0].handler({})
    await calls[1].handler({})
    await calls[2].handler({})
    await flushAsync()
    const events = (await fs.readFile(logPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(events.find((e) => e.tool === 'm365_email_messages_list').level).toBe('read')
    expect(events.find((e) => e.tool === 'm365_email_message_send').level).toBe('write')
    expect(events.find((e) => e.tool === 'm365_email_message_delete').level).toBe('destructive')
  })

  it('skips registration for tools whose level exceeds the configured access level (default = read)', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string }[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: (args: unknown) => Promise<unknown>) => calls.push({ name }) }
    const wrapped = makeAccessGatedRegister(stub as any, 'read', auditCfg())
    wrapped('m365_email_messages_list', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_send', { annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    wrapped('m365_email_message_delete', { annotations: { readOnlyHint: false, destructiveHint: true } }, async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    expect(calls.map((c) => c.name)).toEqual(['m365_email_messages_list'])
  })

  it('registers read + non-destructive writes but skips destructive when access level = write', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string }[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: (args: unknown) => Promise<unknown>) => calls.push({ name }) }
    const wrapped = makeAccessGatedRegister(stub as any, 'write', auditCfg())
    wrapped('m365_email_messages_list', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('m365_email_message_send', { annotations: { readOnlyHint: false, destructiveHint: false } }, async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    wrapped('m365_email_message_delete', { annotations: { readOnlyHint: false, destructiveHint: true } }, async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    expect(calls.map((c) => c.name)).toEqual(['m365_email_messages_list', 'm365_email_message_send'])
  })

  it('treats an unannotated tool as destructive (fail-safe — skipped when only read is configured)', async () => {
    const { makeAccessGatedRegister } = await import('./access-level.js')
    const calls: { name: string }[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: (args: unknown) => Promise<unknown>) => calls.push({ name }) }
    const wrapped = makeAccessGatedRegister(stub as any, 'read', auditCfg())
    wrapped('unannotated_tool', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(calls).toEqual([])
  })

  it('truncates args when the serialized form exceeds MAX_ARG_CHARS', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped({ huge: 'x'.repeat(5000) })
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args._truncated).toBe(true)
    expect(typeof event.args.preview).toBe('string')
  })

  it('rotates the audit log when it exceeds maxBytes (keeps history)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 100, keep: 2 }), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    await expect(fs.access(`${logPath}.1`)).resolves.toBeUndefined()
  })

  it('rotates by truncating the log when keep=0 (no history)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 100, keep: 0 }), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
  })

  it('records ok:false + error message when the handler throws', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => {
      throw new Error('kaboom')
    })
    await expect(wrapped({ id: 'm1' })).rejects.toThrow(/kaboom/)
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('kaboom')
  })

  it('coerces non-Error thrown values via String() when recording the error field', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => {
      throw 'bare string thrown'
    })
    await expect(wrapped({})).rejects.toBe('bare string thrown')
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.error).toBe('bare string thrown')
  })

  it('swallows appendFile failures (e.g. path is a directory) without throwing', async () => {
    await fs.mkdir(logPath, { recursive: true })
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await expect(wrapped({})).resolves.toBeDefined()
  })

  it('records non-object args verbatim (array args are not treated as a redactable map)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg(), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    await wrapped(['a', 'b'] as unknown as Record<string, unknown>)
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.args).toEqual(['a', 'b'])
  })

  it('does not rotate when maxBytes is 0 (rotation disabled)', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 0, keep: 2 }), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    await expect(fs.access(`${logPath}.1`)).rejects.toThrow()
    await expect(fs.access(logPath)).resolves.toBeUndefined()
  })

  it('swallows a rotation failure (e.g. the rotated slot is a non-empty directory)', async () => {
    // Pre-create `${logPath}.1` as a NON-EMPTY directory so renaming the log
    // onto it fails (ENOTEMPTY), exercising the rotation catch.
    await fs.mkdir(`${logPath}.1`, { recursive: true })
    await fs.writeFile(path.join(`${logPath}.1`, 'blocker'), 'x')
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(auditCfg({ maxBytes: 100, keep: 2 }), 'm365_email_message_delete', 'destructive', async () => ({
      content: [{ type: 'text', text: 'ok' }]
    }))
    for (let i = 0; i < 6; i++) await wrapped({ idx: i })
    await new Promise((r) => setTimeout(r, 50))
    // The append still succeeds; rotation failure is swallowed.
    await expect(fs.access(logPath)).resolves.toBeUndefined()
  })

  it('records an empty error string when an isError result has a non-array content', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog(
      auditCfg(),
      'm365_email_message_delete',
      'destructive',
      async () => ({ isError: true, content: 'oops' }) as unknown as { content: { type: string; text: string }[] }
    )
    await wrapped({})
    await flushAsync()
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error ?? '').toBe('')
  })
})
