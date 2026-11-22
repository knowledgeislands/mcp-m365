/**
 * The protected list: folders and categories the server refuses to change,
 * whoever calls.
 *
 * One TOML file per account, named by `MCP_M365_PROTECTED_FILE` and read afresh
 * on every check, so an edit takes effect on the next call. A `folder` entry is
 * held by folder id, so a rename does not lift it, and `subtree` (default true)
 * extends it to every folder beneath it by `parentFolderId`. A `category` entry
 * is held by its display name, which is its identity in Outlook, compared
 * case-insensitively as Outlook does.
 *
 * - No file: nothing is enforced and writes behave as before.
 * - `enforce = false`: reported as not enforced; writes behave as before.
 * - A file that cannot be read, parsed or validated, or a folder id that no
 *   longer resolves: not enforced, and every guarded write is refused until the
 *   file is fixed.
 *
 * There is no override argument and no bypass setting: the only way to lift
 * protection is to edit the file.
 */
import fs from 'node:fs'
import { parse } from 'smol-toml'
import { z } from 'zod'
import { getAllFolders } from '../email/folder-utils.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const PROTECTED_REFUSED = 'PROTECTED_REFUSED'
export const PROTECTED_LIST_INVALID = 'PROTECTED_LIST_INVALID'

const entrySchema = z
  .object({
    kind: z.enum(['folder', 'category']),
    id: z.string().min(1),
    name: z.string().optional(),
    subtree: z.boolean().default(true),
    reason: z.string().optional()
  })
  .strict()

const fileSchema = z
  .object({
    version: z.literal(1),
    enforce: z.boolean().default(true),
    protected: z.array(entrySchema).default([])
  })
  .strict()

type FileEntry = z.infer<typeof entrySchema>

type FileState =
  | { status: 'absent'; source: string | null }
  | { status: 'disabled'; source: string; entries: FileEntry[] }
  | { status: 'invalid'; source: string; error: string }
  | { status: 'enforced'; source: string; entries: FileEntry[] }

/** Read and validate the list file. Never throws: every failure is a state. */
export const readProtectedFile = (file: string | null | undefined): FileState => {
  if (!file) return { status: 'absent', source: null }
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'absent', source: file }
    return { status: 'invalid', source: file, error: `cannot read the file: ${(err as Error).message}` }
  }
  let raw: unknown
  try {
    raw = parse(text)
  } catch (err) {
    return { status: 'invalid', source: file, error: `not valid TOML: ${(err as Error).message}` }
  }
  const checked = fileSchema.safeParse(raw)
  if (!checked.success) {
    const detail = checked.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
    return { status: 'invalid', source: file, error: `not a valid protected list: ${detail}` }
  }
  const { enforce, protected: entries } = checked.data
  return enforce ? { status: 'enforced', source: file, entries } : { status: 'disabled', source: file, entries }
}

export interface ResolvedEntry {
  kind: 'folder' | 'category'
  id: string
  /** The file's name for people, or the current name when the file gives none. */
  name: string
  /** A folder's full path now; a category's name as written. */
  current_name: string
  subtree: boolean
  reason?: string
  covers: Array<{ id: string; name: string }>
}

export type Protection =
  | { mode: 'open'; source: string | null; entries: FileEntry[] }
  | { mode: 'blocked'; source: string; error: string; entries: FileEntry[] }
  | {
      mode: 'enforced'
      source: string
      entries: ResolvedEntry[]
      byFolderId: Map<string, ResolvedEntry>
      byCategory: Map<string, ResolvedEntry>
    }

export type EnforcedProtection = Extract<Protection, { mode: 'enforced' }>

interface Folder {
  id: string
  displayName: string
  parentFolderId?: string
}

const fullPaths = (folders: Folder[]): Map<string, string> => {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const paths = new Map<string, string>()
  for (const folder of folders) {
    const segments: string[] = []
    const seen = new Set<string>()
    let current: Folder | undefined = folder
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      segments.unshift(current.displayName)
      current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined
    }
    paths.set(folder.id, segments.join('/'))
  }
  return paths
}

const descendants = (folders: Folder[], rootId: string): string[] => {
  const out: string[] = []
  const queue = [rootId]
  const seen = new Set(queue)
  while (queue.length) {
    const parent = queue.shift() as string
    for (const f of folders) {
      if (f.parentFolderId === parent && !seen.has(f.id)) {
        seen.add(f.id)
        out.push(f.id)
        queue.push(f.id)
      }
    }
  }
  return out
}

/**
 * Resolve the list against the mailbox: one folder-tree read when the list
 * holds a folder. A Graph error propagates, so a guarded write never proceeds
 * on a failed check.
 */
export const resolveProtection = async (ctx: GraphContext, accessToken: string): Promise<Protection> => {
  const state = readProtectedFile(ctx.protectedFile)
  if (state.status === 'absent') return { mode: 'open', source: state.source, entries: [] }
  if (state.status === 'disabled') return { mode: 'open', source: state.source, entries: state.entries }
  if (state.status === 'invalid') return { mode: 'blocked', source: state.source, error: state.error, entries: [] }

  const folders: Folder[] = state.entries.some((e) => e.kind === 'folder')
    ? (await getAllFolders(ctx.graphApiEndpoint, accessToken)).map((f: any) => ({
        id: String(f.id),
        displayName: String(f.displayName ?? ''),
        ...(f.parentFolderId ? { parentFolderId: String(f.parentFolderId) } : {})
      }))
    : []
  const paths = fullPaths(folders)
  const entries: ResolvedEntry[] = []
  const missing: string[] = []
  for (const e of state.entries) {
    const base = { kind: e.kind, id: e.id, subtree: e.subtree, ...(e.reason ? { reason: e.reason } : {}) }
    if (e.kind === 'category') {
      entries.push({ ...base, name: e.name ?? e.id, current_name: e.id, covers: [] })
      continue
    }
    const current = paths.get(e.id)
    if (current === undefined) {
      missing.push(e.name ? `${e.id} (${e.name})` : e.id)
      continue
    }
    const covers = e.subtree ? descendants(folders, e.id).map((id) => ({ id, name: paths.get(id) as string })) : []
    entries.push({ ...base, name: e.name ?? current, current_name: current, covers })
  }
  if (missing.length) {
    return {
      mode: 'blocked',
      source: state.source,
      error: `entries no longer resolve to a folder: ${missing.join(', ')}`,
      entries: state.entries
    }
  }
  const byFolderId = new Map<string, ResolvedEntry>()
  const byCategory = new Map<string, ResolvedEntry>()
  for (const e of entries) {
    if (e.kind === 'category') {
      if (!byCategory.has(e.id.toLowerCase())) byCategory.set(e.id.toLowerCase(), e)
      continue
    }
    for (const id of [e.id, ...e.covers.map((c) => c.id)]) if (!byFolderId.has(id)) byFolderId.set(id, e)
  }
  return { mode: 'enforced', source: state.source, entries, byFolderId, byCategory }
}

const fileEntryView = (e: FileEntry) => ({
  kind: e.kind,
  id: e.id,
  name: e.name ?? '',
  current_name: null,
  subtree: e.subtree,
  ...(e.reason ? { reason: e.reason } : {}),
  covers: []
})

const structured = (data: Record<string, unknown>) => ({
  resultType: 'complete' as const,
  structuredContent: data,
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
})

export const protectedListOutputSchema = z.object({
  enforced: z.boolean(),
  source: z.string().nullable(),
  error: z.string().optional(),
  entries: z.array(
    z.object({
      kind: z.enum(['folder', 'category']),
      id: z.string(),
      name: z.string(),
      current_name: z.string().nullable(),
      subtree: z.boolean(),
      reason: z.string().optional(),
      covers: z.array(z.object({ id: z.string(), name: z.string() }))
    })
  ),
  checked_at: z.string()
})

/** `m365_email_protected_list`: the file, whether it is enforced, and what each entry covers now. */
export const handleListProtected = async (ctx: GraphContext, now: () => Date = () => new Date()) => {
  const checked_at = now().toISOString()
  const configured = ctx.protectedFile ?? null
  try {
    const token = readProtectedFile(configured).status === 'enforced' ? await ctx.ensureAuthenticated() : ''
    const p = await resolveProtection(ctx, token)
    if (p.mode === 'enforced') return structured({ enforced: true, source: p.source, entries: p.entries, checked_at })
    return structured({
      enforced: false,
      source: p.source,
      ...(p.mode === 'blocked' ? { error: p.error } : {}),
      entries: p.entries.map(fileEntryView),
      checked_at
    })
  } catch (err) {
    return structured({
      enforced: false,
      source: configured,
      error: `could not resolve the list: ${(err as Error).message}`,
      entries: [],
      checked_at
    })
  }
}

/** What a write would touch. Each kind is checked against the resolved list. */
export interface WriteTargets {
  /** Messages the call changes: each one's folder and categories are read before the write. */
  messageIds?: string[]
  /** Folder ids the call moves mail into, renames, deletes, creates beneath, or names in a rule. */
  folderIds?: string[]
  /** Category names the call adds, removes, or names in a rule. */
  categories?: string[]
}

interface Hit {
  target: string
  entry: ResolvedEntry
}

const LOOKUP_CONCURRENCY = 5

const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** The protected targets among `targets`, reading each message's folder and categories from Graph. */
export const findHits = async (
  ctx: GraphContext,
  accessToken: string,
  p: EnforcedProtection,
  targets: WriteTargets
): Promise<Hit[]> => {
  const hits: Hit[] = []
  for (const id of targets.folderIds ?? []) {
    const entry = p.byFolderId.get(id)
    if (entry) hits.push({ target: id, entry })
  }
  for (const name of targets.categories ?? []) {
    const entry = p.byCategory.get(name.toLowerCase())
    if (entry) hits.push({ target: name, entry })
  }
  const messageHits = await mapLimit(targets.messageIds ?? [], LOOKUP_CONCURRENCY, async (id) => {
    const msg: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', `me/messages/${id}`, null, {
      $select: 'id,parentFolderId,categories'
    })
    const inFolder = msg?.parentFolderId ? p.byFolderId.get(String(msg.parentFolderId)) : undefined
    const categories: string[] = Array.isArray(msg?.categories) ? msg.categories.map(String) : []
    const tagged = categories.map((c) => p.byCategory.get(c.toLowerCase())).find(Boolean)
    const entry = inFolder ?? tagged
    return entry ? { target: id, entry } : null
  })
  for (const h of messageHits) if (h) hits.push(h)
  return hits
}

const refusal = (text: string, body: Record<string, unknown>) => ({
  resultType: 'complete' as const,
  isError: true as const,
  structuredContent: body,
  content: [{ type: 'text' as const, text: `${text}\n${JSON.stringify(body)}` }]
})

const entryRef = (e: ResolvedEntry) => ({ kind: e.kind, id: e.id, name: e.name })

/** The refusal for an unusable list. */
export const blockedResult = (tool: string, p: Extract<Protection, { mode: 'blocked' }>) =>
  refusal(
    `Error ${tool}: ${PROTECTED_LIST_INVALID}: the protected list at ${p.source} is not usable (${p.error}); every protected-list write is refused until it is fixed.`,
    { code: PROTECTED_LIST_INVALID, tool, source: p.source, error: p.error }
  )

/** The refusal naming every protected target, or null when there is none. */
export const refusedResult = (tool: string, hits: Hit[]) => {
  if (!hits.length) return null
  const entries = [...new Map(hits.map((h) => [`${h.entry.kind}:${h.entry.id}`, entryRef(h.entry)])).values()]
  const targets = [...new Set(hits.map((h) => h.target))]
  const first = hits[0] as Hit
  return refusal(
    `Error ${tool}: ${PROTECTED_REFUSED}: ${targets.length} target(s) are protected by ${first.entry.name} (${first.entry.kind} ${first.entry.id}): ${targets.join(', ')}. Nothing was changed; only editing the protected list lifts protection.`,
    { code: PROTECTED_REFUSED, tool, entry: entryRef(first.entry), entries, targets }
  )
}

/**
 * Check a write against the protected list before any change reaches Graph.
 * Returns null when the write may proceed, or the refusal to return instead.
 * All or nothing: one protected target refuses the whole call, naming every
 * refused target. Graph errors during the check propagate to the caller's
 * error handling, so the write does not run.
 */
export const guardWrite = async (ctx: GraphContext, accessToken: string, tool: string, targets: WriteTargets) => {
  const p = await resolveProtection(ctx, accessToken)
  if (p.mode === 'open') return null
  if (p.mode === 'blocked') return blockedResult(tool, p)
  return refusedResult(tool, await findHits(ctx, accessToken, p, targets))
}
