/**
 * Folder management module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, WRITE_IDEMPOTENT_REMOTE, WRITE_REMOTE } from '../../utils/annotations.js'
import { handleCreateFolder } from './create.js'
import { handleDeleteFolder } from './delete.js'
import { handleListFolders } from './list.js'
import { handleMoveEmails } from './move.js'
import { handleRenameFolder } from './rename.js'

export const registerFolderTools = (server: McpServer): void => {
  server.registerTool(
    'm365_email_folders_list',
    {
      description: 'Lists mail folders in your Outlook account',
      inputSchema: z
        .object({
          includeItemCounts: z.boolean().optional().describe('Include counts of total and unread items'),
          includeChildren: z.boolean().optional().describe('Include child folders in hierarchy')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    handleListFolders
  )

  server.registerTool(
    'm365_email_folder_create',
    {
      description: 'Creates a new mail folder',
      inputSchema: z
        .object({
          name: z.string().describe('Name of the folder to create'),
          parentFolder: z.string().optional().describe('Optional parent folder path (default is root)')
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    handleCreateFolder
  )

  server.registerTool(
    'm365_email_folder_rename',
    {
      description: 'Renames an existing mail folder',
      inputSchema: z
        .object({
          folder: z.string().describe("Folder to rename. Use a full custom path like 'Top/Sub'"),
          newName: z.string().describe('New leaf name for the folder')
        })
        .strict(),
      annotations: WRITE_IDEMPOTENT_REMOTE
    },
    handleRenameFolder
  )

  server.registerTool(
    'm365_email_folder_delete',
    {
      description: 'Deletes an existing mail folder. `dry_run` defaults to true — pass false to actually delete.',
      inputSchema: z
        .object({
          folder: z.string().min(1).describe("Folder to delete. Use a full custom path like 'Top/Sub'"),
          dry_run: z.boolean().optional().describe('Preview only; do not delete. Default true — pass false to actually delete.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    handleDeleteFolder
  )

  server.registerTool(
    'm365_email_messages_move',
    {
      description: 'Moves emails from one folder to another',
      inputSchema: z
        .object({
          emailIds: z.string().describe('Comma-separated list of email IDs to move'),
          targetFolder: z.string().describe('Folder path to move emails to'),
          sourceFolder: z.string().optional().describe('Optional source folder path (default is inbox)')
        })
        .strict(),
      annotations: WRITE_IDEMPOTENT_REMOTE
    },
    handleMoveEmails
  )
}

export { handleCreateFolder, handleDeleteFolder, handleListFolders, handleMoveEmails, handleRenameFolder }
