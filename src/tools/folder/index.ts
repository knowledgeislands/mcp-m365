/**
 * Folder management module for MCP M365 server
 */

import { handleCreateFolder } from './create.js'
import { handleDeleteFolder } from './delete.js'
import { handleListFolders } from './list.js'
import { handleMoveEmails } from './move.js'
import { handleRenameFolder } from './rename.js'

export const folderTools = [
  {
    name: 'list-folders',
    description: 'Lists mail folders in your Outlook account',
    inputSchema: {
      type: 'object',
      properties: {
        includeItemCounts: { type: 'boolean', description: 'Include counts of total and unread items' },
        includeChildren: { type: 'boolean', description: 'Include child folders in hierarchy' }
      },
      required: []
    },
    handler: handleListFolders
  },
  {
    name: 'create-folder',
    description: 'Creates a new mail folder',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the folder to create' },
        parentFolder: { type: 'string', description: 'Optional parent folder path (default is root)' }
      },
      required: ['name']
    },
    handler: handleCreateFolder
  },
  {
    name: 'rename-folder',
    description: 'Renames an existing mail folder',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: "Folder to rename. Use a full custom path like 'Top/Sub'" },
        newName: { type: 'string', description: 'New leaf name for the folder' }
      },
      required: ['folder', 'newName']
    },
    handler: handleRenameFolder
  },
  {
    name: 'delete-folder',
    description: 'Deletes an existing mail folder',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: "Folder to delete. Use a full custom path like 'Top/Sub'" }
      },
      required: ['folder']
    },
    handler: handleDeleteFolder
  },
  {
    name: 'move-emails',
    description: 'Moves emails from one folder to another',
    inputSchema: {
      type: 'object',
      properties: {
        emailIds: { type: 'string', description: 'Comma-separated list of email IDs to move' },
        targetFolder: { type: 'string', description: 'Folder path to move emails to' },
        sourceFolder: { type: 'string', description: 'Optional source folder path (default is inbox)' }
      },
      required: ['emailIds', 'targetFolder']
    },
    handler: handleMoveEmails
  }
]

export { handleCreateFolder, handleDeleteFolder, handleListFolders, handleMoveEmails, handleRenameFolder }
