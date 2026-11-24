/**
 * Create event functionality. The server is draft-only: Graph sends an
 * invitation to every attendee of a new event and offers no way to suppress
 * it, so an event is created without attendees and a request that names any
 * is refused before authentication.
 */

import { DEFAULT_TIMEZONE } from '../../config/index.js'
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const ATTENDEES_REFUSED =
  'Attendees are not supported: this server never sends calendar invitations. Create the event without attendees and invite people from Outlook.'

export const handleCreateEvent = async (ctx: GraphContext, args: any): Promise<any> => {
  const { subject, start, end, attendees, body } = args

  if (!subject || !start || !end) {
    return errorText('Subject, start, and end times are required to create an event.')
  }

  if (attendees !== undefined && (!Array.isArray(attendees) || attendees.length > 0)) {
    return errorText(ATTENDEES_REFUSED)
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()

    const endpoint = 'me/events'

    const bodyContent = {
      subject,
      start: { dateTime: start.dateTime || start, timeZone: start.timeZone || DEFAULT_TIMEZONE },
      end: { dateTime: end.dateTime || end, timeZone: end.timeZone || DEFAULT_TIMEZONE },
      body: { contentType: 'HTML', content: body || '' }
    }

    await callGraphAPI(ctx.graphApiEndpoint, accessToken, 'POST', endpoint, bodyContent)

    return {
      content: [{ type: 'text', text: `Event '${subject}' has been successfully created.` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText(AUTH_REQUIRED_MESSAGE)
    }

    return errorText(`Error creating event: ${error.message}`)
  }
}
