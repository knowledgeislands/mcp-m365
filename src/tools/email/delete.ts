/**
 * Delete email functionality (move to Deleted Items / trash)
 */
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleDeleteEmail = async (args: any = {}): Promise<any> => {
  const emailId = args.id
  const permanent = args.permanent === true

  if (!emailId) {
    return {
      content: [{ type: 'text', text: 'Email ID is required.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    if (permanent) {
      await callGraphAPI(accessToken, 'POST', `me/messages/${encodeURIComponent(emailId)}/permanentDelete`)
      return {
        content: [{ type: 'text', text: 'Email permanently deleted.' }]
      }
    } else {
      const result = await callGraphAPI(accessToken, 'POST', `me/messages/${encodeURIComponent(emailId)}/move`, {
        destinationId: 'deleteditems'
      })
      return {
        content: [{ type: 'text', text: `Email moved to Deleted Items. ID: ${result.id}` }]
      }
    }
  } catch (error: any) {
    if (error.message === 'Authentication required' || error.message === 'UNAUTHORIZED') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'authenticate' tool first." }]
      }
    }
    return {
      content: [{ type: 'text', text: `Failed to delete email: ${error.message}` }]
    }
  }
}

export default handleDeleteEmail
