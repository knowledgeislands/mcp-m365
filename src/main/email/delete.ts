/**
 * Delete email functionality (move to Deleted Items / trash)
 */

import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleDeleteEmail = async (ctx: GraphContext, args: any = {}): Promise<any> => {
  const emailId = args.id
  const permanent = args.permanent === true
  const dry_run = args.dry_run !== false

  if (!emailId) {
    return errorText('Email ID is required.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()

    if (dry_run) {
      const msg = await callGraphAPI(
        ctx.graphApiEndpoint,
        accessToken,
        'GET',
        `me/messages/${encodeURIComponent(emailId)}?$select=id,subject,from,receivedDateTime`
      )
      const verb = permanent ? 'permanently delete' : 'move to Deleted Items'
      return {
        content: [
          {
            type: 'text',
            text: `[dry_run] would ${verb}: "${msg?.subject ?? ''}" from ${msg?.from?.emailAddress?.address ?? '?'} (${msg?.receivedDateTime ?? '?'}). Pass dry_run: false to ${permanent ? 'permanently delete' : 'trash'}.`
          }
        ]
      }
    }

    if (permanent) {
      await callGraphAPI(
        ctx.graphApiEndpoint,
        accessToken,
        'POST',
        `me/messages/${encodeURIComponent(emailId)}/permanentDelete`
      )
      return {
        content: [{ type: 'text', text: 'Email permanently deleted.' }]
      }
    } else {
      const result = await callGraphAPI(
        ctx.graphApiEndpoint,
        accessToken,
        'POST',
        `me/messages/${encodeURIComponent(emailId)}/move`,
        {
          destinationId: 'deleteditems'
        }
      )
      return {
        content: [{ type: 'text', text: `Email moved to Deleted Items. ID: ${result.id}` }]
      }
    }
  } catch (error: any) {
    if (error.message === 'Authentication required' || error.message === 'UNAUTHORIZED') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }
    return errorText(`Failed to delete email: ${error.message}`)
  }
}
