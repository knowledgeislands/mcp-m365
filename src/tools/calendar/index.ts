/**
 * Calendar module for MCP M365 server.
 *
 * Thin seam (standard §2): each registration zod-validates its args and calls
 * the matching pure `main/` handler, passing the injected `GraphContext` as the
 * first argument. The handler holds the logic; this layer only wires.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import {
  AvailabilityInputSchema,
  AvailabilityResultSchema,
  handleCreateEvent,
  handleDeleteEvent,
  handleGetAvailability,
  handleListEvents
} from '../../main/calendar/index.js'
import type { GraphContext } from '../../main/graph-client/index.js'
import { DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, WRITE_REMOTE } from '../../utils/annotations.js'
import { graphIdSchema } from '../../utils/odata-helpers.js'

export const registerCalendarTools = (server: McpServer, ctx: GraphContext): void => {
  server.registerTool(
    'm365_calendar_availability_get',
    {
      description:
        'Read free/busy availability for up to 20 SMTP targets over at most seven days in UTC. Work/school accounts only; returns availability codes or explicit errors, never event details. No calendar mutation.',
      inputSchema: AvailabilityInputSchema,
      outputSchema: AvailabilityResultSchema,
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleGetAvailability(ctx, args)
  )

  server.registerTool(
    'm365_calendar_event_create',
    {
      description:
        'Creates a personal calendar event with no attendees. Never sends an invitation: the server is draft-only, so attendees are not accepted.',
      inputSchema: z
        .object({
          subject: z.string().describe('The subject of the event'),
          start: z.string().describe('The start time of the event in ISO 8601 format'),
          end: z.string().describe('The end time of the event in ISO 8601 format'),
          body: z.string().optional().describe('Optional body content for the event')
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleCreateEvent(ctx, args)
  )

  server.registerTool(
    'm365_calendar_event_delete',
    {
      description:
        'Deletes a personal calendar event. Refused for a meeting (any event with attendees, or one you did not organise), because deleting a meeting notifies its attendees or organiser. `dry_run` defaults to true — pass false to actually delete; dry-run fetches the event metadata and returns what would happen.',
      inputSchema: z
        .object({
          eventId: graphIdSchema.describe('The ID of the event to delete'),
          dry_run: z
            .boolean()
            .optional()
            .describe('Preview only; do not delete. Default true — pass false to actually delete.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    (args) => handleDeleteEvent(ctx, args)
  )

  server.registerTool(
    'm365_calendar_events_list',
    {
      description: 'Lists upcoming events from your calendar',
      inputSchema: z
        .object({
          count: z
            .number()
            .int()
            .positive()
            .max(50)
            .optional()
            .describe('Number of events to retrieve (default: 10, max: 50)'),
          startDateTime: z.string().optional().describe('ISO 8601 start date/time for the query range (default: now)'),
          endDateTime: z
            .string()
            .optional()
            .describe('ISO 8601 end date/time for the query range (default: startDateTime + 30 days)')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleListEvents(ctx, args)
  )
}
