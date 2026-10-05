import type { McpServer } from '@modelcontextprotocol/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCalendarTools } from '../../tools/calendar/index.js'
import { makeAccessGatedRegister } from '../../utils/access-level.js'
import { callGraphAPI } from '../graph-client/index.js'
import { AvailabilityInputSchema, AvailabilityResultSchema, handleGetAvailability } from './availability.js'

vi.mock('../graph-client/index.js', () => ({ callGraphAPI: vi.fn() }))
const call = vi.mocked(callGraphAPI)
const ctx = { graphApiEndpoint: 'https://graph.microsoft.com/v1.0', ensureAuthenticated: vi.fn() }
const input = {
  schedules: ['one@example.com'],
  startDateTime: '2026-10-05T10:00:00Z',
  endDateTime: '2026-10-05T11:00:00Z'
}
beforeEach(() => {
  vi.resetAllMocks()
  ctx.ensureAuthenticated.mockResolvedValue('fixture-token')
})
describe('bounded calendar availability', () => {
  it('projects only availability and exact read-only Graph POST', async () => {
    call.mockResolvedValue({
      value: [
        {
          scheduleId: 'ONE@example.com',
          availabilityView: '02',
          scheduleItems: [{ subject: 'private', location: 'secret' }]
        }
      ]
    })
    const result = await handleGetAvailability(ctx, input)
    expect(result).toHaveProperty('structuredContent.schedules.0.availabilityView', '02')
    expect(JSON.stringify(result)).not.toMatch(/private|secret|fixture-token/)
    expect(AvailabilityResultSchema.safeParse('structuredContent' in result && result.structuredContent).success).toBe(
      true
    )
    expect(call).toHaveBeenCalledWith(
      ctx.graphApiEndpoint,
      'fixture-token',
      'POST',
      'me/calendar/getSchedule',
      {
        schedules: input.schedules,
        startTime: { dateTime: input.startDateTime, timeZone: 'UTC' },
        endTime: { dateTime: input.endDateTime, timeZone: 'UTC' },
        availabilityViewInterval: 30
      },
      {},
      { maxResponseBytes: 262144, redactErrorBody: true }
    )
  })
  it.each([
    { ...input, endDateTime: input.startDateTime },
    { ...input, endDateTime: '2026-10-05T09:00:00Z' },
    { ...input, endDateTime: '2026-10-13T10:00:00Z' },
    { ...input, schedules: ['one@example.com', 'ONE@example.com'] },
    { ...input, schedules: [] },
    { ...input, schedules: ['bad'] },
    { ...input, schedules: Array.from({ length: 21 }, (_, i) => `a${i}@example.com`) },
    { ...input, availabilityViewInterval: 4 },
    { ...input, availabilityViewInterval: 1441 },
    { ...input, startDateTime: '2026-10-05T10:00:00+00:00' },
    { ...input, startDateTime: '2026-02-30T10:00:00Z' },
    { ...input, extra: true }
  ])('rejects invalid direct-library input before authentication', async (args) => {
    const result = await handleGetAvailability(ctx, args)
    expect(result).toHaveProperty('isError', true)
    expect(ctx.ensureAuthenticated).not.toHaveBeenCalled()
    expect(call).not.toHaveBeenCalled()
  })
  it('accepts seven days and provider interval boundaries', () => {
    expect(
      AvailabilityInputSchema.parse({ ...input, endDateTime: '2026-10-12T10:00:00Z', availabilityViewInterval: 5 })
    ).toHaveProperty('availabilityViewInterval', 5)
    expect(AvailabilityInputSchema.parse({ ...input, availabilityViewInterval: 1440 })).toHaveProperty(
      'availabilityViewInterval',
      1440
    )
  })
  it('retains target order, explicit provider errors and omitted-target failures', async () => {
    call.mockResolvedValue({
      value: [{ scheduleId: 'two@example.com', error: { responseCode: '5006', message: 'private provider detail' } }]
    })
    const result = await handleGetAvailability(ctx, { ...input, schedules: ['one@example.com', 'two@example.com'] })
    expect(result).toHaveProperty('structuredContent.schedules.0.error.code', 'missing_schedule')
    expect(result).toHaveProperty('structuredContent.schedules.1.error.code', '5006')
    expect(JSON.stringify(result)).not.toContain('private provider detail')
  })
  it.each([
    {},
    { value: [{ scheduleId: 'not-an-email' }] },
    { value: [{ scheduleId: 'other@example.com', availabilityView: '00' }] },
    {
      value: [
        { scheduleId: 'one@example.com', availabilityView: '00' },
        { scheduleId: 'one@example.com', availabilityView: '00' }
      ]
    },
    { value: [{ scheduleId: 'one@example.com' }] },
    { value: [{ scheduleId: 'one@example.com', availabilityView: '0' }] },
    { value: [{ scheduleId: 'one@example.com', availabilityView: '0x' }] },
    { value: [{ scheduleId: 'one@example.com', availabilityView: '04' }] }
  ])('fails closed on malformed provider response', async (response) => {
    call.mockResolvedValue(response)
    expect(await handleGetAvailability(ctx, input)).toHaveProperty('isError', true)
  })
  it('returns authentication and transport errors through existing envelopes', async () => {
    ctx.ensureAuthenticated.mockRejectedValueOnce(new Error('Authentication required'))
    expect(await handleGetAvailability(ctx, input)).toHaveProperty('isError', true)
    expect(call).not.toHaveBeenCalled()
    call.mockRejectedValueOnce(new Error('fixture transport failure'))
    expect(await handleGetAvailability(ctx, input)).toHaveProperty('isError', true)
  })
  it('registers a schema-matched read-tier tool through the access gate', async () => {
    const registrations = new Map<string, { config: any; handler: (args: unknown) => Promise<any> }>()
    const server = {
      registerTool: vi.fn((name: string, config: any, handler: any) => {
        registrations.set(name, { config, handler })
      })
    } as unknown as McpServer
    server.registerTool = makeAccessGatedRegister(server, 'read', { mode: 'off', path: '', maxBytes: 0, keep: 0 })
    registerCalendarTools(server, ctx)
    const registration = registrations.get('m365_calendar_availability_get')!
    expect(registration.config.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true })
    expect(registration.config.outputSchema).toBe(AvailabilityResultSchema)
    call.mockResolvedValue({ value: [{ scheduleId: 'one@example.com', availabilityView: '00' }] })
    expect(await registration.handler(input)).toHaveProperty('structuredContent.schedules.0.status', 'available')
    expect(registrations.has('m365_calendar_event_create')).toBe(false)
  })
})
