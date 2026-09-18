/**
 * The injected slice the triage handlers receive.
 *
 * Rules are NOT part of it: they arrive as a string in every tool call so the
 * server holds no rule state and the knowledge-base note stays the single
 * source of truth. The tracking cache is the one piece of state the engine
 * owns, and its location is configuration, not something a caller may choose —
 * a caller-supplied path would let any prompt redirect writes anywhere on disk.
 */
import type { AttachmentSaver } from '../attachments/save.js'
import type { GraphContext } from '../graph-client/index.js'

export interface TriageContext extends GraphContext {
  /** Directories the engine may touch. Every configured or caller-supplied path is checked against these. */
  roots: readonly string[]
  /** Default `tracking.json5` location. From `MCP_M365_TRIAGE_TRACKING_PATH`, or a path inside the first root. A call may override it. */
  trackingPath: string
  /**
   * Default rule-note location, or `''` when unset. From
   * `MCP_M365_TRIAGE_RULES_PATH`. Read fresh on each call, so editing the note
   * takes effect without restarting the server. A call may override it.
   */
  rulesPath: string
  /**
   * Directories `save-attachments:` may write into, from
   * `MCP_M365_ATTACHMENT_ROOTS`. Separate from {@link roots} so neither widens
   * the other: the action that writes PDFs cannot reach the rule note, and the
   * engine that reads the rules cannot write into the receipts folder.
   *
   * This is all the server keeps of attachment saving. Which destinations exist
   * and where they point is declared in the rule note's ```destinations block,
   * because that is policy — the same kind of statement as which mail is saved
   * there. The roots stay here because they are the boundary on that policy: a
   * note may choose where within them a rule writes, never whether it may
   * write outside them.
   */
  attachmentRoots: readonly string[]
  /** Carries out `save-attachments:`. Absent leaves the action failing loudly rather than silently doing nothing. */
  saveAttachments?: AttachmentSaver
}
