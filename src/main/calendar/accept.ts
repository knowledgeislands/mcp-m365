/**
 * Accept event functionality
 */

import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleAcceptEvent = async (ctx: GraphContext, args: any): Promise<any> => {
  const { eventId, comment } = args

  if (!eventId) {
    return errorText('Event ID is required to accept an event.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const endpoint = `me/events/${eventId}/accept`
    const body = { comment: comment || 'Accepted via API' }

    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'POST', endpoint, body)

    return {
      content: [{ type: 'text', text: `Event with ID ${eventId} has been successfully accepted.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error accepting event: ${error.message}`)
  }
}

export default handleAcceptEvent
