/** Forward one original message without downloading or rebuilding its content. */

import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { draftRecipientSchema } from './draft-actions.js'

export type ForwardArgs = { id: string; recipients: string[]; comment?: string; dry_run?: boolean }

export const handleForwardEmail = async (ctx: GraphContext, args: ForwardArgs) => {
  if (!args.id) return errorText('Email ID is required.')
  if (
    !args.recipients?.length ||
    args.recipients.length > 50 ||
    args.recipients.some((address) => !draftRecipientSchema.safeParse(address).success)
  ) {
    return errorText('Forward requires 1 to 50 valid recipient addresses.')
  }
  if (args.comment !== undefined && args.comment.length > 10000)
    return errorText('Forward comment exceeds 10000 characters.')

  try {
    const token = await ctx.ensureAuthenticated()
    const path = `me/messages/${args.id}`
    if (args.dry_run !== false) {
      const message = await callGraphAPI<{ subject?: string }>(ctx.graphApiEndpoint, token, 'GET', path, null, {
        $select: 'id,subject'
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `[dry_run] would forward message ${args.id} (subject: ${message.subject ?? ''}) to ${args.recipients.length} recipient(s). No message was sent. Pass dry_run: false to send.`
          }
        ]
      }
    }

    await callGraphAPI(ctx.graphApiEndpoint, token, 'POST', `${path}/forward`, {
      toRecipients: args.recipients.map((address) => ({ emailAddress: { address } })),
      ...(args.comment !== undefined ? { comment: args.comment } : {})
    })
    return {
      content: [
        { type: 'text' as const, text: 'Forward accepted for delivery by Graph. This is not a delivery receipt.' }
      ]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'Authentication required' || message === 'UNAUTHORIZED') {
      return errorText(AUTH_REQUIRED_MESSAGE)
    }
    return errorText(`Failed to forward email: ${message}`)
  }
}
