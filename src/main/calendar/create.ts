/**
 * Create event functionality
 */

import { DEFAULT_TIMEZONE } from '../../config/index.js'
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleCreateEvent = async (ctx: GraphContext, args: any): Promise<any> => {
  const { subject, start, end, attendees, body } = args

  if (!subject || !start || !end) {
    return errorText('Subject, start, and end times are required to create an event.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()

    const endpoint = 'me/events'

    const bodyContent = {
      subject,
      start: { dateTime: start.dateTime || start, timeZone: start.timeZone || DEFAULT_TIMEZONE },
      end: { dateTime: end.dateTime || end, timeZone: end.timeZone || DEFAULT_TIMEZONE },
      attendees: attendees?.map((email: string) => ({ emailAddress: { address: email }, type: 'required' })),
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
