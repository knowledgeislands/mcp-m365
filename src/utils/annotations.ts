/**
 * MCP tool annotations shared across tool groups.
 *
 * Closed-world (local-only operations, e.g. starting the local OAuth server):
 *   - READ_ONLY
 *
 * Open-world (calls Microsoft Graph or other remote APIs):
 *   - READ_ONLY_REMOTE     — pure read tools
 *   - ADDITIVE_REMOTE      — creates new state remotely (non-idempotent)
 *   - STATE_TOGGLE_REMOTE  — flips an existing state (idempotent)
 *   - DESTRUCTIVE_REMOTE   — deletes/destroys remote state (idempotent end state)
 */
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

export const READ_ONLY_REMOTE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const
export const ADDITIVE_REMOTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const
export const STATE_TOGGLE_REMOTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const
export const DESTRUCTIVE_REMOTE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const
