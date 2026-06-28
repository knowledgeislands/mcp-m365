/**
 * Create rule functionality
 */

import { errorText } from '../../utils/results.js'
import { getFolderIdByName } from '../folder/folder-utils.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { getInboxRules } from './list.js'

export const handleCreateRule = async (ctx: GraphContext, args: any): Promise<any> => {
  const { name, fromAddresses, containsSubject, hasAttachments, moveToFolder, markAsRead, isEnabled = true, sequence } = args

  if (sequence !== undefined && (Number.isNaN(sequence) || sequence < 1)) {
    return errorText('Sequence must be a positive number greater than zero.')
  }

  if (!name) {
    return errorText('Rule name is required.')
  }

  const hasCondition = fromAddresses || containsSubject || hasAttachments === true
  const hasAction = moveToFolder || markAsRead === true

  if (!hasCondition) {
    return errorText('At least one condition is required. Specify fromAddresses, containsSubject, or hasAttachments.')
  }

  if (!hasAction) {
    return errorText('At least one action is required. Specify moveToFolder or markAsRead.')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()

    const result = await createInboxRule(ctx.graphApiEndpoint, accessToken, {
      name,
      fromAddresses,
      containsSubject,
      hasAttachments,
      moveToFolder,
      markAsRead,
      isEnabled,
      sequence
    })

    let responseText = result.message

    if (!sequence && !result.error) {
      responseText +=
        "\n\nTip: You can specify a 'sequence' parameter when creating rules to control their execution order. Lower sequence numbers run first."
    }

    return {
      content: [{ type: 'text', text: responseText }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error creating rule: ${error.message}`)
  }
}

interface CreateRuleResult {
  success: boolean
  message: string
  ruleId?: string
  error?: boolean
}

const createInboxRule = async (graphApiEndpoint: string, accessToken: string, ruleOptions: any): Promise<CreateRuleResult> => {
  const { name, fromAddresses, containsSubject, hasAttachments, moveToFolder, markAsRead, isEnabled, sequence } = ruleOptions

  let ruleSequence = sequence
  if (!ruleSequence) {
    try {
      ruleSequence = 100

      const existingRules = await getInboxRules(graphApiEndpoint, accessToken)
      if (existingRules && existingRules.length > 0) {
        const highestSequence = Math.max(...existingRules.map((r: any) => r.sequence || 0))
        ruleSequence = Math.max(highestSequence + 1, 100)
      }
    } catch (_sequenceError: any) {
      ruleSequence = 100
    }
  }

  ruleSequence = Math.max(1, Math.floor(ruleSequence))

  const rule: any = {
    displayName: name,
    isEnabled: isEnabled === true,
    sequence: ruleSequence,
    conditions: {},
    actions: {}
  }

  if (fromAddresses) {
    const emailAddresses = fromAddresses
      .split(',')
      .map((email: string) => email.trim())
      .filter((email: string) => email)
      .map((email: string) => ({
        emailAddress: { address: email }
      }))

    if (emailAddresses.length > 0) {
      rule.conditions.fromAddresses = emailAddresses
    }
  }

  if (containsSubject) {
    rule.conditions.subjectContains = [containsSubject]
  }

  if (hasAttachments === true) {
    rule.conditions.hasAttachment = true
  }

  if (moveToFolder) {
    try {
      const folderId = await getFolderIdByName(graphApiEndpoint, accessToken, moveToFolder)
      if (!folderId) {
        return {
          success: false,
          message: `Target folder "${moveToFolder}" not found. Please specify a valid folder name.`
        }
      }

      rule.actions.moveToFolder = folderId
    } catch (folderError: any) {
      return {
        success: false,
        message: `Error resolving folder "${moveToFolder}": ${folderError.message}`
      }
    }
  }

  if (markAsRead === true) {
    rule.actions.markAsRead = true
  }

  const response = await callGraphAPI(graphApiEndpoint, accessToken, 'POST', 'me/mailFolders/inbox/messageRules', rule)

  if (response?.id) {
    return {
      success: true,
      message: `Successfully created rule "${name}" with sequence ${ruleSequence}.`,
      ruleId: response.id
    }
  } else {
    return {
      success: false,
      message: "Failed to create rule. The server didn't return a rule ID."
    }
  }
}
