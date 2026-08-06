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
  return map.paths.filter((p) => p.toLowerCase().startsWith(prefix.toLowerCase()) && !p.slice(prefix.length).includes('/'))
}

/** Read messages from a folder, oldest first so repeated batched runs make monotonic progress. */
export const listFolderMessages = async (ctx: GraphContext, accessToken: string, folderId: string, top: number): Promise<any[]> => {
  const response: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', `me/mailFolders/${folderId}/messages`, null, {
    $top: top,
    $select: TRIAGE_SELECT_FIELDS,
    $expand: TRIAGE_EXPAND,
    $orderby: 'receivedDateTime asc'
  })
  return Array.isArray(response?.value) ? response.value : []
}

const sameMessage = (record: EmailRecord, candidate: any): boolean => identityKey(record) === identityKey(toEmailRecord(candidate))

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
      const message: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', `me/messages/${record.id}`, null, { $select: IDENTITY_SELECT })
      if (sameMessage(record, message)) return message
    } catch {
      // Stale id — fall through to the identity search.
    }
  }

  if (!record.received) return null

  try {
    const response: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', 'me/messages', null, {
      $filter: `receivedDateTime eq ${record.received}`,
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
export const resolveMessageId = async (ctx: GraphContext, accessToken: string, record: EmailRecord): Promise<string | null> => {
  const message = await findMessage(ctx, accessToken, record)
  return message ? String(message.id) : null
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
  ctx: GraphContext,
  accessToken: string,
  messageId: string,
  action: Action,
  map: FolderMap
): Promise<{ result: AppliedAction; nextId: string }> => {
  if (action.kind === 'move') {
    const target = resolveMoveTarget(action)
    const destinationId = map.idByPath.get(target.toLowerCase())
    if (!destinationId) return { result: { action: `move:${target}`, ok: false, detail: 'destination folder does not exist' }, nextId: messageId }
    const moved: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'POST', `me/messages/${messageId}/move`, { destinationId })
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
    const current: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', `me/messages/${messageId}`, null, { $select: 'categories' })
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
  ctx: GraphContext,
  accessToken: string,
  record: EmailRecord,
  actions: readonly Action[],
  map: FolderMap
): Promise<{ applied: AppliedAction[]; resolvedId: string | null }> => {
  const resolvedId = await resolveMessageId(ctx, accessToken, record)
  if (!resolvedId) return { applied: [{ action: 'resolve', ok: false, detail: 'message no longer found by subject + sender + received' }], resolvedId: null }

  const applied: AppliedAction[] = []
  let messageId = resolvedId
  for (const action of actions) {
    if (!isExecutable(action)) continue
    try {
      const outcome = await applyOne(ctx, accessToken, messageId, action, map)
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
