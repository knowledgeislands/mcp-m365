/**
 * Folder management module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ADDITIVE_REMOTE, DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, STATE_TOGGLE_REMOTE } from '../../utils/annotations.js'
import { handleCreateFolder } from './create.js'
import { handleDeleteFolder } from './delete.js'
import { handleListFolders } from './list.js'
import { handleMoveEmails } from './move.js'
import { handleRenameFolder } from './rename.js'

export const registerFolderTools = (server: McpServer): void => {
  server.registerTool(
    'list-folders',
    {
      description: 'Lists mail folders in your Outlook account',
      inputSchema: {
        includeItemCounts: z.boolean().optional().describe('Include counts of total and unread items'),
        includeChildren: z.boolean().optional().describe('Include child folders in hierarchy')
      },
      annotations: READ_ONLY_REMOTE
    },
    handleListFolders
  )

  server.registerTool(
    'create-folder',
    {
      description: 'Creates a new mail folder',
      inputSchema: {
        name: z.string().describe('Name of the folder to create'),
        parentFolder: z.string().optional().describe('Optional parent folder path (default is root)')
      },
      annotations: ADDITIVE_REMOTE
    },
    handleCreateFolder
  )

  server.registerTool(
    'rename-folder',
    {
      description: 'Renames an existing mail folder',
      inputSchema: {
        folder: z.string().describe("Folder to rename. Use a full custom path like 'Top/Sub'"),
        newName: z.string().describe('New leaf name for the folder')
      },
      annotations: STATE_TOGGLE_REMOTE
    },
    handleRenameFolder
  )

  server.registerTool(
    'delete-folder',
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
    'move-emails',
    {
      description: 'Moves emails from one folder to another',
      inputSchema: {
        emailIds: z.string().describe('Comma-separated list of email IDs to move'),
        targetFolder: z.string().describe('Folder path to move emails to'),
        sourceFolder: z.string().optional().describe('Optional source folder path (default is inbox)')
      },
      annotations: STATE_TOGGLE_REMOTE
    },
    handleMoveEmails
  )
}

export { handleCreateFolder, handleDeleteFolder, handleListFolders, handleMoveEmails, handleRenameFolder }
