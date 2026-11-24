/**
 * Coverage tests for the small calendar handlers (list/delete).
 * `create` has its own focused test file.
 */
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleDeleteEvent } from './delete.js'
import { handleListEvents } from './list.js'

vi.mock('../graph-client/index.js')

const mockCallGraphAPI = callGraphAPI as Mock
const mockEnsureAuthenticated = vi.fn()
// Injected GraphContext: handlers receive the Graph endpoint + the auth gate as
// their first argument (standard §1/§2), so tests pass a ctx instead of mocking
// a module-level singleton.
const ctx = { graphApiEndpoint: GRAPH_API_ENDPOINT, ensureAuthenticated: mockEnsureAuthenticated }

let consoleErrorSpy: MockInstance

beforeEach(() => {
  mockCallGraphAPI.mockReset()
  mockEnsureAuthenticated.mockReset()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('handleListEvents', () => {
  it('lists events in a sane default range', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'e1',
          subject: 'Standup',
          start: { dateTime: '2026-05-09T09:00:00Z', timeZone: 'UTC' },
          end: { dateTime: '2026-05-09T09:30:00Z', timeZone: 'UTC' },
          location: { displayName: 'Room 1' },
          bodyPreview: 'agenda'
        }
      ]
    })

    const result = await handleListEvents(ctx, {})
    expect(mockCallGraphAPI).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
      'tok',
      'GET',
      'me/calendarView',
      null,
      expect.objectContaining({ $top: 10, $orderby: 'start/dateTime' })
    )
    expect(result.content[0].text).toMatch(/Found 1 events/)
    expect(result.content[0].text).toContain('Standup')
    expect(result.content[0].text).toContain('Room 1')
  })

  it('reports "No calendar events found" when value is empty', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({ value: [] })
    const r = await handleListEvents(ctx, {})
    expect(r.content[0].text).toBe('No calendar events found.')
  })

  it('rejects an invalid date range', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    const r = await handleListEvents(ctx, {
      startDateTime: '2026-05-10T00:00:00Z',
      endDateTime: '2026-05-01T00:00:00Z'
    })
    expect(r.content[0].text).toMatch(/Invalid date range/)
    expect(mockCallGraphAPI).not.toHaveBeenCalled()
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleListEvents(ctx, {})
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleListEvents(ctx, {})
    expect(r.content[0].text).toMatch(/Error listing events: boom/)
  })

  it('formats events without timezone offsets and locations', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        { id: 'e2', subject: 'Solo', start: '2026-05-09T09:00:00Z', end: '2026-05-09T09:30:00Z', bodyPreview: '' }
      ]
    })
    const r = await handleListEvents(ctx, {})
    expect(r.content[0].text).toContain('Location: No location')
  })

  it('covers the date-formatter fallbacks (missing/empty/invalid datetimes and a Z-appended UTC value)', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        // start missing entirely, end as an object lacking dateTime, plus an
        // invalid date string in a second event to hit the NaN branch.
        { id: 'a', subject: 'NoStart', start: undefined, end: {}, bodyPreview: '' },
        { id: 'b', subject: 'BadDate', start: 'not-a-date', end: 'also-bad', bodyPreview: '' },
        // UTC zone with no trailing Z / offset → the `${dateTime}Z` branch.
        {
          id: 'c',
          subject: 'UTCnoZ',
          start: { dateTime: '2026-05-09T09:00:00', timeZone: 'UTC' },
          end: { dateTime: '2026-05-09T10:00:00', timeZone: 'UTC' },
          bodyPreview: ''
        }
      ]
    })
    const r = await handleListEvents(ctx, {})
    expect(r.content[0].text).toContain('NoStart')
    expect(r.content[0].text).toContain('not-a-date')
  })

  it('renders a named (non-UTC, offset-less) timezone verbatim', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'e3',
          subject: 'TZ',
          start: { dateTime: '2026-05-09T09:00:00', timeZone: 'Pacific Standard Time' },
          end: { dateTime: '2026-05-09T09:30:00', timeZone: 'Pacific Standard Time' },
          bodyPreview: ''
        }
      ]
    })
    const r = await handleListEvents(ctx, {})
    expect(r.content[0].text).toContain('2026-05-09T09:00:00 (Pacific Standard Time)')
  })
})

describe('handleDeleteEvent', () => {
  const personal = {
    id: 'e3',
    subject: 'Old',
    start: { dateTime: '2026-01-03T11:00' },
    end: { dateTime: '2026-01-03T12:00' },
    isOrganizer: true,
    attendees: []
  }

  it('deletes a personal event by eventId after checking it is not a meeting', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce(personal).mockResolvedValueOnce({})
    const r = await handleDeleteEvent(ctx, { eventId: 'e3', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenNthCalledWith(
      1,
      GRAPH_API_ENDPOINT,
      'tok',
      'GET',
      expect.stringMatching(/^me\/events\/e3\?\$select=.*isOrganizer.*attendees/)
    )
    expect(mockCallGraphAPI).toHaveBeenNthCalledWith(2, GRAPH_API_ENDPOINT, 'tok', 'DELETE', 'me/events/e3')
    expect(r.content[0].text).toMatch(/successfully deleted/)
  })

  it('returns a [dry_run] preview without deleting by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce(personal)
    const r = await handleDeleteEvent(ctx, { eventId: 'e3' })
    expect(r.content[0].text).toMatch(/^\[dry_run\] would delete event e3: "Old"/)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
      'tok',
      'GET',
      expect.stringContaining('me/events/e3?')
    )
  })

  it.each([
    [
      'an organised meeting with attendees',
      { isOrganizer: true, attendees: [{ emailAddress: { address: 'a@x.com' } }] }
    ],
    ['a meeting someone else organised', { isOrganizer: false, attendees: [] }],
    ['an event whose organiser flag is missing', { isOrganizer: undefined, attendees: undefined }],
    ['an invitation with both', { isOrganizer: false, attendees: [{ emailAddress: { address: 'a@x.com' } }] }]
  ])('never notifies attendees: refuses %s, live or preview, without a DELETE', async (_label, shape) => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    for (const dry_run of [false, true]) {
      mockCallGraphAPI.mockReset()
      mockCallGraphAPI.mockResolvedValueOnce({ ...personal, ...shape })
      const r = await handleDeleteEvent(ctx, { eventId: 'e3', dry_run })
      expect(r.isError).toBe(true)
      expect(r.content[0].text).toMatch(/Refused: event e3 \("Old"\) is a meeting/)
      expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
      expect(mockCallGraphAPI.mock.calls.some((call) => call[2] === 'DELETE')).toBe(false)
    }
  })

  it('rejects when eventId is missing', async () => {
    const r = await handleDeleteEvent(ctx, {})
    expect(r.content[0].text).toMatch(/required to delete/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDeleteEvent(ctx, { eventId: 'e3', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDeleteEvent(ctx, { eventId: 'e3', dry_run: false })
    expect(r.content[0].text).toMatch(/Error deleting event: boom/)
  })
})

describe('dry_run previews fall back gracefully on sparse event metadata', () => {
  beforeEach(() => mockEnsureAuthenticated.mockResolvedValue('tok'))

  it('delete preview uses placeholders when subject/start/end are absent', async () => {
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'e1', isOrganizer: true })
    const r = await handleDeleteEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toContain('"" (? → ?)')
  })

  it('a refusal uses a placeholder subject and treats a missing organiser flag as a meeting', async () => {
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'e1' })
    const r = await handleDeleteEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toMatch(/Refused: event e1 \(""\) is a meeting/)
  })
})
