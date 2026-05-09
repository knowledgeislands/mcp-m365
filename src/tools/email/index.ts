/**
 * Email module for MCP M365 server
 */

import { handleDeleteEmail } from './delete.js'
import { handleDraftEmail } from './draft.js'
import { handleListEmails } from './list.js'
import { handleMarkAsRead } from './mark-as-read.js'
import { handleReadEmail } from './read.js'
import { handleSearchEmails } from './search.js'
import { handleSendEmail } from './send.js'

export const emailTools = [
  {
    name: 'list-emails',
    description: 'Lists recent emails from your inbox',
    inputSchema: {
      type: 'object',
      properties: {
        folder: {
          type: 'string',
          description: "Email folder to list. Use well-known names like 'inbox' or a full custom path like 'Top/Sub' (default: 'inbox')"
        },
        folderId: {
          type: 'string',
          description: 'Optional explicit Graph folder ID. If provided, this is used instead of folder path resolution.'
        },
        count: {
          type: 'number',
          description: 'Number of emails to retrieve (default: 10, max: 1000)'
        },
        includeCount: {
          type: 'boolean',
          description: 'Include total matching count from Microsoft Graph (@odata.count). Default: false'
        }
      },
      required: []
    },
    handler: handleListEmails
  },
  {
    name: 'search-emails',
    description: 'Search for emails using various criteria',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text to find in emails' },
        folder: { type: 'string', description: "Email folder to search in. Use well-known names like 'inbox' or a full custom path like 'Top/Sub' (default: 'inbox')" },
        folderId: { type: 'string', description: 'Optional explicit Graph folder ID. If provided, this is used instead of folder path resolution.' },
        from: { type: 'string', description: 'Filter by sender email address or name' },
        to: { type: 'string', description: 'Filter by recipient email address or name' },
        subject: { type: 'string', description: 'Filter by email subject' },
        hasAttachments: { type: 'boolean', description: 'Filter to only emails with attachments' },
        unreadOnly: { type: 'boolean', description: 'Filter to only unread emails' },
        receivedAfter: { type: 'string', description: 'Filter to emails received on or after this ISO 8601 timestamp' },
        receivedBefore: { type: 'string', description: 'Filter to emails received on or before this ISO 8601 timestamp' },
        count: { type: 'number', description: 'Number of results to return (default: 10, max: 1000)' }
      },
      required: []
    },
    handler: handleSearchEmails
  },
  {
    name: 'read-email',
    description: 'Reads the content of a specific email. HTML emails are securely sanitized to extract only visible text, preventing prompt injection attacks via hidden content.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the email to read' },
        includeRawHtml: { type: 'boolean', description: 'Include raw HTML content (UNSAFE - for debugging only, may contain hidden prompt injection content)' }
      },
      required: ['id']
    },
    handler: handleReadEmail
  },
  {
    name: 'send-email',
    description: 'Composes and sends a new email. Supports both plain text and HTML content.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Comma-separated list of recipient email addresses' },
        cc: { type: 'string', description: 'Comma-separated list of CC recipient email addresses' },
        bcc: { type: 'string', description: 'Comma-separated list of BCC recipient email addresses' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body content (plain text or HTML)' },
        isHtml: { type: 'boolean', description: 'Set to true to send as HTML, false for plain text. If not specified, auto-detects based on <html> tag presence.' },
        importance: { type: 'string', description: 'Email importance (normal, high, low)', enum: ['normal', 'high', 'low'] },
        saveToSentItems: { type: 'boolean', description: 'Whether to save the email to sent items' }
      },
      required: ['to', 'subject', 'body']
    },
    handler: handleSendEmail
  },
  {
    name: 'draft-email',
    description: 'Creates and saves an email draft in Outlook',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Comma-separated list of recipient email addresses' },
        cc: { type: 'string', description: 'Comma-separated list of CC recipient email addresses' },
        bcc: { type: 'string', description: 'Comma-separated list of BCC recipient email addresses' },
        subject: { type: 'string', description: 'Draft email subject' },
        body: { type: 'string', description: 'Draft email body content (can be plain text or HTML)' },
        importance: { type: 'string', description: 'Email importance (normal, high, low)', enum: ['normal', 'high', 'low'] }
      },
      required: []
    },
    handler: handleDraftEmail
  },
  {
    name: 'mark-as-read',
    description: 'Marks an email as read or unread',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the email to mark as read/unread' },
        isRead: { type: 'boolean', description: 'Whether to mark as read (true) or unread (false). Default: true' }
      },
      required: ['id']
    },
    handler: handleMarkAsRead
  },
  {
    name: 'delete-email',
    description: 'Deletes an email by moving it to Deleted Items (trash). Use permanent=true to hard delete.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the email to delete' },
        permanent: { type: 'boolean', description: 'If true, permanently delete the email instead of moving to Deleted Items. Default: false' }
      },
      required: ['id']
    },
    handler: handleDeleteEmail
  }
]

export { handleDeleteEmail, handleDraftEmail, handleListEmails, handleMarkAsRead, handleReadEmail, handleSearchEmails, handleSendEmail }
