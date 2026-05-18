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
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.MCP_M365_AUDIT_LOG_PATH
    delete process.env.MCP_M365_AUDIT_LOG
  })

  it('appends an event for a cleaner tool with the server name set', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('delete-email', 'cleaner', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ id: 'm1' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.server).toBe('mcp-m365')
    expect(event.tool).toBe('delete-email')
    expect(event.role).toBe('cleaner')
    expect(event.ok).toBe(true)
    expect(event.args).toEqual({ id: 'm1' })
  })

  it('redacts body / htmlBody / content / data / fileContent / OAuth code+state fields', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('send-email', 'cleaner', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
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
    const wrapped = withAuditLog('delete-email', 'cleaner', async () => ({ isError: true, content: [{ type: 'text', text: 'gone' }] }))
    await wrapped({ id: 'm1' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('gone')
  })

  it('skips auditor tools by default', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('list-emails', 'auditor', handler)).toBe(handler)
  })

  it('logs auditor tools when MCP_M365_AUDIT_LOG=all', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('list-emails', 'auditor', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.role).toBe('auditor')
  })

  it('skips all roles when MCP_M365_AUDIT_LOG=off', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'off'
    const { withAuditLog } = await import('./audit-log.js')
    const cleaner = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('delete-email', 'cleaner', cleaner)).toBe(cleaner)
    await cleaner({})
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
    const wrapped = withAuditLog('delete-email', 'cleaner', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))

    const mode = (await fs.stat(logPath)).mode & 0o777
    expect(mode.toString(8)).toBe('600')
  })

  it('infers role from annotations.readOnlyHint via makeAuditedRegister', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'all'
    const { makeAuditedRegister } = await import('./audit-log.js')
    const calls: { name: string; handler: (args: unknown) => Promise<unknown> }[] = []
    const stub = { registerTool: (name: string, _config: unknown, handler: (args: unknown) => Promise<unknown>) => calls.push({ name, handler }) }
    const wrapped = makeAuditedRegister(stub as any)
    wrapped('list-emails', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('delete-email', { annotations: { readOnlyHint: false } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await calls[0].handler({})
    await calls[1].handler({})
    await new Promise((r) => setTimeout(r, 20))
    const events = (await fs.readFile(logPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(events.find((e) => e.tool === 'list-emails').role).toBe('auditor')
    expect(events.find((e) => e.tool === 'delete-email').role).toBe('cleaner')
  })
})
