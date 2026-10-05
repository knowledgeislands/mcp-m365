import { z } from 'zod'
import { errorResult } from '../../utils/results.js'
import { callGraphAPI, type GraphContext } from '../graph-client/index.js'

const utc = z.iso.datetime({ offset: false })
export const AvailabilityInputSchema = z
  .object({
    schedules: z.array(z.email().max(254)).min(1).max(20),
    startDateTime: utc,
    endDateTime: utc,
    availabilityViewInterval: z.number().int().min(5).max(1440).default(30)
  })
  .strict()
  .superRefine((value, ctx) => {
    const duration = Date.parse(value.endDateTime) - Date.parse(value.startDateTime)
    if (duration <= 0 || duration > 7 * 24 * 60 * 60 * 1000) {
      ctx.addIssue({ code: 'custom', message: 'Window must be positive and no longer than seven days' })
    }
    if (new Set(value.schedules.map((address) => address.toLowerCase())).size !== value.schedules.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate schedule addresses are not allowed' })
    }
  })

const ScheduleResultSchema = z.discriminatedUnion('status', [
  z
    .object({
      scheduleId: z.string(),
      status: z.literal('available'),
      availabilityView: z
        .string()
        .regex(/^[0-3]+$/)
        .max(2016)
    })
    .strict(),
  z
    .object({
      scheduleId: z.string(),
      status: z.literal('error'),
      error: z.object({ code: z.string().max(100), message: z.string().max(200) }).strict()
    })
    .strict()
])
export const AvailabilityResultSchema = z
  .object({
    startDateTime: utc,
    endDateTime: utc,
    availabilityViewInterval: z.number().int().min(5).max(1440),
    schedules: z.array(ScheduleResultSchema).min(1).max(20)
  })
  .strict()
const ProviderSchema = z.object({
  value: z
    .array(
      z.object({
        scheduleId: z.email().max(254),
        availabilityView: z.string().optional(),
        error: z.object({ responseCode: z.string().min(1).max(100), message: z.string().optional() }).optional()
      })
    )
    .max(20)
})

/** Read-only Graph POST; projects only availability codes and redacted per-target errors. */
export const handleGetAvailability = async (ctx: GraphContext, args: unknown) => {
  try {
    const input = AvailabilityInputSchema.parse(args)
    const token = await ctx.ensureAuthenticated()
    const raw = await callGraphAPI<unknown>(
      ctx.graphApiEndpoint,
      token,
      'POST',
      'me/calendar/getSchedule',
      {
        schedules: input.schedules,
        startTime: { dateTime: input.startDateTime, timeZone: 'UTC' },
        endTime: { dateTime: input.endDateTime, timeZone: 'UTC' },
        availabilityViewInterval: input.availabilityViewInterval
      },
      {},
      { maxResponseBytes: 256 * 1024, redactErrorBody: true }
    )
    const response = ProviderSchema.safeParse(raw)
    if (!response.success) throw new Error('Malformed availability response')
    const targets = new Set(input.schedules.map((address) => address.toLowerCase()))
    const seen = new Set<string>()
    const maxSlots = Math.ceil(
      (Date.parse(input.endDateTime) - Date.parse(input.startDateTime)) / (input.availabilityViewInterval * 60_000)
    )
    const byTarget = new Map<string, z.infer<typeof ScheduleResultSchema>>(
      response.data.value.map((schedule) => {
        const key = schedule.scheduleId.toLowerCase()
        if (!targets.has(key) || seen.has(key)) throw new Error('Unexpected or duplicate availability target')
        seen.add(key)
        if (schedule.error)
          return [
            key,
            {
              scheduleId: schedule.scheduleId,
              status: 'error' as const,
              error: {
                code: schedule.error.responseCode,
                message: 'Provider could not return availability for this schedule'
              }
            }
          ] as const
        if (
          schedule.availabilityView === undefined ||
          schedule.availabilityView.length !== maxSlots ||
          !/^[0-3]+$/.test(schedule.availabilityView)
        )
          throw new Error('Malformed availability view')
        return [
          key,
          { scheduleId: schedule.scheduleId, status: 'available' as const, availabilityView: schedule.availabilityView }
        ] as const
      })
    )
    const payload = AvailabilityResultSchema.parse({
      startDateTime: input.startDateTime,
      endDateTime: input.endDateTime,
      availabilityViewInterval: input.availabilityViewInterval,
      schedules: input.schedules.map(
        (scheduleId) =>
          byTarget.get(scheduleId.toLowerCase()) ?? {
            scheduleId,
            status: 'error',
            error: { code: 'missing_schedule', message: 'Provider omitted this schedule' }
          }
      )
    })
    return {
      resultType: 'complete' as const,
      structuredContent: payload,
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
    }
  } catch (error) {
    return errorResult('reading calendar availability', error)
  }
}
