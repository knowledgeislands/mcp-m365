import type { Mock } from 'vitest'
import { DEFAULT_TIMEZONE, GRAPH_API_ENDPOINT } from '../../config/index.js'
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { callGraphAPI } from '../graph-client/index.js'
import { ATTENDEES_REFUSED, handleCreateEvent } from './create.js'

vi.mock('../graph-client/index.js')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = vi.fn()
// Injected GraphContext: handlers receive the Graph endpoint + the auth gate as
// their first argument (standard §1/§2), so tests pass a ctx instead of mocking
// a module-level singleton.
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: mockEnsureAuthenticated }

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

    await handleCreateEvent(ctx, args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][4]
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

    await handleCreateEvent(ctx, args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][4]
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

    await handleCreateEvent(ctx, args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][4]
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

    await handleCreateEvent(ctx, args)

    expect(mockEnsureAuthenticated).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const callGraphAPIArgs = mockCallGraphAPI.mock.calls[0][4]
    expect(callGraphAPIArgs.start.timeZone).toBe(DEFAULT_TIMEZONE)
    expect(callGraphAPIArgs.end.timeZone).toBe(specifiedTimeZone)
  })

  test('should return error if subject is missing', async () => {
    const args = {
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00'
    }

    const result = await handleCreateEvent(ctx, args)
    expect(result.content[0].text).toBe('Subject, start, and end times are required to create an event.')
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  test('should return error if start is missing', async () => {
    const args = {
      subject: 'Test Event',
      end: '2024-03-10T11:00:00'
    }

    const result = await handleCreateEvent(ctx, args)
    expect(result.content[0].text).toBe('Subject, start, and end times are required to create an event.')
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  test('should return error if end is missing', async () => {
    const args = {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00'
    }

    const result = await handleCreateEvent(ctx, args)
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

    const result = await handleCreateEvent(ctx, args)
    expect(result.content[0].text).toBe(AUTH_REQUIRED_MESSAGE)
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

    const result = await handleCreateEvent(ctx, args)
    expect(result.content[0].text).toBe('Error creating event: Graph API Error')
  })

  test('never notifies attendees: the Graph body carries no attendees', async () => {
    mockEnsureAuthenticated.mockResolvedValue('dummy_access_token')
    mockCallGraphAPI.mockResolvedValue({ id: 'test_event_id' })

    await handleCreateEvent(ctx, {
      subject: 'Test Event',
      start: '2024-03-10T10:00:00',
      end: '2024-03-10T11:00:00',
      attendees: [],
      body: '<p>agenda</p>'
    })

    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    const sent = mockCallGraphAPI.mock.calls[0][4]
    expect(sent).not.toHaveProperty('attendees')
    expect(sent.body.content).toBe('<p>agenda</p>')
  })

  test.each([[['a@example.com']], ['a@example.com'], [[{ emailAddress: { address: 'a@example.com' } }]]])(
    'refuses attendees %j before authentication, so no invitation is sent',
    async (attendees) => {
      const result = await handleCreateEvent(ctx, {
        subject: 'Test Event',
        start: '2024-03-10T10:00:00',
        end: '2024-03-10T11:00:00',
        attendees
      })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toBe(ATTENDEES_REFUSED)
      expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
      expect(mockCallGraphAPI).not.toHaveBeenCalled()
    }
  )
})
