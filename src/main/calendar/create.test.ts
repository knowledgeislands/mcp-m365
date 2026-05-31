import type { Mock } from 'vitest'
import { DEFAULT_TIMEZONE } from '../../config/index.js'
import { ensureAuthenticated } from '../auth/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleCreateEvent } from './create.js'

vi.mock('../graph-client/index.js')
vi.mock('../auth')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = ensureAuthenticated as Mock

describe('handleCreateEvent', () => {
  beforeEach(() => {
    mockCallGraphAPI.mockClear()
    mockEnsureAuthenticated.mockClear()
  })

  test('should use default timezone when no timezone is provided', async () => {
    mockEnsureAuthenticated.mockResolvedValue('dummy_access_token')
    mockCallGraphAPI.mockResolvedValue({ id: 'test_event_id' })

    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00'
    }

    await handleCreateEvent(args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][3]
    expect(callGraphAPIArgs.start.timeZone).toBe(DEFAULT_TIMEZONE)
    expect(callGraphAPIArgs.end.timeZone).toBe(DEFAULT_TIMEZONE)
  })

  test('should use specified timezone when provided', async () => {
    mockEnsureAuthenticated.mockResolvedValue('dummy_access_token')
    mockCallGraphAPI.mockResolvedValue({ id: 'test_event_id' })

    const specifiedTimeZone = 'Pacific Standard Time'
    const args = {
      subject: 'Test Event with Specific Timezone',
      start: { dateTime: '2024-03-10T10:00:00', timeZone: specifiedTimeZone },
      end: { dateTime: '2024-03-10T11:00:00', timeZone: specifiedTimeZone }
    }

    await handleCreateEvent(args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][3]
    expect(callGraphAPIArgs.start.timeZone).toBe(specifiedTimeZone)
    expect(callGraphAPIArgs.end.timeZone).toBe(specifiedTimeZone)
  })

  test('should use default timezone if only start timezone is provided', async () => {
    mockEnsureAuthenticated.mockResolvedValue('dummy_access_token')
    mockCallGraphAPI.mockResolvedValue({ id: 'test_event_id' })

    const specifiedTimeZone = 'Pacific Standard Time'
    const args = {
      subject: 'Test Event with Specific Start Timezone',
      start: { dateTime: '2024-03-10T10:00:00', timeZone: specifiedTimeZone },
      end: { dateTime: '2024-03-10T11:00:00' }
    }

    await handleCreateEvent(args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][3]
    expect(callGraphAPIArgs.start.timeZone).toBe(specifiedTimeZone)
    expect(callGraphAPIArgs.end.timeZone).toBe(DEFAULT_TIMEZONE)
  })

  test('should use default timezone if only end timezone is provided', async () => {
    mockEnsureAuthenticated.mockResolvedValue('dummy_access_token')
    mockCallGraphAPI.mockResolvedValue({ id: 'test_event_id' })

    const specifiedTimeZone = 'Pacific Standard Time'
    const args = {
      subject: 'Test Event with Specific End Timezone',
      start: { dateTime: '2024-03-10T10:00:00' },
      end: { dateTime: '2024-03-10T11:00:00', timeZone: specifiedTimeZone }
    }

    await handleCreateEvent(args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][3]
    expect(callGraphAPIArgs.start.timeZone).toBe(DEFAULT_TIMEZONE)
    expect(callGraphAPIArgs.end.timeZone).toBe(specifiedTimeZone)
  })

  test('should return error if subject is missing', async () => {
    const args = {
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00'
    }

    const result = await handleCreateEvent(args)
    expect(result.content[0].text).toBe('Subject, start, and end times are required to create an event.')
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  test('should return error if start is missing', async () => {
    const args = {
      subject: 'Test Event',
      end: '2024-03-10T11:00:00'
    }

    const result = await handleCreateEvent(args)
    expect(result.content[0].text).toBe('Subject, start, and end times are required to create an event.')
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  test('should return error if end is missing', async () => {
    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00'
    }

    const result = await handleCreateEvent(args)
    expect(result.content[0].text).toBe('Subject, start, and end times are required to create an event.')
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  test('should handle authentication error', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00'
    }

    const result = await handleCreateEvent(args)
    expect(result.content[0].text).toBe("Authentication required. Please use the 'm365_auth_start' tool first.")
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  test('should handle Graph API call error', async () => {
    mockEnsureAuthenticated.mockResolvedValue('dummy_access_token')
    mockCallGraphAPI.mockRejectedValue(new Error('Graph API Error'))
    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00'
    }

    const result = await handleCreateEvent(args)
    expect(result.content[0].text).toBe('Error creating event: Graph API Error')
  })

  test('maps attendees into required-attendee entries', async () => {
    mockEnsureAuthenticated.mockResolvedValue('dummy_access_token')
    mockCallGraphAPI.mockResolvedValue({ id: 'test_event_id' })

    await handleCreateEvent({
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00',
      attendees: ['a@example.com', 'b@example.com'],
      body: '<p>agenda</p>'
    })

    const sent = mockCallGraphAPI.mock.calls[0][3]
    expect(sent.attendees).toEqual([
      { emailAddress: { address: 'a@example.com' }, type: 'required' },
      { emailAddress: { address: 'b@example.com' }, type: 'required' }
    ])
    expect(sent.body.content).toBe('<p>agenda</p>')
  })
})
