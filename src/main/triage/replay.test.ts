/**
 * Replay suite — the Phase 3 paper replay, mechanised.
 *
 * Phase 3 walked 794 historical emails past the compiled rule list by
 * inspection and recorded what it found. Those findings are the fixtures here:
 * each case below is a claim that note makes about how a specific message must
 * be classified, now asserted against the engine that will actually do it.
 *
 * The rule file is a vendored snapshot of the knowledge-base note
 * (`fixtures/routing/email-routing-rules.md`) so the suite runs in CI without
 * the knowledge base mounted. Re-copy it when the note changes.
 */
import { readFileSync } from 'node:fs'
import { resolveMoveTarget } from './folders.js'
import { lintRules } from './lint.js'
import { classify } from './matcher.js'
import { parseRules, selectBlock } from './parser.js'
import type { EmailRecord, Matched, Rule } from './types.js'

const SOURCE = readFileSync(new URL('../../../fixtures/routing/email-routing-rules.md', import.meta.url), 'utf8')
const PARSED = parseRules(SOURCE)

const blockRules = (label: string): Rule[] => {
  const selected = selectBlock(PARSED, label)
  if ('error' in selected) throw new Error(selected.error)
  return selected.block.rules
}

const INBOUND = blockRules('inbound')
const AGED = blockRules('aged')

const NOW = new Date('2026-08-06T09:00:00Z')

const email = (over: Partial<EmailRecord> = {}): EmailRecord => ({
  subject: '',
  body: '',
  from: 'stranger@nowhere.example',
  to: [],
  cc: [],
  received: '2026-08-06T08:00:00Z',
  ...over
})

/** Route a message and report the destination folder its winning rule names. */
const route = (rules: Rule[], over: Partial<EmailRecord> = {}): string => {
  const result = classify(rules, email(over), { now: NOW })
  if (!('rule' in result)) return '(no match)'
  const move = result.rule.actions.find((action) => action.kind === 'move')
  return move ? resolveMoveTarget(move) : `(${result.rule.actions.map((a) => a.kind).join(', ')})`
}

const inbound = (over: Partial<EmailRecord> = {}): string => route(INBOUND, over)
const aged = (over: Partial<EmailRecord> = {}): string => route(AGED, over)

/** A calendar invite, the message class Phase 3's §C scan was restricted to. */
const invite = (over: Partial<EmailRecord>): Partial<EmailRecord> => ({ messageClass: 'IPM.Schedule.Meeting.Request', ...over })

describe('the rule file itself', () => {
  it('parses with no errors', () => {
    expect(PARSED.errors).toEqual([])
  })

  it('carries the two blocks the engine expects', () => {
    expect(PARSED.blocks.map((b) => b.label)).toEqual(['inbound', 'aged'])
  })

  it('ends the inbound block with the mandatory fallback', () => {
    expect(lintRules(PARSED).filter((f) => f.code === 'missing-fallback' || f.code === 'misplaced-fallback')).toEqual([])
  })
})

describe('A — literal predicate preservation', () => {
  it.each([
    ['party:*@partner.example.com', { from: 'contact@partner.example.com' }, '_TRIAGE/111 Partner'],
    ['party:*@partner.example.com via CC', { cc: ['contact@partner.example.com'] }, '_TRIAGE/111 Partner'],
    ['sender:*@db.example.net', { from: 'news@db.example.net' }, '_TRIAGE/981 Delete'],
    ['party:*@bulk.example.invalid', { from: 'sales@bulk.example.invalid' }, '_TRIAGE/981 Delete'],
    ['sender:noreply@code.example.net', { from: 'noreply@code.example.net' }, '_TRIAGE/981 Delete'],
    ['sender:*@chat.example.net', { from: 'no-reply@chat.example.net' }, '_TRIAGE/981 Delete'],
    ['party:*@accounts.example.net', { from: 'bill@accounts.example.net' }, '_TRIAGE/282 Finance'],
    ['sender:receipts+*@payments.example.net', { from: 'receipts+acct@payments.example.net' }, '_TRIAGE/311 Expenses'],
    ['party:*@legal.example.net', { from: 'legal@legal.example.net' }, '_TRIAGE/285 Legal'],
    ['party:*@media.example.net', { from: 'hello@media.example.net' }, '_TRIAGE/241 Media'],
    ['sender:*@newsletter.example.net', { from: 'digest@newsletter.example.net' }, '_TRIAGE/451 Read Later']
  ])('%s routes unchanged', (_label, over, expected) => {
    expect(inbound(over)).toBe(expected)
  })
})

describe('B — route-level entries', () => {
  it('routes a Junk (Delayed) sender to 991 Junk', () => {
    expect(inbound({ from: 'marketing@marketing.example.invalid' })).toBe('_TRIAGE/991 Junk')
  })

  it('routes a calendar response to 981 Delete regardless of who sent it', () => {
    expect(inbound({ from: 'contact@partner.example.com', subject: 'Accepted: Gcore sync' })).toBe('_TRIAGE/981 Delete')
  })

  it('routes a calendar update to 981 Delete', () => {
    expect(inbound({ messageClass: 'IPM.Schedule.Meeting.Canceled', subject: 'Canceled: standup' })).toBe('_TRIAGE/981 Delete')
  })
})

describe('C — the calendar-invite / project-route fix, all eight instances', () => {
  // Seven were caught and moved live during the Phase 3 session; "BFBS Follow up"
  // was the eighth and last, found in the full 794-email corpus.
  it.each([
    ['BFBS Follow up', { from: 'chris@internal.example.com' }],
    ['Partner workstream update', {}],
    ['partner conference prep', {}],
    ['Partner phase planning', {}],
    ['Partner meet-up', {}],
    ['5G- Emerge Phase 3 Planning', {}],
    ['Re: 5G -Emerge sync', {}],
    ['Partner catch-up', {}]
  ])('a calendar invite titled "%s" reaches its project folder, not 101 Do', (subject, over) => {
    expect(inbound(invite({ subject, ...over }))).toBe('_TRIAGE/111 Partner')
  })

  it('still sends a non-project calendar invite to 101 Do', () => {
    expect(inbound(invite({ subject: 'Dentist appointment' }))).toBe('_TRIAGE/101 Do')
  })
})

describe('C — the other two ordering transforms', () => {
  it('sends EBU Horizons to Events, not Partner, even from an EBU address', () => {
    expect(inbound({ from: 'contact@partner.example.com', subject: 'EBU Horizons agenda' })).toBe('_TRIAGE/251 Events')
    expect(inbound({ from: 'contact@partner.example.com', subject: 'Horizons 2026 registration' })).toBe('_TRIAGE/251 Events')
  })

  it('sends Lighthouse traffic to its own folder ahead of Partner', () => {
    expect(inbound({ from: 'contact@partner.example.com', body: 'an update on Lighthouse' })).toBe('_TRIAGE/112 Lighthouse')
    expect(inbound({ from: 'contact@partner.example.com', body: 'the Olympics In A Box demo' })).toBe('_TRIAGE/112 Lighthouse')
  })

  it('routes Telco by party and by body', () => {
    expect(inbound({ from: 'a@telco.example.net' })).toBe('_TRIAGE/113 Telco')
    expect(inbound({ body: 'call with Telco next week' })).toBe('_TRIAGE/113 Telco')
  })
})

describe('the Vendor guard, folded from a deny row into a negation', () => {
  it('disposes of ordinary Vendor notifications', () => {
    expect(inbound({ from: 'noreply@vendor.example.com', subject: 'Your monthly update' })).toBe('_TRIAGE/981 Delete')
  })

  it('keeps signature requests visible', () => {
    expect(inbound({ from: 'noreply@vendor.example.com', subject: 'Please sign your agreement' })).toBe('_TRIAGE/000 Unknown')
  })
})

describe('the resolved open question — a manual flag beats topic routing', () => {
  it('sends a flagged project email to Urgent', () => {
    expect(inbound({ from: 'contact@partner.example.com', flag: 'flagged' })).toBe('_TRIAGE/102 Urgent')
  })

  it('sends the same email to its project folder when it is not flagged', () => {
    expect(inbound({ from: 'contact@partner.example.com' })).toBe('_TRIAGE/111 Partner')
  })

  it('still disposes of a flagged calendar response — disposal precedes the flag', () => {
    expect(inbound({ from: 'contact@partner.example.com', flag: 'flagged', subject: 'Accepted: sync' })).toBe('_TRIAGE/981 Delete')
  })
})

describe('the two Phase 3 gaps', () => {
  it('now catches outreach cold outreach', () => {
    expect(inbound({ from: 'sales@outreach.example.invalid' })).toBe('_TRIAGE/991 Junk')
  })

  it('does not carry the self-matching internal-domain rule that was never agreed', () => {
    // `party:*@internal.example.com` matched 116 messages and would have routed
    // the whole mailbox to Exec. Its absence is the correct outcome.
    expect(inbound({ from: 'sam@internal.example.com', subject: 'lunch?' })).toBe('_TRIAGE/000 Unknown')
  })
})

describe('the fallback', () => {
  it('routes unrecognised mail to 000 Unknown and marks it for suggestion', () => {
    const result = classify(INBOUND, email({ from: 'nobody@unknown.example' }), { now: NOW }) as Matched
    expect(result.ruleset).toBe('*')
    expect(result.rule.actions.map((a) => a.kind)).toEqual(['move', 'suggest'])
  })

  it('is the last rule in the block', () => {
    expect(INBOUND[INBOUND.length - 1]?.groups[0]?.terms[0]).toEqual({ kind: 'any' })
  })
})

describe('the aged block', () => {
  it('archives Partner mail after seven days', () => {
    const result = classify(AGED, email({ folder: '111 Partner', received: '2026-07-20T09:00:00Z', flag: 'unflagged' }), { now: NOW })
    expect(result.ruleIndex).not.toBe(-1)
    expect((result as Matched).rule.actions.map((a) => a.kind)).toEqual(['move', 'tag', 'mark'])
    expect(aged({ folder: '111 Partner', received: '2026-07-20T09:00:00Z', flag: 'unflagged' })).toBe('_ARCHIVE/Success/Partner')
  })

  it('never archives a flagged message', () => {
    expect(aged({ folder: '111 Partner', received: '2026-07-20T09:00:00Z', flag: 'flagged' })).toBe('(no match)')
  })

  it('leaves a message younger than the retention window alone', () => {
    expect(aged({ folder: '111 Partner', received: '2026-08-05T09:00:00Z', flag: 'unflagged' })).toBe('(no match)')
  })

  it('deletes aged disposal mail', () => {
    expect(aged({ folder: '981 Delete', received: '2026-07-20T09:00:00Z', flag: 'unflagged' })).toBe('(delete)')
  })

  it('moves aged junk to the mailbox Junk Email folder, not a triage folder', () => {
    expect(aged({ folder: '991 Junk', received: '2026-07-20T09:00:00Z', flag: 'unflagged' })).toBe('Junk Email')
  })

  it('returns a message to Unknown once its flag is cleared', () => {
    expect(aged({ folder: '102 Urgent', flag: 'unflagged' })).toBe('_TRIAGE/000 Unknown')
  })
})

describe('lint over the live rule file', () => {
  const findings = lintRules(PARSED)

  it('reports no parse or fallback errors', () => {
    expect(findings.filter((f) => ['parse-error', 'missing-fallback', 'misplaced-fallback'].includes(f.code))).toEqual([])
  })

  /**
   * Four rules in the file are unreachable. Two are harmless (a narrower rule
   * below a broader one with the same destination); two are live defects where
   * mail is being disposed of instead of filed. Pinned here so the set cannot
   * grow unnoticed — shrink this list as they are fixed in the note.
   */
  it('reports exactly the four known unreachable rules', () => {
    const shadowed = findings.filter((f) => f.code === 'shadowed-rule').map((f) => f.source?.replace(/\s+/g, ' ').trim())
    expect(shadowed).toEqual([
      'sender:notifications@tasks.example.net -> move:981 Delete # Linear in-app notification emails',
      'party:members@forum.example.org -> move:241 Media',
      'sender:noreply@code.example.net subject:"Payment Receipt" -> move:282 Finance # GitHub payment receipts',
      'sender:changelog@updates.tasks.example.net -> move:451 Read Later # Linear changelog digest'
    ])
  })

  /** Two of the four are live defects: mail is being disposed of instead of filed. */
  it('confirms GitHub payment receipts and the Linear changelog are currently mis-routed', () => {
    expect(inbound({ from: 'noreply@code.example.net', subject: 'Payment Receipt for GitHub' })).toBe('_TRIAGE/981 Delete')
    expect(inbound({ from: 'changelog@updates.tasks.example.net' })).toBe('_TRIAGE/981 Delete')
  })

  it('confirms the hoisted flag rule is exempt from the collision report', () => {
    const collisions = findings.filter((f) => f.code === 'broad-rule-collision').map((f) => f.source)
    expect(collisions.some((source) => source?.includes('status:flagged'))).toBe(false)
  })
})
