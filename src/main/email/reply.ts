/** Reply actions let Graph own threading and recipient derivation. */

import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export type ReplyKind = 'reply' | 'replyAll'
export type ReplyArgs = { id: string; comment: string; dry_run?: boolean }

export const handleReplyEmail = async (ctx: GraphContext, args: ReplyArgs, kind: ReplyKind) => {
  if (!args.id) return errorText('Email ID is required.')
  if (!args.comment?.trim()) return errorText('A plain-text reply comment is required.')

  try {
    const token = await ctx.ensureAuthenticated()
    const path = `me/messages/${args.id}`
    if (args.dry_run !== false) {
      const message = await callGraphAPI<Record<string, unknown>>(ctx.graphApiEndpoint, token, 'GET', path, null, {
        $select: 'id,subject,from,receivedDateTime'
      })
      return {
        content: [
          {
            type: 'text' as const,
            text: `[dry_run] would ${kind === 'replyAll' ? 'reply to all' : 'reply'} to message ${args.id} (subject: ${String(message.subject ?? '')}). Graph will choose the recipients and threading. Pass dry_run: false to send.`
          }
        ]
      }
    }

    await callGraphAPI(ctx.graphApiEndpoint, token, 'POST', `${path}/${kind}`, { comment: args.comment })
    return {
      content: [
        {
          type: 'text' as const,
          text: `${kind === 'replyAll' ? 'Reply-all' : 'Reply'} accepted for delivery by Graph. This is not a delivery receipt.`
        }
      ]
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message === 'Authentication required' || message === 'UNAUTHORIZED') {
      return errorText(AUTH_REQUIRED_MESSAGE)
    }
    return errorText(`Failed to ${kind === 'replyAll' ? 'reply to all' : 'reply'}: ${message}`)
  }
}
