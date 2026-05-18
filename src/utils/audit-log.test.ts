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
    delete process.env.MCP_M365_ROLES
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.MCP_M365_AUDIT_LOG_PATH
    delete process.env.MCP_M365_AUDIT_LOG
    delete process.env.MCP_M365_ROLES
  })

  it('appends an event for an editor tool with the server name set', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('editor_delete-email', 'editor', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({ id: 'm1' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.server).toBe('mcp-m365')
    expect(event.tool).toBe('editor_delete-email')
    expect(event.role).toBe('editor')
    expect(event.ok).toBe(true)
    expect(event.args).toEqual({ id: 'm1' })
  })

  it('redacts body / htmlBody / content / data / fileContent / OAuth code+state fields', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('editor_send-email', 'editor', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
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
    const wrapped = withAuditLog('editor_delete-email', 'editor', async () => ({ isError: true, content: [{ type: 'text', text: 'gone' }] }))
    await wrapped({ id: 'm1' })
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.ok).toBe(false)
    expect(event.error).toBe('gone')
  })

  it('skips viewer tools by default', async () => {
    const { withAuditLog } = await import('./audit-log.js')
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('viewer_list-emails', 'viewer', handler)).toBe(handler)
  })

  it('logs viewer tools when MCP_M365_AUDIT_LOG=all', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'all'
    const { withAuditLog } = await import('./audit-log.js')
    const wrapped = withAuditLog('viewer_list-emails', 'viewer', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))
    const event = JSON.parse((await fs.readFile(logPath, 'utf-8')).trim())
    expect(event.role).toBe('viewer')
  })

  it('skips all roles when MCP_M365_AUDIT_LOG=off', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'off'
    const { withAuditLog } = await import('./audit-log.js')
    const editor = vi.fn(async (_args: unknown) => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(withAuditLog('editor_delete-email', 'editor', editor)).toBe(editor)
    await editor({})
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
    const wrapped = withAuditLog('editor_delete-email', 'editor', async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await wrapped({})
    await new Promise((r) => setTimeout(r, 20))

    const mode = (await fs.stat(logPath)).mode & 0o777
    expect(mode.toString(8)).toBe('600')
  })

  it('infers role from tool-name prefix via makeRoleGatedRegister', async () => {
    process.env.MCP_M365_AUDIT_LOG = 'all'
    process.env.MCP_M365_ROLES = 'viewer,editor'
    const { makeRoleGatedRegister } = await import('./roles.js')
    const calls: { name: string; handler: (args: unknown) => Promise<unknown> }[] = []
    const stub = { registerTool: (name: string, _config: unknown, handler: (args: unknown) => Promise<unknown>) => calls.push({ name, handler }) }
    const wrapped = makeRoleGatedRegister(stub as any)
    wrapped('viewer_list-emails', { annotations: { readOnlyHint: true } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('editor_delete-email', { annotations: { readOnlyHint: false } }, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    await calls[0].handler({})
    await calls[1].handler({})
    await new Promise((r) => setTimeout(r, 20))
    const events = (await fs.readFile(logPath, 'utf-8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(events.find((e) => e.tool === 'viewer_list-emails').role).toBe('viewer')
    expect(events.find((e) => e.tool === 'editor_delete-email').role).toBe('editor')
  })

  it('skips registration for disabled roles via makeRoleGatedRegister', async () => {
    process.env.MCP_M365_ROLES = 'viewer'
    const { makeRoleGatedRegister } = await import('./roles.js')
    const calls: { name: string }[] = []
    const stub = { registerTool: (name: string, _config: unknown, _handler: (args: unknown) => Promise<unknown>) => calls.push({ name }) }
    const wrapped = makeRoleGatedRegister(stub as any)
    wrapped('viewer_list-emails', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    wrapped('editor_delete-email', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }))
    expect(calls.map((c) => c.name)).toEqual(['viewer_list-emails'])
  })

  it('throws if tool name has no viewer_/editor_ prefix', async () => {
    process.env.MCP_M365_ROLES = 'viewer,editor'
    const { makeRoleGatedRegister } = await import('./roles.js')
    const stub = { registerTool: () => {} }
    const wrapped = makeRoleGatedRegister(stub as any)
    expect(() => wrapped('list-emails', {}, async () => ({ content: [{ type: 'text', text: 'ok' }] }))).toThrow(/Cannot determine role/)
  })
})
