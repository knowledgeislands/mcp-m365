/**
 * Delete event functionality
 */

import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleDeleteEvent = async (ctx: GraphContext, args: any): Promise<any> => {
  const { eventId, dry_run = true } = args

  if (!eventId) {
    return errorText('Event ID is required to delete an event.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const endpoint = `me/events/${eventId}`

    if (dry_run) {
      const event = await callGraphAPI(
        ctx.graphApiEndpoint,
        accessToken,
        'GET',
        `${endpoint}?$select=id,subject,start,end`
      )
      return {
        content: [
          {
            type: 'text',
            text: `[dry_run] would delete event ${eventId}: "${event?.subject ?? ''}" (${event?.start?.dateTime ?? '?'} → ${event?.end?.dateTime ?? '?'}). Pass dry_run: false to delete.`
          }
        ]
      }
    }

    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'DELETE', endpoint)

    return {
      content: [{ type: 'text', text: `Event with ID ${eventId} has been successfully deleted.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error deleting event: ${error.message}`)
  }
}
