/**
 * Email rules management module for MCP M365 server.
 */
import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import type { GraphContext } from '../../main/graph-client/index.js'
import {
  handleCreateRule,
  handleDeleteRule,
  handleEditRuleSequence,
  handleListRules,
  handleUpdateRule
} from '../../main/rules/index.js'
import { DESTRUCTIVE_REMOTE, READ_ONLY_REMOTE, WRITE_IDEMPOTENT_REMOTE, WRITE_REMOTE } from '../../utils/annotations.js'
import { graphIdSchema } from '../../utils/odata-helpers.js'

const ruleRef = {
  ruleId: graphIdSchema.optional().describe('ID of the rule (from m365_email_rules_list)'),
  ruleName: z.string().min(1).optional().describe('Exact name of the rule, when it is unique')
}

export const registerRulesTools = (server: McpServer, ctx: GraphContext): void => {
  server.registerTool(
    'm365_email_rule_create',
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
          isEnabled: z
            .boolean()
            .optional()
            .describe('Whether the rule should be enabled after creation (default: true)'),
          sequence: z
            .number()
            .int()
            .min(0)
            .max(10000)
            .optional()
            .describe(
              'Order in which the rule is executed (lower numbers run first, default: 100). Graph rejects negative values.'
            )
        })
        .strict(),
      annotations: WRITE_REMOTE
    },
    (args) => handleCreateRule(ctx, args)
  )

  server.registerTool(
    'm365_email_rule_delete',
    {
      description:
        'Deletes an inbox rule. Refused when the rule touches a protected folder or category. Preview by default.',
      inputSchema: z
        .object({
          ...ruleRef,
          dry_run: z.boolean().default(true).describe('Preview only by default; pass false to delete the rule')
        })
        .strict(),
      annotations: DESTRUCTIVE_REMOTE
    },
    (args) => handleDeleteRule(ctx, args)
  )

  server.registerTool(
    'm365_email_rule_update',
    {
      description:
        'Updates an inbox rule: rename, enable or disable, reorder, or change its conditions and actions. Conditions and actions given replace those fields only; the rest of the rule is kept. Refused when the rule touches a protected folder or category, before or after. Preview by default.',
      inputSchema: z
        .object({
          ...ruleRef,
          name: z.string().min(1).optional().describe('New name'),
          isEnabled: z.boolean().optional().describe('Enable (true) or disable (false) the rule'),
          sequence: z.number().int().min(0).max(10000).optional().describe('New execution order'),
          fromAddresses: z.string().optional().describe('Comma-separated sender addresses'),
          containsSubject: z.string().optional().describe('Subject text the email must contain'),
          hasAttachments: z.boolean().optional().describe('Match emails with attachments'),
          moveToFolder: z.string().optional().describe('Folder path to move matching emails to'),
          markAsRead: z.boolean().optional().describe('Mark matching emails as read'),
          categories: z.array(z.string().min(1).max(255)).max(25).optional().describe('Categories to assign'),
          dry_run: z.boolean().default(true).describe('Preview only by default; pass false to update the rule')
        })
        .strict(),
      annotations: WRITE_IDEMPOTENT_REMOTE
    },
    (args) => handleUpdateRule(ctx, args)
  )

  server.registerTool(
    'm365_email_rules_list',
    {
      description: 'Lists inbox rules in your Outlook account',
      inputSchema: z
        .object({
          includeDetails: z.boolean().optional().describe('Include detailed rule conditions and actions')
        })
        .strict(),
      annotations: READ_ONLY_REMOTE
    },
    (args) => handleListRules(ctx, args)
  )

  server.registerTool(
    'm365_email_rules_reorder',
    {
      description: 'Changes the execution order of an existing inbox rule',
      inputSchema: z
        .object({
          ruleName: z.string().describe('Name of the rule to modify'),
          sequence: z
            .number()
            .int()
            .min(0)
            .max(10000)
            .describe('New sequence value for the rule (lower numbers run first). Graph rejects negative values.')
        })
        .strict(),
      annotations: WRITE_IDEMPOTENT_REMOTE
    },
    (args) => handleEditRuleSequence(ctx, args)
  )
}
