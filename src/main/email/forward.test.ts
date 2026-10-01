import type { McpServer } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { registerEmailTools } from '../../tools/email/index.js'
import { makeAccessGatedRegister } from '../../utils/access-level.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleForwardEmail } from './forward.js'

vi.mock('../graph-client/index.js')

const graph = vi.mocked(callGraphAPI)
const ensureAuthenticated = vi.fn()
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated }
const recipients = ['alpha@example.com', 'beta@example.com']

beforeEach(() => {
  graph.mockReset()
  ensureAuthenticated.mockReset()
  ensureAuthenticated.mockResolvedValue('fixture-token')
})

describe('handleForwardEmail', () => {
  it('previews with one GET and no mutation by default', async () => {
    graph.mockResolvedValue({ id: 'm1', subject: 'Alpha update' })
    const result = await handleForwardEmail(ctx, { id: 'm1', recipients })
    expect(result.content[0]?.text).toContain('[dry_run]')
    expect(result.content[0]?.text).toContain('2 recipient(s)')
    expect(graph).toHaveBeenCalledExactlyOnceWith(GRAPH_API_ENDPOINT, 'fixture-token', 'GET', 'me/messages/m1', null, {
      $select: 'id,subject'
    })
  })

  it('handles a preview without a subject', async () => {
    graph.mockResolvedValue({ id: 'm1' })
    const result = await handleForwardEmail(ctx, { id: 'm1', recipients, dry_run: true })
    expect(result.content[0]?.text).toContain('subject: ')
  })

  it('forwards once with Graph-owned original content and a comment', async () => {
    graph.mockResolvedValue({})
    const result = await handleForwardEmail(ctx, { id: 'm1', recipients, comment: 'FYI', dry_run: false })
    expect(graph).toHaveBeenCalledExactlyOnceWith(
      GRAPH_API_ENDPOINT,
      'fixture-token',
      'POST',
      'me/messages/m1/forward',
      {
        toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
        comment: 'FYI'
      }
    )
    expect(result.content[0]?.text).toContain('accepted for delivery')
    expect(result.content[0]?.text).toContain('not a delivery receipt')
  })

  it('omits the optional comment', async () => {
    graph.mockResolvedValue({})
    await handleForwardEmail(ctx, { id: 'm1', recipients, dry_run: false })
    expect(graph).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'fixture-token', 'POST', 'me/messages/m1/forward', {
      toRecipients: recipients.map((address) => ({ emailAddress: { address } }))
    })
  })

  it('rejects a missing ID before authentication', async () => {
    const result = await handleForwardEmail(ctx, { id: '', recipients })
    expect(result).toHaveProperty('isError', true)
    expect(ensureAuthenticated).not.toHaveBeenCalled()
  })

  it.each([undefined, [], Array.from({ length: 51 }, () => 'alpha@example.com'), ['bad\n@example.com']])(
    'rejects invalid recipients before authentication',
    async (value) => {
      const result = await handleForwardEmail(ctx, { id: 'm1', recipients: value as string[] })
      expect(result).toHaveProperty('isError', true)
      expect(ensureAuthenticated).not.toHaveBeenCalled()
      expect(graph).not.toHaveBeenCalled()
    }
  )

  it('rejects an overlong comment before authentication', async () => {
    const result = await handleForwardEmail(ctx, { id: 'm1', recipients, comment: 'x'.repeat(10001) })
    expect(result).toHaveProperty('isError', true)
    expect(ensureAuthenticated).not.toHaveBeenCalled()
  })

  it.each(['Authentication required', 'UNAUTHORIZED'])('maps %s to authentication guidance', async (message) => {
    ensureAuthenticated.mockRejectedValue(new Error(message))
    const result = await handleForwardEmail(ctx, { id: 'm1', recipients })
    expect(result.content[0]?.text).toContain('m365_auth_start')
  })

  it('reports a provider failure without retrying', async () => {
    graph.mockRejectedValue(new Error('provider failed'))
    const result = await handleForwardEmail(ctx, { id: 'm1', recipients, dry_run: false })
    expect(result.content[0]?.text).toContain('Failed to forward email: provider failed')
    expect(graph).toHaveBeenCalledTimes(1)
  })

  it('reports a non-Error rejection without leaking credentials', async () => {
    graph.mockRejectedValue('unavailable')
    const result = await handleForwardEmail(ctx, { id: 'm1', recipients, dry_run: false })
    expect(result.content[0]?.text).toContain('unavailable')
    expect(result.content[0]?.text).not.toContain('fixture-token')
  })
})

describe('forward registration', () => {
  const registrations = (level: 'read' | 'write') => {
    const calls: Array<{ name: string; config: { inputSchema: z.ZodType } }> = []
    const server = {
      registerTool: (name: string, config: { inputSchema: z.ZodType }) => calls.push({ name, config })
    } as unknown as McpServer
    server.registerTool = makeAccessGatedRegister(server, level, {
      mode: 'off',
      path: '/tmp/unused-m365-forward-audit',
      maxBytes: 0,
      keep: 0
    })
    registerEmailTools(server, ctx)
    return calls
  }

  it('is visible at write access, not read access', () => {
    expect(registrations('write').some((call) => call.name === 'm365_email_message_forward')).toBe(true)
    expect(registrations('read').some((call) => call.name === 'm365_email_message_forward')).toBe(false)
  })

  it('requires a valid ID and bounded recipient array, rejects overrides, and defaults to preview', () => {
    const schema = registrations('write').find((call) => call.name === 'm365_email_message_forward')?.config.inputSchema
    expect(schema?.safeParse({ id: 'm1', recipients }).data).toEqual({ id: 'm1', recipients, dry_run: true })
    for (const invalid of [
      { id: '', recipients },
      { id: '../other', recipients },
      { id: 'm1', recipients: [] },
      { id: 'm1', recipients: ['bad\n@example.com'] },
      { id: 'm1', recipients: Array.from({ length: 51 }, () => 'alpha@example.com') },
      { id: 'm1', recipients, comment: 'x'.repeat(10001) },
      { id: 'm1', recipients, message: { body: 'override' } }
    ])
      expect(schema?.safeParse(invalid).success).toBe(false)
  })
})
