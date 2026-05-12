/**
 * Calendar module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { handleAcceptEvent } from './accept.js'
import { handleCancelEvent } from './cancel.js'
import { handleCreateEvent } from './create.js'
import { handleDeclineEvent } from './decline.js'
import { handleDeleteEvent } from './delete.js'
import { handleListEvents } from './list.js'

const READ_ONLY_REMOTE = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const
const ADDITIVE_REMOTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } as const
const STATE_CHANGE_REMOTE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const
const DESTRUCTIVE_REMOTE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true } as const

export const registerCalendarTools = (server: McpServer): void => {
  server.registerTool(
    'list-events',
    {
      description: 'Lists upcoming events from your calendar',
      inputSchema: {
        count: z.number().optional().describe('Number of events to retrieve (default: 10, max: 50)'),
        startDateTime: z.string().optional().describe('ISO 8601 start date/time for the query range (default: now)'),
        endDateTime: z.string().optional().describe('ISO 8601 end date/time for the query range (default: startDateTime + 30 days)')
      },
      annotations: READ_ONLY_REMOTE
    },
    handleListEvents
  )

  server.registerTool(
    'accept-event',
    {
      description: 'Accepts a calendar event',
      inputSchema: {
        eventId: z.string().describe('The ID of the event to accept'),
        comment: z.string().optional().describe('Optional comment for accepting the event')
      },
      annotations: STATE_CHANGE_REMOTE
    },
    handleAcceptEvent
  )

  server.registerTool(
    'decline-event',
    {
      description: 'Declines a calendar event',
      inputSchema: {
        eventId: z.string().describe('The ID of the event to decline'),
        comment: z.string().optional().describe('Optional comment for declining the event')
      },
      annotations: DESTRUCTIVE_REMOTE
    },
    handleDeclineEvent
  )

  server.registerTool(
    'create-event',
    {
      description: 'Creates a new calendar event',
      inputSchema: {
        subject: z.string().describe('The subject of the event'),
        start: z.string().describe('The start time of the event in ISO 8601 format'),
        end: z.string().describe('The end time of the event in ISO 8601 format'),
        attendees: z.array(z.string()).optional().describe('List of attendee email addresses'),
        body: z.string().optional().describe('Optional body content for the event')
      },
      annotations: ADDITIVE_REMOTE
    },
    handleCreateEvent
  )

  server.registerTool(
    'cancel-event',
    {
      description: 'Cancels a calendar event',
      inputSchema: {
        eventId: z.string().describe('The ID of the event to cancel'),
        comment: z.string().optional().describe('Optional comment for cancelling the event')
      },
      annotations: DESTRUCTIVE_REMOTE
    },
    handleCancelEvent
  )

  server.registerTool(
    'delete-event',
    {
      description: 'Deletes a calendar event',
      inputSchema: {
        eventId: z.string().describe('The ID of the event to delete')
      },
      annotations: DESTRUCTIVE_REMOTE
    },
    handleDeleteEvent
  )
}

export { handleAcceptEvent, handleCancelEvent, handleCreateEvent, handleDeclineEvent, handleDeleteEvent, handleListEvents }
