/**
 * Graph transport for the routing engine.
 *
 * Everything that touches the mailbox lives here so the parser, matcher and
 * lint stay pure. Two rules govern this layer:
 *
 * - **Identity is re-resolved before every mutation.** A stored Graph id is a
 *   hint; Graph reissues ids on folder moves, so acting on a stale id either
 *   fails or — worse — hits the wrong message. {@link resolveMessageId} checks
 *   the hint against subject + sender + received and falls back to a search.
 * - **A move invalidates the id it was given.** The id returned by the move is
 *   threaded into any remaining actions for that message.
 */
import { errMessage } from '../../utils/errors.js'
import type { AttachmentSaver } from '../attachments/save.js'
import { getAllFolders } from '../email/folder-utils.js'
import type { GraphContext } from '../graph-client/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { resolveMoveTarget } from './folders.js'
import { TRIAGE_EXPAND, TRIAGE_SELECT_FIELDS, toEmailRecord } from './message.js'
import { identityKey } from './tracking.js'
import type { Action, EmailRecord } from './types.js'

/** Full-path ↔ id views of the mail folder tree. */
export interface FolderMap {
  /** Lower-cased full path → folder id. */
  idByPath: Map<string, string>
  /** Folder id → full path, original casing. */
  pathById: Map<string, string>
  /** Every folder path, original casing. */
  paths: string[]
}

/** Build the folder map once per run. Folder ids are stable; paths are what the rule file talks about. */
export const buildFolderMap = async (ctx: GraphContext, accessToken: string): Promise<FolderMap> => {
  const folders = await getAllFolders(ctx.graphApiEndpoint, accessToken)
  const byId = new Map<string, any>(folders.map((folder: any) => [folder.id, folder]))

  const pathOf = (folder: any): string => {
    const segments: string[] = []
    let current: any = folder
    const guard = new Set<string>()
    while (current && !guard.has(current.id)) {
      guard.add(current.id)
      segments.unshift(current.displayName)
      current = byId.get(current.parentFolderId)
    }
    return segments.join('/')
  }

  const idByPath = new Map<string, string>()
  const pathById = new Map<string, string>()
  const paths: string[] = []
  for (const folder of folders) {
    const full = pathOf(folder)
    idByPath.set(full.toLowerCase(), folder.id)
    pathById.set(folder.id, full)
    paths.push(full)
  }

  return { idByPath, pathById, paths: paths.sort() }
}

/** Immediate children of a folder path, as full paths. Used to enumerate the `_TRIAGE` subfolders for the aged pass. */
export const childPaths = (map: FolderMap, parentPath: string): string[] => {
  const prefix = `${parentPath}/`
  return map.paths.filter(
    (p) => p.toLowerCase().startsWith(prefix.toLowerCase()) && !p.slice(prefix.length).includes('/')
  )
}

/** Read messages from a folder, oldest first so repeated batched runs make monotonic progress. */
export const listFolderMessages = async (
  ctx: GraphContext,
  accessToken: string,
  folderId: string,
  top: number
): Promise<any[]> => {
  const response: any = await callGraphAPI(
    ctx.graphApiEndpoint,
    accessToken,
    'GET',
    `me/mailFolders/${folderId}/messages`,
    null,
    {
      $top: top,
      $select: TRIAGE_SELECT_FIELDS,
      $expand: TRIAGE_EXPAND,
      $orderby: 'receivedDateTime asc'
    }
  )
  return Array.isArray(response?.value) ? response.value : []
}

/** `[received, received + 1s)` as Graph datetime literals, or null when the timestamp will not parse. */
const receivedWindow = (received: string): { from: string; to: string } | null => {
  const start = new Date(received)
  if (Number.isNaN(start.getTime())) return null
  const from = new Date(Math.floor(start.getTime() / 1000) * 1000)
  const to = new Date(from.getTime() + 1000)
  return { from: from.toISOString(), to: to.toISOString() }
}

const sameMessage = (record: EmailRecord, candidate: any): boolean =>
  identityKey(record) === identityKey(toEmailRecord(candidate))

/** Fields every identity lookup needs, plus the current folder so the drift scan needs only one round trip per entry. */
const IDENTITY_SELECT = 'id,subject,from,receivedDateTime,parentFolderId'

/**
 * Find the message Graph currently holds for a record, by identity.
 *
 * The cached id is tried first and accepted only when the message it returns
 * still carries the same subject, sender and received timestamp. Otherwise the
 * mailbox is searched by received timestamp — an exact, indexed filter — and
 * the candidates are matched on full identity.
 */
export const findMessage = async (ctx: GraphContext, accessToken: string, record: EmailRecord): Promise<any | null> => {
  if (record.id) {
    try {
      const message: any = await callGraphAPI(
        ctx.graphApiEndpoint,
        accessToken,
        'GET',
        `me/messages/${record.id}`,
        null,
        { $select: IDENTITY_SELECT }
      )
      if (sameMessage(record, message)) return message
    } catch {
      // Stale id — fall through to the identity search.
    }
  }

  if (!record.received) return null

  // Graph keeps receivedDateTime to sub-second precision but serialises it to
  // whole seconds, so an exact `eq` against the value it handed back never
  // matches. A one-second window does, and the identity match narrows it.
  const window = receivedWindow(record.received)
  if (!window) return null

  try {
    const response: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', 'me/messages', null, {
      $filter: `receivedDateTime ge ${window.from} and receivedDateTime lt ${window.to}`,
      $select: IDENTITY_SELECT,
      $top: 50
    })
    const candidates: any[] = Array.isArray(response?.value) ? response.value : []
    return candidates.find((candidate) => sameMessage(record, candidate)) ?? null
  } catch {
    return null
  }
}

/** Identity-resolved Graph id, or null when the message is gone. */
export const resolveMessageId = async (
  ctx: GraphContext,
  accessToken: string,
  record: EmailRecord
): Promise<string | null> => {
  const message = await findMessage(ctx, accessToken, record)
  return message ? String(message.id) : null
}

/**
 * What applying actions needs: Graph access, plus — when a rule uses
 * `save-attachments:` — the saver and the destinations the note declared.
 * Narrower than `TriageContext` so a caller holding only a Graph client — the
 * folder helpers, the tests — still satisfies it.
 */
export interface ActionContext extends GraphContext {
  saveAttachments?: AttachmentSaver
  /** Destination name → path, as declared in the rule note being run. */
  attachmentDestinations?: Readonly<Record<string, string>>
}

export interface AppliedAction {
  action: string
  ok: boolean
  detail?: string
}

/** Actions with no mailbox effect — `suggest` only marks the message for the induction step. */
const isExecutable = (action: Action): boolean => action.kind !== 'suggest'

/** Does this rule ask for any mailbox mutation at all? */
export const hasExecutableActions = (actions: readonly Action[]): boolean => actions.some(isExecutable)

const applyOne = async (
  ctx: ActionContext,
  accessToken: string,
  messageId: string,
  action: Action,
  map: FolderMap,
  record: EmailRecord
): Promise<{ result: AppliedAction; nextId: string }> => {
  if (action.kind === 'save-attachments') {
    const label = `save-attachments:${action.value}`
    // Absent saver is a failure, not a no-op: the actions after this one
    // dispose of the mail, and the engine stops the chain on failure.
    if (!ctx.saveAttachments)
      return {
        result: { action: label, ok: false, detail: 'this server cannot save attachments' },
        nextId: messageId
      }
    const outcome = await ctx.saveAttachments({
      accessToken,
      messageId,
      record,
      destination: String(action.value),
      destinations: ctx.attachmentDestinations ?? {}
    })
    const saved = outcome.files.map((file) => file.filename).join(', ')
    return {
      result: {
        action: label,
        ok: outcome.ok,
        ...(outcome.ok
          ? { detail: outcome.files.length === 0 ? 'no PDF attachments' : saved }
          : { detail: outcome.detail ?? 'saving attachments failed' })
      },
      nextId: messageId
    }
  }

  if (action.kind === 'move') {
    const target = resolveMoveTarget(action)
    const destinationId = map.idByPath.get(target.toLowerCase())
    if (!destinationId)
      return {
        result: { action: `move:${target}`, ok: false, detail: 'destination folder does not exist' },
        nextId: messageId
      }
    const moved: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'POST', `me/messages/${messageId}/move`, {
      destinationId
    })
    // The move reissues the id; everything after this acts on the new one.
    const nextId = moved?.id ? String(moved.id) : messageId
    return { result: { action: `move:${target}`, ok: true }, nextId }
  }

  if (action.kind === 'mark') {
    const body =
      action.value === 'read' || action.value === 'unread'
        ? { isRead: action.value === 'read' }
        : { flag: { flagStatus: action.value === 'flagged' ? 'flagged' : 'notFlagged' } }
    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'PATCH', `me/messages/${messageId}`, body)
    return { result: { action: `mark:${action.value}`, ok: true }, nextId: messageId }
  }

  if (action.kind === 'tag') {
    const current: any = await callGraphAPI(
      ctx.graphApiEndpoint,
      accessToken,
      'GET',
      `me/messages/${messageId}`,
      null,
      { $select: 'categories' }
    )
    const existing: string[] = Array.isArray(current?.categories) ? current.categories : []
    const value = String(action.value)
    const categories = existing.includes(value) ? existing : [...existing, value]
    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'PATCH', `me/messages/${messageId}`, { categories })
    return { result: { action: `tag:${value}`, ok: true }, nextId: messageId }
  }

  await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'DELETE', `me/messages/${messageId}`)
  return { result: { action: 'delete', ok: true }, nextId: messageId }
}

/**
 * Execute a rule's actions against one message, in the order they were written.
 * Identity is re-resolved first; a failure part-way through leaves the earlier
 * actions applied, which is safe because a re-run reclassifies from the
 * message's current folder.
 */
export const applyActions = async (
  ctx: ActionContext,
  accessToken: string,
  record: EmailRecord,
  actions: readonly Action[],
  map: FolderMap
): Promise<{ applied: AppliedAction[]; resolvedId: string | null }> => {
  const resolvedId = await resolveMessageId(ctx, accessToken, record)
  if (!resolvedId)
    return {
      applied: [{ action: 'resolve', ok: false, detail: 'message no longer found by subject + sender + received' }],
      resolvedId: null
    }

  const applied: AppliedAction[] = []
  let messageId = resolvedId
  for (const action of actions) {
    if (!isExecutable(action)) continue
    try {
      const outcome = await applyOne(ctx, accessToken, messageId, action, map, record)
      applied.push(outcome.result)
      messageId = outcome.nextId
      if (!outcome.result.ok) break
    } catch (error) {
      applied.push({ action: action.kind, ok: false, detail: errMessage(error) })
      break
    }
  }
  return { applied, resolvedId }
}
