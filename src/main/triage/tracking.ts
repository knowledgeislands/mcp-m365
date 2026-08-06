/**
 * The tracking cache — the engine's record of what it routed where.
 *
 * Invariants promoted out of agent memory and into code:
 *
 * - **The engine is the only writer.** Nothing else appends to this file.
 * - **One rolling backup, not one per run.** The previous generation is kept as
 *   `<name>.bak` and overwritten; the historical `.bak_pre_<date>_<activity>`
 *   litter is not recreated.
 * - **Identity is subject + sender + received, never the Graph id.** Graph
 *   reissues ids on folder moves, so an id is a cache hint and nothing more.
 *
 * The file is JSON5 by extension and by tolerance on read (comments and
 * trailing commas are accepted), but strict JSON is written — JSON is a subset
 * of JSON5, so the output stays readable by any JSON5 consumer without taking
 * on a parser dependency.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { EmailRecord } from './types.js'

/** One routed message. Field names match the historical corpus so the existing history stays readable. */
export interface TrackingEntry {
  /** Graph id at time of routing — a hint for re-resolution, never the identity. */
  id?: string
  subject: string
  from: string
  received: string
  /** The rendered predicate group that fired, e.g. `sender:*@db.example.net`. `unknown` when nothing matched. */
  ruleset: string
  /** Destination folder leaf name, e.g. `111 Partner`. */
  routed_to: string
  /** Full destination path, e.g. `_TRIAGE/111 Partner`. */
  destination: string
  /** ISO timestamp of the routing action. */
  routed_at: string
  /** Where the message sits now. Updated by the drift scan when the user re-routes it by hand. */
  triage_folder: string
  /** When the drift scan last examined this entry. Absent means never — see {@link sweepPending}. */
  scanned_at?: string
}

/**
 * A single pass of the drift scan over the whole corpus. Persisted so that a
 * batched scan can tell "not yet examined in THIS pass" from "examined", which
 * is the only way `remaining` can reach zero and a polling caller can stop.
 */
export interface Sweep {
  started_at: string
}

export interface TrackingFile {
  entries: TrackingEntry[]
  sweep?: Sweep
}

/**
 * Field separator for the identity key. A NUL can never appear in a subject or
 * an address, so it cannot be forged by crafting a subject that contains the
 * delimiter. Written as an escape rather than a literal byte — a raw NUL makes
 * Git treat the whole source file as binary and refuse to diff it.
 */
const SEP = '\u0000'

/**
 * Stable identity for a message. Subject is compared verbatim (including any
 * non-ASCII the sender used — one corpus entry differs from its Graph subject
 * only by `x` vs `×`, which is why sender and timestamp are part of the key).
 */
export const identityKey = (record: Pick<EmailRecord, 'subject' | 'from' | 'received'>): string =>
  [record.subject.trim(), record.from.trim().toLowerCase(), record.received.trim()].join(SEP)

/** Identity key for a stored entry — same shape, different field names. */
export const entryKey = (entry: TrackingEntry): string => identityKey({ subject: entry.subject, from: entry.from, received: entry.received })

/**
 * Quote bare object keys (`entries:` → `"entries":`), string-aware so a colon
 * inside a string literal is left alone. Earlier generations of the tracking
 * file were written as true JSON5 with unquoted keys; without this they parse
 * as nothing at all.
 */
export const quoteBareKeys = (text: string): string => {
  let out = ''
  let inString = false
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string

    if (inString) {
      out += ch
      if (ch === '\\') {
        /* v8 ignore next — a trailing backslash means truncated input; the tolerant parser simply drops it */
        out += text[i + 1] ?? ''
        i++
      } else if (ch === quote) {
        inString = false
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      out += ch
      continue
    }

    const key = /^([A-Za-z_$][\w$]*)(\s*:)/.exec(text.slice(i))
    if (key && /[{,\s]/.test(out.at(-1) ?? '{')) {
      out += `"${key[1]}"${key[2]}`
      i += (key[0] as string).length - 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * Strip JSON5 conveniences (line/block comments, trailing commas) that strict
 * `JSON.parse` rejects, leaving string literals untouched.
 */
export const relaxJson5 = (text: string): string => {
  let out = ''
  let inString = false
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string
    const next = text[i + 1]

    if (inString) {
      out += ch
      if (ch === '\\') {
        /* v8 ignore next — a trailing backslash means truncated input; the tolerant parser simply drops it */
        out += next ?? ''
        i++
      } else if (ch === quote) {
        inString = false
      }
      continue
    }

    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      out += ch
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
      continue
    }
    if (ch === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
      continue
    }
    out += ch
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/**
 * Parse tracking content, tolerating JSON5 conveniences.
 *
 * Returns `null` when the content is present but cannot be parsed — NOT an
 * empty cache. The distinction is load-bearing: a caller that mistook an
 * unparseable file for an empty one would read nothing, append the current
 * batch, and write the result back, destroying every earlier entry.
 */
export const parseTracking = (text: string): TrackingFile | null => {
  if (!text.trim()) return { entries: [] }
  const attempt = (candidate: string): TrackingFile | null => {
    try {
      const parsed = JSON.parse(candidate) as { entries?: unknown; sweep?: unknown }
      if (!Array.isArray(parsed.entries)) return { entries: [] }
      const file: TrackingFile = { entries: parsed.entries as TrackingEntry[] }
      const startedAt = (parsed.sweep as Sweep | undefined)?.started_at
      if (typeof startedAt === 'string') file.sweep = { started_at: startedAt }
      return file
    } catch {
      return null
    }
  }
  const relaxed = relaxJson5(text)
  return attempt(text) ?? attempt(relaxed) ?? attempt(quoteBareKeys(relaxed))
}

/**
 * Read the tracking cache.
 *
 * A missing file is an empty cache — the first run has nothing to read. A file
 * that exists but will not parse returns `null`, and every caller must refuse
 * to write rather than overwrite a history it could not understand.
 */
export const readTracking = async (filePath: string): Promise<TrackingFile | null> => {
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch {
    return { entries: [] }
  }
  return parseTracking(text)
}

/**
 * Write the tracking cache: roll the previous generation to `<name>.bak`, then
 * write atomically (temp file + rename) at mode 0600 so a crash mid-write can
 * never leave a truncated cache in place.
 */
export const writeTracking = async (filePath: string, file: TrackingFile): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  try {
    await fs.copyFile(filePath, `${filePath}.bak`)
  } catch {
    // No prior generation to roll — first run.
  }

  const temp = `${filePath}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`
  await fs.writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temp, filePath)
}

/** Insert or replace entries by identity, keeping the most recent record for each message. */
export const upsertEntries = (file: TrackingFile, entries: readonly TrackingEntry[]): TrackingFile => {
  const byKey = new Map(file.entries.map((entry) => [entryKey(entry), entry]))
  for (const entry of entries) byKey.set(entryKey(entry), entry)
  return { ...file, entries: [...byKey.values()] }
}

/** Drop entries routed more than `days` ago. Keeps the cache bounded; the drift scan is the only caller. */
export const pruneOlderThan = (file: TrackingFile, days: number, now: Date): { kept: TrackingFile; pruned: TrackingEntry[] } => {
  const cutoff = now.getTime() - days * 86_400_000
  const kept: TrackingEntry[] = []
  const pruned: TrackingEntry[] = []
  for (const entry of file.entries) {
    const routedAt = Date.parse(entry.routed_at)
    if (!Number.isNaN(routedAt) && routedAt < cutoff) pruned.push(entry)
    else kept.push(entry)
  }
  return { kept: { ...file, entries: kept }, pruned }
}

/**
 * The entries still to be examined in the current sweep, and the sweep they
 * belong to.
 *
 * A batched scan needs to distinguish "not yet examined in this pass" from
 * "examined", or `remaining` is just `total - batchSize` on every call and a
 * caller told to loop while `remaining > 0` never terminates. Each entry
 * records when it was last scanned; anything last scanned before the current
 * sweep began is still outstanding.
 *
 * When nothing is outstanding the previous sweep is complete, so a fresh one
 * begins here — which is what makes `remaining` fall to zero at the end of a
 * pass and rise again on the next invocation.
 */
export const sweepPending = (file: TrackingFile, now: Date): { sweep: Sweep; pending: TrackingEntry[] } => {
  const startedAt = file.sweep?.started_at
  if (startedAt) {
    const pending = file.entries.filter((entry) => !entry.scanned_at || entry.scanned_at < startedAt)
    if (pending.length > 0) return { sweep: { started_at: startedAt }, pending }
  }
  return { sweep: { started_at: now.toISOString() }, pending: file.entries }
}
