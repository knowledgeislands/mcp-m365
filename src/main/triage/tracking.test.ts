import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  entryKey,
  identityKey,
  parseTracking,
  pruneOlderThan,
  readTracking,
  relaxJson5,
  sweepPending,
  type TrackingEntry,
  upsertEntries,
  writeTracking
} from './tracking.js'

const entry = (over: Partial<TrackingEntry> = {}): TrackingEntry => ({
  subject: 'Subject',
  from: 'a@example.com',
  received: '2026-08-01T09:00:00Z',
  ruleset: 'sender:*@example.com',
  routed_to: '000 Unknown',
  destination: '_TRIAGE/000 Unknown',
  routed_at: '2026-08-01T10:00:00Z',
  triage_folder: '000 Unknown',
  ...over
})

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'triage-tracking-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('identity', () => {
  it('keys on subject, sender and received — never the Graph id', () => {
    const a = identityKey({ subject: 'Hi', from: 'A@Example.com', received: '2026-08-01T09:00:00Z' })
    const b = identityKey({ subject: ' Hi ', from: 'a@example.com', received: ' 2026-08-01T09:00:00Z ' })
    expect(a).toBe(b)
  })

  it('distinguishes subjects that differ only by a non-ASCII character', () => {
    // A real corpus entry differs from its Graph subject by `x` vs `×`.
    expect(identityKey({ subject: 'Acme x Beta', from: 'a@b.com', received: 'r' })).not.toBe(
      identityKey({ subject: 'Acme × Beta', from: 'a@b.com', received: 'r' })
    )
  })

  it('derives the same key from a stored entry', () => {
    expect(entryKey(entry())).toBe(identityKey({ subject: 'Subject', from: 'a@example.com', received: '2026-08-01T09:00:00Z' }))
  })
})

describe('relaxJson5', () => {
  it('strips line and block comments', () => {
    expect(relaxJson5('{ // note\n"a": 1 /* and */ }')).toContain('"a": 1')
  })

  it('strips trailing commas', () => {
    expect(relaxJson5('{"a": [1, 2,],}')).toBe('{"a": [1, 2]}')
  })

  it('leaves comment-like text inside strings alone', () => {
    expect(relaxJson5('{"a": "http://x/y", "b": "/* keep */"}')).toBe('{"a": "http://x/y", "b": "/* keep */"}')
  })

  it('handles single-quoted strings and escapes', () => {
    expect(relaxJson5(`{'a': 'it\\'s // fine'}`)).toBe(`{'a': 'it\\'s // fine'}`)
  })
})

describe('parseTracking', () => {
  it('reads strict JSON', () => {
    expect(parseTracking('{"entries":[]}')).toEqual({ entries: [] })
  })

  it('reads JSON5 conveniences', () => {
    expect(parseTracking('{ // cache\n "entries": [], \n}').entries).toEqual([])
  })

  it('treats an empty file as an empty cache', () => {
    expect(parseTracking('   ')).toEqual({ entries: [] })
  })

  it('treats a file with no entries array as empty', () => {
    expect(parseTracking('{"other": 1}')).toEqual({ entries: [] })
  })

  it('treats unparseable content as empty rather than throwing mid-run', () => {
    expect(parseTracking('{not json at all')).toEqual({ entries: [] })
  })
})

describe('readTracking', () => {
  it('returns an empty cache when the file does not exist', async () => {
    expect(await readTracking(path.join(dir, 'missing.json5'))).toEqual({ entries: [] })
  })

  it('reads what was written', async () => {
    const file = path.join(dir, 'tracking.json5')
    await writeTracking(file, { entries: [entry()] })
    expect((await readTracking(file)).entries).toHaveLength(1)
  })
})

describe('writeTracking', () => {
  it('creates the directory tree', async () => {
    const file = path.join(dir, 'nested', 'deeper', 'tracking.json5')
    await writeTracking(file, { entries: [] })
    expect(await fs.readFile(file, 'utf8')).toContain('"entries"')
  })

  it('writes at mode 0600', async () => {
    const file = path.join(dir, 'tracking.json5')
    await writeTracking(file, { entries: [] })
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  })

  it('leaves no temp file behind', async () => {
    const file = path.join(dir, 'tracking.json5')
    await writeTracking(file, { entries: [] })
    expect((await fs.readdir(dir)).filter((n) => n.includes('.tmp.'))).toEqual([])
  })

  it('keeps one rolling backup rather than one per run', async () => {
    const file = path.join(dir, 'tracking.json5')
    await writeTracking(file, { entries: [entry({ subject: 'first' })] })
    await writeTracking(file, { entries: [entry({ subject: 'second' })] })
    await writeTracking(file, { entries: [entry({ subject: 'third' })] })

    const names = await fs.readdir(dir)
    expect(names.sort()).toEqual(['tracking.json5', 'tracking.json5.bak'])
    expect(await fs.readFile(`${file}.bak`, 'utf8')).toContain('second')
  })

  it('writes strict JSON so any JSON5 reader can consume it', async () => {
    const file = path.join(dir, 'tracking.json5')
    await writeTracking(file, { entries: [entry()] })
    expect(() => JSON.parse(String(fs.readFile))).toThrow()
    expect(JSON.parse(await fs.readFile(file, 'utf8')).entries).toHaveLength(1)
  })
})

describe('upsertEntries', () => {
  it('adds new entries', () => {
    expect(upsertEntries({ entries: [] }, [entry()]).entries).toHaveLength(1)
  })

  it('replaces an entry with the same identity rather than duplicating it', () => {
    const before = { entries: [entry({ triage_folder: '000 Unknown' })] }
    const after = upsertEntries(before, [entry({ triage_folder: '111 Partner' })])
    expect(after.entries).toHaveLength(1)
    expect(after.entries[0]?.triage_folder).toBe('111 Partner')
  })

  it('keeps entries for different messages side by side', () => {
    expect(upsertEntries({ entries: [entry()] }, [entry({ subject: 'Another' })]).entries).toHaveLength(2)
  })
})

describe('pruneOlderThan', () => {
  const now = new Date('2026-08-06T09:00:00Z')

  it('drops entries routed outside the window', () => {
    const { kept, pruned } = pruneOlderThan(
      { entries: [entry({ routed_at: '2026-07-01T09:00:00Z' }), entry({ subject: 'recent', routed_at: '2026-08-05T09:00:00Z' })] },
      21,
      now
    )
    expect(pruned).toHaveLength(1)
    expect(kept.entries[0]?.subject).toBe('recent')
  })

  it('keeps an entry with an unparseable timestamp rather than silently discarding it', () => {
    const { kept, pruned } = pruneOlderThan({ entries: [entry({ routed_at: 'whenever' })] }, 21, now)
    expect(pruned).toEqual([])
    expect(kept.entries).toHaveLength(1)
  })
})

describe('sweepPending', () => {
  const now = new Date('2026-08-06T09:00:00Z')
  const earlier = '2026-08-06T08:00:00Z'

  it('treats a corpus with no scan history as entirely outstanding', () => {
    // The pre-existing tracking file has no `scanned_at` on any entry.
    const { sweep, pending } = sweepPending({ entries: [entry({ subject: 'a' }), entry({ subject: 'b' })] }, now)
    expect(pending).toHaveLength(2)
    expect(sweep.started_at).toBe(now.toISOString())
  })

  it('carries an in-progress sweep forward and reports only what is left', () => {
    const file = {
      entries: [entry({ subject: 'done', scanned_at: now.toISOString() }), entry({ subject: 'todo' })],
      sweep: { started_at: earlier }
    }
    const { sweep, pending } = sweepPending(file, now)
    expect(sweep.started_at).toBe(earlier)
    expect(pending.map((e) => e.subject)).toEqual(['todo'])
  })

  it('counts an entry scanned before the current sweep began as outstanding', () => {
    const file = { entries: [entry({ scanned_at: '2026-08-01T00:00:00Z' })], sweep: { started_at: earlier } }
    expect(sweepPending(file, now).pending).toHaveLength(1)
  })

  it('begins a fresh sweep once every entry has been examined', () => {
    const file = { entries: [entry({ scanned_at: now.toISOString() })], sweep: { started_at: earlier } }
    const { sweep, pending } = sweepPending(file, now)
    expect(sweep.started_at).toBe(now.toISOString())
    expect(pending).toHaveLength(1)
  })

  it('handles an empty corpus without claiming work', () => {
    expect(sweepPending({ entries: [] }, now).pending).toEqual([])
  })
})

describe('sweep persistence', () => {
  it('round-trips the sweep marker through the file', async () => {
    const file = path.join(dir, 'tracking.json5')
    await writeTracking(file, { entries: [entry({ scanned_at: '2026-08-06T08:00:00Z' })], sweep: { started_at: '2026-08-06T07:00:00Z' } })
    const read = await readTracking(file)
    expect(read.sweep).toEqual({ started_at: '2026-08-06T07:00:00Z' })
    expect(read.entries[0]?.scanned_at).toBe('2026-08-06T08:00:00Z')
  })

  it('tolerates a file written before the cursor existed', () => {
    expect(parseTracking('{"entries":[]}').sweep).toBeUndefined()
  })

  it('ignores a malformed sweep marker rather than trusting it', () => {
    expect(parseTracking('{"entries":[],"sweep":{"started_at":42}}').sweep).toBeUndefined()
  })

  it('preserves the sweep across upsert and prune', () => {
    const file = { entries: [entry()], sweep: { started_at: 'S' } }
    expect(upsertEntries(file, [entry({ subject: 'new' })]).sweep).toEqual({ started_at: 'S' })
    expect(pruneOlderThan(file, 21, new Date('2026-08-06T09:00:00Z')).kept.sweep).toEqual({ started_at: 'S' })
  })
})
