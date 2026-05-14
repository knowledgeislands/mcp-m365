/**
 * Email rules management module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { ADDITIVE_REMOTE, READ_ONLY_REMOTE, STATE_TOGGLE_REMOTE } from '../../utils/annotations.js'
import { handleCreateRule } from './create.js'
import { handleEditRuleSequence } from './edit-sequence.js'
import { handleListRules } from './list.js'

export const registerRulesTools = (server: McpServer): void => {
  server.registerTool(
    'list-rules',
    {
      description: 'Lists inbox rules in your Outlook account',
      inputSchema: z
        .object({
          includeDetails: z.boolean().optional().describe('Include detailed rule conditions and actions')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    handleListRules
  )

  server.registerTool(
    'create-rule',
    {
      description: 'Creates a new inbox rule',
      inputSchema: z
        .object({
          name: z.string().describe('Name of the rule to create'),
          fromAddresses: z.string().optional().describe('Comma-separated list of sender email addresses for the rule'),
          containsSubject: z.string().optional().describe('Subject text the email must contain'),
          hasAttachments: z.boolean().optional().describe('Whether the rule applies to emails with attachments'),
          moveToFolder: z.string().optional().describe('Name of the folder to move matching emails to'),
          markAsRead: z.boolean().optional().describe('Whether to mark matching emails as read'),
          isEnabled: z.boolean().optional().describe('Whether the rule should be enabled after creation (default: true)'),
          sequence: z.number().int().min(0).max(10000).optional().describe('Order in which the rule is executed (lower numbers run first, default: 100). Graph rejects negative values.')
        })
        .strict(),
      annotations: ADDITIVE_REMOTE
    },
    handleCreateRule
  )

  server.registerTool(
    'edit-rule-sequence',
    {
      description: 'Changes the execution order of an existing inbox rule',
      inputSchema: z
        .object({
          ruleName: z.string().describe('Name of the rule to modify'),
          sequence: z.number().int().min(0).max(10000).describe('New sequence value for the rule (lower numbers run first). Graph rejects negative values.')
        })
        .strict(),
      annotations: STATE_TOGGLE_REMOTE
    },
    handleEditRuleSequence
  )
}

export { handleCreateRule, handleEditRuleSequence, handleListRules }
