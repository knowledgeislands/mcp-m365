/**
 * Create event functionality
 */

import { DEFAULT_TIMEZONE } from '../../config.js'
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleCreateEvent = async (args: any): Promise<any> => {
  const { subject, start, end, attendees, body } = args

  if (!subject || !start || !end) {
    return {
      content: [{ type: 'text', text: 'Subject, start, and end times are required to create an event.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    const endpoint = 'me/events'

    const bodyContent = {
      subject,
      start: { dateTime: start.dateTime || start, timeZone: start.timeZone || DEFAULT_TIMEZONE },
      end: { dateTime: end.dateTime || end, timeZone: end.timeZone || DEFAULT_TIMEZONE },
      attendees: attendees?.map((email: string) => ({ emailAddress: { address: email }, type: 'required' })),
      body: { contentType: 'HTML', content: body || '' }
    }

    await callGraphAPI(accessToken, 'POST', endpoint, bodyContent)

    return {
      content: [{ type: 'text', text: `Event '${subject}' has been successfully created.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error creating event: ${error.message}` }]
    }
  }
}

export default handleCreateEvent
