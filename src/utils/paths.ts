/**
 * Filesystem root allowlisting for caller-supplied paths.
 *
 * Cross-MCP helper, mirroring `assertOutputPathWithinDownloadRoot()` in
 * mcp-gmail: any path that reaches the filesystem from a tool call must resolve
 * inside a configured root, or the call is refused.
 *
 * The check is two-layer, and both layers are load-bearing:
 *
 *  1. **Lexical.** `path.resolve` collapses `..` and relative segments, so
 *     `<root>/../../etc/passwd` is caught before any syscall.
 *  2. **Real path.** A lexical check alone is defeated by a symlink *inside* a
 *     root pointing out of it. This matters concretely here — the knowledge
 *     base symlinks `Pillars/*` into a separate repository — so both the roots
 *     and the candidate are resolved through `realpath` and re-checked.
 *
 * The candidate need not exist yet (a tracking file is created on first write),
 * so the deepest existing ancestor is resolved and the not-yet-created tail is
 * reattached.
 */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * Expand a leading `~` to the home directory, then resolve to absolute.
 *
 * Every server in this family writes `~/workspaces/...` in its env config (see
 * `MCP_GIT_AUDIT_SAFE_ROOTS` in the sibling), and `path.resolve` does NOT
 * expand `~` — it would produce a literal `./~/workspaces/...` that silently
 * matches nothing. Handled here so configured and caller-supplied paths behave
 * identically.
 */
export const expandHome = (target: string): string => {
  const trimmed = target.trim()
  if (trimmed === '~') return os.homedir()
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/'))
    return path.resolve(os.homedir(), trimmed.slice(2))
  return path.resolve(trimmed)
}

/** Parse a delimiter-separated root list (`:` on POSIX, `;` on Windows) into absolute, de-duplicated paths. */
export const parseRoots = (raw: string | undefined): string[] => {
  if (!raw?.trim()) return []
  const seen = new Set<string>()
  for (const entry of raw.split(path.delimiter)) {
    const trimmed = entry.trim()
    if (trimmed) seen.add(expandHome(trimmed))
  }
  return [...seen]
}

/** Is `candidate` the same as `root`, or beneath it? Compares resolved paths, never raw strings. */
const isWithin = (root: string, candidate: string): boolean =>
  candidate === root || candidate.startsWith(root + path.sep)

/**
 * Resolve `target` through `realpath`, walking up to the deepest ancestor that
 * exists and reattaching the remaining segments. Lets a path that has not been
 * created yet still be checked against its real (symlink-resolved) location.
 */
export const realpathOfNearestExisting = async (target: string): Promise<string> => {
  const tail: string[] = []
  let current = path.resolve(target)
  for (;;) {
    try {
      const real = await fs.realpath(current)
      return tail.length === 0 ? real : path.join(real, ...[...tail].reverse())
    } catch {
      const parent = path.dirname(current)
      /* v8 ignore next — only reachable if the filesystem root itself is unstattable */
      if (parent === current) return path.resolve(target)
      tail.push(path.basename(current))
      current = parent
    }
  }
}

/**
 * Return the resolved absolute path, or throw if it falls outside every root.
 *
 * `purpose` appears in the error so a refusal says which path was rejected and
 * what it was for, without echoing any file contents.
 */
export const assertWithinRoots = async (
  roots: readonly string[],
  candidate: string,
  purpose: string
): Promise<string> => {
  if (roots.length === 0) {
    throw new Error(
      `Refusing to access the ${purpose}: no roots are configured. Set MCP_M365_TRIAGE_ROOTS to the directories the engine may use.`
    )
  }

  const lexical = expandHome(candidate)
  const realRoots = await Promise.all(roots.map((root) => realpathOfNearestExisting(root)))
  const real = await realpathOfNearestExisting(lexical)

  const allowed = roots.some((root, index) => isWithin(root, lexical) && isWithin(realRoots[index] as string, real))
  if (!allowed) {
    throw new Error(
      `Refusing to access the ${purpose} at "${candidate}": it resolves outside the configured roots (${roots.join(', ')}).`
    )
  }
  return real
}
