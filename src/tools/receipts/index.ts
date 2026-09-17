/**
 * Receipt harvesting tool.
 *
 * One tool, not the `attachment_list` / `attachment_save` pair the roadmap
 * record first sketched. A general attachment-save tool would be a prompt-
 * controlled write of attacker-supplied bytes to a caller-chosen path; this
 * tool writes only receipt-like PDFs, only under a configured destination, and
 * names them itself. The narrower surface is the point.
 *
 * Like the routing passes, it defaults to `mode: "report"` and nothing touches
 * the mailbox or the filesystem until a caller asks for `mode: "live"`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { ReceiptsContext } from '../../main/receipts/index.js'
import {
  DEFAULT_ARCHIVE_FOLDER,
  DEFAULT_SOURCE_FOLDER,
  handleHarvest,
  harvestResultSchema
} from '../../main/receipts/index.js'
import { DESTRUCTIVE_ONESHOT_REMOTE } from '../../utils/annotations.js'

export const registerReceiptsTools = (server: McpServer, ctx: ReceiptsContext): void => {
  server.registerTool(
    'm365_email_receipts_harvest',
    {
      description:
        'Saves the receipt and invoice PDFs attached to mail in a finance folder into the configured receipts staging folder as `YYYY-MM-DD_vendor_amount.pdf`, then archives each message whose attachments were all written. Only mail whose subject and attachment names look like a receipt is touched; other finance correspondence is reported and left alone. Batch-bounded and resumable — loop while `remaining` is true. Defaults to report mode.',
      inputSchema: z
        .object({
          folder: z
            .string()
            .max(512)
            .optional()
            .describe(`Mail folder to harvest, as a full path. Defaults to "${DEFAULT_SOURCE_FOLDER}".`),
          archiveTo: z
            .string()
            .max(512)
            .optional()
            .describe(
              `Folder harvested mail is moved to, as a full path. Defaults to "${DEFAULT_ARCHIVE_FOLDER}". A message is moved only after every one of its attachments is confirmed written.`
            ),
          subdirectory: z
            .string()
            .max(256)
            .optional()
            .describe(
              'Subdirectory of MCP_M365_RECEIPTS_DIR to write into, for the `_archived/YYYY-MM` per-month convention. Root-checked. Defaults to the destination itself.'
            ),
          mode: z
            .enum(['live', 'report'])
            .optional()
            .describe(
              '`report` (default) downloads and names everything without writing a file or moving any mail; `live` writes and archives.'
            ),
          maxMessages: z
            .number()
            .int()
            .positive()
            .max(100)
            .optional()
            .describe(
              'Maximum messages examined in this call (default 20). Lower than the routing passes because each message costs an attachment download and a PDF text extraction. Loop while `remaining` is true.'
            )
        })
        .strict(),
      outputSchema: harvestResultSchema,
      // Non-idempotent: each live call archives the mail it harvested, so a
      // repeat does different work rather than converging on the same state.
      annotations: DESTRUCTIVE_ONESHOT_REMOTE
    },
    (args) => handleHarvest(ctx, args)
  )
}
