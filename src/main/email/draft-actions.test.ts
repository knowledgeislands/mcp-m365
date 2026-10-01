import type { McpServer } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { z } from 'zod'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { registerEmailTools } from '../../tools/email/index.js'
import { makeAccessGatedRegister } from '../../utils/access-level.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleDraftAction } from './draft-actions.js'

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

describe('message-scoped draft actions', () => {
  it.each(['createReply', 'createReplyAll', 'createForward'] as const)('previews %s without a POST', async (action) => {
    graph.mockResolvedValue({ id: 'm1', subject: 'Alpha update' })
    const result = await handleDraftAction(
      ctx,
      { id: 'm1', comment: 'Please review.', ...(action === 'createForward' ? { recipients } : {}) },
      action
    )
    expect(result).toHaveProperty('structuredContent', {
      dry_run: true,
      action,
      originalMessageId: 'm1',
      draftId: null,
      subject: null
    })
    expect(result.content[0]?.text).toContain('Alpha update')
    expect(graph).toHaveBeenCalledExactlyOnceWith(GRAPH_API_ENDPOINT, 'fixture-token', 'GET', 'me/messages/m1', null, {
      $select: 'id,subject'
    })
  })

  it('previews an original without a subject', async () => {
    graph.mockResolvedValue({ id: 'm1' })
    const result = await handleDraftAction(ctx, { id: 'm1', dry_run: true }, 'createReply')
    expect(result.content[0]?.text).toContain('subject: ')
  })

  it.each(['createReply', 'createReplyAll'] as const)(
    'creates a %s draft without replacing the Graph body',
    async (action) => {
      graph.mockResolvedValue({ id: 'draft-1', subject: 'Re: Alpha', body: { content: 'Graph quote retained' } })
      const result = await handleDraftAction(ctx, { id: 'm1', comment: 'Please review.', dry_run: false }, action)
      expect(graph).toHaveBeenCalledExactlyOnceWith(
        GRAPH_API_ENDPOINT,
        'fixture-token',
        'POST',
        `me/messages/m1/${action}`,
        { comment: 'Please review.' }
      )
      expect(result).toHaveProperty('structuredContent', {
        dry_run: false,
        action,
        originalMessageId: 'm1',
        draftId: 'draft-1',
        subject: 'Re: Alpha'
      })
      expect(result.content[0]?.text).toContain('not sent')
    }
  )

  it('creates a reply draft without a request body when no comment is supplied', async () => {
    graph.mockResolvedValue({ id: 'draft-1', subject: 'Re: Alpha' })
    await handleDraftAction(ctx, { id: 'm1', dry_run: false }, 'createReply')
    expect(graph).toHaveBeenCalledExactlyOnceWith(
      GRAPH_API_ENDPOINT,
      'fixture-token',
      'POST',
      'me/messages/m1/createReply',
      null
    )
  })

  it('creates a forward draft with validated recipients and an optional comment', async () => {
    graph.mockResolvedValue({ id: 'draft-2', subject: 'Fw: Alpha' })
    const result = await handleDraftAction(
      ctx,
      { id: 'm1', recipients, comment: 'FYI', dry_run: false },
      'createForward'
    )
    expect(graph).toHaveBeenCalledExactlyOnceWith(
      GRAPH_API_ENDPOINT,
      'fixture-token',
      'POST',
      'me/messages/m1/createForward',
      {
        message: { toRecipients: recipients.map((address) => ({ emailAddress: { address } })) },
        comment: 'FYI'
      }
    )
    expect(result).toHaveProperty(
      'structuredContent',
      expect.objectContaining({ draftId: 'draft-2', subject: 'Fw: Alpha' })
    )
  })

  it('omits a forward comment and tolerates a missing subject in the Graph response', async () => {
    graph.mockResolvedValue({ id: 'draft-2' })
    const result = await handleDraftAction(ctx, { id: 'm1', recipients, dry_run: false }, 'createForward')
    expect(graph).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'fixture-token', 'POST', 'me/messages/m1/createForward', {
      message: { toRecipients: recipients.map((address) => ({ emailAddress: { address } })) }
    })
    expect(result).toHaveProperty('structuredContent', expect.objectContaining({ draftId: 'draft-2', subject: '' }))
  })

  it.each([{}, { id: 'm1', comment: 'x'.repeat(10001) }])(
    'rejects missing ID or overlong comment before auth',
    async (input) => {
      const result = await handleDraftAction(ctx, { id: '', ...input }, 'createReply')
      expect(result).toHaveProperty('isError', true)
      expect(ensureAuthenticated).not.toHaveBeenCalled()
    }
  )

  it.each([undefined, [], Array.from({ length: 51 }, () => 'alpha@example.com'), ['bad\n@example.com']])(
    'rejects invalid forwarding recipients before auth',
    async (value) => {
      const result = await handleDraftAction(ctx, { id: 'm1', recipients: value }, 'createForward')
      expect(result).toHaveProperty('isError', true)
      expect(ensureAuthenticated).not.toHaveBeenCalled()
      expect(graph).not.toHaveBeenCalled()
    }
  )

  it('rejects recipient overrides on replies before auth', async () => {
    const result = await handleDraftAction(ctx, { id: 'm1', recipients }, 'createReplyAll')
    expect(result).toHaveProperty('isError', true)
    expect(ensureAuthenticated).not.toHaveBeenCalled()
  })

  it.each([undefined, ''])(
    'reports a created draft with a missing ID instead of inviting an unsafe retry',
    async (id) => {
      graph.mockResolvedValue({ id })
      const result = await handleDraftAction(ctx, { id: 'm1', dry_run: false }, 'createReply')
      expect(result).toHaveProperty('isError', true)
      expect(result.content[0]?.text).toContain('inspect Outlook drafts before retrying')
    }
  )

  it.each(['Authentication required', 'UNAUTHORIZED'])('maps %s to authentication guidance', async (message) => {
    ensureAuthenticated.mockRejectedValue(new Error(message))
    const result = await handleDraftAction(ctx, { id: 'm1' }, 'createReply')
    expect(result.content[0]?.text).toContain('m365_auth_start')
  })

  it('identifies a permission failure as a Mail.ReadWrite concern', async () => {
    graph.mockRejectedValue(new Error('API call failed with status 403'))
    const result = await handleDraftAction(ctx, { id: 'm1', dry_run: false }, 'createReply')
    expect(result.content[0]?.text).toContain('Mail.ReadWrite consent')
  })

  it('surfaces a provider error without leaking a token', async () => {
    graph.mockRejectedValue(new Error('provider unavailable'))
    const result = await handleDraftAction(ctx, { id: 'm1', dry_run: false }, 'createReply')
    expect(result.content[0]?.text).toContain('provider unavailable')
    expect(result.content[0]?.text).not.toContain('fixture-token')
  })

  it('handles a non-Error rejection', async () => {
    graph.mockRejectedValue('unavailable')
    const result = await handleDraftAction(ctx, { id: 'm1', dry_run: false }, 'createReply')
    expect(result.content[0]?.text).toContain('unavailable')
  })
})

describe('draft action registration', () => {
  const registrations = (level: 'read' | 'write') => {
    const calls: Array<{ name: string; config: { inputSchema: z.ZodType; outputSchema?: z.ZodType } }> = []
    const server = {
      registerTool: (name: string, config: { inputSchema: z.ZodType; outputSchema?: z.ZodType }) =>
        calls.push({ name, config })
    } as unknown as McpServer
    server.registerTool = makeAccessGatedRegister(server, level, {
      mode: 'off',
      path: '/tmp/unused-m365-draft-audit',
      maxBytes: 0,
      keep: 0
    })
    registerEmailTools(server, ctx)
    return calls
  }

  it('registers three write-level draft actions', () => {
    const names = ['m365_email_draft_reply', 'm365_email_draft_reply_all', 'm365_email_draft_forward']
    for (const name of names) {
      expect(registrations('write').some((call) => call.name === name)).toBe(true)
      expect(registrations('read').some((call) => call.name === name)).toBe(false)
    }
  })

  it('enforces strict IDs, bounded comments and recipients, and a default preview', () => {
    for (const [name, action] of [
      ['m365_email_draft_reply', 'createReply'],
      ['m365_email_draft_reply_all', 'createReplyAll'],
      ['m365_email_draft_forward', 'createForward']
    ] as const) {
      const config = registrations('write').find((call) => call.name === name)?.config
      const valid = { id: 'm1', comment: 'hi', ...(action === 'createForward' ? { recipients } : {}) }
      expect(config?.inputSchema.safeParse(valid).data).toMatchObject({ ...valid, dry_run: true })
      expect(config?.inputSchema.safeParse({ ...valid, id: '../other' }).success).toBe(false)
      expect(config?.inputSchema.safeParse({ ...valid, comment: 'x'.repeat(10001) }).success).toBe(false)
      expect(config?.inputSchema.safeParse({ ...valid, message: { body: 'override' } }).success).toBe(false)
      expect(
        config?.outputSchema?.safeParse({
          dry_run: false,
          action,
          originalMessageId: 'm1',
          draftId: 'd1',
          subject: 's'
        }).success
      ).toBe(true)
    }
    const forward = registrations('write').find((call) => call.name === 'm365_email_draft_forward')?.config.inputSchema
    expect(forward?.safeParse({ id: 'm1', recipients: [] }).success).toBe(false)
    expect(forward?.safeParse({ id: 'm1', recipients: ['bad\n@example.com'] }).success).toBe(false)
    expect(
      forward?.safeParse({ id: 'm1', recipients: Array.from({ length: 51 }, () => 'alpha@example.com') }).success
    ).toBe(false)
  })
})
