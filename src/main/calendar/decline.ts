/**
 * Decline event functionality
 */

import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleDeclineEvent = async (ctx: GraphContext, args: any): Promise<any> => {
  const { eventId, comment, dry_run = true } = args

  if (!eventId) {
    return errorText('Event ID is required to decline an event.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const endpoint = `me/events/${eventId}/decline`
    const body = { comment: comment || 'Declined via API' }

    if (dry_run) {
      const event = await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'GET', `me/events/${eventId}?$select=id,subject,start`)
      return {
        content: [
          {
            type: 'text',
            text: `[dry_run] would decline event ${eventId}: "${event?.subject ?? ''}" (${event?.start?.dateTime ?? '?'}). Pass dry_run: false to decline.`
          }
        ]
      }
    }

    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'POST', endpoint, body)

    return {
      content: [{ type: 'text', text: `Event with ID ${eventId} has been successfully declined.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error declining event: ${error.message}`)
  }
}

export default handleDeclineEvent
