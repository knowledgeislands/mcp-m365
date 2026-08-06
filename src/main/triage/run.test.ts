import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { getAllFolders } from '../email/folder-utils.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleAgedRun, handleRulesLint, handleTriageRun } from './run.js'
import { readTracking } from './tracking.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('../email/folder-utils.js', () => ({ getAllFolders: vi.fn() }))

const mockCall = callGraphAPI as Mock
const mockGetAllFolders = getAllFolders as Mock

const FOLDERS = [
  { id: 'inbox-id', displayName: 'Inbox', parentFolderId: 'root' },
  { id: 'triage-id', displayName: '_TRIAGE', parentFolderId: 'root' },
  { id: 'unknown-id', displayName: '000 Unknown', parentFolderId: 'triage-id' },
  { id: 'junk-id', displayName: '991 Junk', parentFolderId: 'triage-id' },
  { id: 'emerge-id', displayName: '111 Partner', parentFolderId: 'triage-id' }
]

const RULES = [
  '## Inbound',
  '',
  '```rules v1',
  'sender:*@junk.example -> move:991 Junk',
  'party:*@partner.example.com -> move:111 Partner',
  '* -> move:000 Unknown, suggest',
  '```',
  '',
  '## Aged',
  '',
  '```rules v1',
  'folder:"991 Junk" age:7d !status:flagged -> delete',
  '```'
].join('\n')

const message = (over: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  subject: 'Hello',
  from: { emailAddress: { address: 'sales@junk.example' } },
  receivedDateTime: '2026-08-01T09:00:00Z',
  parentFolderId: 'inbox-id',
  ...over
})

let dir: string
let ctx: { graphApiEndpoint: string; ensureAuthenticated: Mock; trackingPath: string }

beforeEach(async () => {
  vi.clearAllMocks()
  mockGetAllFolders.mockResolvedValue(FOLDERS)
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'triage-run-'))
  ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: vi.fn().mockResolvedValue('token'), trackingPath: path.join(dir, 'tracking.json5') }
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Inbox listing returns `messages`; everything after is a successful no-op. */
const stubInbox = (messages: unknown[]) => {
  mockCall.mockImplementation(async (_endpoint: string, _token: string, method: string, apiPath: string) => {
    if (method === 'GET' && apiPath.endsWith('/messages')) return { value: messages }
    if (method === 'GET' && apiPath.startsWith('me/messages/')) return message()
    if (method === 'POST') return { id: 'msg-moved' }
    return {}
  })
}

describe('handleTriageRun — report mode is the default', () => {
  it('classifies without touching the mailbox', async () => {
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules: RULES })

    expect(result.structuredContent).toMatchObject({ mode: 'report', block: 'inbound', considered: 1, acted: 1, remaining: false, unmatched: 0 })
    expect(result.structuredContent.items[0]).toMatchObject({ destination: '_TRIAGE/991 Junk', ruleset: 'sender:*@junk.example', applied: [] })
    expect(mockCall).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), 'POST', expect.anything(), expect.anything())
  })

  it('writes no tracking entries in report mode', async () => {
    stubInbox([message()])
    await handleTriageRun(ctx, { rules: RULES })
    expect(await readTracking(ctx.trackingPath)).toEqual({ entries: [] })
  })

  it('describes the run in the text block', async () => {
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules: RULES })
    expect(result.content[0].text).toContain('[report] would process 1 of 1 message(s) in the "inbound" pass.')
  })
})

describe('handleTriageRun — live mode', () => {
  it('applies the winning rule and records what it did', async () => {
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules: RULES, mode: 'live' })

    expect(result.structuredContent.items[0].applied).toEqual([{ action: 'move:_TRIAGE/991 Junk', ok: true }])
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'token', 'POST', 'me/messages/msg-1/move', { destinationId: 'junk-id' })
  })

  it('records a tracking entry keyed on identity, not the Graph id', async () => {
    stubInbox([message()])
    await handleTriageRun(ctx, { rules: RULES, mode: 'live' })

    const { entries } = await readTracking(ctx.trackingPath)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      subject: 'Hello',
      from: 'sales@junk.example',
      received: '2026-08-01T09:00:00Z',
      ruleset: 'sender:*@junk.example',
      routed_to: '991 Junk',
      destination: '_TRIAGE/991 Junk',
      triage_folder: '991 Junk'
    })
  })

  it('does not record a tracking entry when an action failed', async () => {
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [message()] }
      if (method === 'GET') return message()
      throw new Error('Graph is down')
    })
    const result = await handleTriageRun(ctx, { rules: RULES, mode: 'live' })

    expect(result.structuredContent.items[0].applied[0].ok).toBe(false)
    expect(result.content[0].text).toContain('FAILED (Graph is down)')
    expect(await readTracking(ctx.trackingPath)).toEqual({ entries: [] })
  })

  it('is idempotent — a second run over an emptied Inbox does nothing', async () => {
    stubInbox([])
    const result = await handleTriageRun(ctx, { rules: RULES, mode: 'live' })
    expect(result.structuredContent).toMatchObject({ considered: 0, acted: 0, remaining: false })
  })
})

describe('handleTriageRun — batch bounding', () => {
  it('acts on at most maxActions messages and reports that more remain', async () => {
    stubInbox([message({ id: 'a' }), message({ id: 'b' }), message({ id: 'c' })])
    const result = await handleTriageRun(ctx, { rules: RULES, maxActions: 2 })
    expect(result.structuredContent).toMatchObject({ considered: 2, acted: 2, remaining: true })
    expect(result.content[0].text).toContain('More remain — call again.')
  })

  it('asks Graph for one more than the batch so it can tell whether more remain', async () => {
    stubInbox([])
    await handleTriageRun(ctx, { rules: RULES, maxActions: 5 })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'token', 'GET', 'me/mailFolders/inbox-id/messages', null, expect.objectContaining({ $top: 6 }))
  })

  it('defaults to 50', async () => {
    stubInbox([])
    await handleTriageRun(ctx, { rules: RULES })
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'token', 'GET', 'me/mailFolders/inbox-id/messages', null, expect.objectContaining({ $top: 51 }))
  })
})

describe('handleTriageRun — refusals', () => {
  it('refuses to run a rule file that will not parse', async () => {
    const result = await handleTriageRun(ctx, { rules: '## Inbound\n\n```rules v1\ntheme:x -> move:A\n* -> move:000 Unknown\n```' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Refusing to run')
    expect(result.content[0].text).toContain('unknown predicate key "theme"')
  })

  it('refuses to run a rule file whose fence was never closed', async () => {
    const result = await handleTriageRun(ctx, { rules: '## Inbound\n\n```rules v1\nsender:*@x.com -> move:A\n* -> move:000 Unknown, suggest' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('unterminated ```rules block')
  })

  it('refuses to run without a fallback, so no message can be silently unclassified', async () => {
    const result = await handleTriageRun(ctx, { rules: '## Inbound\n\n```rules v1\nsender:*@x.com -> move:A\n```' })
    expect(result.content[0].text).toContain('missing-fallback')
  })

  it('refuses when no rules were supplied at all', async () => {
    expect((await handleTriageRun(ctx, {})).isError).toBe(true)
  })

  it('reports when the requested block is absent', async () => {
    const rules = '## Archive\n\n```rules v1\n* -> move:000 Unknown, suggest\n```\n\n## Aged\n\n```rules v1\nfolder:"x" -> delete\n```'
    expect((await handleTriageRun(ctx, { rules })).content[0].text).toContain('no "inbound" rules block found')
  })

  it('does not run when shadowing is present, but reports it as a warning', async () => {
    const rules = [
      '## Inbound',
      '',
      '```rules v1',
      'sender:*@x.com -> move:991 Junk',
      'sender:a@x.com -> move:111 Partner',
      '* -> move:000 Unknown, suggest',
      '```'
    ].join('\n')
    stubInbox([])
    const result = await handleTriageRun(ctx, { rules })
    expect(result.isError).toBeUndefined()
    expect(result.structuredContent.warnings.join('\n')).toContain('shadowed-rule')
  })

  it('surfaces an authentication failure as an error envelope', async () => {
    ctx.ensureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const result = await handleTriageRun(ctx, { rules: RULES })
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain('Error running triage: Authentication required')
  })

  it('appends the re-authentication hint on a 401, as every tool in this server must', async () => {
    ctx.ensureAuthenticated.mockRejectedValue(new Error('API call failed with status 401'))
    expect((await handleTriageRun(ctx, { rules: RULES })).content[0].text).toContain('m365_auth_start')
  })

  it('reports nothing to do when the mailbox has no Inbox folder', async () => {
    mockGetAllFolders.mockResolvedValue([])
    const result = await handleTriageRun(ctx, { rules: RULES })
    expect(result.structuredContent).toMatchObject({ considered: 0, acted: 0 })
  })
})

describe('handleTriageRun — reporting', () => {
  it('counts messages that match no rule when the block has no fallback', async () => {
    // The aged block has no fallback by design, so route an unmatched message through it.
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath === 'me/mailFolders/junk-id/messages') return { value: [message({ parentFolderId: 'junk-id' })] }
      if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [] }
      return {}
    })
    const result = await handleAgedRun(ctx, { rules: RULES })
    expect(result.structuredContent.unmatched).toBe(1)
    expect(result.content[0].text).toContain('matched no rule')
  })

  it('describes a rule that neither moves nor deletes', async () => {
    const rules = '## Inbound\n\n```rules v1\nsender:*@junk.example -> mark:read\n* -> move:000 Unknown, suggest\n```'
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules })
    expect(result.structuredContent.items[0].destination).toBe('(no move)')
  })

  it('records a tracking entry for a message Graph gave no id for', async () => {
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [{ ...message(), id: undefined }] }
      if (method === 'GET') return { ...message(), id: undefined }
      if (method === 'POST') return { id: 'msg-moved' }
      return {}
    })
    await handleTriageRun(ctx, { rules: RULES, mode: 'live' })
    const { entries } = await readTracking(ctx.trackingPath)
    expect(entries[0]).toBeDefined()
    expect(entries[0]?.id).toBeUndefined()
  })

  it('skips a rule whose only action is suggest', async () => {
    const rules = '## Inbound\n\n```rules v1\nsender:*@junk.example -> suggest\n* -> move:000 Unknown, suggest\n```'
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules })
    expect(result.structuredContent).toMatchObject({ considered: 1, acted: 0 })
  })
})

describe('handleAgedRun', () => {
  it('walks the _TRIAGE subfolders and classifies against the aged block', async () => {
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath === 'me/mailFolders/junk-id/messages') {
        return { value: [message({ receivedDateTime: '2020-01-01T00:00:00Z', flag: { flagStatus: 'notFlagged' } })] }
      }
      if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [] }
      if (method === 'GET') return message({ receivedDateTime: '2020-01-01T00:00:00Z' })
      return {}
    })

    const result = await handleAgedRun(ctx, { rules: RULES, mode: 'live' })
    expect(result.structuredContent).toMatchObject({ block: 'aged', acted: 1 })
    expect(result.structuredContent.items[0].destination).toBe('(deleted)')
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'token', 'DELETE', 'me/messages/msg-1')
  })

  it('stops collecting once the batch is full and reports that more remain', async () => {
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath.endsWith('/messages')) {
        return { value: [message({ receivedDateTime: '2020-01-01T00:00:00Z', flag: { flagStatus: 'notFlagged' } })] }
      }
      return {}
    })
    const result = await handleAgedRun(ctx, { rules: RULES, maxActions: 1 })
    expect(result.structuredContent.remaining).toBe(true)
  })

  it('surfaces a Graph failure as an error envelope', async () => {
    mockGetAllFolders.mockRejectedValue(new Error('Graph unreachable'))
    const result = await handleAgedRun(ctx, { rules: RULES })
    expect(result.content[0].text).toContain('Error running the aged pass: Graph unreachable')
  })
})

describe('handleRulesLint', () => {
  it('summarises the blocks and finding counts', async () => {
    const result = await handleRulesLint(ctx, { rules: RULES })
    expect(result.content[0].text).toContain('Parsed blocks: inbound (3 rules), aged (1 rules)')
    expect(result.content[0].text).toContain('0 error, 0 warning, 0 info')
  })

  it('notes when no folder taxonomy was supplied', async () => {
    expect((await handleRulesLint(ctx, { rules: RULES })).content[0].text).toContain('no knownFolders supplied')
  })

  it('checks move targets when a taxonomy is supplied', async () => {
    const result = await handleRulesLint(ctx, { rules: RULES, knownFolders: ['_TRIAGE/991 Junk', '_TRIAGE/111 Partner', '_TRIAGE/000 Unknown'] })
    expect(result.content[0].text).not.toContain('no knownFolders supplied')
    expect(result.content[0].text).toContain('0 error')
  })

  it('reports findings with their source line', async () => {
    const result = await handleRulesLint(ctx, { rules: '## Inbound\n\n```rules v1\nsender:db.example.net -> move:A\n* -> move:000 Unknown, suggest\n```' })
    expect(result.content[0].text).toContain('malformed-address')
    expect(result.content[0].text).toContain('sender:db.example.net -> move:A')
  })

  it('reports a source with no rules at all', async () => {
    expect((await handleRulesLint(ctx, {})).content[0].text).toContain('Parsed blocks: none')
  })

  it('ignores a knownFolders value that is not an array', async () => {
    expect((await handleRulesLint(ctx, { rules: RULES, knownFolders: 'nope' })).content[0].text).toContain('no knownFolders supplied')
  })
})
