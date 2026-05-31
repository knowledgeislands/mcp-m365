/**
 * Create event functionality
 */

import { DEFAULT_TIMEZONE } from '../../config/index.js'
import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'

export const handleCreateEvent = async (args: any): Promise<any> => {
  const { subject, start, end, attendees, body } = args

  if (!subject || !start || !end) {
    return errorText('Subject, start, and end times are required to create an event.')
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
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error creating event: ${error.message}`)
  }
}

export default handleCreateEvent
