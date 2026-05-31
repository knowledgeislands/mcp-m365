/**
 * Send email functionality
 */

import { errorText } from '../../utils/results.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'

export const handleSendEmail = async (args: any): Promise<any> => {
  const { to, cc, bcc, subject, body, importance = 'normal', saveToSentItems = true, isHtml } = args

  if (!to) {
    return errorText('Recipient (to) is required.')
  }

  if (!subject) {
    return errorText('Subject is required.')
  }

  if (!body) {
    return errorText('Body content is required.')
  }

  try {
    const accessToken = await ensureAuthenticated()

    const toRecipients = to.split(',').map((email: string) => {
      email = email.trim()
      return { emailAddress: { address: email } }
    })

    const ccRecipients = cc
      ? cc.split(',').map((email: string) => {
          email = email.trim()
          return { emailAddress: { address: email } }
        })
      : []

    const bccRecipients = bcc
      ? bcc.split(',').map((email: string) => {
          email = email.trim()
          return { emailAddress: { address: email } }
        })
      : []

    const contentType = isHtml === true ? 'html' : isHtml === false ? 'text' : body.includes('<html') || body.includes('<HTML') ? 'html' : 'text'

    const emailObject = {
      message: {
        subject,
        body: {
          contentType: contentType,
          content: body
        },
        toRecipients,
        ccRecipients: ccRecipients.length > 0 ? ccRecipients : undefined,
        bccRecipients: bccRecipients.length > 0 ? bccRecipients : undefined,
        importance
      },
      saveToSentItems
    }

    await callGraphAPI(accessToken, 'POST', 'me/sendMail', emailObject)

    return {
      content: [
        {
          type: 'text',
          text: `Email sent successfully!\n\nSubject: ${subject}\nRecipients: ${toRecipients.length}${ccRecipients.length > 0 ? ` + ${ccRecipients.length} CC` : ''}${bccRecipients.length > 0 ? ` + ${bccRecipients.length} BCC` : ''}\nMessage Length: ${body.length} characters`
        }
      ]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return errorText("Authentication required. Please use the 'm365_auth_start' tool first.")
    }

    return errorText(`Error sending email: ${error.message}`)
  }
}

export default handleSendEmail
