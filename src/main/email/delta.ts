/**
 * Mail changes since a checkpoint, through Graph's message delta query on one
 * folder. Headers only: the select carries no body or preview, so a change
 * read never returns message text.
 *
 * The first call (no `deltaLink`) starts a round and pages through the folder's
 * current messages; each page returns either a `nextLink` (more in this round)
 * or a `deltaLink` (the round is complete). Pass either back as `deltaLink` to
 * continue; save the `deltaLink` as the checkpoint for the next round.
 */
import { z } from 'zod'
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { resolveFolderPath } from './folder-utils.js'

export const DELTA_SELECT_FIELDS = 'id,subject,from,receivedDateTime,parentFolderId,categories,isRead,conversationId'

export const deltaResultSchema = z.object({
  changes: z.array(
    z.object({
      id: z.string(),
      removed: z.boolean(),
      reason: z.string().optional(),
      subject: z.string().optional(),
      from: z.string().optional(),
      receivedDateTime: z.string().optional(),
      parentFolderId: z.string().optional(),
      categories: z.array(z.string()).optional(),
      isRead: z.boolean().optional(),
      conversationId: z.string().optional()
    })
  ),
  nextLink: z.string().optional(),
  deltaLink: z.string().optional()
})

// Graph's delta pages hold message objects only; a removal carries `@removed`.
const change = (m: any) =>
  m['@removed']
    ? { id: String(m.id ?? ''), removed: true, reason: String(m['@removed']?.reason ?? '') }
    : {
        id: String(m.id ?? ''),
        removed: false,
        subject: String(m.subject ?? ''),
        from: String(m.from?.emailAddress?.address ?? ''),
        receivedDateTime: String(m.receivedDateTime ?? ''),
        parentFolderId: String(m.parentFolderId ?? ''),
        categories: Array.isArray(m.categories) ? m.categories.map(String) : [],
        isRead: m.isRead === true,
        conversationId: String(m.conversationId ?? '')
      }

/** `m365_email_messages_delta`. */
export const handleMessagesDelta = async (ctx: GraphContext, args: any): Promise<any> => {
  const deltaLink: string | undefined = args.deltaLink
  if (deltaLink && !/\/messages\/delta$/.test(new URL(deltaLink, 'https://invalid/').pathname)) {
    return errorText('deltaLink must be a nextLink or deltaLink returned by this tool.')
  }
  try {
    const accessToken = await ctx.ensureAuthenticated()
    // A full link is host-pinned by callGraphAPI before the token is attached.
    const res: any = deltaLink
      ? await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', deltaLink)
      : await callGraphAPI(
          ctx.graphApiEndpoint,
          accessToken,
          'GET',
          `${await resolveFolderPath(ctx.graphApiEndpoint, accessToken, args.folder)}/delta`,
          null,
          { $select: DELTA_SELECT_FIELDS }
        )
    const result: Record<string, unknown> = {
      changes: (Array.isArray(res?.value) ? res.value : []).map(change)
    }
    if (res?.['@odata.nextLink']) result.nextLink = String(res['@odata.nextLink'])
    if (res?.['@odata.deltaLink']) result.deltaLink = String(res['@odata.deltaLink'])
    return {
      resultType: 'complete' as const,
      structuredContent: result,
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
    }
  } catch (error: any) {
    return error.message === 'Authentication required'
      ? errorText(AUTH_REQUIRED_MESSAGE)
      : errorText(`Error reading mail changes: ${error.message}`)
  }
}
