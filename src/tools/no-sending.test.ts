/**
 * The server is draft-only: no registered tool may send mail or a calendar
 * response. Every tool group registers through the access gate at every access
 * level — `destructive` is the widest, and no other configuration adds tools —
 * and the surface must hold no sending tool. Registration only: no handler runs.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'
import { ACCESS_LEVELS, type AccessLevel, type Config } from '../config/index.js'
import type TokenStorage from '../main/auth/index.js'
import type { GraphContext } from '../main/graph-client/index.js'
import type { TriageContext } from '../main/triage/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'
import {
  registerAuthTools,
  registerCalendarTools,
  registerEmailTools,
  registerFolderTools,
  registerOnedriveTools,
  registerRulesTools,
  registerTriageTools
} from './index.js'

const registeredAt = (level: AccessLevel): Map<string, { inputSchema?: z.ZodType }> => {
  const tools = new Map<string, { inputSchema?: z.ZodType }>()
  const server = {
    registerTool: (name: string, config: { inputSchema?: z.ZodType }) => {
      tools.set(name, config)
    }
  } as unknown as McpServer
  server.registerTool = makeAccessGatedRegister(server, level, {
    mode: 'off',
    path: '/nonexistent/audit.jsonl',
    maxBytes: 1,
    keep: 1
  })
  const ctx = {} as GraphContext
  registerAuthTools(server, {} as Config, {} as TokenStorage)
  registerCalendarTools(server, ctx)
  registerEmailTools(server, ctx)
  registerFolderTools(server, ctx)
  registerOnedriveTools(server, ctx)
  registerRulesTools(server, ctx)
  registerTriageTools(server, {} as TriageContext)
  return tools
}

// A sending verb as a whole name segment. The reply and forward draft tools save
// a draft only and are the one sanctioned use of those verbs; a draft tool that
// sends, such as a `_draft_send`, is still caught.
const SENDING = /(^|_)(send|reply|reply_all|forward|accept|decline|cancel|tentative|respond|invite)(_|$)/
const isSending = (name: string) => SENDING.test(name) && !/^m365_email_draft_(reply|reply_all|forward)$/.test(name)

describe('the draft-only tool surface', () => {
  it.each(ACCESS_LEVELS)('registers no sending tool at the %s access level', (level) => {
    const names = [...registeredAt(level).keys()]
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter(isSending)).toEqual([])
  })

  it('keeps the four draft tools at the write level', () => {
    const names = [...registeredAt('write').keys()]
    expect(names).toEqual(
      expect.arrayContaining([
        'm365_email_draft_create',
        'm365_email_draft_reply',
        'm365_email_draft_reply_all',
        'm365_email_draft_forward'
      ])
    )
  })

  it.each([
    'm365_email_message_send',
    'm365_email_draft_send',
    'm365_email_message_reply',
    'm365_email_message_reply_all',
    'm365_email_message_forward',
    'm365_calendar_event_accept',
    'm365_calendar_event_decline',
    'm365_calendar_event_cancel'
  ])('the pattern recognises a sending name such as %s', (name) => {
    expect(isSending(name)).toBe(true)
  })

  it('refuses attendees on m365_calendar_event_create at the tool boundary', () => {
    const schema = registeredAt('destructive').get('m365_calendar_event_create')?.inputSchema
    const event = { subject: 'Focus', start: '2026-01-01T09:00:00', end: '2026-01-01T10:00:00' }
    expect(schema?.safeParse(event).success).toBe(true)
    expect(schema?.safeParse({ ...event, attendees: ['a@example.com'] }).success).toBe(false)
  })
})
