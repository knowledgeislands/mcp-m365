import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Mock } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { getAllFolders } from '../email/folder-utils.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleDriftScan, RETENTION_DAYS } from './drift.js'
import { readTracking, type TrackingEntry, writeTracking } from './tracking.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
vi.mock('../email/folder-utils.js', () => ({ getAllFolders: vi.fn() }))

const mockCall = callGraphAPI as Mock
const mockGetAllFolders = getAllFolders as Mock

const FOLDERS = [
  { id: 'triage-id', displayName: '_TRIAGE', parentFolderId: 'root' },
  { id: 'unknown-id', displayName: '000 Unknown', parentFolderId: 'triage-id' },
  { id: 'bizdev-id', displayName: '263 BizDev', parentFolderId: 'triage-id' }
]

const NOW = new Date('2026-08-06T09:00:00Z')

const entry = (over: Partial<TrackingEntry> = {}): TrackingEntry => ({
  id: 'msg-1',
  subject: 'follow-up from IBC Kickstart Day',
  from: 'sam.jones@partner.example.com',
  received: '2026-07-17T09:05:48Z',
  ruleset: 'unknown',
  routed_to: '000 Unknown',
  destination: '_TRIAGE/000 Unknown',
  routed_at: '2026-08-04T12:00:00Z',
  triage_folder: '000 Unknown',
  ...over
})

const graphMessage = (over: Record<string, unknown> = {}) => ({
  id: 'msg-1',
  subject: 'follow-up from IBC Kickstart Day',
  from: { emailAddress: { address: 'sam.jones@partner.example.com' } },
  receivedDateTime: '2026-07-17T09:05:48Z',
  parentFolderId: 'unknown-id',
  ...over
})

let dir: string
let ctx: {
  graphApiEndpoint: string
  ensureAuthenticated: Mock
  roots: string[]
  trackingPath: string
  rulesPath: string
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mockGetAllFolders.mockResolvedValue(FOLDERS)
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'triage-drift-')))
  ctx = {
    graphApiEndpoint: GRAPH_API_ENDPOINT,
    ensureAuthenticated: vi.fn().mockResolvedValue('token'),
    roots: [dir],
    trackingPath: path.join(dir, 'tracking.json5'),
    rulesPath: ''
  }
})

afterEach(async () => {
  vi.useRealTimers()
  await fs.rm(dir, { recursive: true, force: true })
})

describe('handleDriftScan', () => {
  it('does nothing but say so when there is no tracking data', async () => {
    const result = await handleDriftScan(ctx, {})
    expect(result.structuredContent).toMatchObject({
      scanned: 0,
      reRouted: [],
      prunedMissing: 0,
      prunedExpired: 0,
      trackedAfter: 0
    })
    expect(ctx.ensureAuthenticated).not.toHaveBeenCalled()
  })

  it('reports a message the user has moved by hand', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    mockCall.mockResolvedValue(graphMessage({ parentFolderId: 'bizdev-id' }))

    const result = await handleDriftScan(ctx, {})
    expect(result.structuredContent.reRouted).toEqual([
      {
        subject: 'follow-up from IBC Kickstart Day',
        from: 'sam.jones@partner.example.com',
        received: '2026-07-17T09:05:48Z',
        ruleset: 'unknown',
        from_folder: '000 Unknown',
        to_folder: '263 BizDev'
      }
    ])
    expect(result.content[0].text).toContain('000 Unknown → 263 BizDev')
  })

  it('updates the tracked folder but leaves the recorded ruleset alone', async () => {
    // `ruleset` records what the automation matched; `triage_folder` records where
    // the message sits. The two disagreeing is the drift signal, not a defect.
    await writeTracking(ctx.trackingPath, { entries: [entry({ ruleset: 'party:*@partner.example.com' })] })
    mockCall.mockResolvedValue(graphMessage({ parentFolderId: 'bizdev-id' }))

    await handleDriftScan(ctx, {})
    const entries = (await readTracking(ctx.trackingPath))?.entries ?? []
    expect(entries[0]).toMatchObject({ ruleset: 'party:*@partner.example.com', triage_folder: '263 BizDev' })
  })

  it('reports nothing when a message is still where the engine put it', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    mockCall.mockResolvedValue(graphMessage())
    const result = await handleDriftScan(ctx, {})
    expect(result.structuredContent).toMatchObject({ scanned: 1, reRouted: [], trackedAfter: 1 })
    expect(result.content[0].text).not.toContain('Generalise before proposing a rule')
  })

  it('prunes an entry whose message can no longer be found', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    mockCall.mockResolvedValue({ value: [] })
    const result = await handleDriftScan(ctx, {})
    expect(result.structuredContent).toMatchObject({ prunedMissing: 1, trackedAfter: 0 })
  })

  it('prunes entries older than the retention window without calling Graph for them', async () => {
    const stale = entry({ subject: 'ancient', routed_at: '2026-06-01T12:00:00Z' })
    await writeTracking(ctx.trackingPath, { entries: [stale] })
    const result = await handleDriftScan(ctx, {})
    expect(result.structuredContent).toMatchObject({ prunedExpired: 1, scanned: 0, trackedAfter: 0 })
    expect((await readTracking(ctx.trackingPath))?.entries).toEqual([])
  })

  it('keeps the retention window at three weeks', () => {
    expect(RETENTION_DAYS).toBe(21)
  })

  it('refreshes the cached id from the message it found', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry({ id: 'stale-id' })] })
    mockCall
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ value: [graphMessage({ id: 'reissued' })] })
    await handleDriftScan(ctx, {})
    expect((await readTracking(ctx.trackingPath))?.entries[0]?.id).toBe('reissued')
  })

  it('searches by identity for an entry with no cached id', async () => {
    const { id: _drop, ...withoutId } = entry()
    await writeTracking(ctx.trackingPath, { entries: [withoutId as TrackingEntry] })
    mockCall.mockResolvedValue({ value: [graphMessage()] })
    expect((await handleDriftScan(ctx, {})).structuredContent.scanned).toBe(1)
  })

  it('leaves the tracked folder alone when the message sits in a folder outside the map', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    mockCall.mockResolvedValue(graphMessage({ parentFolderId: 'somewhere-else' }))
    const result = await handleDriftScan(ctx, {})
    expect(result.structuredContent.reRouted).toEqual([])
    expect((await readTracking(ctx.trackingPath))?.entries[0]?.triage_folder).toBe('000 Unknown')
  })

  it('reports which tracking cache it scanned', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    mockCall.mockResolvedValue(graphMessage())
    const result = await handleDriftScan(ctx, {})
    expect(result.structuredContent.trackingPath).toBe(ctx.trackingPath)
    expect(result.content[0].text).toContain(`Tracking: ${ctx.trackingPath}`)
  })

  it('honours a trackingPath passed in the call', async () => {
    const alternate = path.join(dir, 'alternate.json5')
    await writeTracking(alternate, { entries: [entry()] })
    mockCall.mockResolvedValue(graphMessage())
    expect((await handleDriftScan(ctx, { trackingPath: alternate })).structuredContent).toMatchObject({
      scanned: 1,
      trackingPath: alternate
    })
  })

  it('refuses a trackingPath outside the roots', async () => {
    const elsewhere = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'drift-outside-')))
    try {
      const result = await handleDriftScan(ctx, { trackingPath: path.join(elsewhere, 'tracking.json5') })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/resolves outside the configured roots/)
    } finally {
      await fs.rm(elsewhere, { recursive: true, force: true })
    }
  })

  it('refuses to scan a cache it could not parse, rather than pruning from an assumed-empty one', async () => {
    await fs.writeFile(ctx.trackingPath, '{ truncated')
    const result = await handleDriftScan(ctx, {})
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/could not be parsed. Refusing to scan/)
    expect(await fs.readFile(ctx.trackingPath, 'utf8')).toBe('{ truncated')
  })

  it('refuses to scan with no tracking cache configured', async () => {
    ctx.trackingPath = ''
    expect((await handleDriftScan(ctx, {})).content[0].text).toMatch(/No tracking cache configured/)
  })

  describe('resumability across calls', () => {
    const SUBJECTS = ['one', 'two', 'three']

    /** Three distinct tracked messages, each resolvable by its own id. */
    const seed = async () => {
      await writeTracking(ctx.trackingPath, {
        entries: SUBJECTS.map((subject) => entry({ id: `msg-${subject}`, subject }))
      })
      mockCall.mockImplementation(async (_e: string, _t: string, _m: string, apiPath: string) => {
        const id = apiPath.replace('me/messages/', '')
        return graphMessage({ id, subject: id.replace('msg-', '') })
      })
    }

    const tracked = async () => ((await readTracking(ctx.trackingPath))?.entries ?? []).map((e) => e.subject)

    it('drives `remaining` to zero after exactly one full sweep, so a polling caller stops', async () => {
      // Regression: `remaining` was `total - maxEntries` on every call, a constant.
      // A caller told to loop while `remaining > 0` would never terminate, however
      // many entries it had already examined.
      await seed()
      const remaining: number[] = []

      for (let call = 0; call < SUBJECTS.length; call++) {
        const result = await handleDriftScan(ctx, { maxEntries: 1 })
        expect(result.structuredContent.scanned).toBe(1)
        remaining.push(result.structuredContent.remaining)
      }

      expect(remaining).toEqual([2, 1, 0])
    })

    it('examines a different entry on each call, in file order', async () => {
      await seed()
      const examined: string[] = []
      mockCall.mockImplementation(async (_e: string, _t: string, _m: string, apiPath: string) => {
        const id = apiPath.replace('me/messages/', '')
        examined.push(id.replace('msg-', ''))
        return graphMessage({ id, subject: id.replace('msg-', '') })
      })

      for (let call = 0; call < SUBJECTS.length; call++) await handleDriftScan(ctx, { maxEntries: 1 })

      expect(examined).toEqual(SUBJECTS)
    })

    it('starts a fresh sweep once the previous one has completed', async () => {
      await seed()
      for (let call = 0; call < SUBJECTS.length; call++) await handleDriftScan(ctx, { maxEntries: 1 })

      // The sweep is done; the next invocation begins another and has work again.
      const next = await handleDriftScan(ctx, { maxEntries: 1 })
      expect(next.structuredContent).toMatchObject({ scanned: 1, remaining: 2 })
    })

    it('leaves the entries in their original order — the cursor tracks progress, not position', async () => {
      await seed()
      for (let call = 0; call < SUBJECTS.length; call++) await handleDriftScan(ctx, { maxEntries: 1 })
      expect(await tracked()).toEqual(SUBJECTS)
    })

    it('reports the sweep as complete in the text summary', async () => {
      await seed()
      const result = await handleDriftScan(ctx, { maxEntries: 50 })
      expect(result.content[0].text).toContain('sweep complete')
    })

    it('covers a corpus with no scan history in a single pass', async () => {
      // The existing 316-entry file predates the cursor: every entry is outstanding.
      await seed()
      const result = await handleDriftScan(ctx, { maxEntries: 50 })
      expect(result.structuredContent).toMatchObject({ scanned: 3, remaining: 0 })
    })
  })

  it('bounds the batch and reports how many entries are left', async () => {
    await writeTracking(ctx.trackingPath, {
      entries: [entry({ subject: 'one' }), entry({ subject: 'two' }), entry({ subject: 'three' })]
    })
    mockCall.mockResolvedValue({ value: [] })

    const result = await handleDriftScan(ctx, { maxEntries: 1 })
    expect(result.structuredContent).toMatchObject({ scanned: 1, remaining: 2, prunedMissing: 1, trackedAfter: 2 })
    expect(result.content[0].text).toContain('2 still to examine in this sweep — call again')
  })

  it('surfaces a failure as an error envelope', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    ctx.ensureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    expect((await handleDriftScan(ctx, {})).content[0].text).toContain(
      'Error scanning for drift: Authentication required'
    )
  })

  it('appends the re-authentication hint on a 401', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    ctx.ensureAuthenticated.mockRejectedValue(new Error('API call failed with status 401'))
    expect((await handleDriftScan(ctx, {})).content[0].text).toContain('m365_auth_start')
  })

  it('reminds the reader that induction is judgement, not mechanics', async () => {
    await writeTracking(ctx.trackingPath, { entries: [entry()] })
    mockCall.mockResolvedValue(graphMessage({ parentFolderId: 'bizdev-id' }))
    expect((await handleDriftScan(ctx, {})).content[0].text).toContain('more than ~10% of the tracked corpus')
  })
})
