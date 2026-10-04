/**
 * Edit inbox rule sequence functionality.
 */

import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'
import { getInboxRules } from './list.js'

export const handleEditRuleSequence = async (ctx: GraphContext, args: any): Promise<any> => {
  const { ruleName, sequence } = args

  if (!ruleName) {
    return errorText('Rule name is required. Please specify the exact name of an existing rule.')
  }

  if (!sequence || Number.isNaN(sequence) || sequence < 1) {
    return errorText('A positive sequence number is required. Lower numbers run first (higher priority).')
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()
    const rules = await getInboxRules(ctx.graphApiEndpoint, accessToken)

    const rule = rules.find((r: any) => r.displayName === ruleName)
    if (!rule) {
      return errorText(`Rule with name "${ruleName}" not found.`)
    }

    await callGraphAPI(
      ctx.graphApiEndpoint,
      accessToken,
      'PATCH',
      `me/mailFolders/inbox/messageRules/${encodeURIComponent(rule.id)}`,
      {
        sequence
      }
    )

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
      return errorText(AUTH_REQUIRED_MESSAGE)
    }

    return errorText(`Error updating rule sequence: ${error.message}`)
  }
}
