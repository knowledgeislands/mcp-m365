/**
 * Delete event functionality
 */
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleDeleteEvent = async (args: any): Promise<any> => {
  const { eventId, dry_run = true } = args

  if (!eventId) {
    return {
      content: [{ type: 'text', text: 'Event ID is required to delete an event.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()
    const endpoint = `me/events/${eventId}`

    if (dry_run) {
      const event = await callGraphAPI(accessToken, 'GET', `${endpoint}?$select=id,subject,start,end`)
      return {
        content: [
          {
            type: 'text',
            text: `[dry_run] would delete event ${eventId}: "${event?.subject ?? ''}" (${event?.start?.dateTime ?? '?'} → ${event?.end?.dateTime ?? '?'}). Pass dry_run: false to delete.`
          }
        ]
      }
    }

    await callGraphAPI(accessToken, 'DELETE', endpoint)

    return {
      content: [{ type: 'text', text: `Event with ID ${eventId} has been successfully deleted.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error deleting event: ${error.message}` }]
    }
  }
}

export default handleDeleteEvent
