/**
 * Graph message → {@link EmailRecord} normalisation.
 *
 * Kept pure and separate from the Graph transport so the matcher and the replay
 * fixtures exercise one normalisation path, not two.
 */
import { sanitizeHtmlToText } from '../../utils/html-sanitizer.js'
import type { EmailRecord } from './types.js'

/** `$select` for triage: everything a predicate can test, and nothing else. */
export const TRIAGE_SELECT_FIELDS =
  'id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,importance,isRead,flag'

/**
 * `PR_MESSAGE_CLASS`. Graph does not surface it as a first-class property, so it
 * is requested as a MAPI extended property and used as the primary `type:`
 * signal — subject prefixes are localised and therefore only a fallback.
 */
export const MESSAGE_CLASS_PROPERTY = 'String 0x001A'
export const TRIAGE_EXPAND = `singleValueExtendedProperties($filter=id eq '${MESSAGE_CLASS_PROPERTY}')`

const addressOf = (recipient: any): string => String(recipient?.emailAddress?.address ?? '').toLowerCase()

const addressList = (recipients: any): string[] =>
  Array.isArray(recipients) ? recipients.map(addressOf).filter(Boolean) : []

const FLAG_STATUS: Record<string, EmailRecord['flag']> = {
  flagged: 'flagged',
  complete: 'complete',
  notFlagged: 'unflagged'
}

const bodyText = (message: any): string => {
  const body = message?.body
  if (body?.content) return body.contentType === 'html' ? sanitizeHtmlToText(body.content) : String(body.content)
  return String(message?.bodyPreview ?? '')
}

const messageClassOf = (message: any): string | undefined => {
  const properties = message?.singleValueExtendedProperties
  if (!Array.isArray(properties)) return undefined
  const found = properties.find((property: any) => property?.id === MESSAGE_CLASS_PROPERTY)
  return found?.value ? String(found.value) : undefined
}

/** Normalise one Graph message. `folder` is the `_TRIAGE` subfolder it was read from — only the aged pass supplies it. */
export const toEmailRecord = (message: any, folder?: string): EmailRecord => {
  const record: EmailRecord = {
    subject: String(message?.subject ?? ''),
    body: bodyText(message),
    from: addressOf(message?.from),
    to: addressList(message?.toRecipients),
    cc: addressList(message?.ccRecipients),
    received: String(message?.receivedDateTime ?? '')
  }

  if (message?.id) record.id = String(message.id)
  if (message?.importance) record.importance = message.importance
  if (typeof message?.isRead === 'boolean') record.isRead = message.isRead
  const flag = FLAG_STATUS[message?.flag?.flagStatus]
  if (flag) record.flag = flag
  const messageClass = messageClassOf(message)
  if (messageClass) record.messageClass = messageClass
  if (message?.['@odata.type']) record.odataType = String(message['@odata.type'])
  if (folder) record.folder = folder

  return record
}
