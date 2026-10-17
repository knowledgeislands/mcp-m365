import { bindThreadTarget, filedFolders, firstThreadRule, resolveThread, type ThreadSibling } from './lookups.js'
import { parseRules } from './parser.js'
import type { EmailRecord, Rule, RuleBlock } from './types.js'

const NOTE = [
  '## Inbound',
  '',
  '```rules v1',
  'sender:*@junk.example -> move:991 Junk',
  'party:*@partner.example.com -> move:111 Partner',
  'subject:board -> move:"Board Papers"',
  'thread:filed -> move:@thread',
  'party:*@other.example.com -> move:112 Other',
  'subject:minutes -> move:_ARCHIVE/Minutes',
  '* -> move:000 Unknown, suggest',
  '```',
  '',
  '## Aged',
  '',
  '```rules v1',
  'folder:"111 Partner" age:30d -> move:_ARCHIVE/Partner',
  'folder:"112 Other" age:30d | folder:"991 Junk" age:30d -> move:_ARCHIVE/Shared',
  'folder:"000 Unknown" age:60d -> move:_ARCHIVE/Old',
  'folder:"111 Partner" age:90d -> move:_ARCHIVE/Minutes',
  '!folder:"112 Other" age:400d -> move:_ARCHIVE/Ancient',
  'folder:"981 Delete" age:7d -> delete',
  '```'
].join('\n')

const blocksOf = (source: string): RuleBlock[] => {
  const parsed = parseRules(source)
  expect(parsed.errors).toEqual([])
  return parsed.blocks
}

const FILED = filedFolders(blocksOf(NOTE))

const self: EmailRecord = {
  subject: 'Re: Partner sync',
  body: '',
  from: 'contact@partner.example.com',
  to: [],
  cc: [],
  received: '2026-08-05T09:00:00Z'
}

const sibling = (folder: string, received: string, over: Partial<ThreadSibling> = {}): ThreadSibling => ({
  subject: 'Partner sync',
  from: 'owner@example.com',
  received,
  folder,
  ...over
})

describe('filedFolders', () => {
  it('treats every inbound move target except the fallback as filed', () => {
    expect(FILED.targets.get('_triage/991 junk')).toBe('_TRIAGE/991 Junk')
    expect(FILED.targets.get('_triage/111 partner')).toBe('_TRIAGE/111 Partner')
    expect(FILED.targets.get('board papers')).toBe('Board Papers')
    expect(FILED.targets.has('_triage/000 unknown')).toBe(false)
    expect(FILED.targets.has('_triage/@thread')).toBe(false)
  })

  it('maps an archive back to the one filed folder that feeds it', () => {
    expect(FILED.targets.get('_archive/partner')).toBe('_TRIAGE/111 Partner')
  })

  it('keeps an archive that inbound rules also file into as itself', () => {
    expect(FILED.targets.get('_archive/minutes')).toBe('_ARCHIVE/Minutes')
  })

  it('marks an archive fed from two filed folders as ambiguous', () => {
    expect(FILED.targets.has('_archive/shared')).toBe(false)
    expect(FILED.ambiguous.has('_archive/shared')).toBe(true)
  })

  it('ignores an archive fed only from the fallback folder, or by a negated folder test', () => {
    expect(FILED.targets.has('_archive/old')).toBe(false)
    expect(FILED.ambiguous.has('_archive/old')).toBe(false)
    expect(FILED.targets.has('_archive/ancient')).toBe(false)
  })

  it('never counts the fallback folder as filed, even when another rule moves there', () => {
    const filed = filedFolders(blocksOf('rules v1\nsubject:unsure -> move:000 Unknown\n* -> move:000 Unknown, suggest'))
    expect(filed.targets.size).toBe(0)
  })

  it('reads a bare rule list as the inbound block', () => {
    const bare = filedFolders(blocksOf('rules v1\nsender:a@b.com -> move:101 Do\n* -> move:000 Unknown'))
    expect([...bare.targets.values()]).toEqual(['_TRIAGE/101 Do'])
  })

  it('finds nothing filed without an inbound block', () => {
    const agedOnly = filedFolders(
      blocksOf(
        '## Aged\n\n```rules v1\nfolder:X age:7d -> move:Y\n```\n\n## Other\n\n```rules v1\nsubject:z -> move:Z\n```'
      )
    )
    expect(agedOnly.targets.size).toBe(0)
  })
})

describe('resolveThread', () => {
  it('routes to the folder of the single filed sibling', () => {
    expect(resolveThread(self, [sibling('_TRIAGE/111 Partner', '2026-08-01T09:00:00Z')], FILED)).toEqual({
      folder: '_TRIAGE/111 Partner',
      alternatives: [],
      skipped: []
    })
  })

  it('routes a sibling in an archive to the folder that feeds it', () => {
    expect(resolveThread(self, [sibling('_ARCHIVE/Partner', '2026-07-01T09:00:00Z')], FILED)?.folder).toBe(
      '_TRIAGE/111 Partner'
    )
  })

  it('chooses the most recent filed sibling and reports the other folders', () => {
    const resolved = resolveThread(
      self,
      [
        sibling('_TRIAGE/111 Partner', '2026-08-01T09:00:00Z'),
        sibling('_TRIAGE/112 Other', '2026-08-03T09:00:00Z'),
        sibling('_ARCHIVE/Partner', '2026-07-01T09:00:00Z'),
        sibling('_triage/111 partner', '2026-07-20T09:00:00Z')
      ],
      FILED
    )
    expect(resolved).toEqual({ folder: '_TRIAGE/112 Other', alternatives: ['_TRIAGE/111 Partner'], skipped: [] })
  })

  it('skips an ambiguous archive and lets the next sibling decide, saying so', () => {
    const resolved = resolveThread(
      self,
      [sibling('_ARCHIVE/Shared', '2026-08-04T09:00:00Z'), sibling('_TRIAGE/111 Partner', '2026-08-01T09:00:00Z')],
      FILED
    )
    expect(resolved).toEqual({ folder: '_TRIAGE/111 Partner', alternatives: [], skipped: ['_ARCHIVE/Shared'] })
  })

  it('finds nothing when no sibling is filed', () => {
    expect(
      resolveThread(
        self,
        [
          sibling('Sent Items', '2026-08-04T09:00:00Z'),
          sibling('_TRIAGE/000 Unknown', '2026-08-03T09:00:00Z'),
          sibling('_ARCHIVE/Shared', '2026-08-02T09:00:00Z')
        ],
        FILED
      )
    ).toBeNull()
    expect(resolveThread(self, [], FILED)).toBeNull()
  })

  it('excludes the message itself by subject, sender and received time', () => {
    const itself = sibling('_TRIAGE/111 Partner', self.received, { subject: self.subject, from: self.from })
    expect(resolveThread(self, [itself], FILED)).toBeNull()
  })

  it('sorts a sibling with an unreadable timestamp last', () => {
    const resolved = resolveThread(
      self,
      [sibling('_TRIAGE/112 Other', 'not-a-date'), sibling('_TRIAGE/111 Partner', '2026-08-01T09:00:00Z')],
      FILED
    )
    expect(resolved?.folder).toBe('_TRIAGE/111 Partner')
    expect(resolved?.alternatives).toEqual(['_TRIAGE/112 Other'])
  })

  it('keeps written order between siblings whose timestamps are both unreadable', () => {
    const resolved = resolveThread(
      self,
      [sibling('_TRIAGE/112 Other', ''), sibling('_TRIAGE/111 Partner', 'bad')],
      FILED
    )
    expect(resolved?.folder).toBe('_TRIAGE/112 Other')
  })
})

describe('firstThreadRule', () => {
  const rulesOf = (body: string): Rule[] => blocksOf(`rules v1\n${body}`)[0]?.rules ?? []

  it('finds the first rule that tests thread:, negated or not', () => {
    expect(firstThreadRule(rulesOf('subject:a -> move:A\n!thread:filed subject:b -> move:B\n* -> move:C'))).toBe(1)
    expect(firstThreadRule(rulesOf('subject:a | thread:filed -> move:@thread\n* -> move:C'))).toBe(0)
  })

  it('returns -1 for a rule file without thread-follow', () => {
    expect(firstThreadRule(rulesOf('subject:a -> move:A\n* -> move:C'))).toBe(-1)
  })
})

describe('bindThreadTarget', () => {
  const actions = [
    { kind: 'move' as const, value: '@thread', quoted: false },
    { kind: 'tag' as const, value: 'Thread', quoted: false }
  ]

  it('replaces @thread with the resolved folder as an absolute target', () => {
    expect(bindThreadTarget(actions, '_TRIAGE/111 Partner')).toEqual([
      { kind: 'move', value: '_TRIAGE/111 Partner', quoted: true },
      { kind: 'tag', value: 'Thread', quoted: false }
    ])
  })

  it('leaves the actions alone when nothing was resolved', () => {
    expect(bindThreadTarget(actions, undefined)).toBe(actions)
  })
})
