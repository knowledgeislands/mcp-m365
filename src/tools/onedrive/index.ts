/**
 * OneDrive module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { GraphContext } from '../../main/graph-client/index.js'
import { handleCreateFolder, handleDeleteItem, handleDownload, handleListFiles, handleSearchFiles, handleShare, handleUpload, handleUploadLarge } from '../../main/onedrive/index.js'
import { DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, WRITE_REMOTE } from '../../utils/annotations.js'
import { graphIdSchema } from '../../utils/odata-helpers.js'

export const registerOnedriveTools = (server: McpServer, ctx: GraphContext): void => {
  server.registerTool(
    'm365_onedrive_items_list',
    {
      description: 'List files and folders in OneDrive at a specific path',
      inputSchema: z
        .object({
          path: z.string().optional().describe("Path to list (e.g., '/Documents', '/Photos'). Defaults to root."),
          count: z.number().int().positive().max(50).optional().describe('Number of items to retrieve (default: 25, max: 50)')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleListFiles(ctx, args)
  )

  server.registerTool(
    'm365_onedrive_items_search',
    {
      description: 'Search for files in OneDrive by name or content',
      inputSchema: z
        .object({
          query: z.string().describe('Search query to find files'),
          count: z.number().int().positive().max(50).optional().describe('Number of results to return (default: 25, max: 50)')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleSearchFiles(ctx, args)
  )

  server.registerTool(
    'm365_onedrive_item_download',
    {
      description: "Get a download URL for a file in OneDrive. Either 'itemId' or 'path' must be provided.",
      inputSchema: z
        .object({
          itemId: graphIdSchema.optional().describe('ID of the item to download'),
          path: z.string().optional().describe('Path to the file (alternative to itemId)')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleDownload(ctx, args)
  )

  server.registerTool(
    'm365_onedrive_item_upload',
    {
      description: 'Upload a small file (< 4MB) to OneDrive',
      inputSchema: z
        .object({
          path: z.string().describe("Destination path including filename (e.g., '/Documents/myfile.txt')"),
          content: z.string().describe('File content to upload'),
          conflictBehavior: z.enum(['rename', 'replace', 'fail']).optional().describe("Behavior when file exists: 'rename' (default), 'replace', or 'fail'")
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleUpload(ctx, args)
  )

  server.registerTool(
    'm365_onedrive_item_upload_large',
    {
      description: 'Upload a large file (> 4MB) to OneDrive using chunked upload',
      inputSchema: z
        .object({
          path: z.string().describe("Destination path including filename (e.g., '/Documents/largefile.zip')"),
          content: z.string().describe('File content to upload'),
          conflictBehavior: z.enum(['rename', 'replace', 'fail']).optional().describe("Behavior when file exists: 'rename' (default), 'replace', or 'fail'")
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleUploadLarge(ctx, args)
  )

  server.registerTool(
    'm365_onedrive_item_share',
    {
      description: 'Create a sharing link for a file or folder in OneDrive',
      inputSchema: z
        .object({
          itemId: graphIdSchema.optional().describe('ID of the item to share'),
          path: z.string().optional().describe('Path to the item (alternative to itemId)'),
          type: z.enum(['view', 'edit', 'embed']).optional().describe("Link type: 'view' (default), 'edit', or 'embed'"),
          scope: z.enum(['anonymous', 'organization']).optional().describe("Link scope: 'anonymous' (default) or 'organization'")
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleShare(ctx, args)
  )

  server.registerTool(
    'm365_onedrive_folder_create',
    {
      description: 'Create a new folder in OneDrive',
      inputSchema: z
        .object({
          path: z.string().optional().describe("Parent folder path (e.g., '/Documents'). Defaults to root."),
          name: z.string().describe('Name of the new folder')
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleCreateFolder(ctx, args)
  )

  server.registerTool(
    'm365_onedrive_item_delete',
    {
      description: 'Delete a file or folder from OneDrive. `dry_run` defaults to true — pass false to actually delete; dry-run fetches the item metadata and returns name/size.',
      inputSchema: z
        .object({
          itemId: graphIdSchema.optional().describe('ID of the item to delete'),
          path: z.string().min(1).optional().describe('Path to the item (alternative to itemId)'),
          dry_run: z.boolean().optional().describe('Preview only; do not delete. Default true — pass false to actually delete.')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    (args) => handleDeleteItem(ctx, args)
  )
}

export { handleCreateFolder, handleDeleteItem, handleDownload, handleListFiles, handleSearchFiles, handleShare, handleUpload, handleUploadLarge } from '../../main/onedrive/index.js'
