import {
  classify,
  detectType,
  evaluateGroup,
  evaluatePredicate,
  evaluateTerm,
  matchesAddress,
  matchRule
} from './matcher.js'
import { parseRules } from './parser.js'
import type { AndGroup, EmailRecord, Matched, PredicateTerm, Rule } from './types.js'

const NOW = new Date('2026-08-06T09:00:00Z')
const ctx = { now: NOW }

const record = (over: Partial<EmailRecord> = {}): EmailRecord => ({
  subject: '',
  body: '',
  from: 'someone@example.com',
  to: [],
  cc: [],
  received: '2026-08-06T08:00:00Z',
  ...over
})

const rulesOf = (body: string): Rule[] => {
  const parsed = parseRules(`## Inbound\n\n\`\`\`rules v1\n${body}\n\`\`\`\n`)
  expect(parsed.errors).toEqual([])
  return parsed.blocks[0]?.rules ?? []
}

const term = (text: string): PredicateTerm => rulesOf(`${text} -> move:X`)[0]?.groups[0]?.terms[0] as PredicateTerm

describe('matchesAddress', () => {
  it.each([
    ['*@partner.example.com', 'contact@partner.example.com', true],
    ['*@partner.example.com', 'CONTACT@PARTNER.EXAMPLE.COM', true],
    ['*@partner.example.com', 'someone@notpartner.example.com', false],
    ['noreply@code.example.net', 'noreply@code.example.net', true],
    ['noreply@code.example.net', 'no-reply@code.example.net', false],
    ['receipts+*@payments.example.net', 'receipts+acct1@payments.example.net', true],
    ['receipts+*@payments.example.net', 'billing@payments.example.net', false],
    ['*@*.cloud.example.net', 'no-reply@sns.cloud.example.net', true],
    ['*@*.cloud.example.net', 'no-reply@cloud.example.net', true],
    ['*@*.cloud.example.net', 'no-reply@cloud.example.net.evil.net', false]
  ])('%s vs %s → %s', (pattern, address, expected) => {
    expect(matchesAddress(pattern, address)).toBe(expected)
  })

  it('does not let a bare *@domain reach subdomains', () => {
    // Otherwise `*@tasks.example.net -> Delete` would swallow `changelog@updates.tasks.example.net -> Read Later`.
    expect(matchesAddress('*@tasks.example.net', 'changelog@updates.tasks.example.net')).toBe(false)
  })

  it('returns false for an empty address', () => {
    expect(matchesAddress('*@partner.example.com', '')).toBe(false)
  })

  it('compares a pattern with no @ against the whole address', () => {
    expect(matchesAddress('partner.example.com', 'partner.example.com')).toBe(true)
    expect(matchesAddress('partner.example.com', 'a@partner.example.com')).toBe(false)
  })

  it('returns false when the address has no @ but the pattern does', () => {
    expect(matchesAddress('*@partner.example.com', 'notanaddress')).toBe(false)
  })

  it('escapes regex metacharacters in a wildcard local part', () => {
    expect(matchesAddress('a.b*@x.com', 'a.bc@x.com')).toBe(true)
    expect(matchesAddress('a.b*@x.com', 'axbc@x.com')).toBe(false)
  })
})

describe('detectType', () => {
  it.each([
    ['IPM.Schedule.Meeting.Request', 'calendar-invite'],
    ['IPM.Schedule.Meeting.Resp.Pos', 'calendar-response'],
    ['IPM.Schedule.Meeting.Canceled', 'calendar-update'],
    ['IPM.Schedule.Meeting.Cancelled', 'calendar-update']
  ])('reads %s from the message class', (messageClass, expected) => {
    expect(detectType(record({ messageClass }))).toBe(expected)
  })

  it.each([
    ['#microsoft.graph.eventMessageRequest', 'calendar-invite'],
    ['#microsoft.graph.eventMessageResponse', 'calendar-response']
  ])('falls back to the OData type %s', (odataType, expected) => {
    expect(detectType(record({ odataType }))).toBe(expected)
  })

  it.each([
    ['Accepted: Standup', 'calendar-response'],
    ['Declined: Standup', 'calendar-response'],
    ['Tentative: Standup', 'calendar-response'],
    ['Tentatively accepted: Standup', 'calendar-response'],
    ['Canceled: Standup', 'calendar-update'],
    ['Cancelled: Standup', 'calendar-update'],
    ['Updated: Standup', 'calendar-update'],
    ['Invitation: Standup', 'calendar-invite']
  ])('falls back to the subject prefix %s', (subject, expected) => {
    expect(detectType(record({ subject }))).toBe(expected)
  })

  it('prefers the message class over a misleading subject', () => {
    expect(detectType(record({ messageClass: 'IPM.Schedule.Meeting.Request', subject: 'Accepted: x' }))).toBe(
      'calendar-invite'
    )
  })

  it('returns null for ordinary mail', () => {
    expect(
      detectType(record({ subject: 'Hello', messageClass: 'IPM.Note', odataType: '#microsoft.graph.message' }))
    ).toBeNull()
  })
})

describe('evaluatePredicate', () => {
  it('matches type via the detected calendar class', () => {
    expect(
      evaluatePredicate(term('type:calendar-invite'), record({ messageClass: 'IPM.Schedule.Meeting.Request' }), ctx)
    ).toBe(true)
  })

  it('matches party across From, To and CC', () => {
    const t = term('party:*@partner.example.com')
    expect(evaluatePredicate(t, record({ from: 'a@partner.example.com' }), ctx)).toBe(true)
    expect(evaluatePredicate(t, record({ to: ['b@partner.example.com'] }), ctx)).toBe(true)
    expect(evaluatePredicate(t, record({ cc: ['c@partner.example.com'] }), ctx)).toBe(true)
    expect(evaluatePredicate(t, record(), ctx)).toBe(false)
  })

  it('matches sender, to and cc directionally', () => {
    const rec = record({ from: 'a@x.com', to: ['b@y.com'], cc: ['c@z.com'] })
    expect(evaluatePredicate(term('sender:*@x.com'), rec, ctx)).toBe(true)
    expect(evaluatePredicate(term('sender:*@y.com'), rec, ctx)).toBe(false)
    expect(evaluatePredicate(term('to:*@y.com'), rec, ctx)).toBe(true)
    expect(evaluatePredicate(term('cc:*@z.com'), rec, ctx)).toBe(true)
    expect(evaluatePredicate(term('cc:*@y.com'), rec, ctx)).toBe(false)
  })

  it('matches subject and body case-insensitively as a substring', () => {
    expect(evaluatePredicate(term('subject:"BFBS"'), record({ subject: 'BFBS Follow up' }), ctx)).toBe(true)
    expect(evaluatePredicate(term('subject:bfbs'), record({ subject: 'Re: BFBS' }), ctx)).toBe(true)
    expect(evaluatePredicate(term('body:TelemetryHub'), record({ body: 'the telemetryhub build' }), ctx)).toBe(true)
    expect(evaluatePredicate(term('body:Lighthouse'), record({ body: 'unrelated' }), ctx)).toBe(false)
  })

  it('matches importance', () => {
    expect(evaluatePredicate(term('importance:high'), record({ importance: 'high' }), ctx)).toBe(true)
    expect(evaluatePredicate(term('importance:low'), record({ importance: 'normal' }), ctx)).toBe(false)
  })

  it.each([
    ['status:flagged', { flag: 'flagged' as const }, true],
    ['status:unflagged', { flag: 'unflagged' as const }, true],
    ['status:complete', { flag: 'complete' as const }, true],
    ['status:flagged', { flag: 'unflagged' as const }, false],
    ['status:unread', { isRead: false }, true],
    ['status:unread', { isRead: true }, false],
    ['status:replied', { replied: true }, true],
    ['status:replied', {}, false]
  ])('matches %s', (text, over, expected) => {
    expect(evaluatePredicate(term(text), record(over), ctx)).toBe(expected)
  })

  it('matches age strictly older than N days', () => {
    const t = term('age:7d')
    expect(evaluatePredicate(t, record({ received: '2026-07-20T09:00:00Z' }), ctx)).toBe(true)
    expect(evaluatePredicate(t, record({ received: '2026-08-05T09:00:00Z' }), ctx)).toBe(false)
  })

  it('treats an unparseable received timestamp as not aged', () => {
    expect(evaluatePredicate(term('age:7d'), record({ received: 'not-a-date' }), ctx)).toBe(false)
  })

  it('matches the current folder case-insensitively', () => {
    expect(evaluatePredicate(term('folder:"111 Partner"'), record({ folder: '111 partner' }), ctx)).toBe(true)
    expect(evaluatePredicate(term('folder:"111 Partner"'), record(), ctx)).toBe(false)
  })
})

describe('evaluateTerm and evaluateGroup', () => {
  it('honours negation', () => {
    expect(evaluateTerm(term('!subject:sign'), record({ subject: 'Contract' }), ctx)).toBe(true)
    expect(evaluateTerm(term('!subject:sign'), record({ subject: 'Please sign' }), ctx)).toBe(false)
  })

  it('treats the match-everything term as always true', () => {
    expect(evaluateTerm({ kind: 'any' }, record(), ctx)).toBe(true)
  })

  it('requires every juxtaposed term to hold', () => {
    const group = rulesOf('sender:*@vendor.example.com !subject:sign -> move:981 Delete')[0]?.groups[0] as AndGroup
    expect(evaluateGroup(group, record({ from: 'a@vendor.example.com', subject: 'Update' }), ctx)).toBe(true)
    expect(evaluateGroup(group, record({ from: 'a@vendor.example.com', subject: 'Please sign' }), ctx)).toBe(false)
  })
})

describe('matchRule', () => {
  it('returns the index of the OR-arm that fired', () => {
    const rule = rulesOf('subject:alpha | subject:beta -> move:X')[0] as Rule
    expect(matchRule(rule, record({ subject: 'beta release' }), ctx)).toBe(1)
    expect(matchRule(rule, record({ subject: 'gamma' }), ctx)).toBe(-1)
  })
})

describe('classify', () => {
  const rules = rulesOf(
    [
      'sender:*@junk.com -> move:991 Junk',
      'subject:"BFBS" -> move:111 Partner',
      '* -> move:000 Unknown, suggest'
    ].join('\n')
  )

  it('stops at the first match — order is the whole specification', () => {
    const result = classify(rules, record({ from: 'a@junk.com', subject: 'BFBS Follow up' }), ctx) as Matched
    expect(result.ruleIndex).toBe(0)
    expect(result.ruleset).toBe('sender:*@junk.com')
  })

  it('reaches a later rule when earlier ones do not match', () => {
    expect(classify(rules, record({ subject: 'BFBS Follow up' }), ctx).ruleIndex).toBe(1)
  })

  it('falls through to the fallback', () => {
    const result = classify(rules, record({ subject: 'Anything' }), ctx) as Matched
    expect(result.ruleIndex).toBe(2)
    expect(result.ruleset).toBe('*')
  })

  it('reports no match when there is no fallback', () => {
    expect(classify(rulesOf('sender:*@junk.com -> move:991 Junk'), record(), ctx)).toEqual({ ruleIndex: -1 })
  })
})
