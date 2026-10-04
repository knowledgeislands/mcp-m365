/** Message-scoped drafts use Graph's own quoted-content and recipient preparation. */
import { z } from 'zod'
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const draftRecipientSchema = z.email().max(254)
export type DraftAction = 'createReply' | 'createReplyAll' | 'createForward'
export type DraftActionArgs = { id: string; comment?: string; recipients?: string[]; dry_run?: boolean }

export const handleDraftAction = async (ctx: GraphContext, args: DraftActionArgs, action: DraftAction) => {
  if (!args.id) return errorText('Email ID is required.')
  if (args.comment !== undefined && args.comment.length > 10000)
    return errorText('Draft comment exceeds 10000 characters.')
  if (action === 'createForward') {
    if (
      !args.recipients?.length ||
      args.recipients.length > 50 ||
      args.recipients.some((address) => !draftRecipientSchema.safeParse(address).success)
    ) {
      return errorText('Forward requires 1 to 50 valid recipient addresses.')
    }
  } else if (args.recipients !== undefined) {
    return errorText('Reply drafts do not accept recipient overrides.')
  }

  try {
    const token = await ctx.ensureAuthenticated()
    const messagePath = `me/messages/${args.id}`
    if (args.dry_run !== false) {
      const original = await callGraphAPI<{ subject?: string }>(ctx.graphApiEndpoint, token, 'GET', messagePath, null, {
        $select: 'id,subject'
      })
      const result = { dry_run: true, action, originalMessageId: args.id, draftId: null, subject: null }
      return {
        resultType: 'complete' as const,
        structuredContent: result,
        content: [
          {
            type: 'text' as const,
            text: `[dry_run] would create ${action} draft for message ${args.id} (subject: ${original.subject ?? ''}). No draft was created.`
          }
        ]
      }
    }

    const body =
      action === 'createForward'
        ? {
            message: { toRecipients: args.recipients?.map((address) => ({ emailAddress: { address } })) },
            ...(args.comment !== undefined ? { comment: args.comment } : {})
          }
        : args.comment !== undefined
          ? { comment: args.comment }
          : null
    const draft = await callGraphAPI<{ id?: unknown; subject?: unknown }>(
      ctx.graphApiEndpoint,
      token,
      'POST',
      `${messagePath}/${action}`,
      body
    )
    if (typeof draft.id !== 'string' || !draft.id)
      return errorText('Graph created a draft but did not return its ID; inspect Outlook drafts before retrying.')
    const result = {
      dry_run: false,
      action,
      originalMessageId: args.id,
      draftId: draft.id,
      subject: typeof draft.subject === 'string' ? draft.subject : ''
    }
    return {
      resultType: 'complete' as const,
      structuredContent: result,
      content: [
        {
          type: 'text' as const,
          text: `${action} draft created. Draft ID: ${result.draftId}. Subject: ${result.subject}. Review it in Outlook; it was not sent.`
        }
      ]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'Authentication required' || message === 'UNAUTHORIZED') {
      return errorText(AUTH_REQUIRED_MESSAGE)
    }
    if (message.includes('403')) return errorText(`Failed to create draft: ${message}. Confirm Mail.ReadWrite consent.`)
    return errorText(`Failed to create draft: ${message}`)
  }
}
