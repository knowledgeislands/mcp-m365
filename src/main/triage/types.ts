/**
 * Shared types for the email routing engine (the `email_*` triage tools).
 *
 * The engine executes a flat, ordered, first-match-wins rule list authored in
 * the line DSL specified by the Email Routing Engine Design note. Rules are
 * DATA — they arrive as a string in each tool call and the server holds no rule
 * state; the knowledge-base note remains the single source of truth.
 */

/** Predicate keys accepted by the v1 grammar. */
export const PREDICATE_KEYS = ['type', 'party', 'sender', 'to', 'cc', 'subject', 'body', 'importance', 'status', 'age', 'folder'] as const
export type PredicateKey = (typeof PREDICATE_KEYS)[number]

/**
 * Predicates that say nothing about who sent a message or what it is about.
 * They cut across every topic, so an early rule built only from these will
 * claim mail that a later, topically-specific rule was written for — the
 * calendar-invite/project-route collision class the lint must catch.
 */
export const BROAD_KEYS: readonly PredicateKey[] = ['type', 'status', 'importance', 'age'] as const

export const TYPE_VALUES = ['calendar-invite', 'calendar-response', 'calendar-update'] as const
export const IMPORTANCE_VALUES = ['high', 'low'] as const
export const STATUS_VALUES = ['flagged', 'unflagged', 'complete', 'unread', 'replied'] as const
export const MARK_VALUES = ['read', 'unread', 'flagged', 'unflagged'] as const

export type TypeValue = (typeof TYPE_VALUES)[number]
export type StatusValue = (typeof STATUS_VALUES)[number]
export type MarkValue = (typeof MARK_VALUES)[number]

/** A single `key:value` test, optionally negated with `!`. */
export interface PredicateTerm {
  kind: 'predicate'
  key: PredicateKey
  value: string
  /** Whether the value was written in double quotes — only affects `move:` target resolution and diagnostics, never matching. */
  quoted: boolean
  negated: boolean
}

/** The `*` match-everything term. Valid only as a rule's sole term (the fallback). */
export interface AnyTerm {
  kind: 'any'
}

export type Term = PredicateTerm | AnyTerm

/** Juxtaposed terms — all must hold. */
export interface AndGroup {
  terms: Term[]
}

export type ActionKind = 'move' | 'tag' | 'mark' | 'delete' | 'suggest'

export interface Action {
  kind: ActionKind
  /** Absent for `delete` / `suggest`. */
  value?: string
  /** Whether the value was double-quoted — a quoted `move:` target is an absolute folder name, not `_TRIAGE`-relative. */
  quoted?: boolean
}

/** One logical rule: `predicates -> actions [# comment]`. */
export interface Rule {
  /** 1-based line number of the rule's first physical line, within the whole source string. */
  line: number
  /** OR of AND-groups. A rule matches when any group matches. */
  groups: AndGroup[]
  actions: Action[]
  comment?: string
  /** The reassembled logical line, comment included — echoed in reports so findings are self-describing. */
  source: string
}

/** A fenced ```rules block. The note carries two: `inbound` and `aged`. */
export interface RuleBlock {
  /** Lower-cased nearest preceding markdown heading, or `default` for a bare (unfenced) rule list. */
  label: string
  version: string
  rules: Rule[]
  /** 1-based line number of the fence (or first line, when unfenced). */
  startLine: number
}

export interface ParseError {
  line: number
  message: string
  source?: string
}

export interface ParseResult {
  blocks: RuleBlock[]
  errors: ParseError[]
}

/**
 * A message normalised for matching. Built from Graph in production and from
 * literals in the replay fixtures, so the matcher never touches Graph shapes.
 *
 * Identity is `subject` + `from` + `received` — NEVER `id`. Graph reissues ids
 * on folder moves, so an id is only ever a cache hint that must be re-verified.
 */
export interface EmailRecord {
  /** Graph id, when known. A hint only: every mutation re-resolves identity before acting. */
  id?: string
  subject: string
  /** Body text (or bodyPreview when the full body was not fetched). */
  body: string
  /** Sender address, lower-cased. */
  from: string
  to: string[]
  cc: string[]
  /** ISO 8601 received timestamp. */
  received: string
  importance?: 'low' | 'normal' | 'high'
  isRead?: boolean
  /** `complete` maps to Outlook's flagStatus `complete`. */
  flag?: 'flagged' | 'unflagged' | 'complete'
  /** Whether the user has replied — from Graph's `IPM.Note` last-verb extended property. */
  replied?: boolean
  /** PR_MESSAGE_CLASS, when fetched. Primary signal for `type:`; subject prefixes are the fallback. */
  messageClass?: string
  /** Graph `@odata.type`, e.g. `#microsoft.graph.eventMessageRequest`. Secondary `type:` signal. */
  odataType?: string
  /** The `_TRIAGE` subfolder the message currently sits in. Only populated for the aged pass. */
  folder?: string
}

/** Nothing matched. Only reachable in a block with no fallback rule. */
export interface NoMatch {
  ruleIndex: -1
}

/** A rule fired. `rule`, `groupIndex` and `ruleset` always travel together, so no caller has to null-check them apart. */
export interface Matched {
  /** Index of the matching rule within its block. */
  ruleIndex: number
  rule: Rule
  /** The AND-group that satisfied the rule — reported so a review can see which OR-arm fired. */
  groupIndex: number
  /** Human-readable rendering of the matching group, e.g. `sender:*@db.example.net`. Recorded as `ruleset` in tracking. */
  ruleset: string
}

/** The outcome of evaluating the rule list against one message. */
export type MatchResult = NoMatch | Matched
