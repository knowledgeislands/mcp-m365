/**
 * Accept event functionality
 */
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleAcceptEvent = async (args: any): Promise<any> => {
  const { eventId, comment } = args

  if (!eventId) {
    return {
      content: [{ type: 'text', text: 'Event ID is required to accept an event.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()
    const endpoint = `me/events/${eventId}/accept`
    const body = { comment: comment || 'Accepted via API' }

    await callGraphAPI(accessToken, 'POST', endpoint, body)

    return {
      content: [{ type: 'text', text: `Event with ID ${eventId} has been successfully accepted.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error accepting event: ${error.message}` }]
    }
  }
}

export default handleAcceptEvent
