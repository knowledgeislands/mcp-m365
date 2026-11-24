/**
 * Delete event functionality. The server is draft-only: Graph sends a
 * cancellation to every attendee when the organiser deletes a meeting, so the
 * event is read first and anything that is a meeting — it has attendees, or
 * someone else organised it — is refused, in a preview and a live call alike.
 * Only a personal event with no attendees is deleted, which notifies no one.
 */

import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

/**
 * True unless deleting the event provably notifies no one: the caller organised
 * it and it has no attendees. An unreadable organiser flag counts as a meeting.
 */
const isMeeting = (event: any): boolean =>
  event?.isOrganizer !== true || (Array.isArray(event?.attendees) && event.attendees.length > 0)

export const handleDeleteEvent = async (ctx: GraphContext, args: any): Promise<any> => {
  const { eventId, dry_run = true } = args

  if (!eventId) {
    return errorText('Event ID is required to delete an event.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const endpoint = `me/events/${eventId}`

    const event = await callGraphAPI(
      ctx.graphApiEndpoint,
      accessToken,
      'GET',
      `${endpoint}?$select=id,subject,start,end,isOrganizer,attendees`
    )

    if (isMeeting(event)) {
      return errorText(
        `Refused: event ${eventId} ("${event?.subject ?? ''}") is a meeting, and deleting it would notify its attendees or organiser. This server never sends; remove it from Outlook instead.`
      )
    }

    if (dry_run) {
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
      return errorText(AUTH_REQUIRED_MESSAGE)
    }

    return errorText(`Error deleting event: ${error.message}`)
  }
}
