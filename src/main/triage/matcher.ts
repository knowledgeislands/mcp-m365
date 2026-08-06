/**
 * Rule evaluation: strictly top-to-bottom, first match wins.
 *
 * Every predicate is a pure function of an {@link EmailRecord} plus an injected
 * `now` — no clock, no Graph, no I/O — so the replay fixtures exercise exactly
 * the code that runs against the live mailbox.
 */

import { renderGroup } from './parser.js'
import type { AndGroup, EmailRecord, MatchResult, PredicateTerm, Rule, TypeValue } from './types.js'

/** Injected evaluation context. `now` is a parameter so `age:` is deterministic under test. */
export interface MatchContext {
  now: Date
}

const MS_PER_DAY = 86_400_000

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Match one address against an address pattern.
 *
 * Supported forms, all case-insensitive:
 *   `person@example.com`  — exact address
 *   `*@example.com`       — any local part at exactly that domain
 *   `receipts+*@payments.example.net` — local-part wildcard
 *   `*@*.example.com`     — that domain OR any subdomain of it
 *
 * A bare `*@domain` deliberately does NOT match subdomains: allowing it would
 * let a broad disposal rule swallow a later, more specific rule on a subdomain
 * (`*@updates.tasks.example.net` vs `changelog@updates.tasks.example.net`). Subdomain reach
 * must be asked for explicitly with the `*.` form.
 */
export const matchesAddress = (pattern: string, address: string): boolean => {
  const pat = pattern.trim().toLowerCase()
  const addr = address.trim().toLowerCase()
  if (!addr) return false

  const patAt = pat.lastIndexOf('@')
  if (patAt === -1) return pat === addr

  const addrAt = addr.lastIndexOf('@')
  if (addrAt === -1) return false

  const patLocal = pat.slice(0, patAt)
  const patDomain = pat.slice(patAt + 1)
  const addrLocal = addr.slice(0, addrAt)
  const addrDomain = addr.slice(addrAt + 1)

  if (patDomain.startsWith('*.')) {
    const base = patDomain.slice(2)
    if (addrDomain !== base && !addrDomain.endsWith(`.${base}`)) return false
  } else if (patDomain !== addrDomain) {
    return false
  }

  if (patLocal === '*') return true
  if (!patLocal.includes('*')) return patLocal === addrLocal
  const localRe = new RegExp(`^${patLocal.split('*').map(escapeRegex).join('[^@]*')}$`)
  return localRe.test(addrLocal)
}

const SUBJECT_TYPE_PREFIXES: readonly (readonly [string, TypeValue])[] = [
  ['accepted:', 'calendar-response'],
  ['declined:', 'calendar-response'],
  ['tentative:', 'calendar-response'],
  ['tentatively accepted:', 'calendar-response'],
  ['canceled:', 'calendar-update'],
  ['cancelled:', 'calendar-update'],
  ['updated:', 'calendar-update'],
  ['invitation:', 'calendar-invite']
]

/**
 * Classify a message as a calendar invite / response / update.
 *
 * `PR_MESSAGE_CLASS` is authoritative when present; Graph's `@odata.type` is
 * the next-best signal; the localised subject prefix is the last resort, which
 * is why the design calls it a fallback rather than the primary test.
 */
export const detectType = (record: EmailRecord): TypeValue | null => {
  const messageClass = record.messageClass?.toLowerCase() ?? ''
  if (messageClass.startsWith('ipm.schedule.meeting.resp')) return 'calendar-response'
  if (messageClass.startsWith('ipm.schedule.meeting.canceled') || messageClass.startsWith('ipm.schedule.meeting.cancelled')) return 'calendar-update'
  if (messageClass.startsWith('ipm.schedule.meeting.request')) return 'calendar-invite'

  const odataType = record.odataType?.toLowerCase() ?? ''
  if (odataType.includes('eventmessageresponse')) return 'calendar-response'
  if (odataType.includes('eventmessagerequest')) return 'calendar-invite'

  const subject = record.subject.trim().toLowerCase()
  for (const [prefix, type] of SUBJECT_TYPE_PREFIXES) {
    if (subject.startsWith(prefix)) return type
  }
  return null
}

const contains = (haystack: string, needle: string): boolean => haystack.toLowerCase().includes(needle.toLowerCase())

const anyAddressMatches = (pattern: string, addresses: readonly string[]): boolean => addresses.some((a) => matchesAddress(pattern, a))

const evaluateStatus = (value: string, record: EmailRecord): boolean => {
  if (value === 'unread') return record.isRead === false
  if (value === 'replied') return record.replied === true
  return record.flag === value
}

/** Evaluate a single predicate, ignoring its `negated` flag (applied by the caller). */
export const evaluatePredicate = (term: PredicateTerm, record: EmailRecord, ctx: MatchContext): boolean => {
  switch (term.key) {
    case 'type':
      return detectType(record) === term.value
    case 'party':
      return anyAddressMatches(term.value, [record.from, ...record.to, ...record.cc])
    case 'sender':
      return matchesAddress(term.value, record.from)
    case 'to':
      return anyAddressMatches(term.value, record.to)
    case 'cc':
      return anyAddressMatches(term.value, record.cc)
    case 'subject':
      return contains(record.subject, term.value)
    case 'body':
      return contains(record.body, term.value)
    case 'importance':
      return record.importance === term.value
    case 'status':
      return evaluateStatus(term.value, record)
    case 'age': {
      const days = Number.parseInt(term.value, 10)
      const received = Date.parse(record.received)
      if (Number.isNaN(received)) return false
      return ctx.now.getTime() - received > days * MS_PER_DAY
    }
    /* v8 ignore next 2 — exhaustive over PredicateKey; `folder` is the final arm */
    default:
      return (record.folder ?? '').toLowerCase() === term.value.toLowerCase()
  }
}

/** Evaluate one term, honouring negation and the `*` match-everything form. */
export const evaluateTerm = (term: AndGroup['terms'][number], record: EmailRecord, ctx: MatchContext): boolean => {
  if (term.kind === 'any') return true
  const held = evaluatePredicate(term, record, ctx)
  return term.negated ? !held : held
}

/** An AND-group holds when every one of its juxtaposed terms holds. */
export const evaluateGroup = (group: AndGroup, record: EmailRecord, ctx: MatchContext): boolean => group.terms.every((term) => evaluateTerm(term, record, ctx))

/** Index of the first OR-group that holds, or -1. */
export const matchRule = (rule: Rule, record: EmailRecord, ctx: MatchContext): number => rule.groups.findIndex((group) => evaluateGroup(group, record, ctx))

/**
 * Run the ordered rule list against one message. First match wins; evaluation
 * stops there, which is what makes rule order the whole of the specification.
 */
export const classify = (rules: readonly Rule[], record: EmailRecord, ctx: MatchContext): MatchResult => {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index] as Rule
    const groupIndex = matchRule(rule, record, ctx)
    if (groupIndex !== -1) {
      return { ruleIndex: index, rule, groupIndex, ruleset: renderGroup(rule.groups[groupIndex] as AndGroup) }
    }
  }
  return { ruleIndex: -1 }
}
