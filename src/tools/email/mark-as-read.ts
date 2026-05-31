/**
 * Mark email as read functionality
 */
import { callGraphAPI } from '../../main/graph-client/index.js'
import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleMarkAsRead = async (args: any): Promise<any> => {
  const emailId = args.id
  const isRead = args.isRead !== undefined ? args.isRead : true

  if (!emailId) {
    return errorText('Email ID is required.')
  }

  try {
    const accessToken = await ensureAuthenticated()

    const endpoint = `me/messages/${encodeURIComponent(emailId)}`
    const updateData = { isRead }

    try {
      await callGraphAPI(accessToken, 'PATCH', endpoint, updateData)

      const status = isRead ? 'read' : 'unread'

      return {
        content: [{ type: 'text', text: `Email successfully marked as ${status}.` }]
      }
    } catch (error: any) {
      console.error(`Error marking email as ${isRead ? 'read' : 'unread'}: ${error.message}`)

      if (error.message.includes("doesn't belong to the targeted mailbox")) {
        return errorText("The email ID seems invalid or doesn't belong to your mailbox. Please try with a different email ID.")
      } else if (error.message.includes('UNAUTHORIZED')) {
        return errorText('Authentication failed. Please re-authenticate and try again.')
      } else {
        return errorText(`Failed to mark email as ${isRead ? 'read' : 'unread'}: ${error.message}`)
      }
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error accessing email: ${error.message}`)
  }
}

export default handleMarkAsRead
