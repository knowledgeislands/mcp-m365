/**
 * Cancel event functionality
 */

import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'

export const handleCancelEvent = async (args: any): Promise<any> => {
  const { eventId, comment, dry_run = true } = args

  if (!eventId) {
    return errorText('Event ID is required to cancel an event.')
  }

  try {
    const accessToken = await ensureAuthenticated()
    const endpoint = `me/events/${eventId}/cancel`
    const body = { comment: comment || 'Cancelled via API' }

    if (dry_run) {
      const event = await callGraphAPI(accessToken, 'GET', `me/events/${eventId}?$select=id,subject,start`)
      return {
        content: [
          {
            type: 'text',
            text: `[dry_run] would cancel event ${eventId}: "${event?.subject ?? ''}" (${event?.start?.dateTime ?? '?'}). Pass dry_run: false to cancel.`
          }
        ]
      }
    }

    await callGraphAPI(accessToken, 'POST', endpoint, body)

    return {
      content: [{ type: 'text', text: `Event with ID ${eventId} has been successfully cancelled.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error cancelling event: ${error.message}`)
  }
}

export default handleCancelEvent
