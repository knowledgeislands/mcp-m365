/**
 * Email rules management module for MCP M365 server
 */

import { handleCreateRule } from './create.js'
import { handleEditRuleSequence } from './edit-sequence.js'
import { handleListRules } from './list.js'

export const rulesTools = [
  {
    name: 'list-rules',
    description: 'Lists inbox rules in your Outlook account',
    inputSchema: {
      type: 'object',
      properties: {
        includeDetails: { type: 'boolean', description: 'Include detailed rule conditions and actions' }
      },
      required: []
    },
    handler: handleListRules
  },
  {
    name: 'create-rule',
    description: 'Creates a new inbox rule',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the rule to create' },
        fromAddresses: { type: 'string', description: 'Comma-separated list of sender email addresses for the rule' },
        containsSubject: { type: 'string', description: 'Subject text the email must contain' },
        hasAttachments: { type: 'boolean', description: 'Whether the rule applies to emails with attachments' },
        moveToFolder: { type: 'string', description: 'Name of the folder to move matching emails to' },
        markAsRead: { type: 'boolean', description: 'Whether to mark matching emails as read' },
        isEnabled: { type: 'boolean', description: 'Whether the rule should be enabled after creation (default: true)' },
        sequence: { type: 'number', description: 'Order in which the rule is executed (lower numbers run first, default: 100)' }
      },
      required: ['name']
    },
    handler: handleCreateRule
  },
  {
    name: 'edit-rule-sequence',
    description: 'Changes the execution order of an existing inbox rule',
    inputSchema: {
      type: 'object',
      properties: {
        ruleName: { type: 'string', description: 'Name of the rule to modify' },
        sequence: { type: 'number', description: 'New sequence value for the rule (lower numbers run first)' }
      },
      required: ['ruleName', 'sequence']
    },
    handler: handleEditRuleSequence
  }
]

export { handleCreateRule, handleEditRuleSequence, handleListRules }
