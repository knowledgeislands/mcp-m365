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
let ctx: {
  graphApiEndpoint: string
  ensureAuthenticated: Mock
  roots: string[]
  trackingPath: string
  rulesPath: string
  attachmentRoots: string[]
  saveAttachments?: Mock
}

beforeEach(async () => {
  vi.clearAllMocks()
  mockGetAllFolders.mockResolvedValue(FOLDERS)
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'triage-run-')))
  ctx = {
    graphApiEndpoint: GRAPH_API_ENDPOINT,
    ensureAuthenticated: vi.fn().mockResolvedValue('token'),
    roots: [dir],
    trackingPath: path.join(dir, 'tracking.json5'),
    rulesPath: '',
    attachmentRoots: [dir]
  }
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

    expect(result.structuredContent).toMatchObject({
      mode: 'report',
      block: 'inbound',
      considered: 1,
      acted: 1,
      remaining: false,
      unmatched: 0
    })
    expect(result.structuredContent.items[0]).toMatchObject({
      destination: '_TRIAGE/991 Junk',
      ruleset: 'sender:*@junk.example',
      applied: []
    })
    expect(mockCall).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'POST',
      expect.anything(),
      expect.anything()
    )
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
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'token', 'POST', 'me/messages/msg-1/move', {
      destinationId: 'junk-id'
    })
  })

  it('records a tracking entry keyed on identity, not the Graph id', async () => {
    stubInbox([message()])
    await handleTriageRun(ctx, { rules: RULES, mode: 'live' })

    const entries = (await readTracking(ctx.trackingPath))?.entries ?? []
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
    expect(mockCall).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
      'token',
      'GET',
      'me/mailFolders/inbox-id/messages',
      null,
      expect.objectContaining({ $top: 6 })
    )
  })

  it('defaults to 50', async () => {
    stubInbox([])
    await handleTriageRun(ctx, { rules: RULES })
    expect(mockCall).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
      'token',
      'GET',
      'me/mailFolders/inbox-id/messages',
      null,
      expect.objectContaining({ $top: 51 })
    )
  })
})

describe('rules from the configured note', () => {
  const configured = async (contents: string) => {
    const file = path.join(dir, 'Email Routing Rules.md')
    await fs.writeFile(file, contents)
    ctx.rulesPath = file
    return file
  }

  it('reads the note when the caller passes no rules', async () => {
    await configured(RULES)
    stubInbox([message()])
    const result = await handleTriageRun(ctx, {})
    expect(result.structuredContent).toMatchObject({ block: 'inbound', considered: 1, acted: 1 })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/991 Junk')
  })

  it('prefers rules passed in the call over the configured note', async () => {
    await configured('## Inbound\n\n```rules v1\n* -> move:000 Unknown, suggest\n```')
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules: RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/991 Junk')
  })

  it('treats a blank rules argument as absent', async () => {
    await configured(RULES)
    stubInbox([message()])
    expect((await handleTriageRun(ctx, { rules: '   ' })).structuredContent.items[0].destination).toBe(
      '_TRIAGE/991 Junk'
    )
  })

  it('picks up an edit to the note without a restart', async () => {
    const file = await configured(RULES)
    stubInbox([message()])
    expect((await handleTriageRun(ctx, {})).structuredContent.items[0].destination).toBe('_TRIAGE/991 Junk')

    await fs.writeFile(file, '## Inbound\n\n```rules v1\n* -> move:000 Unknown, suggest\n```')
    expect((await handleTriageRun(ctx, {})).structuredContent.items[0].destination).toBe('_TRIAGE/000 Unknown')
  })

  it('serves the aged block from the note too', async () => {
    await configured(RULES)
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [] }
      return {}
    })
    expect((await handleAgedRun(ctx, {})).structuredContent.block).toBe('aged')
  })

  it('lints the note when no rules are passed', async () => {
    await configured(RULES)
    expect((await handleRulesLint(ctx, {})).content[0].text).toContain(
      'Parsed blocks: inbound (3 rules), aged (1 rules)'
    )
  })

  it('names all three ways to supply rules when none is available', async () => {
    const result = await handleTriageRun(ctx, {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/pass `rules`, pass `rulesPath`, or set MCP_M365_TRIAGE_RULES_PATH/)
  })

  it('reports a missing note without pretending it had no rules', async () => {
    ctx.rulesPath = path.join(dir, 'absent.md')
    const result = await handleTriageRun(ctx, {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Could not read the rule file')
  })

  it('accepts a rulesPath passed in the call', async () => {
    const file = path.join(dir, 'passed-in.md')
    await fs.writeFile(file, RULES)
    stubInbox([message()])
    expect((await handleTriageRun(ctx, { rulesPath: file })).structuredContent.items[0].destination).toBe(
      '_TRIAGE/991 Junk'
    )
  })

  it('prefers a rulesPath in the call over the configured default', async () => {
    await configured('## Inbound\n\n```rules v1\n* -> move:000 Unknown, suggest\n```')
    const file = path.join(dir, 'override.md')
    await fs.writeFile(file, RULES)
    stubInbox([message()])
    expect((await handleTriageRun(ctx, { rulesPath: file })).structuredContent.items[0].destination).toBe(
      '_TRIAGE/991 Junk'
    )
  })

  it('refuses a rulesPath outside the configured roots', async () => {
    const elsewhere = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'triage-outside-')))
    try {
      await fs.writeFile(path.join(elsewhere, 'evil.md'), RULES)
      const result = await handleTriageRun(ctx, { rulesPath: path.join(elsewhere, 'evil.md') })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/resolves outside the configured roots/)
    } finally {
      await fs.rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('refuses a traversal out of the roots', async () => {
    const result = await handleTriageRun(ctx, { rulesPath: path.join(dir, '..', 'etc', 'passwd') })
    expect(result.content[0].text).toMatch(/resolves outside the configured roots/)
  })

  it('refuses any file access when no roots are configured', async () => {
    ctx.roots = []
    ctx.rulesPath = path.join(dir, 'anything.md')
    expect((await handleTriageRun(ctx, {})).content[0].text).toMatch(/no roots are configured/)
  })

  it('refuses a note larger than the read limit', async () => {
    const file = path.join(dir, 'huge.md')
    await fs.writeFile(file, 'x'.repeat(1024 * 1024 + 1))
    ctx.rulesPath = file
    expect((await handleTriageRun(ctx, {})).content[0].text).toMatch(/over the 1048576-byte limit/)
  })
})

describe('the tracking cache a run writes to', () => {
  it('reports which file it used, so a mistaken override is visible', async () => {
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules: RULES, mode: 'live' })
    expect(result.structuredContent.trackingPath).toBe(ctx.trackingPath)
    expect(result.content[0].text).toContain(`Tracking: ${ctx.trackingPath}`)
  })

  it('honours a trackingPath passed in the call', async () => {
    const alternate = path.join(dir, 'alternate.json5')
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules: RULES, mode: 'live', trackingPath: alternate })
    expect(result.structuredContent.trackingPath).toBe(alternate)
    expect((await readTracking(alternate))?.entries).toHaveLength(1)
    expect((await readTracking(ctx.trackingPath))?.entries).toEqual([])
  })

  it('refuses a trackingPath outside the roots rather than writing there', async () => {
    const elsewhere = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'triage-outside-')))
    try {
      stubInbox([message()])
      const result = await handleTriageRun(ctx, {
        rules: RULES,
        mode: 'live',
        trackingPath: path.join(elsewhere, 'tracking.json5')
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/resolves outside the configured roots/)
      expect(await fs.readdir(elsewhere)).toEqual([])
    } finally {
      await fs.rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('refuses to overwrite a cache it could not parse, rather than replacing the history with one batch', async () => {
    // The realistic version of this: an older JSON5-with-comments cache, or a
    // file truncated by an interrupted write. Reading it as "empty" and writing
    // back would silently destroy every earlier entry.
    await fs.writeFile(ctx.trackingPath, '{ half a cach')
    stubInbox([message()])
    const result = await handleTriageRun(ctx, { rules: RULES, mode: 'live' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/could not be parsed, so it was left untouched/)
    expect(await fs.readFile(ctx.trackingPath, 'utf8')).toBe('{ half a cach')
  })

  it('still reads a legacy JSON5 cache with unquoted keys and preserves it', async () => {
    const legacy = `{
      // written by the previous automation
      entries: [
        { subject: "Older", from: "x@y.com", received: "2026-07-01T00:00:00Z", ruleset: "r", routed_to: "a", destination: "_TRIAGE/a", routed_at: "2026-08-05T00:00:00Z", triage_folder: "a" },
      ],
    }`
    await fs.writeFile(ctx.trackingPath, legacy)
    stubInbox([message()])
    await handleTriageRun(ctx, { rules: RULES, mode: 'live' })

    const entries = (await readTracking(ctx.trackingPath))?.entries ?? []
    expect(entries.map((e) => e.subject).sort()).toEqual(['Hello', 'Older'])
  })

  it('refuses a live run with no tracking cache configured at all', async () => {
    ctx.trackingPath = ''
    stubInbox([message()])
    expect((await handleTriageRun(ctx, { rules: RULES, mode: 'live' })).content[0].text).toMatch(
      /No tracking cache configured/
    )
  })

  it('does not require a tracking cache in report mode', async () => {
    ctx.trackingPath = ''
    stubInbox([message()])
    expect((await handleTriageRun(ctx, { rules: RULES })).structuredContent.acted).toBe(1)
  })
})

describe('handleTriageRun — refusals', () => {
  it('refuses to run a rule file that will not parse', async () => {
    const result = await handleTriageRun(ctx, {
      rules: '## Inbound\n\n```rules v1\ntheme:x -> move:A\n* -> move:000 Unknown\n```'
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Refusing to run')
    expect(result.content[0].text).toContain('unknown predicate key "theme"')
  })

  it('refuses to run a rule file whose fence was never closed', async () => {
    const result = await handleTriageRun(ctx, {
      rules: '## Inbound\n\n```rules v1\nsender:*@x.com -> move:A\n* -> move:000 Unknown, suggest'
    })
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
    const rules =
      '## Archive\n\n```rules v1\n* -> move:000 Unknown, suggest\n```\n\n## Aged\n\n```rules v1\nfolder:"x" -> delete\n```'
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
      if (method === 'GET' && apiPath === 'me/mailFolders/junk-id/messages')
        return { value: [message({ parentFolderId: 'junk-id', flag: { flagStatus: 'flagged' } })] }
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
    const entries = (await readTracking(ctx.trackingPath))?.entries ?? []
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

describe('handleTriageRun — thread-follow', () => {
  const THREAD_FOLDERS = [
    ...FOLDERS,
    { id: 'other-id', displayName: '112 Other', parentFolderId: 'triage-id' },
    { id: 'archive-id', displayName: '_ARCHIVE', parentFolderId: 'root' },
    { id: 'archive-partner-id', displayName: 'Partner', parentFolderId: 'archive-id' },
    { id: 'sent-id', displayName: 'Sent Items', parentFolderId: 'root' }
  ]

  const THREAD_RULES = [
    '## Inbound',
    '',
    '```rules v1',
    'sender:*@junk.example -> move:991 Junk',
    'thread:filed -> move:@thread   # lint:allow-collision',
    'party:*@partner.example.com -> move:111 Partner',
    'party:*@other.example.com -> move:112 Other',
    '* -> move:000 Unknown, suggest',
    '```',
    '',
    '## Aged',
    '',
    '```rules v1',
    'folder:"111 Partner" age:30d -> move:_ARCHIVE/Partner',
    '```'
  ].join('\n')

  /** The reply waiting in the Inbox: a sender no rule knows, in a filed conversation. */
  const reply = (over: Record<string, unknown> = {}) =>
    message({
      id: 'reply-1',
      subject: 'Re: Partner sync',
      from: { emailAddress: { address: 'someone@stranger.example' } },
      receivedDateTime: '2026-08-05T09:00:00Z',
      conversationId: 'conv-1',
      ...over
    })

  /** An earlier message in the same conversation, sitting in `folderId`. */
  const sibling = (folderId: string, receivedDateTime: string, id = `sib-${folderId}`) => ({
    id,
    subject: 'Partner sync',
    from: { emailAddress: { address: 'contact@partner.example.com' } },
    receivedDateTime,
    parentFolderId: folderId
  })

  const isConversationQuery = (query: any): boolean => String(query?.$filter ?? '').includes('conversationId eq')

  /** Inbox holds `inbox`; each conversation id resolves to its listed messages. */
  const stubThread = (inbox: unknown[], conversations: Record<string, unknown[] | Error>) => {
    mockGetAllFolders.mockResolvedValue(THREAD_FOLDERS)
    mockCall.mockImplementation(
      async (_endpoint: string, _token: string, method: string, apiPath: string, _body: unknown, query: any) => {
        if (method === 'GET' && apiPath === 'me/messages' && isConversationQuery(query)) {
          const id = /conversationId eq '(.*)'$/.exec(query.$filter)?.[1] as string
          const listed = conversations[id] ?? []
          if (listed instanceof Error) throw listed
          return { value: listed }
        }
        if (method === 'GET' && apiPath.endsWith('/messages')) return { value: inbox }
        if (method === 'GET' && apiPath.startsWith('me/messages/')) return reply()
        if (method === 'POST') return { id: 'msg-moved' }
        return {}
      }
    )
  }

  const conversationQueries = () =>
    mockCall.mock.calls.filter(
      ([, , method, apiPath, , query]) => method === 'GET' && apiPath === 'me/messages' && isConversationQuery(query)
    )

  it('routes a reply to the folder its single filed sibling sits in', async () => {
    stubThread([reply()], {
      'conv-1': [reply({ parentFolderId: 'inbox-id' }), sibling('emerge-id', '2026-08-01T09:00:00Z')]
    })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })

    expect(result.structuredContent.items[0]).toMatchObject({
      destination: '_TRIAGE/111 Partner',
      ruleset: 'thread:filed',
      thread: { folder: '_TRIAGE/111 Partner', alternatives: [], skipped: [] }
    })
    expect(result.content[0].text).toContain('→ _TRIAGE/111 Partner [thread:filed] pending — via thread')
  })

  it('moves the reply and records the concrete folder in live mode', async () => {
    stubThread([reply()], { 'conv-1': [sibling('emerge-id', '2026-08-01T09:00:00Z')] })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES, mode: 'live' })

    expect(result.structuredContent.items[0].applied).toEqual([{ action: 'move:_TRIAGE/111 Partner', ok: true }])
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'token', 'POST', 'me/messages/reply-1/move', {
      destinationId: 'emerge-id'
    })
    const entries = (await readTracking(ctx.trackingPath))?.entries ?? []
    expect(entries[0]).toMatchObject({
      destination: '_TRIAGE/111 Partner',
      routed_to: '111 Partner',
      ruleset: 'thread:filed'
    })
  })

  it('routes a sibling in an archive to the triage folder that feeds it', async () => {
    stubThread([reply()], { 'conv-1': [sibling('archive-partner-id', '2026-06-01T09:00:00Z')] })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/111 Partner')
  })

  it('chooses the most recent sibling when the thread is split, and reports the other folder', async () => {
    stubThread([reply()], {
      'conv-1': [sibling('other-id', '2026-08-03T09:00:00Z'), sibling('emerge-id', '2026-08-01T09:00:00Z')]
    })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })

    expect(result.structuredContent.items[0].thread).toEqual({
      folder: '_TRIAGE/112 Other',
      alternatives: ['_TRIAGE/111 Partner'],
      skipped: []
    })
    expect(result.content[0].text).toContain('via thread; also filed in _TRIAGE/111 Partner')
  })

  it('names a folder it skipped as unresolvable', async () => {
    const rules = THREAD_RULES.replace(
      'folder:"111 Partner" age:30d -> move:_ARCHIVE/Partner',
      'folder:"111 Partner" age:30d | folder:"112 Other" age:30d -> move:_ARCHIVE/Partner'
    )
    stubThread([reply()], {
      'conv-1': [sibling('archive-partner-id', '2026-08-03T09:00:00Z'), sibling('other-id', '2026-08-01T09:00:00Z')]
    })
    const result = await handleTriageRun(ctx, { rules })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/112 Other')
    expect(result.content[0].text).toContain('via thread; skipped _ARCHIVE/Partner')
  })

  it('falls through when no sibling is filed', async () => {
    stubThread([reply()], {
      'conv-1': [
        reply({ parentFolderId: 'inbox-id' }),
        sibling('sent-id', '2026-08-02T09:00:00Z'),
        sibling('unknown-id', '2026-08-01T09:00:00Z')
      ]
    })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })

    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/000 Unknown')
    expect(result.structuredContent.items[0].thread).toBeUndefined()
  })

  it('does not mistake the reply itself for a sibling when Graph has reissued its id', async () => {
    stubThread([reply()], {
      'conv-1': [
        reply({ id: 'reply-1-reissued', parentFolderId: 'emerge-id' }),
        sibling('other-id', '2026-08-01T09:00:00Z', 'sib-reissued')
      ]
    })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/112 Other')
  })

  it('keeps a rule above the thread line ahead of it, with no lookup', async () => {
    stubThread([message({ conversationId: 'conv-1' })], { 'conv-1': [sibling('emerge-id', '2026-08-01T09:00:00Z')] })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/991 Junk')
    expect(conversationQueries()).toHaveLength(0)
  })

  it('lets a rule below the thread line decide when the thread is not filed', async () => {
    stubThread([reply({ from: { emailAddress: { address: 'a@partner.example.com' } } })], { 'conv-1': [] })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/111 Partner')
    expect(result.structuredContent.items[0].thread).toBeUndefined()
    expect(conversationQueries()).toHaveLength(1)
  })

  it('looks each conversation up once per call', async () => {
    stubThread([reply(), reply({ id: 'reply-2', receivedDateTime: '2026-08-06T09:00:00Z' })], {
      'conv-1': [sibling('emerge-id', '2026-08-01T09:00:00Z')]
    })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items).toHaveLength(2)
    expect(conversationQueries()).toHaveLength(1)
  })

  it('skips the lookup for a message Graph gave no conversation id', async () => {
    stubThread([reply({ conversationId: undefined })], {})
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/000 Unknown')
    expect(conversationQueries()).toHaveLength(0)
  })

  it('reports a failed lookup and lets the message fall through', async () => {
    stubThread([reply()], { 'conv-1': new Error('Graph said no') })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/000 Unknown')
    expect(result.structuredContent.warnings).toContain('thread lookup failed for "Re: Partner sync": Graph said no')
  })

  it('ignores a sibling in a folder the folder map does not know', async () => {
    stubThread([reply()], { 'conv-1': [sibling('vanished-id', '2026-08-01T09:00:00Z')] })
    const result = await handleTriageRun(ctx, { rules: THREAD_RULES })
    expect(result.structuredContent.items[0].destination).toBe('_TRIAGE/000 Unknown')
  })

  it('refuses a rule file that uses @thread without testing thread:filed', async () => {
    const rules = THREAD_RULES.replace('thread:filed -> move:@thread', 'sender:*@stranger.example -> move:@thread')
    stubThread([reply()], {})
    const result = await handleTriageRun(ctx, { rules })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('thread-target-without-thread')
  })

  it('re-files an unknown item in the aged pass once its thread has been filed', async () => {
    const rules = THREAD_RULES.replace(
      'folder:"111 Partner" age:30d -> move:_ARCHIVE/Partner',
      'folder:"111 Partner" age:30d -> move:_ARCHIVE/Partner\nfolder:"000 Unknown" thread:filed -> move:@thread'
    )
    mockGetAllFolders.mockResolvedValue(THREAD_FOLDERS)
    mockCall.mockImplementation(
      async (_endpoint: string, _token: string, method: string, apiPath: string, _body: unknown, query: any) => {
        if (method === 'GET' && apiPath === 'me/messages' && isConversationQuery(query))
          return { value: query.$filter.endsWith("'conv-1'") ? [sibling('emerge-id', '2026-08-01T09:00:00Z')] : [] }
        if (method === 'GET' && apiPath === 'me/mailFolders/unknown-id/messages')
          return {
            value: [
              reply({ parentFolderId: 'unknown-id' }),
              reply({ id: 'lone', conversationId: 'conv-2', subject: 'Alone' })
            ]
          }
        if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [] }
        return {}
      }
    )
    const result = await handleAgedRun(ctx, { rules })
    expect(result.structuredContent.items[0]).toMatchObject({
      destination: '_TRIAGE/111 Partner',
      ruleset: 'folder:"000 Unknown" thread:filed'
    })
    expect(result.structuredContent.unmatched).toBe(1)
  })

  it('leaves a rule file without thread: exactly as it was — no conversation query', async () => {
    stubThread([message({ conversationId: 'conv-1' }), reply()], {
      'conv-1': [sibling('emerge-id', '2026-08-01T09:00:00Z')]
    })
    const result = await handleTriageRun(ctx, { rules: RULES })
    expect(result.structuredContent.items.map((item: any) => item.destination)).toEqual([
      '_TRIAGE/991 Junk',
      '_TRIAGE/000 Unknown'
    ])
    expect(result.structuredContent.items.every((item: any) => item.thread === undefined)).toBe(true)
    expect(conversationQueries()).toHaveLength(0)
  })
})

describe('forwarded-to', () => {
  const FORWARD_FOLDERS = [
    ...FOLDERS,
    { id: 'held-id', displayName: '210 Held', parentFolderId: 'triage-id' },
    { id: 'other-id', displayName: '112 Other', parentFolderId: 'triage-id' },
    { id: 'archive-id', displayName: '_ARCHIVE', parentFolderId: 'root' },
    { id: 'paid-id', displayName: 'Paid', parentFolderId: 'archive-id' }
  ]

  const FORWARD_RULES = [
    '## Inbound',
    '',
    '```rules v1',
    '* -> move:000 Unknown',
    '```',
    '',
    '## Aged',
    '',
    '```rules v1',
    'folder:"991 Junk" age:7d -> delete',
    'folder:"210 Held" forwarded-to:finance@example.com !status:flagged -> move:_ARCHIVE/Paid, mark:read',
    '```'
  ].join('\n')

  /** A payment document held until the owner forwards it. */
  const invoice = (over: Record<string, unknown> = {}) =>
    message({
      id: 'inv-1',
      subject: 'Invoice 42',
      from: { emailAddress: { address: 'billing@supplier.example' } },
      receivedDateTime: '2026-08-01T09:00:00Z',
      parentFolderId: 'held-id',
      hasAttachments: true,
      ...over
    })

  /** The owner's forward of it to the finance mailbox. */
  const forward = (over: Record<string, unknown> = {}) => ({
    id: 'fw-1',
    subject: 'FW: Invoice 42',
    from: { emailAddress: { address: 'owner@example.com' } },
    toRecipients: [{ emailAddress: { address: 'finance@example.com' } }],
    receivedDateTime: '2026-08-02T09:00:00Z',
    hasAttachments: true,
    internetMessageId: '<fw-1@example.com>',
    ...over
  })

  const isSearch = (query: any): boolean => typeof query?.$search === 'string'

  /** `held` sits in 210 Held; every forward search returns `found`; `names` lists each message's attachments. */
  const stubForwards = (
    held: unknown[],
    found: unknown[] | Error,
    names: Record<string, string[]> = {},
    extra: (method: string, apiPath: string, query: any) => unknown = () => undefined
  ) => {
    mockGetAllFolders.mockResolvedValue(FORWARD_FOLDERS)
    mockCall.mockImplementation(
      async (_endpoint: string, _token: string, method: string, apiPath: string, _body: unknown, query: any) => {
        const answer = extra(method, apiPath, query)
        if (answer !== undefined) return answer
        if (method === 'GET' && apiPath === 'me')
          return { mail: 'owner@example.com', userPrincipalName: 'owner@example.com' }
        if (method === 'GET' && apiPath === 'me/messages' && isSearch(query)) {
          if (found instanceof Error) throw found
          return { value: found }
        }
        if (method === 'GET' && apiPath.endsWith('/attachments'))
          return { value: (names[apiPath.split('/')[2] as string] ?? []).map((name) => ({ name })) }
        if (method === 'GET' && apiPath === 'me/mailFolders/held-id/messages') return { value: held }
        if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [] }
        if (method === 'GET' && apiPath.startsWith('me/messages/')) return invoice()
        if (method === 'POST') return { id: 'inv-moved' }
        return {}
      }
    )
  }

  const calls = (predicate: (call: any[]) => boolean) => mockCall.mock.calls.filter(predicate)
  const searches = () =>
    calls(([, , method, apiPath, , query]) => method === 'GET' && apiPath === 'me/messages' && isSearch(query))
  const ownerReads = () => calls(([, , method, apiPath]) => method === 'GET' && apiPath === 'me')
  const attachmentReads = () => calls(([, , , apiPath]) => String(apiPath).endsWith('/attachments'))

  it('archives a held item once its single forward is found, and says which forward', async () => {
    stubForwards([invoice()], [forward()], { 'inv-1': ['invoice-42.pdf'], 'fw-1': ['Invoice-42.PDF'] })
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES })

    expect(result.structuredContent.items[0]).toMatchObject({
      destination: '_ARCHIVE/Paid',
      forward: { address: 'finance@example.com', subject: 'FW: Invoice 42', received: '2026-08-02T09:00:00Z' }
    })
    expect(result.structuredContent).toMatchObject({ forwardMatched: 1, forwardAmbiguous: [] })
    expect(result.content[0].text).toContain('pending — forwarded to finance@example.com (2026-08-02T09:00:00Z)')
    expect(result.content[0].text).toContain('1 message(s) matched by a forward.')
  })

  it('runs the rule on the original in live mode and leaves the forward copy alone', async () => {
    stubForwards([invoice()], [forward()], { 'inv-1': ['invoice-42.pdf'], 'fw-1': ['invoice-42.pdf'] })
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES, mode: 'live' })

    expect(result.structuredContent.items[0].applied).toEqual([
      { action: 'move:_ARCHIVE/Paid', ok: true },
      { action: 'mark:read', ok: true }
    ])
    expect(mockCall).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'token', 'POST', 'me/messages/inv-1/move', {
      destinationId: 'paid-id'
    })
    expect(calls(([, , method, apiPath]) => method !== 'GET' && String(apiPath).includes('fw-1'))).toHaveLength(0)
  })

  it('counts the Sent Items copy and the copy returned through the shared address as one forward', async () => {
    stubForwards([invoice({ hasAttachments: false })], [forward(), forward({ id: 'fw-1-returned' })])
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES })
    expect(result.structuredContent.forwardMatched).toBe(1)
    expect(attachmentReads()).toHaveLength(0)
  })

  it('falls back to subject, sender and time to de-duplicate copies with no message id', async () => {
    const bare = forward({ hasAttachments: undefined, internetMessageId: undefined })
    stubForwards([invoice({ hasAttachments: false })], [bare, { ...bare, id: 'fw-1-returned' }])
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES })
    expect(result.structuredContent.forwardMatched).toBe(1)
  })

  it('moves nothing when two distinct forwards are found, and lists the message for the owner', async () => {
    stubForwards(
      [invoice()],
      [
        forward(),
        forward({ id: 'fw-2', internetMessageId: '<fw-2@example.com>', receivedDateTime: '2026-08-09T09:00:00Z' })
      ],
      { 'inv-1': ['invoice-42.pdf'], 'fw-1': ['invoice-42.pdf'], 'fw-2': ['invoice-42.pdf'] }
    )
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES })

    expect(result.structuredContent).toMatchObject({ acted: 0, unmatched: 1, forwardMatched: 0 })
    expect(result.structuredContent.forwardAmbiguous).toEqual([
      {
        subject: 'Invoice 42',
        from: 'billing@supplier.example',
        received: '2026-08-01T09:00:00Z',
        address: 'finance@example.com',
        candidates: 2
      }
    ])
    expect(result.content[0].text).toContain('Ambiguous forwards (nothing moved — decide by hand):')
    expect(result.content[0].text).toContain(
      '- "Invoice 42" <billing@supplier.example> 2026-08-01T09:00:00Z: 2 forwards to finance@example.com'
    )
    // The original's names are read once, however many candidates it is compared with.
    expect(attachmentReads().map(([, , , apiPath]) => apiPath)).toEqual([
      'me/messages/inv-1/attachments',
      'me/messages/fw-1/attachments',
      'me/messages/fw-2/attachments'
    ])
  })

  it('does not match a forward that shares no attachment name with the original', async () => {
    stubForwards([invoice()], [forward()], { 'inv-1': ['invoice-42.pdf'], 'fw-1': ['unrelated.pdf'] })
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES })
    expect(result.structuredContent).toMatchObject({ acted: 0, unmatched: 1, forwardAmbiguous: [] })
  })

  it('does not prove a pair whose attachments cannot be compared for want of an id', async () => {
    const { id: _id, ...noId } = invoice()
    stubForwards([noId, invoice({ id: 'inv-2', subject: 'Invoice 43' })], [forward({ id: undefined })])
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES })
    expect(result.structuredContent.unmatched).toBe(2)
    expect(attachmentReads()).toHaveLength(0)
  })

  it('looks up only messages a forwarded-to group could match, once per owner and subject', async () => {
    stubForwards(
      [
        invoice({ hasAttachments: false }),
        invoice({ id: 'inv-2', hasAttachments: false, receivedDateTime: '2026-08-01T10:00:00Z' }),
        invoice({ id: 'inv-3', subject: 'Flagged', flag: { flagStatus: 'flagged' } })
      ],
      []
    )
    await handleAgedRun(ctx, { rules: FORWARD_RULES })
    expect(ownerReads()).toHaveLength(1)
    expect(searches()).toHaveLength(1)
    expect(searches()[0]?.[5]).toMatchObject({ $search: '"recipients:"finance@example.com" subject:"invoice 42""' })
  })

  it('reports a failed lookup as a warning and leaves the message where it is', async () => {
    stubForwards([invoice()], new Error('search unavailable'))
    const result = await handleAgedRun(ctx, { rules: FORWARD_RULES })
    expect(result.structuredContent).toMatchObject({ acted: 0, unmatched: 1 })
    expect(result.structuredContent.warnings).toContain('forward lookup failed for "Invoice 42": search unavailable')
  })

  it('follows a match unseated by a forward down to a thread-follow rule below it', async () => {
    const rules = [
      '## Inbound',
      '',
      '```rules v1',
      'subject:invoice !forwarded-to:finance@example.com -> move:210 Held',
      'thread:filed -> move:@thread   # lint:allow-collision',
      '* -> move:000 Unknown',
      '```'
    ].join('\n')
    const inbound = invoice({ parentFolderId: 'inbox-id', conversationId: 'conv-1', hasAttachments: false })
    stubForwards([], [forward({ hasAttachments: false })], {}, (method, apiPath, query) => {
      if (method === 'GET' && apiPath === 'me/mailFolders/inbox-id/messages') return { value: [inbound] }
      if (method === 'GET' && String(query?.$filter ?? '').includes('conversationId eq'))
        return {
          value: [
            {
              id: 'sib-1',
              subject: 'Invoice 42',
              from: { emailAddress: { address: 'billing@supplier.example' } },
              receivedDateTime: '2026-07-01T09:00:00Z',
              parentFolderId: 'held-id'
            }
          ]
        }
      return undefined
    })
    const result = await handleTriageRun(ctx, { rules })
    expect(result.structuredContent.items[0]).toMatchObject({
      destination: '_TRIAGE/210 Held',
      ruleset: 'thread:filed',
      thread: { folder: '_TRIAGE/210 Held' }
    })
    expect(result.structuredContent.items[0].forward).toBeUndefined()
  })

  it('leaves a rule file without forwarded-to exactly as it was — no owner read, no search, no new fields', async () => {
    stubForwards([invoice()], [forward()])
    const result = await handleAgedRun(ctx, { rules: RULES })
    expect(ownerReads()).toHaveLength(0)
    expect(searches()).toHaveLength(0)
    expect(result.structuredContent).not.toHaveProperty('forwardMatched')
    expect(result.structuredContent).not.toHaveProperty('forwardAmbiguous')
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

  it('reads only the subfolders the aged block names, each with its own window', async () => {
    const listed: string[] = []
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath.endsWith('/messages')) {
        listed.push(apiPath)
        // Every folder is fuller than the window; only the named one may set `truncated`.
        return { value: [message(), message({ id: 'msg-2' })] }
      }
      return {}
    })
    const result = await handleAgedRun(ctx, { rules: RULES, maxActions: 1 })
    expect(listed).toEqual(['me/mailFolders/junk-id/messages'])
    expect(result.structuredContent).toMatchObject({ considered: 1, remaining: true })
  })

  it('stops collecting once the batch is full and reports that more remain', async () => {
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath.endsWith('/messages')) {
        const aged = (id: string) =>
          message({ id, receivedDateTime: '2020-01-01T00:00:00Z', flag: { flagStatus: 'notFlagged' } })
        return { value: [aged('msg-1'), aged('msg-2')] }
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

describe('handleAgedRun — save-attachments', () => {
  const agedWithAttachment = (over: Record<string, unknown> = {}) =>
    message({
      receivedDateTime: '2020-01-01T00:00:00Z',
      flag: { flagStatus: 'notFlagged' },
      hasAttachments: true,
      ...over
    })

  /**
   * A note carrying both halves: the rules, and the destinations block that
   * says where `receipts` points. Both are rule data — the server contributes
   * only the roots that bound the path.
   */
  const savingRules = (actions: string, declared = path.join(dir, 'Receipts')) =>
    [
      '## Inbound',
      '',
      '```rules v1',
      '* -> move:000 Unknown, suggest',
      '```',
      '',
      '## Aged',
      '',
      '```rules v1',
      `folder:"991 Junk" age:7d has:attachment -> ${actions}`,
      '```',
      '',
      '## Destinations',
      '',
      '```destinations v1',
      `receipts = ${declared}`,
      '```'
    ].join('\n')

  const stubAgedFolder = () => {
    mockCall.mockImplementation(async (_e: string, _t: string, method: string, apiPath: string) => {
      if (method === 'GET' && apiPath === 'me/mailFolders/junk-id/messages') return { value: [agedWithAttachment()] }
      if (method === 'GET' && apiPath.endsWith('/messages')) return { value: [] }
      if (method === 'GET') return agedWithAttachment()
      if (method === 'POST') return { id: 'msg-moved' }
      return {}
    })
  }

  beforeEach(() => {
    ctx.saveAttachments = vi.fn().mockResolvedValue({
      ok: true,
      files: [{ filename: '2020-01-01_vendor_5.14.pdf', source: 'receipt.pdf', amount: '5.14', written: true }]
    })
  })

  it('saves, then archives, and reports both in the destination', async () => {
    stubAgedFolder()
    const result = await handleAgedRun(ctx, {
      rules: savingRules('save-attachments:receipts, move:111 Partner'),
      mode: 'live'
    })

    expect(result.structuredContent.items[0]).toMatchObject({
      destination: 'save-attachments:receipts + _TRIAGE/111 Partner',
      applied: [
        { action: 'save-attachments:receipts', ok: true, detail: '2020-01-01_vendor_5.14.pdf' },
        { action: 'move:_TRIAGE/111 Partner', ok: true }
      ]
    })
  })

  it('describes a save with no move and a save that deletes', async () => {
    stubAgedFolder()
    const saveOnly = await handleAgedRun(ctx, { rules: savingRules('save-attachments:receipts') })
    expect(saveOnly.structuredContent.items[0].destination).toBe('save-attachments:receipts')

    stubAgedFolder()
    const saveThenDelete = await handleAgedRun(ctx, { rules: savingRules('save-attachments:receipts, delete') })
    expect(saveThenDelete.structuredContent.items[0].destination).toBe('save-attachments:receipts + (deleted)')
  })

  it('writes nothing in report mode', async () => {
    stubAgedFolder()
    const result = await handleAgedRun(ctx, { rules: savingRules('save-attachments:receipts, move:111 Partner') })
    expect(result.structuredContent.items[0].applied).toEqual([])
    expect(ctx.saveAttachments).not.toHaveBeenCalled()
  })

  it('passes the note’s declared destinations to the saver, `~` expanded', async () => {
    stubAgedFolder()
    await handleAgedRun(ctx, { rules: savingRules('save-attachments:receipts'), mode: 'live' })
    expect(ctx.saveAttachments).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: 'receipts',
        destinations: { receipts: path.join(dir, 'Receipts') }
      })
    )
  })

  it('refuses the whole run when the rule names a destination the note does not declare', async () => {
    // Blocking, not per-message: a typo would otherwise be discovered one
    // message at a time, after the pass had already started moving mail.
    stubAgedFolder()
    const result = await handleAgedRun(ctx, { rules: savingRules('save-attachments:invoices, move:111 Partner') })
    expect(result.content[0].text).toContain('unknown-destination')
    expect(ctx.saveAttachments).not.toHaveBeenCalled()
  })

  it('refuses the whole run when the note declares a path outside the server’s roots', async () => {
    // The note owns the destination; the roots own whether it is allowed. A
    // note that oversteps stops the run rather than failing at write time.
    stubAgedFolder()
    const result = await handleAgedRun(ctx, {
      rules: savingRules('save-attachments:receipts', path.join(os.tmpdir(), 'elsewhere')),
      mode: 'live'
    })
    expect(result.content[0].text).toContain('destination-outside-roots')
    expect(ctx.saveAttachments).not.toHaveBeenCalled()
  })
})

describe('handleRulesLint', () => {
  it('summarises the blocks and finding counts', async () => {
    const result = await handleRulesLint(ctx, { rules: RULES })
    expect(result.content[0].text).toContain('Parsed blocks: inbound (3 rules), aged (1 rules)')
    expect(result.content[0].text).toContain('0 error, 0 warning, 0 info')
  })

  it('flags a save-attachments target the note does not declare', async () => {
    const rules = ['## Inbound', '', '```rules v1', '* -> save-attachments:receipts', '```'].join('\n')
    expect((await handleRulesLint(ctx, { rules })).content[0].text).toContain('unknown-destination')
  })

  it('flags a declared destination this server would refuse', async () => {
    // Linting a proposed edit is where an over-reaching destination should be
    // caught — before the edit lands in the note.
    const rules = [
      '## Destinations',
      '',
      '```destinations v1',
      `receipts = ${path.join(os.tmpdir(), 'elsewhere')}`,
      '```'
    ].join('\n')
    expect((await handleRulesLint(ctx, { rules })).content[0].text).toContain('destination-outside-roots')
  })

  it('notes when no folder taxonomy was supplied', async () => {
    expect((await handleRulesLint(ctx, { rules: RULES })).content[0].text).toContain('no knownFolders supplied')
  })

  it('checks move targets when a taxonomy is supplied', async () => {
    const result = await handleRulesLint(ctx, {
      rules: RULES,
      knownFolders: ['_TRIAGE/991 Junk', '_TRIAGE/111 Partner', '_TRIAGE/000 Unknown']
    })
    expect(result.content[0].text).not.toContain('no knownFolders supplied')
    expect(result.content[0].text).toContain('0 error')
  })

  it('reports findings with their source line', async () => {
    const result = await handleRulesLint(ctx, {
      rules: '## Inbound\n\n```rules v1\nsender:db.example.net -> move:A\n* -> move:000 Unknown, suggest\n```'
    })
    expect(result.content[0].text).toContain('malformed-address')
    expect(result.content[0].text).toContain('sender:db.example.net -> move:A')
  })

  it('reports a source that contains no rule blocks', async () => {
    expect((await handleRulesLint(ctx, { rules: 'just prose, no fences here' })).content[0].text).toContain(
      'Parsed blocks: none'
    )
  })

  it('asks for rules rather than linting nothing when none are available', async () => {
    const result = await handleRulesLint(ctx, {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/pass `rules`, pass `rulesPath`, or set MCP_M365_TRIAGE_RULES_PATH/)
  })

  it('tolerates being called with no arguments at all', async () => {
    expect((await handleRulesLint(ctx, undefined)).isError).toBe(true)
  })

  it('ignores a knownFolders value that is not an array', async () => {
    expect((await handleRulesLint(ctx, { rules: RULES, knownFolders: 'nope' })).content[0].text).toContain(
      'no knownFolders supplied'
    )
  })
})
