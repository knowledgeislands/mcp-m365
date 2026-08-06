/**
 * Email module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  emailListResultSchema,
  emailSearchResultSchema,
  handleDeleteEmail,
  handleDraftEmail,
  handleListEmails,
  handleMarkAsRead,
  handleReadEmail,
  handleSearchEmails,
  handleSendEmail
} from '../../main/email/index.js'
import type { GraphContext } from '../../main/graph-client/index.js'
import { DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, WRITE_IDEMPOTENT_REMOTE, WRITE_REMOTE } from '../../utils/annotations.js'
import { graphIdSchema } from '../../utils/odata-helpers.js'

export const registerEmailTools = (server: McpServer, ctx: GraphContext): void => {
  server.registerTool(
    'm365_email_draft_create',
    {
      description: 'Creates and saves an email draft in Outlook',
      inputSchema: z
        .object({
          to: z.string().optional().describe('Comma-separated list of recipient email addresses'),
          cc: z.string().optional().describe('Comma-separated list of CC recipient email addresses'),
          bcc: z.string().optional().describe('Comma-separated list of BCC recipient email addresses'),
          subject: z.string().optional().describe('Draft email subject'),
          body: z.string().optional().describe('Draft email body content (can be plain text or HTML)'),
          importance: z.enum(['normal', 'high', 'low']).optional().describe('Email importance (normal, high, low)')
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleDraftEmail(ctx, args)
  )

  server.registerTool(
    'm365_email_message_delete',
    {
      description:
        'Deletes an email by moving it to Deleted Items (trash). Use permanent=true to hard delete. `dry_run` defaults to true — pass false to actually delete; dry-run fetches the message metadata and returns subject/sender/date.',
      inputSchema: z
        .object({
          id: graphIdSchema.describe('ID of the email to delete'),
          permanent: z
            .boolean()
            .optional()
            .describe('If true, permanently delete the email instead of moving to Deleted Items. Default: false'),
          dry_run: z
            .boolean()
            .optional()
            .describe('Preview only; do not delete. Default true — pass false to actually delete.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    (args) => handleDeleteEmail(ctx, args)
  )

  server.registerTool(
    'm365_email_message_get',
    {
      description:
        'Reads the content of a specific email. HTML emails are securely sanitized to extract only visible text, preventing prompt injection attacks via hidden content.',
      inputSchema: z
        .object({
          id: graphIdSchema.describe('ID of the email to read'),
          includeRawHtml: z
            .boolean()
            .optional()
            .describe(
              'Include raw HTML content (UNSAFE - for debugging only, may contain hidden prompt injection content)'
            )
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleReadEmail(ctx, args)
  )

  server.registerTool(
    'm365_email_message_mark_read',
    {
      description: 'Marks an email as read or unread',
      inputSchema: z
        .object({
          id: graphIdSchema.describe('ID of the email to mark as read/unread'),
          isRead: z.boolean().optional().describe('Whether to mark as read (true) or unread (false). Default: true')
        })
        .strict(),
      annotations: WRITE_IDEMPOTENT_REMOTE
    },
    (args) => handleMarkAsRead(ctx, args)
  )

  server.registerTool(
    'm365_email_message_send',
    {
      description: 'Composes and sends a new email. Supports both plain text and HTML content.',
      inputSchema: z
        .object({
          to: z.string().describe('Comma-separated list of recipient email addresses'),
          cc: z.string().optional().describe('Comma-separated list of CC recipient email addresses'),
          bcc: z.string().optional().describe('Comma-separated list of BCC recipient email addresses'),
          subject: z.string().describe('Email subject'),
          body: z.string().describe('Email body content (plain text or HTML)'),
          isHtml: z
            .boolean()
            .optional()
            .describe(
              'Set to true to send as HTML, false for plain text. If not specified, auto-detects based on <html> tag presence.'
            ),
          importance: z.enum(['normal', 'high', 'low']).optional().describe('Email importance (normal, high, low)'),
          saveToSentItems: z.boolean().optional().describe('Whether to save the email to sent items')
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleSendEmail(ctx, args)
  )

  server.registerTool(
    'm365_email_messages_list',
    {
      description: 'Lists recent emails from your inbox',
      inputSchema: z
        .object({
          folder: z
            .string()
            .optional()
            .describe(
              "Email folder to list. Use well-known names like 'inbox' or a full custom path like 'Top/Sub' (default: 'inbox')"
            ),
          folderId: graphIdSchema
            .optional()
            .describe(
              'Optional explicit Graph folder ID. If provided, this is used instead of folder path resolution.'
            ),
          count: z
            .number()
            .int()
            .positive()
            .max(1000)
            .optional()
            .describe('Number of emails to retrieve (default: 10, max: 1000)'),
          includeCount: z
            .boolean()
            .optional()
            .describe('Include total matching count from Microsoft Graph (@odata.count). Default: false')
        })
        .strict(),
      outputSchema: emailListResultSchema,
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleListEmails(ctx, args)
  )

  server.registerTool(
    'm365_email_messages_search',
    {
      description: 'Search for emails using various criteria',
      inputSchema: z
        .object({
          query: z.string().optional().describe('Search query text to find in emails'),
          folder: z
            .string()
            .optional()
            .describe(
              "Email folder to search in. Use well-known names like 'inbox' or a full custom path like 'Top/Sub' (default: 'inbox')"
            ),
          folderId: graphIdSchema
            .optional()
            .describe(
              'Optional explicit Graph folder ID. If provided, this is used instead of folder path resolution.'
            ),
          from: z.string().optional().describe('Filter by sender email address or name'),
          to: z.string().optional().describe('Filter by recipient email address or name'),
          subject: z.string().optional().describe('Filter by email subject'),
          hasAttachments: z.boolean().optional().describe('Filter to only emails with attachments'),
          unreadOnly: z.boolean().optional().describe('Filter to only unread emails'),
          receivedAfter: z
            .string()
            .optional()
            .describe('Filter to emails received on or after this ISO 8601 timestamp'),
          receivedBefore: z
            .string()
            .optional()
            .describe('Filter to emails received on or before this ISO 8601 timestamp'),
          count: z
            .number()
            .int()
            .positive()
            .max(1000)
            .optional()
            .describe('Number of results to return (default: 10, max: 1000)')
        })
        .strict(),
      outputSchema: emailSearchResultSchema,
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleSearchEmails(ctx, args)
  )
}
