/**
 * Coverage tests for the small calendar handlers (list/cancel/decline/delete).
 * `create` has its own focused test file.
 */
import type { Mock, MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import { callGraphAPI } from '../graph-client/index.js'
import { handleAcceptEvent } from './accept.js'
import { handleCancelEvent } from './cancel.js'
import { handleDeclineEvent } from './decline.js'
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

describe('handleAcceptEvent', () => {
  it('accepts an event with a default comment', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleAcceptEvent(ctx, { eventId: 'e1' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/events/e1/accept', {
      comment: 'Accepted via API'
    })
    expect(r.content[0].text).toMatch(/successfully accepted/)
  })

  it('uses the supplied comment when provided', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleAcceptEvent(ctx, { eventId: 'e1', comment: 'see you' })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/events/e1/accept', {
      comment: 'see you'
    })
  })

  it('rejects when eventId is missing', async () => {
    const r = await handleAcceptEvent(ctx, {})
    expect(r.content[0].text).toMatch(/required to accept/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleAcceptEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleAcceptEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toMatch(/Error accepting event: boom/)
  })
})

describe('handleCancelEvent', () => {
  it('cancels an event with a default comment', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleCancelEvent(ctx, { eventId: 'e1', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/events/e1/cancel', {
      comment: 'Cancelled via API'
    })
    expect(r.content[0].text).toMatch(/successfully cancelled/)
  })

  it('uses the supplied comment when provided', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleCancelEvent(ctx, { eventId: 'e1', comment: 'sick', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/events/e1/cancel', {
      comment: 'sick'
    })
  })

  it('returns a [dry_run] preview without calling cancel by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'e1', subject: 'Standup', start: { dateTime: '2026-01-01T09:00' } })
    const r = await handleCancelEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toMatch(/^\[dry_run\] would cancel event e1: "Standup"/)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
    expect(mockCallGraphAPI).toHaveBeenCalledWith(
      GRAPH_API_ENDPOINT,
      'tok',
      'GET',
      expect.stringContaining('me/events/e1?')
    )
  })

  it('rejects when eventId is missing', async () => {
    const r = await handleCancelEvent(ctx, {})
    expect(r.content[0].text).toMatch(/required to cancel/)
    expect(mockEnsureAuthenticated).not.toHaveBeenCalled()
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleCancelEvent(ctx, { eventId: 'e1', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleCancelEvent(ctx, { eventId: 'e1', dry_run: false })
    expect(r.content[0].text).toMatch(/Error cancelling event: boom/)
  })
})

describe('handleDeclineEvent', () => {
  it('declines with a default comment', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleDeclineEvent(ctx, { eventId: 'e2', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/events/e2/decline', {
      comment: 'Declined via API'
    })
    expect(r.content[0].text).toMatch(/successfully declined/)
  })

  it('uses the supplied comment when provided', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    await handleDeclineEvent(ctx, { eventId: 'e2', comment: 'conflict', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'POST', 'me/events/e2/decline', {
      comment: 'conflict'
    })
  })

  it('returns a [dry_run] preview without calling decline by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'e2', subject: 'Review', start: { dateTime: '2026-01-02T10:00' } })
    const r = await handleDeclineEvent(ctx, { eventId: 'e2' })
    expect(r.content[0].text).toMatch(/^\[dry_run\] would decline event e2: "Review"/)
    expect(mockCallGraphAPI).toHaveBeenCalledTimes(1)
  })

  it('rejects when eventId is missing', async () => {
    const r = await handleDeclineEvent(ctx, {})
    expect(r.content[0].text).toMatch(/required to decline/)
  })

  it('handles authentication errors', async () => {
    mockEnsureAuthenticated.mockRejectedValue(new Error('Authentication required'))
    const r = await handleDeclineEvent(ctx, { eventId: 'e2', dry_run: false })
    expect(r.content[0].text).toMatch(/Authentication required/)
  })

  it('handles Graph API errors', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockRejectedValue(new Error('boom'))
    const r = await handleDeclineEvent(ctx, { eventId: 'e2', dry_run: false })
    expect(r.content[0].text).toMatch(/Error declining event: boom/)
  })
})

describe('handleDeleteEvent', () => {
  it('deletes by eventId', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValue({})
    const r = await handleDeleteEvent(ctx, { eventId: 'e3', dry_run: false })
    expect(mockCallGraphAPI).toHaveBeenCalledWith(GRAPH_API_ENDPOINT, 'tok', 'DELETE', 'me/events/e3')
    expect(r.content[0].text).toMatch(/successfully deleted/)
  })

  it('returns a [dry_run] preview without deleting by default', async () => {
    mockEnsureAuthenticated.mockResolvedValue('tok')
    mockCallGraphAPI.mockResolvedValueOnce({
      id: 'e3',
      subject: 'Old',
      start: { dateTime: '2026-01-03T11:00' },
      end: { dateTime: '2026-01-03T12:00' }
    })
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

  it('cancel preview uses placeholders when subject/start are absent', async () => {
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'e1' })
    const r = await handleCancelEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toContain('"" (?)')
  })

  it('decline preview uses placeholders when subject/start are absent', async () => {
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'e1' })
    const r = await handleDeclineEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toContain('"" (?)')
  })

  it('delete preview uses placeholders when subject/start/end are absent', async () => {
    mockCallGraphAPI.mockResolvedValueOnce({ id: 'e1' })
    const r = await handleDeleteEvent(ctx, { eventId: 'e1' })
    expect(r.content[0].text).toContain('"" (? → ?)')
  })
})
