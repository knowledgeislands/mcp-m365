import type { McpServer } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { registerEmailTools } from '../../tools/email/index.js'
import { makeAccessGatedRegister } from '../../utils/access-level.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleReplyEmail } from './reply.js'

vi.mock('../graph-client/index.js')

const graph = vi.mocked(callGraphAPI)
const ensureAuthenticated = vi.fn()
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated }

beforeEach(() => {
  graph.mockReset()
  ensureAuthenticated.mockReset()
  ensureAuthenticated.mockResolvedValue('fixture-token')
})

describe('handleReplyEmail', () => {
  it.each(['reply', 'replyAll'] as const)('previews %s with one GET and no mutation', async (kind) => {
    graph.mockResolvedValue({ id: 'm1', subject: 'Alpha planning' })
    const result = await handleReplyEmail(ctx, { id: 'm1', comment: 'Confirmed.' }, kind)
    expect(result.content[0]?.text).toContain('[dry_run]')
    expect(result.content[0]?.text).toContain(kind === 'replyAll' ? 'reply to all' : 'reply')
    expect(graph).toHaveBeenCalledExactlyOnceWith(GRAPH_API_ENDPOINT, 'fixture-token', 'GET', 'me/messages/m1', null, {
      $select: 'id,subject,from,receivedDateTime'
    })
  })

  it('uses an empty subject when preview metadata lacks one', async () => {
    graph.mockResolvedValue({ id: 'm1' })
    const result = await handleReplyEmail(ctx, { id: 'm1', comment: 'Confirmed.', dry_run: true }, 'reply')
    expect(result.content[0]?.text).toContain('subject: ')
  })

  it.each(['reply', 'replyAll'] as const)(
    'sends %s once only with a comment and describes acceptance',
    async (kind) => {
      graph.mockResolvedValue({})
      const result = await handleReplyEmail(ctx, { id: 'm1', comment: 'Confirmed.', dry_run: false }, kind)
      expect(graph).toHaveBeenCalledExactlyOnceWith(
        GRAPH_API_ENDPOINT,
        'fixture-token',
        'POST',
        `me/messages/m1/${kind}`,
        { comment: 'Confirmed.' }
      )
      expect(result.content[0]?.text).toContain('accepted for delivery')
      expect(result.content[0]?.text).toContain('not a delivery receipt')
    }
  )

  it('rejects a missing ID and blank comment before authentication', async () => {
    expect((await handleReplyEmail(ctx, { id: '', comment: 'ok' }, 'reply')).content[0]?.text).toContain(
      'ID is required'
    )
    expect((await handleReplyEmail(ctx, { id: 'm1', comment: '  ' }, 'reply')).content[0]?.text).toContain(
      'comment is required'
    )
    expect(
      (await handleReplyEmail(ctx, { id: 'm1', comment: undefined as unknown as string }, 'reply')).content[0]?.text
    ).toContain('comment is required')
    expect(ensureAuthenticated).not.toHaveBeenCalled()
    expect(graph).not.toHaveBeenCalled()
  })

  it.each(['Authentication required', 'UNAUTHORIZED'])('maps %s to the auth guidance', async (message) => {
    ensureAuthenticated.mockRejectedValue(new Error(message))
    const result = await handleReplyEmail(ctx, { id: 'm1', comment: 'ok', dry_run: false }, 'reply')
    expect(result.content[0]?.text).toContain('m365_auth_start')
    expect(graph).not.toHaveBeenCalled()
  })

  it('maps provider errors without retrying', async () => {
    graph.mockRejectedValue(new Error('provider failed'))
    const result = await handleReplyEmail(ctx, { id: 'm1', comment: 'ok', dry_run: false }, 'replyAll')
    expect(result.content[0]?.text).toContain('Failed to reply to all: provider failed')
    expect(graph).toHaveBeenCalledTimes(1)
  })

  it('maps non-Error failures without exposing a token', async () => {
    graph.mockRejectedValue('unavailable')
    const result = await handleReplyEmail(ctx, { id: 'm1', comment: 'ok', dry_run: false }, 'reply')
    expect(result.content[0]?.text).toContain('Failed to reply: unavailable')
    expect(result.content[0]?.text).not.toContain('fixture-token')
  })
})

describe('reply tool registration', () => {
  const registrations = (level: 'read' | 'write') => {
    const calls: Array<{ name: string; config: { inputSchema: z.ZodType; annotations: object } }> = []
    const server = {
      registerTool: (name: string, config: { inputSchema: z.ZodType; annotations: object }) => {
        calls.push({ name, config })
      }
    } as unknown as McpServer
    server.registerTool = makeAccessGatedRegister(server, level, {
      mode: 'off',
      path: '/tmp/unused-m365-reply-audit',
      maxBytes: 0,
      keep: 0
    })
    registerEmailTools(server, ctx)
    return calls
  }

  it('shows both actions at write access and hides them at read access', () => {
    const names = (level: 'read' | 'write') => registrations(level).map(({ name }) => name)
    expect(names('write')).toEqual(expect.arrayContaining(['m365_email_message_reply', 'm365_email_message_reply_all']))
    expect(names('read')).not.toContain('m365_email_message_reply')
    expect(names('read')).not.toContain('m365_email_message_reply_all')
  })

  it('requires a bounded comment and valid ID, rejects message overrides, and defaults to preview', () => {
    for (const name of ['m365_email_message_reply', 'm365_email_message_reply_all']) {
      const schema = registrations('write').find((call) => call.name === name)?.config.inputSchema
      expect(schema?.safeParse({ id: 'm1', comment: 'Confirmed.' }).data).toEqual({
        id: 'm1',
        comment: 'Confirmed.',
        dry_run: true
      })
      for (const invalid of [
        { id: '', comment: 'Confirmed.' },
        { id: '../other', comment: 'Confirmed.' },
        { id: 'm1', comment: '' },
        { id: 'm1', comment: 'x'.repeat(10001) },
        { id: 'm1', comment: 'Confirmed.', message: { toRecipients: [] } }
      ])
        expect(schema?.safeParse(invalid).success).toBe(false)
    }
  })
})
