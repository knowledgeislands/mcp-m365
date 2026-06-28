/**
 * List rules functionality
 */

import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

export const handleListRules = async (ctx: GraphContext, args: any): Promise<any> => {
  const includeDetails = args.includeDetails === true

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const rules = await getInboxRules(ctx.graphApiEndpoint, accessToken)
    const formattedRules = formatRulesList(rules, includeDetails)

    return {
      content: [{ type: 'text', text: formattedRules }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error listing rules: ${error.message}`)
  }
}

export const getInboxRules = async (graphApiEndpoint: string, accessToken: string): Promise<any[]> => {
  const response = await callGraphAPI(graphApiEndpoint, accessToken, 'GET', 'me/mailFolders/inbox/messageRules', null)

  return response.value || []
}

const formatRulesList = (rules: any[], includeDetails: boolean): string => {
  if (!rules || rules.length === 0) {
    return "No inbox rules found.\n\nTip: You can create rules using the 'm365_email_rule_create' tool. Rules are processed in order of their sequence number (lower numbers are processed first)."
  }

  const sortedRules = [...rules].sort((a, b) => {
    return (a.sequence || 9999) - (b.sequence || 9999)
  })

  if (includeDetails) {
    const detailedRules = sortedRules.map((rule, index) => {
      let ruleText = `${index + 1}. ${rule.displayName}${rule.isEnabled ? '' : ' (Disabled)'} - Sequence: ${rule.sequence || 'N/A'}`

      const conditions = formatRuleConditions(rule)
      if (conditions) {
        ruleText += `\n   Conditions: ${conditions}`
      }

      const actions = formatRuleActions(rule)
      if (actions) {
        ruleText += `\n   Actions: ${actions}`
      }

      return ruleText
    })

    return `Found ${rules.length} inbox rules (sorted by execution order):\n\n${detailedRules.join('\n\n')}\n\nRules are processed in order of their sequence number. You can change rule order using the 'm365_email_rules_reorder' tool.`
  } else {
    const simpleRules = sortedRules.map((rule, index) => {
      return `${index + 1}. ${rule.displayName}${rule.isEnabled ? '' : ' (Disabled)'} - Sequence: ${rule.sequence || 'N/A'}`
    })

    return `Found ${rules.length} inbox rules (sorted by execution order):\n\n${simpleRules.join('\n')}\n\nTip: Use 'm365_email_rules_list with includeDetails=true' to see more information about each rule.`
  }
}

const formatRuleConditions = (rule: any): string => {
  const conditions: string[] = []

  if (rule.conditions?.fromAddresses?.length > 0) {
    const senders = rule.conditions.fromAddresses.map((addr: any) => addr.emailAddress.address).join(', ')
    conditions.push(`From: ${senders}`)
  }

  if (rule.conditions?.subjectContains?.length > 0) {
    conditions.push(`Subject contains: "${rule.conditions.subjectContains.join(', ')}"`)
  }

  if (rule.conditions?.bodyContains?.length > 0) {
    conditions.push(`Body contains: "${rule.conditions.bodyContains.join(', ')}"`)
  }

  if (rule.conditions?.hasAttachment === true) {
    conditions.push('Has attachment')
  }

  if (rule.conditions?.importance) {
    conditions.push(`Importance: ${rule.conditions.importance}`)
  }

  return conditions.join('; ')
}

const formatRuleActions = (rule: any): string => {
  const actions: string[] = []

  if (rule.actions?.moveToFolder) {
    actions.push(`Move to folder: ${rule.actions.moveToFolder}`)
  }

  if (rule.actions?.copyToFolder) {
    actions.push(`Copy to folder: ${rule.actions.copyToFolder}`)
  }

  if (rule.actions?.markAsRead === true) {
    actions.push('Mark as read')
  }

  if (rule.actions?.markImportance) {
    actions.push(`Mark importance: ${rule.actions.markImportance}`)
  }

  if (rule.actions?.forwardTo?.length > 0) {
    const recipients = rule.actions.forwardTo.map((r: any) => r.emailAddress.address).join(', ')
    actions.push(`Forward to: ${recipients}`)
  }

  if (rule.actions?.delete === true) {
    actions.push('Delete')
  }

  return actions.join('; ')
}
