/**
 * End-to-end semantics over a complete rule file.
 *
 * The unit suites cover each component in isolation; this one exercises a whole
 * file the way the engine will, and pins the *classes of behaviour* that the
 * Phase 3 replay identified as load-bearing:
 *
 *   - a broad rule placed above specific ones swallows them (the hazard)
 *   - an exception must precede the rule it is an exception to (the fix)
 *   - a bare `*@domain` does not reach subdomains (the reason the fix is safe)
 *   - the first-match-wins ordering is the whole specification
 *
 * The fixture is SYNTHETIC — `fixtures/routing/example-rules.md`, built from
 * RFC 2606 reserved domains and generic folder names. It deliberately does not
 * mirror any real rule file: this repository is public, and a real routing
 * table is a map of its owner's correspondents. Behaviour classes are what is
 * worth regression-testing; a particular person's address list is not.
 *
 * A real file is validated by running `ki:lint:rules` against it in place.
 */
import { readFileSync } from 'node:fs'
import { resolveMoveTarget } from './folders.js'
import { lintRules } from './lint.js'
import { classify } from './matcher.js'
import { parseRules, selectBlock } from './parser.js'
import type { EmailRecord, Matched, Rule } from './types.js'

const SOURCE = readFileSync(new URL('../../../fixtures/routing/example-rules.md', import.meta.url), 'utf8')
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

const invite = (over: Partial<EmailRecord>): Partial<EmailRecord> => ({
  messageClass: 'IPM.Schedule.Meeting.Request',
  ...over
})

describe('the fixture itself', () => {
  it('parses with no errors', () => {
    expect(PARSED.errors).toEqual([])
  })

  it('carries the two blocks the engine expects', () => {
    expect(PARSED.blocks.map((b) => b.label)).toEqual(['inbound', 'aged'])
  })

  it('lints clean apart from the deliberate, unmarked collisions', () => {
    expect(lintRules(PARSED).filter((f) => f.severity === 'error')).toEqual([])
  })
})

describe('address matching', () => {
  it.each([
    ['exact address', { from: 'billing@vendor.example.com' }, '_TRIAGE/282 Finance'],
    ['any local part at a domain', { from: 'anyone@partner.example.com' }, '_TRIAGE/111 Partner'],
    ['local-part wildcard', { from: 'receipts+acct@vendor.example.com' }, '_TRIAGE/311 Expenses'],
    ['domain and its subdomains', { from: 'alerts@eu.cloud.example.net' }, '_TRIAGE/981 Delete'],
    ['party: matches the sender', { from: 'someone@partner.example.com' }, '_TRIAGE/111 Partner'],
    ['party: also matches a CC', { cc: ['someone@partner.example.com'] }, '_TRIAGE/111 Partner'],
    ['to: matches a named recipient', { to: ['events@example.com'] }, '_TRIAGE/251 Events'],
    ['cc: matches a named copy', { cc: ['legal@example.com'] }, '_TRIAGE/285 Legal']
  ])('%s', (_label, over, expected) => {
    expect(inbound(over)).toBe(expected)
  })

  it('does not let a bare *@domain reach a subdomain', () => {
    // `sender:*@example.org` sits above `sender:*@lists.example.org`. If the
    // bare form reached subdomains, the second rule would be unreachable — and
    // more importantly, a broad disposal rule would silently swallow every
    // later, more specific subdomain rule. The lint agrees:
    const shadowed = lintRules(PARSED).filter((f) => f.code === 'shadowed-rule')
    expect(shadowed).toEqual([])
  })
})

describe('predicate combination', () => {
  it('treats juxtaposition as AND — both terms must hold', () => {
    expect(inbound({ from: 'x@partner.example.com', subject: 'contract renewal' })).toBe('_TRIAGE/263 BizDev')
    expect(inbound({ from: 'x@partner.example.com', subject: 'something else' })).toBe('_TRIAGE/111 Partner')
  })

  it('treats | as OR across AND-groups — any group may match', () => {
    expect(inbound({ subject: 'the widget spec' })).toBe('_TRIAGE/221 Widgets')
    expect(inbound({ subject: 'two widgets' })).toBe('_TRIAGE/221 Widgets')
    expect(inbound({ body: 'a widget, mentioned in the body' })).toBe('_TRIAGE/221 Widgets')
  })

  it('honours negation — the rule fires only when the negated term is absent', () => {
    expect(inbound({ from: 'bot@notify.example.net', subject: 'weekly digest' })).toBe('_TRIAGE/981 Delete')
    expect(inbound({ from: 'bot@notify.example.net', subject: 'security alert' })).toBe('_TRIAGE/000 Unknown')
  })

  it('matches a quoted value containing spaces', () => {
    expect(inbound({ from: 'noreply@example.com', subject: 'Payment Receipt #4' })).toBe('_TRIAGE/282 Finance')
  })

  it('matches on importance', () => {
    expect(inbound({ from: 'nobody@nowhere.invalid', importance: 'high' })).toBe('_TRIAGE/102 Urgent')
  })
})

describe('first match wins — the ordering hazard, and the fix for it', () => {
  it('lets a broad rule placed high swallow every specific rule below it', () => {
    // `type:calendar-invite` sits above the topic rules on purpose, so an invite
    // that would otherwise be filed by topic collects in one folder instead.
    // This is exactly the shape of bug the Phase 3 replay was built to find; it
    // is only correct here because it is deliberate and marked.
    expect(inbound(invite({ body: 'about the lighthouse project' }))).toBe('_TRIAGE/101 Do')
    expect(inbound(invite({ from: 'x@partner.example.com' }))).toBe('_TRIAGE/101 Do')
  })

  it('routes those same messages by topic when the broad rule does not apply', () => {
    expect(inbound({ body: 'about the lighthouse project' })).toBe('_TRIAGE/112 Lighthouse')
    expect(inbound({ from: 'x@partner.example.com' })).toBe('_TRIAGE/111 Partner')
  })

  it('rescues a carve-out by placing it above the rule it escapes', () => {
    // Below the disposal rule, this would be unreachable and the mail silently
    // deleted — the defect class the `shadowed-rule` check exists to catch.
    expect(inbound({ from: 'noreply@example.com', subject: 'Payment Receipt' })).toBe('_TRIAGE/282 Finance')
    expect(inbound({ from: 'noreply@example.com', subject: 'weekly digest' })).toBe('_TRIAGE/981 Delete')
  })

  it('applies the same rescue across a subdomain boundary', () => {
    expect(inbound({ from: 'updates@lists.example.org' })).toBe('_TRIAGE/451 Read Later')
    expect(inbound({ from: 'other@lists.example.org' })).toBe('_TRIAGE/981 Delete')
  })

  it('orders a narrower topic ahead of the broader one it would otherwise fall into', () => {
    expect(inbound({ from: 'x@partner.example.com', body: 'the lighthouse rollout' })).toBe('_TRIAGE/112 Lighthouse')
  })
})

describe('an absolute override at the top of the file', () => {
  it('pre-empts topic routing', () => {
    expect(inbound({ from: 'x@partner.example.com', flag: 'flagged' })).toBe('_TRIAGE/102 Urgent')
    expect(inbound({ from: 'x@partner.example.com' })).toBe('_TRIAGE/111 Partner')
  })

  it('pre-empts disposal too — which is the consequence worth noticing', () => {
    // A rule at position 1 beats everything, including the rules that would
    // have thrown the message away. Intended here, but it is the reason the
    // collision check reports broad high rules at all.
    expect(inbound({ from: 'junk@bulk.example.invalid', flag: 'flagged' })).toBe('_TRIAGE/102 Urgent')
    expect(inbound({ from: 'junk@bulk.example.invalid' })).toBe('_TRIAGE/991 Junk')
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
  it('archives mail from a tracked folder after the retention window', () => {
    const result = classify(
      AGED,
      email({ folder: '111 Partner', received: '2026-07-20T09:00:00Z', flag: 'unflagged' }),
      { now: NOW }
    )
    expect(result.ruleIndex).not.toBe(-1)
    expect((result as Matched).rule.actions.map((a) => a.kind)).toEqual(['move', 'tag', 'mark'])
    expect(aged({ folder: '111 Partner', received: '2026-07-20T09:00:00Z', flag: 'unflagged' })).toBe(
      '_ARCHIVE/Partner'
    )
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

describe('lint over a whole file', () => {
  const findings = lintRules(PARSED)

  it('reports no parse or fallback errors', () => {
    expect(findings.filter((f) => ['parse-error', 'missing-fallback', 'misplaced-fallback'].includes(f.code))).toEqual(
      []
    )
  })

  it('reports no unreachable rules', () => {
    expect(findings.filter((f) => f.code === 'shadowed-rule')).toEqual([])
  })

  it('reports the unmarked broad rules as collisions', () => {
    const collisions = findings.filter((f) => f.code === 'broad-rule-collision').map((f) => f.source?.trim())
    expect(collisions).toEqual([
      'type:calendar-response                                  -> move:981 Delete',
      'type:calendar-update                                    -> move:981 Delete',
      'importance:high                                         -> move:102 Urgent'
    ])
  })

  it('exempts a rule carrying the allow-collision marker', () => {
    // Both `status:flagged` and `type:calendar-invite` are broad rules at the
    // very top — the highest-collision positions in the file — and neither is
    // reported, because each carries `# lint:allow-collision`.
    const collisions = findings.filter((f) => f.code === 'broad-rule-collision').map((f) => f.source ?? '')
    expect(collisions.some((s) => s.includes('status:flagged'))).toBe(false)
    expect(collisions.some((s) => s.includes('type:calendar-invite'))).toBe(false)
  })
})
