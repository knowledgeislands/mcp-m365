/**
 * Folder-name resolution for `move:` targets.
 *
 * Targets are `_TRIAGE`-relative by default, because the overwhelming majority
 * of routing lands in a numbered triage folder and repeating the prefix 280
 * times would be noise. A target escapes the prefix by containing a `/` (an
 * explicit path such as `_ARCHIVE/Success/Partner`) or by being quoted (a
 * well-known mailbox folder such as `"Junk Email"`).
 */
import type { Action } from './types.js'

export const TRIAGE_ROOT = '_TRIAGE'

/** Resolve a `move:` action to a full, slash-delimited mail folder path. */
export const resolveMoveTarget = (action: Action): string => {
  const value = (action.value ?? '').trim()
  if (action.quoted || value.includes('/')) return value
  return `${TRIAGE_ROOT}/${value}`
}
