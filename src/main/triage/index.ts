/**
 * Email routing engine — a mechanical replacement for LLM-interpreted triage.
 *
 * Rules are data (a flat, ordered, first-match-wins list in the v1 line DSL),
 * the engine is code, and Claude keeps only the judgement roles: inducing rules
 * from the drift diff, and review. See the Email Routing Engine Design note.
 */
export type { TriageContext } from './context.js'
export { type DriftScanResult, driftScanResultSchema, handleDriftScan, RETENTION_DAYS } from './drift.js'
export { resolveMoveTarget, TRIAGE_ROOT } from './folders.js'
export {
  type AppliedAction,
  applyActions,
  buildFolderMap,
  childPaths,
  type FolderMap,
  findMessage,
  hasExecutableActions,
  listFolderMessages,
  resolveMessageId
} from './graph-ops.js'
export { ALLOW_COLLISION, groupSubsumes, type LintFinding, type LintOptions, type LintSeverity, lintRules, ruleShadows } from './lint.js'
export { classify, detectType, evaluateGroup, evaluatePredicate, evaluateTerm, type MatchContext, matchesAddress, matchRule } from './matcher.js'
export { MESSAGE_CLASS_PROPERTY, TRIAGE_EXPAND, TRIAGE_SELECT_FIELDS, toEmailRecord } from './message.js'
export {
  assembleLines,
  parseRule,
  parseRules,
  renderAction,
  renderGroup,
  renderPredicates,
  SUPPORTED_VERSION,
  selectBlock,
  splitOutsideQuotes,
  stripComment
} from './parser.js'
export { handleAgedRun, handleRulesLint, handleTriageRun, type TriageRunResult, triageRunResultSchema } from './run.js'
export {
  entryKey,
  identityKey,
  parseTracking,
  pruneOlderThan,
  readTracking,
  relaxJson5,
  type TrackingEntry,
  type TrackingFile,
  upsertEntries,
  writeTracking
} from './tracking.js'
export type {
  Action,
  ActionKind,
  AndGroup,
  EmailRecord,
  Matched,
  MatchResult,
  NoMatch,
  ParseError,
  ParseResult,
  PredicateKey,
  PredicateTerm,
  Rule,
  RuleBlock,
  Term
} from './types.js'
export { BROAD_KEYS, IMPORTANCE_VALUES, MARK_VALUES, PREDICATE_KEYS, STATUS_VALUES, TYPE_VALUES } from './types.js'
