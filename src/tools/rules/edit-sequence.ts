/**
 * Edit inbox rule sequence functionality.
 */
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'
import { getInboxRules } from './list.js'

export const handleEditRuleSequence = async (args: any): Promise<any> => {
  const { ruleName, sequence } = args

  if (!ruleName) {
    return {
      content: [
        {
          type: 'text',
          text: 'Rule name is required. Please specify the exact name of an existing rule.'
        }
      ]
    }
  }

  if (!sequence || Number.isNaN(sequence) || sequence < 1) {
    return {
      content: [
        {
          type: 'text',
          text: 'A positive sequence number is required. Lower numbers run first (higher priority).'
        }
      ]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()
    const rules = await getInboxRules(accessToken)

    const rule = rules.find((r: any) => r.displayName === ruleName)
    if (!rule) {
      return {
        content: [{ type: 'text', text: `Rule with name "${ruleName}" not found.` }]
      }
    }

    await callGraphAPI(accessToken, 'PATCH', `me/mailFolders/inbox/messageRules/${rule.id}`, { sequence })

    return {
      content: [
        {
          type: 'text',
          text: `Successfully updated the sequence of rule "${ruleName}" to ${sequence}.`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'editor_authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error updating rule sequence: ${error.message}` }]
    }
  }
}

export default handleEditRuleSequence
