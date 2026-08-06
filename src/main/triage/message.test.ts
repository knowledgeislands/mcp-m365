import { resolveMoveTarget } from './folders.js'
import { MESSAGE_CLASS_PROPERTY, toEmailRecord } from './message.js'

describe('toEmailRecord', () => {
  const graphMessage = {
    id: 'AAMk123',
    subject: 'Re: Partner sync',
    from: { emailAddress: { name: 'Sam', address: 'Contact@Partner.Example.com' } },
    toRecipients: [{ emailAddress: { address: 'Kris@Example.com' } }],
    ccRecipients: [{ emailAddress: { address: 'other@example.com' } }],
    receivedDateTime: '2026-08-01T09:00:00Z',
    body: { contentType: 'text', content: 'plain body' },
    importance: 'high',
    isRead: false,
    flag: { flagStatus: 'flagged' },
    '@odata.type': '#microsoft.graph.eventMessageRequest',
    singleValueExtendedProperties: [{ id: MESSAGE_CLASS_PROPERTY, value: 'IPM.Schedule.Meeting.Request' }]
  }

  it('normalises every field the matcher can test', () => {
    expect(toEmailRecord(graphMessage)).toEqual({
      id: 'AAMk123',
      subject: 'Re: Partner sync',
      body: 'plain body',
      from: 'contact@partner.example.com',
      to: ['kris@example.com'],
      cc: ['other@example.com'],
      received: '2026-08-01T09:00:00Z',
      importance: 'high',
      isRead: false,
      flag: 'flagged',
      messageClass: 'IPM.Schedule.Meeting.Request',
      odataType: '#microsoft.graph.eventMessageRequest'
    })
  })

  it('records the folder for the aged pass', () => {
    expect(toEmailRecord(graphMessage, '111 Partner').folder).toBe('111 Partner')
  })

  it('converts an HTML body to text so body predicates see prose, not markup', () => {
    const record = toEmailRecord({ body: { contentType: 'html', content: '<p>an update on <b>Lighthouse</b></p>' } })
    expect(record.body).toContain('Lighthouse')
    expect(record.body).not.toContain('<b>')
  })

  it('falls back to the body preview when no body was fetched', () => {
    expect(toEmailRecord({ bodyPreview: 'preview text' }).body).toBe('preview text')
  })

  it.each([
    ['notFlagged', 'unflagged'],
    ['complete', 'complete'],
    ['flagged', 'flagged']
  ])('maps flag status %s', (flagStatus, expected) => {
    expect(toEmailRecord({ flag: { flagStatus } }).flag).toBe(expected)
  })

  it('omits the flag when Graph reports an unrecognised status', () => {
    expect(toEmailRecord({ flag: { flagStatus: 'somethingElse' } }).flag).toBeUndefined()
  })

  it('tolerates a message with nothing on it', () => {
    expect(toEmailRecord({})).toEqual({ subject: '', body: '', from: '', to: [], cc: [], received: '' })
  })

  it('tolerates a null message', () => {
    expect(toEmailRecord(null).subject).toBe('')
  })

  it('ignores recipient collections that are not arrays', () => {
    expect(toEmailRecord({ toRecipients: 'nope' }).to).toEqual([])
  })

  it('drops recipients with no address', () => {
    expect(
      toEmailRecord({ toRecipients: [{ emailAddress: {} }, { emailAddress: { address: 'a@b.com' } }] }).to
    ).toEqual(['a@b.com'])
  })

  it('ignores extended properties that are not the message class', () => {
    expect(
      toEmailRecord({ singleValueExtendedProperties: [{ id: 'String 0x999', value: 'x' }] }).messageClass
    ).toBeUndefined()
  })

  it('ignores an extended property with no value', () => {
    expect(
      toEmailRecord({ singleValueExtendedProperties: [{ id: MESSAGE_CLASS_PROPERTY }] }).messageClass
    ).toBeUndefined()
  })

  it('ignores an extended properties field that is not an array', () => {
    expect(toEmailRecord({ singleValueExtendedProperties: {} }).messageClass).toBeUndefined()
  })

  it('omits isRead when Graph did not report it', () => {
    expect(toEmailRecord({}).isRead).toBeUndefined()
  })
})

describe('resolveMoveTarget', () => {
  it('prefixes a bare folder name with the triage root', () => {
    expect(resolveMoveTarget({ kind: 'move', value: '111 Partner', quoted: false })).toBe('_TRIAGE/111 Partner')
  })

  it('leaves an explicit path alone', () => {
    expect(resolveMoveTarget({ kind: 'move', value: '_ARCHIVE/Success/Partner', quoted: false })).toBe(
      '_ARCHIVE/Success/Partner'
    )
  })

  it('treats a quoted name as an absolute mailbox folder', () => {
    expect(resolveMoveTarget({ kind: 'move', value: 'Junk Email', quoted: true })).toBe('Junk Email')
  })

  it('tolerates a move action with no value', () => {
    expect(resolveMoveTarget({ kind: 'move' })).toBe('_TRIAGE/')
  })
})
