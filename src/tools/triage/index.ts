/**
 * Email routing engine tools.
 *
 * Rules are passed in on every call rather than held server-side: the
 * knowledge-base rule note stays the single source of truth and the server
 * stays stateless apart from its own tracking cache.
 *
 * Both mutating tools default to `mode: "report"` — the engine's equivalent of
 * the `dry_run: true` default every destructive tool in this server carries.
 * Nothing touches the mailbox until a caller asks for `mode: "live"`.
 *
 * NAMING: the design note calls these `email_triage_run`, `email_aged_run`,
 * `email_rules_lint` and `email_drift_scan`. They are registered here under the
 * repo's canonical `<app>_<service>_<resource>_<action>` scheme instead, for two
 * reasons: an unprefixed `email_*` tool would be the only one on this server
 * outside the `m365_` namespace and would collide with the sibling Gmail MCP in
 * any client holding both, and `m365_email_rules_lint` would sit one character
 * from the existing `m365_email_rules_list` (Outlook's own server-side inbox
 * rules — an unrelated concept). `routing` disambiguates both. Rename if the
 * design note's literal names are preferred; the scheduled task prompts are the
 * only callers.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  driftScanResultSchema,
  handleAgedRun,
  handleDriftScan,
  handleRulesLint,
  handleTriageRun,
  type TriageContext,
  triageRunResultSchema
} from '../../main/triage/index.js'
import { DESTRUCTIVE_ONESHOT_REMOTE, READ_ONLY } from '../../utils/annotations.js'

const rulesSchema = z
  .string()
  .max(500_000)
  .optional()
  .describe(
    'The rule file contents — either the whole knowledge-base note (rules are read from its ```rules fences) or a bare list headed `rules v1`. Optional: when omitted the server reads the note configured as MCP_M365_TRIAGE_RULES_PATH, so a caller need not ship the whole document on every call.'
  )

const rulesPathSchema = z
  .string()
  .max(4096)
  .optional()
  .describe(
    'Path to the rule note, overriding MCP_M365_TRIAGE_RULES_PATH. Must resolve inside MCP_M365_TRIAGE_ROOTS. Ignored when `rules` is supplied.'
  )

const trackingPathSchema = z
  .string()
  .max(4096)
  .optional()
  .describe(
    'Path to the tracking cache, overriding MCP_M365_TRIAGE_TRACKING_PATH. Must resolve inside MCP_M365_TRIAGE_ROOTS. The result reports which file was used.'
  )

const modeSchema = z
  .enum(['live', 'report'])
  .optional()
  .describe('`report` (default) classifies and reports without touching the mailbox; `live` executes the actions.')

const maxActionsSchema = z
  .number()
  .int()
  .positive()
  .max(200)
  .optional()
  .describe(
    'Maximum messages acted on in this call (default 50). Keeps the call inside the client timeout; loop while `remaining` is true and `acted` is above zero.'
  )

export const registerTriageTools = (server: McpServer, ctx: TriageContext): void => {
  server.registerTool(
    'm365_email_routing_aged',
    {
      description:
        'Applies the `aged` retention block across the _TRIAGE subfolders — archiving, marking read, deleting, or returning mail for re-evaluation. Same batch-bounded, resumable contract as m365_email_routing_triage. Defaults to report mode.',
      inputSchema: z
        .object({
          rules: rulesSchema,
          rulesPath: rulesPathSchema,
          trackingPath: trackingPathSchema,
          mode: modeSchema,
          maxActions: maxActionsSchema
        })
        .strict(),
      outputSchema: triageRunResultSchema,
      annotations: DESTRUCTIVE_ONESHOT_REMOTE
    },
    (args) => handleAgedRun(ctx, args)
  )

  server.registerTool(
    'm365_email_routing_drift',
    {
      description:
        'Compares every tracked message against its current folder, reporting messages the user has re-routed by hand and pruning entries that have gone or aged out. Returns the diff for rule induction; writes no suggestions. Batched: call again while `remaining` is above zero — it reaches zero when the sweep has covered every tracked message.',
      inputSchema: z
        .object({
          trackingPath: trackingPathSchema,
          maxEntries: z
            .number()
            .int()
            .positive()
            .max(200)
            .optional()
            .describe(
              'Maximum tracked entries examined in this call (default 50). Call again while `remaining` is above zero; it falls to zero at the end of a full sweep.'
            )
        })
        .strict(),
      outputSchema: driftScanResultSchema,
      // One-shot, not idempotent: each call advances the sweep cursor and may
      // prune tracked history, so a repeat does different work rather than
      // converging on the same end state.
      annotations: DESTRUCTIVE_ONESHOT_REMOTE
    },
    (args) => handleDriftScan(ctx, args)
  )

  server.registerTool(
    'm365_email_routing_lint',
    {
      description:
        'Parses a rule file and reports parse errors, unreachable (shadowed) rules, duplicates, broad-rule collisions, party-consolidation opportunities, malformed address patterns, and unknown move targets. No mailbox access — safe to run against a proposed edit before saving it.',
      inputSchema: z
        .object({
          rules: rulesSchema,
          rulesPath: rulesPathSchema,
          knownFolders: z
            .array(z.string())
            .max(1000)
            .optional()
            .describe(
              'Folder paths that exist, e.g. `_TRIAGE/111 Partner`. When supplied, every move target is checked against it.'
            )
        })
        .strict(),
      annotations: READ_ONLY
    },
    (args) => handleRulesLint(ctx, args)
  )

  server.registerTool(
    'm365_email_routing_triage',
    {
      description:
        'Classifies Inbox mail against the `inbound` rule block and applies the first matching rule’s actions. Batch-bounded and resumable: call repeatedly while the result reports `remaining: true` and a non-zero `acted`. Defaults to report mode.',
      inputSchema: z
        .object({
          rules: rulesSchema,
          rulesPath: rulesPathSchema,
          trackingPath: trackingPathSchema,
          mode: modeSchema,
          maxActions: maxActionsSchema
        })
        .strict(),
      outputSchema: triageRunResultSchema,
      annotations: DESTRUCTIVE_ONESHOT_REMOTE
    },
    (args) => handleTriageRun(ctx, args)
  )
}
