/**
 * Email module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ADDITIVE_REMOTE, DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, STATE_TOGGLE_REMOTE } from '../../utils/annotations.js'
import { handleDeleteEmail } from './delete.js'
import { handleDraftEmail } from './draft.js'
import { handleListEmails } from './list.js'
import { handleMarkAsRead } from './mark-as-read.js'
import { handleReadEmail } from './read.js'
import { handleSearchEmails } from './search.js'
import { handleSendEmail } from './send.js'

export const registerEmailTools = (server: McpServer): void => {
  server.registerTool(
    'list-emails',
    {
      description: 'Lists recent emails from your inbox',
      inputSchema: {
        folder: z.string().optional().describe("Email folder to list. Use well-known names like 'inbox' or a full custom path like 'Top/Sub' (default: 'inbox')"),
        folderId: z.string().optional().describe('Optional explicit Graph folder ID. If provided, this is used instead of folder path resolution.'),
        count: z.number().optional().describe('Number of emails to retrieve (default: 10, max: 1000)'),
        includeCount: z.boolean().optional().describe('Include total matching count from Microsoft Graph (@odata.count). Default: false')
      },
      annotations: READ_ONLY_REMOTE
    },
    handleListEmails
  )

  server.registerTool(
    'search-emails',
    {
      description: 'Search for emails using various criteria',
      inputSchema: {
        query: z.string().optional().describe('Search query text to find in emails'),
        folder: z.string().optional().describe("Email folder to search in. Use well-known names like 'inbox' or a full custom path like 'Top/Sub' (default: 'inbox')"),
        folderId: z.string().optional().describe('Optional explicit Graph folder ID. If provided, this is used instead of folder path resolution.'),
        from: z.string().optional().describe('Filter by sender email address or name'),
        to: z.string().optional().describe('Filter by recipient email address or name'),
        subject: z.string().optional().describe('Filter by email subject'),
        hasAttachments: z.boolean().optional().describe('Filter to only emails with attachments'),
        unreadOnly: z.boolean().optional().describe('Filter to only unread emails'),
        receivedAfter: z.string().optional().describe('Filter to emails received on or after this ISO 8601 timestamp'),
        receivedBefore: z.string().optional().describe('Filter to emails received on or before this ISO 8601 timestamp'),
        count: z.number().optional().describe('Number of results to return (default: 10, max: 1000)')
      },
      annotations: READ_ONLY_REMOTE
    },
    handleSearchEmails
  )

  server.registerTool(
    'read-email',
    {
      description: 'Reads the content of a specific email. HTML emails are securely sanitized to extract only visible text, preventing prompt injection attacks via hidden content.',
      inputSchema: {
        id: z.string().describe('ID of the email to read'),
        includeRawHtml: z.boolean().optional().describe('Include raw HTML content (UNSAFE - for debugging only, may contain hidden prompt injection content)')
      },
      annotations: READ_ONLY_REMOTE
    },
    handleReadEmail
  )

  server.registerTool(
    'send-email',
    {
      description: 'Composes and sends a new email. Supports both plain text and HTML content.',
      inputSchema: {
        to: z.string().describe('Comma-separated list of recipient email addresses'),
        cc: z.string().optional().describe('Comma-separated list of CC recipient email addresses'),
        bcc: z.string().optional().describe('Comma-separated list of BCC recipient email addresses'),
        subject: z.string().describe('Email subject'),
        body: z.string().describe('Email body content (plain text or HTML)'),
        isHtml: z.boolean().optional().describe('Set to true to send as HTML, false for plain text. If not specified, auto-detects based on <html> tag presence.'),
        importance: z.enum(['normal', 'high', 'low']).optional().describe('Email importance (normal, high, low)'),
        saveToSentItems: z.boolean().optional().describe('Whether to save the email to sent items')
      },
      annotations: ADDITIVE_REMOTE
    },
    handleSendEmail
  )

  server.registerTool(
    'draft-email',
    {
      description: 'Creates and saves an email draft in Outlook',
      inputSchema: {
        to: z.string().optional().describe('Comma-separated list of recipient email addresses'),
        cc: z.string().optional().describe('Comma-separated list of CC recipient email addresses'),
        bcc: z.string().optional().describe('Comma-separated list of BCC recipient email addresses'),
        subject: z.string().optional().describe('Draft email subject'),
        body: z.string().optional().describe('Draft email body content (can be plain text or HTML)'),
        importance: z.enum(['normal', 'high', 'low']).optional().describe('Email importance (normal, high, low)')
      },
      annotations: ADDITIVE_REMOTE
    },
    handleDraftEmail
  )

  server.registerTool(
    'mark-as-read',
    {
      description: 'Marks an email as read or unread',
      inputSchema: {
        id: z.string().describe('ID of the email to mark as read/unread'),
        isRead: z.boolean().optional().describe('Whether to mark as read (true) or unread (false). Default: true')
      },
      annotations: STATE_TOGGLE_REMOTE
    },
    handleMarkAsRead
  )

  server.registerTool(
    'delete-email',
    {
      description:
        'Deletes an email by moving it to Deleted Items (trash). Use permanent=true to hard delete. `dry_run` defaults to true — pass false to actually delete; dry-run fetches the message metadata and returns subject/sender/date.',
      inputSchema: z
        .object({
          id: z.string().min(1).describe('ID of the email to delete'),
          permanent: z.boolean().optional().describe('If true, permanently delete the email instead of moving to Deleted Items. Default: false'),
          dry_run: z.boolean().optional().describe('Preview only; do not delete. Default true — pass false to actually delete.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    handleDeleteEmail
  )
}

export { handleDeleteEmail, handleDraftEmail, handleListEmails, handleMarkAsRead, handleReadEmail, handleSearchEmails, handleSendEmail }
