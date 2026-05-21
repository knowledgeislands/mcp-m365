/**
 * Calendar module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, WRITE_IDEMPOTENT_REMOTE, WRITE_REMOTE } from '../../utils/annotations.js'
import { handleAcceptEvent } from './accept.js'
import { handleCancelEvent } from './cancel.js'
import { handleCreateEvent } from './create.js'
import { handleDeclineEvent } from './decline.js'
import { handleDeleteEvent } from './delete.js'
import { handleListEvents } from './list.js'

export const registerCalendarTools = (server: McpServer): void => {
  server.registerTool(
    'm365_calendar_events_list',
    {
      description: 'Lists upcoming events from your calendar',
      inputSchema: z
        .object({
          count: z.number().int().positive().max(50).optional().describe('Number of events to retrieve (default: 10, max: 50)'),
          startDateTime: z.string().optional().describe('ISO 8601 start date/time for the query range (default: now)'),
          endDateTime: z.string().optional().describe('ISO 8601 end date/time for the query range (default: startDateTime + 30 days)')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    handleListEvents
  )

  server.registerTool(
    'm365_calendar_event_accept',
    {
      description: 'Accepts a calendar event',
      inputSchema: z
        .object({
          eventId: z.string().describe('The ID of the event to accept'),
          comment: z.string().optional().describe('Optional comment for accepting the event')
        })
        .strict(),
      annotations: WRITE_IDEMPOTENT_REMOTE
    },
    handleAcceptEvent
  )

  server.registerTool(
    'm365_calendar_event_decline',
    {
      description: 'Declines a calendar event. `dry_run` defaults to true — pass false to actually decline; dry-run fetches the event metadata and returns what would happen.',
      inputSchema: z
        .object({
          eventId: z.string().min(1).describe('The ID of the event to decline'),
          comment: z.string().optional().describe('Optional comment for declining the event'),
          dry_run: z.boolean().optional().describe('Preview only; do not decline. Default true — pass false to actually decline.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    handleDeclineEvent
  )

  server.registerTool(
    'm365_calendar_event_create',
    {
      description: 'Creates a new calendar event',
      inputSchema: z
        .object({
          subject: z.string().describe('The subject of the event'),
          start: z.string().describe('The start time of the event in ISO 8601 format'),
          end: z.string().describe('The end time of the event in ISO 8601 format'),
          attendees: z.array(z.string()).optional().describe('List of attendee email addresses'),
          body: z.string().optional().describe('Optional body content for the event')
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    handleCreateEvent
  )

  server.registerTool(
    'm365_calendar_event_cancel',
    {
      description: 'Cancels a calendar event. `dry_run` defaults to true — pass false to actually cancel.',
      inputSchema: z
        .object({
          eventId: z.string().min(1).describe('The ID of the event to cancel'),
          comment: z.string().optional().describe('Optional comment for cancelling the event'),
          dry_run: z.boolean().optional().describe('Preview only; do not cancel. Default true — pass false to actually cancel.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    handleCancelEvent
  )

  server.registerTool(
    'm365_calendar_event_delete',
    {
      description: 'Deletes a calendar event. `dry_run` defaults to true — pass false to actually delete; dry-run fetches the event metadata and returns what would happen.',
      inputSchema: z
        .object({
          eventId: z.string().min(1).describe('The ID of the event to delete'),
          dry_run: z.boolean().optional().describe('Preview only; do not delete. Default true — pass false to actually delete.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    handleDeleteEvent
  )
}

export { handleAcceptEvent, handleCancelEvent, handleCreateEvent, handleDeclineEvent, handleDeleteEvent, handleListEvents }
