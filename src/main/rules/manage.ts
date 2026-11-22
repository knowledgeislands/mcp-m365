/**
 * Update and delete an inbox rule. Both find the rule by id or exact name, and
 * both preview by default: `dry_run: false` makes the change. Every rule write
 * honours the protected list, refusing a rule whose criteria or actions name a
 * protected folder or category, before or after the change.
 */
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { getFolderIdByName } from '../folder/folder-utils.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { guardWrite, type WriteTargets } from '../protected/index.js'
import { getInboxRules } from './list.js'

const RULES_ENDPOINT = 'me/mailFolders/inbox/messageRules'

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : [])

/** The folders and categories a rule names, in its conditions, exceptions or actions. */
export const ruleTargets = (rule: any): Required<Pick<WriteTargets, 'folderIds' | 'categories'>> => ({
  folderIds: [rule?.actions?.moveToFolder, rule?.actions?.copyToFolder].filter(Boolean).map(String),
  categories: [
    ...strings(rule?.actions?.assignCategories),
    ...strings(rule?.conditions?.categories),
    ...strings(rule?.exceptions?.categories)
  ]
})

const mergeTargets = (a: ReturnType<typeof ruleTargets>, b: ReturnType<typeof ruleTargets>): WriteTargets => ({
  folderIds: [...a.folderIds, ...b.folderIds],
  categories: [...a.categories, ...b.categories]
})

const text = (value: unknown) => ({
  resultType: 'complete' as const,
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
})

type Found = { rule: any } | { error: string }

const findRule = async (ctx: GraphContext, accessToken: string, args: any): Promise<Found> => {
  if (!args.ruleId === !args.ruleName) return { error: 'Give exactly one of ruleId or ruleName.' }
  const rules = await getInboxRules(ctx.graphApiEndpoint, accessToken)
  const matches = rules.filter((r: any) => (args.ruleId ? r.id === args.ruleId : r.displayName === args.ruleName))
  if (matches.length === 0) return { error: `Rule ${args.ruleId ?? `"${args.ruleName}"`} not found.` }
  if (matches.length > 1) return { error: `${matches.length} rules are named "${args.ruleName}"; give ruleId instead.` }
  return { rule: matches[0] }
}

const failure = (action: string, error: any) =>
  error.message === 'Authentication required'
    ? errorText(AUTH_REQUIRED_MESSAGE)
    : errorText(`Error ${action}: ${error.message}`)

/**
 * `m365_email_rule_update`: rename, enable or disable, reorder, or change a
 * rule's conditions and actions. Conditions and actions are merged into the
 * rule's current ones, so a field left out keeps its value.
 */
export const handleUpdateRule = async (ctx: GraphContext, args: any): Promise<any> => {
  const dry_run = args.dry_run !== false
  try {
    const accessToken = await ctx.ensureAuthenticated()
    const found = await findRule(ctx, accessToken, args)
    if ('error' in found) return errorText(found.error)
    const { rule } = found

    const conditions: Record<string, unknown> = {}
    if (args.fromAddresses !== undefined) {
      conditions.fromAddresses = String(args.fromAddresses)
        .split(',')
        .map((a: string) => a.trim())
        .filter(Boolean)
        .map((address: string) => ({ emailAddress: { address } }))
    }
    if (args.containsSubject !== undefined) conditions.subjectContains = [args.containsSubject]
    if (args.hasAttachments !== undefined) conditions.hasAttachment = args.hasAttachments

    const actions: Record<string, unknown> = {}
    if (args.moveToFolder !== undefined) {
      const folderId = await getFolderIdByName(ctx.graphApiEndpoint, accessToken, args.moveToFolder)
      if (!folderId) return errorText(`Target folder "${args.moveToFolder}" not found.`)
      actions.moveToFolder = folderId
    }
    if (args.markAsRead !== undefined) actions.markAsRead = args.markAsRead
    if (args.categories !== undefined) actions.assignCategories = args.categories

    const patch: Record<string, unknown> = {}
    if (args.name !== undefined) patch.displayName = args.name
    if (args.isEnabled !== undefined) patch.isEnabled = args.isEnabled
    if (args.sequence !== undefined) patch.sequence = args.sequence
    if (Object.keys(conditions).length) patch.conditions = { ...(rule.conditions ?? {}), ...conditions }
    if (Object.keys(actions).length) patch.actions = { ...(rule.actions ?? {}), ...actions }
    if (!Object.keys(patch).length) return errorText('Nothing to change: give at least one field to update.')

    const refused = await guardWrite(
      ctx,
      accessToken,
      'm365_email_rule_update',
      mergeTargets(ruleTargets(rule), ruleTargets({ ...rule, ...patch }))
    )
    if (refused) return refused

    if (dry_run) return text({ dry_run: true, updated: false, ruleId: rule.id, name: rule.displayName, patch })
    const updated: any = await callGraphAPI(
      ctx.graphApiEndpoint,
      accessToken,
      'PATCH',
      `${RULES_ENDPOINT}/${rule.id}`,
      patch
    )
    return text({
      dry_run: false,
      updated: true,
      ruleId: rule.id,
      name: updated?.displayName ?? rule.displayName,
      patch
    })
  } catch (error: any) {
    return failure('updating rule', error)
  }
}

/** `m365_email_rule_delete`: delete an inbox rule; preview by default. */
export const handleDeleteRule = async (ctx: GraphContext, args: any): Promise<any> => {
  const dry_run = args.dry_run !== false
  try {
    const accessToken = await ctx.ensureAuthenticated()
    const found = await findRule(ctx, accessToken, args)
    if ('error' in found) return errorText(found.error)
    const { rule } = found

    const refused = await guardWrite(ctx, accessToken, 'm365_email_rule_delete', ruleTargets(rule))
    if (refused) return refused

    if (dry_run) return text({ dry_run: true, deleted: false, ruleId: rule.id, name: rule.displayName })
    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'DELETE', `${RULES_ENDPOINT}/${rule.id}`)
    return text({ dry_run: false, deleted: true, ruleId: rule.id, name: rule.displayName })
  } catch (error: any) {
    return failure('deleting rule', error)
  }
}
