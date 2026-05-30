/**
 * Read email functionality
 *
 * Security: HTML emails are sanitized to remove hidden content that could
 * be used for prompt injection attacks. Only visible text is extracted.
 */
import { EMAIL_DETAIL_FIELDS } from '../../config/index.js'
import { callGraphAPI } from '../../main/graph-client/index.js'
import { processHtmlEmail } from '../../utils/html-sanitizer.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleReadEmail = async (args: any): Promise<any> => {
  const emailId = args.id
  const includeRawHtml = args.includeRawHtml === true

  if (!emailId) {
    return {
      content: [{ type: 'text', text: 'Email ID is required.' }]
    }
  }

  try {
    const accessToken = await ensureAuthenticated()

    const endpoint = `me/messages/${encodeURIComponent(emailId)}`
    const queryParams = {
      $select: EMAIL_DETAIL_FIELDS
    }

    try {
      const email = await callGraphAPI(accessToken, 'GET', endpoint, null, queryParams)

      if (!email) {
        return {
          content: [{ type: 'text', text: `Email with ID ${emailId} not found.` }]
        }
      }

      const sender = email.from ? `${email.from.emailAddress.name} (${email.from.emailAddress.address})` : 'Unknown'
      const senderAddress = email.from?.emailAddress?.address || 'unknown'
      const to = email.toRecipients ? email.toRecipients.map((r: any) => `${r.emailAddress.name} (${r.emailAddress.address})`).join(', ') : 'None'
      const cc = email.ccRecipients && email.ccRecipients.length > 0 ? email.ccRecipients.map((r: any) => `${r.emailAddress.name} (${r.emailAddress.address})`).join(', ') : 'None'
      const bcc = email.bccRecipients && email.bccRecipients.length > 0 ? email.bccRecipients.map((r: any) => `${r.emailAddress.name} (${r.emailAddress.address})`).join(', ') : 'None'
      const date = new Date(email.receivedDateTime).toLocaleString()

      let body = ''
      let bodyNote = ''

      if (email.body) {
        if (email.body.contentType === 'html') {
          body = processHtmlEmail(email.body.content, {
            addBoundary: true,
            metadata: {
              from: senderAddress,
              subject: email.subject,
              date: date
            }
          })
          bodyNote = '\n[HTML email - sanitized for security, hidden content removed]\n'
        } else {
          body = processHtmlEmail(email.body.content, {
            addBoundary: true,
            metadata: {
              from: senderAddress,
              subject: email.subject,
              date: date
            }
          })
        }
      } else {
        body = email.bodyPreview || 'No content'
      }

      const formattedEmail = `From: ${sender}
To: ${to}
${cc !== 'None' ? `CC: ${cc}\n` : ''}${bcc !== 'None' ? `BCC: ${bcc}\n` : ''}Subject: ${email.subject}
Date: ${date}
Importance: ${email.importance || 'normal'}
Has Attachments: ${email.hasAttachments ? 'Yes' : 'No'}
${bodyNote}
${body}`

      let rawHtmlSection = ''
      if (includeRawHtml && email.body?.contentType === 'html') {
        rawHtmlSection = `\n\n--- RAW HTML (UNSAFE - FOR DEBUGGING ONLY) ---\n${email.body.content}\n--- END RAW HTML ---`
      }

      return {
        content: [{ type: 'text', text: formattedEmail + rawHtmlSection }]
      }
    } catch (error: any) {
      console.error(`Error reading email: ${error.message}`)

      if (error.message.includes("doesn't belong to the targeted mailbox")) {
        return {
          content: [{ type: 'text', text: "The email ID seems invalid or doesn't belong to your mailbox. Please try with a different email ID." }]
        }
      } else {
        return {
          content: [{ type: 'text', text: `Failed to read email: ${error.message}` }]
        }
      }
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'm365_auth_start' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error accessing email: ${error.message}` }]
    }
  }
}

export default handleReadEmail
