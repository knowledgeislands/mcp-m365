/**
 * Draft email functionality
 */

import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'

export const handleDraftEmail = async (args: any): Promise<any> => {
  const { to, cc, bcc, subject = '', body = '', importance = 'normal' } = args || {}

  try {
    const accessToken = await ensureAuthenticated()

    const toRecipients = to
      ? to
          .split(',')
          .map((email: string) => ({
            emailAddress: { address: email.trim() }
          }))
          .filter((r: any) => r.emailAddress.address)
      : []

    const ccRecipients = cc
      ? cc
          .split(',')
          .map((email: string) => ({
            emailAddress: { address: email.trim() }
          }))
          .filter((r: any) => r.emailAddress.address)
      : []

    const bccRecipients = bcc
      ? bcc
          .split(',')
          .map((email: string) => ({
            emailAddress: { address: email.trim() }
          }))
          .filter((r: any) => r.emailAddress.address)
      : []

    const messageObject = {
      subject,
      body: {
        contentType: typeof body === 'string' && body.toLowerCase().includes('<html') ? 'html' : 'text',
        content: body
      },
      toRecipients: toRecipients.length > 0 ? toRecipients : undefined,
      ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
      bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
      importance
    }

    const draft = await callGraphAPI(accessToken, 'POST', 'me/messages', messageObject)

    return {
      content: [
        {
          type: 'text',
          text: `Draft created successfully!\n\nDraft ID: ${draft.id}\nSubject: ${draft.subject || '(no subject)'}\nRecipients: ${toRecipients.length}${ccRecipients.length > 0 ? ` + ${ccRecipients.length} CC` : ''}${bccRecipients.length > 0 ? ` + ${bccRecipients.length} BCC` : ''}`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    if (error.message?.includes('status 403')) {
      return errorText('Draft creation was denied by Microsoft Graph (403). The token likely lacks Mail.ReadWrite scope. Re-authenticate with force=true to refresh consent, then try again.')
    }

    return errorText(`Error creating draft email: ${error.message}`)
  }
}

export default handleDraftEmail
