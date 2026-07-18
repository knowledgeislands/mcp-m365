// Generated on 2026-07-18T16:27:50.527Z by @knowledgeislands/mcp-m365@1.0.0
// Server: hnr-mcp-m365
// Source: /Users/krisbrown/.mcporter/mcporter.json
// Transport: STDIO /Users/krisbrown/.local/share/mise/installs/node/lts/bin/node /Users/krisbrown/workspaces/kis/knowledgeislands/mcp-m365/dist/mcp-server/index.js

import type { CallResult } from 'mcporter';

export interface HnrMcpM365Tools {
  /**
   * Returns information about this MCP M365 server
   */
  m365_about(): Promise<CallResult>;

  /**
   * Authenticate with Microsoft Graph API to access Outlook data. Initiates the OAuth flow and persists
   * tokens to disk on success — registered under the `write` role because of that token-store mutation.
   *
   * @param force? Force re-authentication even if already authenticated
   */
  m365_auth_start(force?: boolean): Promise<CallResult>;

  /**
   * Check the current authentication status with Microsoft Graph API. Returns presence + scope/expiry
   * metadata only — never the token values.
   */
  m365_auth_status(): Promise<CallResult>;

  /**
   * Lists upcoming events from your calendar
   *
   * @param count? Number of events to retrieve (default: 10, max: 50)
   * @param startDateTime? ISO 8601 start date/time for the query range (default: now)
   * @param endDateTime? ISO 8601 end date/time for the query range (default: startDateTime + 30 days)
   */
  m365_calendar_events_list(count?: number, startDateTime?: string, endDateTime?: string): Promise<CallResult>;

  /**
   * Accepts a calendar event
   *
   * @param eventId The ID of the event to accept
   * @param comment? Optional comment for accepting the event
   */
  m365_calendar_event_accept(eventId: string, comment?: string): Promise<CallResult>;

  /**
   * Declines a calendar event. `dry_run` defaults to true — pass false to actually decline; dry-run
   * fetches the event metadata and returns what would happen.
   *
   * @param eventId The ID of the event to decline
   * @param comment? Optional comment for declining the event
   * @param dry_run? Preview only; do not decline. Default true — pass false to actually decline.
   */
  m365_calendar_event_decline(eventId: string, comment?: string, dry_run?: boolean): Promise<CallResult>;

  /**
   * Creates a new calendar event
   *
   * @param subject The subject of the event
   * @param start The start time of the event in ISO 8601 format
   * @param end The end time of the event in ISO 8601 format
   * @param attendees? List of attendee email addresses
   * @param body? Optional body content for the event
   */
  m365_calendar_event_create(subject: string, start: string, end: string, attendees?: string[], body?: string): Promise<CallResult>;

  /**
   * Lists recent emails from your inbox
   *
   * @param folder? Email folder to list. Use well-known names like 'inbox' or a full custom path like
   *                'Top/Sub' (default: 'inbox')
   * @param folderId? Optional explicit Graph folder ID. If provided, this is used instead of folder path
   *                  resolution.
   * @param count? Number of emails to retrieve (default: 10, max: 1000)
   * @param includeCount? Include total matching count from Microsoft Graph (@odata.count). Default:
   *                      false
   */
  m365_email_messages_list(folder?: string, folderId?: string, count?: number, includeCount?: boolean): Promise<object>;

  /**
   * Search for emails using various criteria
   *
   * @param query? Search query text to find in emails
   * @param folder? Email folder to search in. Use well-known names like 'inbox' or a full custom path
   *                like 'Top/Sub' (default: 'inbox')
   * @param folderId? Optional explicit Graph folder ID. If provided, this is used instead of folder path
   *                  resolution.
   * @param from? Filter by sender email address or name
   * @param to? Filter by recipient email address or name
   * @param subject? Filter by email subject
   * @param hasAttachments? Filter to only emails with attachments
   * @param unreadOnly? Filter to only unread emails
   * @param receivedAfter? Filter to emails received on or after this ISO 8601 timestamp
   * @param receivedBefore? Filter to emails received on or before this ISO 8601 timestamp
   * @param count? Number of results to return (default: 10, max: 1000)
   */
  m365_email_messages_search(query?: string, folder?: string, folderId?: string, from?: string, to?: string): Promise<object>;
  // optional (6): subject, hasAttachments, unreadOnly, receivedAfter, receivedBefore, ...

  /**
   * Reads the content of a specific email. HTML emails are securely sanitized to extract only visible
   * text, preventing prompt injection attacks via hidden content.
   *
   * @param id ID of the email to read
   * @param includeRawHtml? Include raw HTML content (UNSAFE - for debugging only, may contain hidden
   *                        prompt injection content)
   */
  m365_email_message_get(id: string, includeRawHtml?: boolean): Promise<CallResult>;

  /**
   * Composes and sends a new email. Supports both plain text and HTML content.
   *
   * @param to Comma-separated list of recipient email addresses
   * @param cc? Comma-separated list of CC recipient email addresses
   * @param bcc? Comma-separated list of BCC recipient email addresses
   * @param subject Email subject
   * @param body Email body content (plain text or HTML)
   * @param isHtml? Set to true to send as HTML, false for plain text. If not specified, auto-detects
   *                based on <html> tag presence.
   * @param importance? Email importance (normal, high, low)
   * @param saveToSentItems? Whether to save the email to sent items
   */
  m365_email_message_send(to: string, cc?: string, bcc?: string, subject: string, body: string): Promise<CallResult>;
  // optional (3): isHtml, importance, saveToSentItems

  /**
   * Creates and saves an email draft in Outlook
   *
   * @param to? Comma-separated list of recipient email addresses
   * @param cc? Comma-separated list of CC recipient email addresses
   * @param bcc? Comma-separated list of BCC recipient email addresses
   * @param subject? Draft email subject
   * @param body? Draft email body content (can be plain text or HTML)
   * @param importance? Email importance (normal, high, low)
   */
  m365_email_draft_create(to?: string, cc?: string, bcc?: string, subject?: string, body?: string): Promise<CallResult>;
  // optional (1): importance

  /**
   * Marks an email as read or unread
   *
   * @param id ID of the email to mark as read/unread
   * @param isRead? Whether to mark as read (true) or unread (false). Default: true
   */
  m365_email_message_mark_read(id: string, isRead?: boolean): Promise<CallResult>;

  /**
   * Lists mail folders in your Outlook account
   *
   * @param includeItemCounts? Include counts of total and unread items
   * @param includeChildren? Include child folders in hierarchy
   */
  m365_email_folders_list(includeItemCounts?: boolean, includeChildren?: boolean): Promise<object>;

  /**
   * Creates a new mail folder
   *
   * @param name Name of the folder to create
   * @param parentFolder? Optional parent folder path (default is root)
   */
  m365_email_folder_create(name: string, parentFolder?: string): Promise<CallResult>;

  /**
   * Renames an existing mail folder
   *
   * @param folder Folder to rename. Use a full custom path like 'Top/Sub'
   * @param newName New leaf name for the folder
   */
  m365_email_folder_rename(folder: string, newName: string): Promise<CallResult>;

  /**
   * Moves emails from one folder to another
   *
   * @param emailIds Comma-separated list of email IDs to move
   * @param targetFolder Folder path to move emails to
   * @param sourceFolder? Optional source folder path (default is inbox)
   */
  m365_email_messages_move(emailIds: string, targetFolder: string, sourceFolder?: string): Promise<CallResult>;

  /**
   * List files and folders in OneDrive at a specific path
   *
   * @param path? Path to list (e.g., '/Documents', '/Photos'). Defaults to root.
   * @param count? Number of items to retrieve (default: 25, max: 50)
   */
  m365_onedrive_items_list(path?: string, count?: number): Promise<CallResult>;

  /**
   * Search for files in OneDrive by name or content
   *
   * @param query Search query to find files
   * @param count? Number of results to return (default: 25, max: 50)
   */
  m365_onedrive_items_search(query: string, count?: number): Promise<CallResult>;

  /**
   * Get a download URL for a file in OneDrive. Either 'itemId' or 'path' must be provided.
   *
   * @param itemId? ID of the item to download
   * @param path? Path to the file (alternative to itemId)
   */
  m365_onedrive_item_download(itemId?: string, path?: string): Promise<CallResult>;

  /**
   * Upload a small file (< 4MB) to OneDrive
   *
   * @param path Destination path including filename (e.g., '/Documents/myfile.txt')
   * @param content File content to upload
   * @param conflictBehavior? Behavior when file exists: 'rename' (default), 'replace', or 'fail'
   */
  m365_onedrive_item_upload(path: string, content: string, conflictBehavior?: "rename" | "replace" | "fail"): Promise<CallResult>;

  /**
   * Upload a large file (> 4MB) to OneDrive using chunked upload
   *
   * @param path Destination path including filename (e.g., '/Documents/largefile.zip')
   * @param content File content to upload
   * @param conflictBehavior? Behavior when file exists: 'rename' (default), 'replace', or 'fail'
   */
  m365_onedrive_item_upload_large(path: string, content: string, conflictBehavior?: "rename" | "replace" | "fail"): Promise<CallResult>;

  /**
   * Create a sharing link for a file or folder in OneDrive
   *
   * @param itemId? ID of the item to share
   * @param path? Path to the item (alternative to itemId)
   * @param type? Link type: 'view' (default), 'edit', or 'embed'
   * @param scope? Link scope: 'anonymous' (default) or 'organization'
   */
  m365_onedrive_item_share(itemId?: string, path?: string, type?: "view" | "edit" | "embed", scope?: "anonymous" | "organization"): Promise<CallResult>;

  /**
   * Create a new folder in OneDrive
   *
   * @param path? Parent folder path (e.g., '/Documents'). Defaults to root.
   * @param name Name of the new folder
   */
  m365_onedrive_folder_create(path?: string, name: string): Promise<CallResult>;

  /**
   * Lists inbox rules in your Outlook account
   *
   * @param includeDetails? Include detailed rule conditions and actions
   */
  m365_email_rules_list(includeDetails?: boolean): Promise<CallResult>;

  /**
   * Creates a new inbox rule
   *
   * @param name Name of the rule to create
   * @param fromAddresses? Comma-separated list of sender email addresses for the rule
   * @param containsSubject? Subject text the email must contain
   * @param hasAttachments? Whether the rule applies to emails with attachments
   * @param moveToFolder? Name of the folder to move matching emails to
   * @param markAsRead? Whether to mark matching emails as read
   * @param isEnabled? Whether the rule should be enabled after creation (default: true)
   * @param sequence? Order in which the rule is executed (lower numbers run first, default: 100). Graph
   *                  rejects negative values.
   */
  m365_email_rule_create(name: string, fromAddresses?: string, containsSubject?: string, hasAttachments?: boolean, moveToFolder?: string): Promise<CallResult>;
  // optional (3): markAsRead, isEnabled, sequence

  /**
   * Changes the execution order of an existing inbox rule
   *
   * @param ruleName Name of the rule to modify
   * @param sequence New sequence value for the rule (lower numbers run first). Graph rejects negative
   *                 values.
   */
  m365_email_rules_reorder(ruleName: string, sequence: number): Promise<CallResult>;
}

