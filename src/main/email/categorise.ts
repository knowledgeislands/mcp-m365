/**
 * Set Outlook categories on messages, and list the mailbox's category names.
 *
 * Categorising is all or nothing against the protected list: a message that
 * sits in a protected folder or carries a protected category, or a protected
 * category being added or removed, refuses the whole call before any message
 * changes.
 */
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { guardWrite } from '../protected/index.js'

const text = (value: unknown) => ({
  resultType: 'complete' as const,
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
})

const failure = (action: string, error: any) =>
  error.message === 'Authentication required'
    ? errorText(AUTH_REQUIRED_MESSAGE)
    : errorText(`Error ${action}: ${error.message}`)

const lower = (s: string) => s.toLowerCase()

/** The categories a message ends with: `set` replaces; otherwise `remove` then `add`, case-insensitively. */
export const nextCategories = (
  current: string[],
  { set, add, remove }: { set?: string[]; add?: string[]; remove?: string[] }
): string[] => {
  if (set) return [...new Map(set.map((c) => [lower(c), c])).values()]
  const removed = new Set((remove ?? []).map(lower))
  const kept = current.filter((c) => !removed.has(lower(c)))
  for (const c of add ?? []) if (!kept.some((k) => lower(k) === lower(c))) kept.push(c)
  return kept
}

/** `m365_email_messages_categorise`. */
export const handleCategoriseMessages = async (ctx: GraphContext, args: any): Promise<any> => {
  const messageIds: string[] = args.messageIds ?? []
  const { set, add, remove } = args as { set?: string[]; add?: string[]; remove?: string[] }
  if (!messageIds.length) return errorText('At least one message id is required.')
  if (set && (add?.length || remove?.length)) return errorText('Give either set, or add and remove, not both.')
  if (!set && !add?.length && !remove?.length) return errorText('Give set, add or remove.')

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const refused = await guardWrite(ctx, accessToken, 'm365_email_messages_categorise', {
      messageIds,
      categories: [...(set ?? []), ...(add ?? []), ...(remove ?? [])]
    })
    if (refused) return refused

    const results: Array<{ id: string; ok: boolean; categories?: string[]; error?: string }> = []
    for (const id of messageIds) {
      try {
        const current: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', `me/messages/${id}`, null, {
          $select: 'id,categories'
        })
        const categories = nextCategories(Array.isArray(current?.categories) ? current.categories : [], {
          set,
          add,
          remove
        })
        await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'PATCH', `me/messages/${id}`, { categories })
        results.push({ id, ok: true, categories })
      } catch (error: any) {
        results.push({ id, ok: false, error: error.message })
      }
    }
    const failed = results.filter((r) => !r.ok).length
    return { ...text({ updated: results.length - failed, failed, results }), ...(failed ? { isError: true } : {}) }
  } catch (error: any) {
    return failure('categorising messages', error)
  }
}

/** `m365_email_categories_list`: the mailbox's master category list. Needs `MailboxSettings.Read`. */
export const handleListCategories = async (ctx: GraphContext): Promise<any> => {
  try {
    const accessToken = await ctx.ensureAuthenticated()
    const res: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', 'me/outlook/masterCategories')
    const categories = (Array.isArray(res?.value) ? res.value : []).map((c: any) => ({
      id: String(c?.id ?? ''),
      displayName: String(c?.displayName ?? ''),
      color: String(c?.color ?? '')
    }))
    return text({ categories })
  } catch (error: any) {
    return failure('listing categories', error)
  }
}

/** Outlook's preset colours, `none` and `preset0` to `preset24`. */
export const CATEGORY_COLOURS = ['none', ...Array.from({ length: 25 }, (_, i) => `preset${i}`)] as const

/** `m365_email_category_create`: add a name to the master category list. Needs `MailboxSettings.ReadWrite`. */
export const handleCreateCategory = async (ctx: GraphContext, args: any): Promise<any> => {
  const displayName = String(args.displayName ?? '').trim()
  if (!displayName) return errorText('A category name is required.')
  try {
    const accessToken = await ctx.ensureAuthenticated()
    const refused = await guardWrite(ctx, accessToken, 'm365_email_category_create', { categories: [displayName] })
    if (refused) return refused
    const created: any = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'POST', 'me/outlook/masterCategories', {
      displayName,
      color: args.color ?? 'none'
    })
    return text({ id: String(created?.id ?? ''), displayName, color: String(created?.color ?? args.color ?? 'none') })
  } catch (error: any) {
    return failure('creating category', error)
  }
}
