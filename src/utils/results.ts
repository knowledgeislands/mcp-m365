/**
 * MCP tool-result envelope helpers.
 *
 * The thin `tools/` layer maps every failure into one of these `{ isError: true }`
 * envelopes rather than `throw`ing, so the `withAuditLog` wrapper records
 * `ok: false` and the spec's Tool-Execution-Error semantics hold (validation /
 * API / business errors are surfaced in the result envelope, not as JSON-RPC
 * protocol errors). Mirrors the sibling `results.ts` in mcp-gmail / mcp-git-audit.
 */
import { errMessage } from './errors.js'

/**
 * Generic error envelope: `Error <action>: <message>`, `isError: true`.
 * Routes the message through `errMessage` so Graph error shapes are normalised
 * and the 401 → `m365_auth_start` hint is appended.
 */
export const errorResult = (action: string, error: unknown) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text: `Error ${action}: ${errMessage(error)}` }]
})

/**
 * Error envelope carrying a pre-formatted message verbatim, with `isError`
 * set. Used where a handler already builds a bespoke error string (a validation
 * hint, or a Source/Context-annotated Graph failure) that must be preserved.
 */
export const errorText = (text: string) => ({
  isError: true as const,
  content: [{ type: 'text' as const, text }]
})
