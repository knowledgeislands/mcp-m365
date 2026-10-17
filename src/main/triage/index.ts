/**
 * Email routing engine — a mechanical replacement for LLM-interpreted triage.
 *
 * Rules are data (a flat, ordered, first-match-wins list in the v1 line DSL),
 * the engine is code, and Claude keeps only the judgement roles: inducing rules
 * from the drift diff, and review. See the Email Routing Engine Design note.
 */
export type { TriageContext } from './context.js'
export { type DriftScanResult, driftScanResultSchema, handleDriftScan, RETENTION_DAYS } from './drift.js'
export { isThreadTarget, resolveMoveTarget, TRIAGE_ROOT } from './folders.js'
export {
  type AppliedAction,
  applyActions,
  attachmentNames,
  buildFolderMap,
  childPaths,
  type FolderMap,
  findMessage,
  hasExecutableActions,
  listConversation,
  listFolderMessages,
  mailboxOwner,
  resolveMessageId,
  searchForwards
} from './graph-ops.js'
export {
  ALLOW_COLLISION,
  groupSubsumes,
  type LintFinding,
  type LintOptions,
  type LintSeverity,
  lintRules,
  ruleShadows
} from './lint.js'
export {
  bindThreadTarget,
  type FiledFolders,
  FORWARD_WINDOW_DAYS,
  type ForwardCandidate,
  filedFolders,
  firstThreadRule,
  forwardAddressesToResolve,
  forwardCandidates,
  forwardFor,
  normaliseSubject,
  resolveThread,
  sharesAttachmentName,
  type ThreadSibling,
  testsForwards
} from './lookups.js'
export {
  classify,
  detectType,
  evaluateGroup,
  evaluatePredicate,
  evaluateTerm,
  type MatchContext,
  matchesAddress,
  matchRule
} from './matcher.js'
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
  quoteBareKeys,
  readTracking,
  relaxJson5,
  type Sweep,
  sweepPending,
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
  ForwardMatch,
  Matched,
  MatchResult,
  NoMatch,
  ParseError,
  ParseResult,
  PredicateKey,
  PredicateTerm,
  Rule,
  RuleBlock,
  Term,
  ThreadFiling
} from './types.js'
export {
  BROAD_KEYS,
  IMPORTANCE_VALUES,
  MARK_VALUES,
  PREDICATE_KEYS,
  STATUS_VALUES,
  THREAD_TARGET,
  THREAD_VALUES,
  TYPE_VALUES
} from './types.js'
