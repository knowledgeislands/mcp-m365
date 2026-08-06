/**
 * The injected slice the triage handlers receive.
 *
 * Rules are NOT part of it: they arrive as a string in every tool call so the
 * server holds no rule state and the knowledge-base note stays the single
 * source of truth. The tracking cache is the one piece of state the engine
 * owns, and its location is configuration, not something a caller may choose —
 * a caller-supplied path would let any prompt redirect writes anywhere on disk.
 */
import type { GraphContext } from '../graph-client/index.js'

export interface TriageContext extends GraphContext {
  /** Absolute path to `tracking.json5`. From `MCP_M365_TRIAGE_TRACKING_PATH`. */
  trackingPath: string
}
