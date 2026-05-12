/**
 * List events functionality
 */
import config from '../../config.js'
import { callGraphAPI } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'

export const handleListEvents = async (args: any): Promise<any> => {
  const count = Math.min(args.count || 10, config.MAX_RESULT_COUNT)

  try {
    const accessToken = await ensureAuthenticated()

    const startDate = args.startDateTime ? new Date(args.startDateTime) : new Date()
    const endDate = args.endDateTime ? new Date(args.endDateTime) : new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000)

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
      return {
        content: [
          {
            type: 'text',
            text: 'Invalid date range. Provide valid startDateTime/endDateTime with endDateTime > startDateTime.'
          }
        ]
      }
    }

    const endpoint = 'me/calendarView'

    const queryParams = {
      startDateTime: startDate.toISOString(),
      endDateTime: endDate.toISOString(),
      $top: count,
      $orderby: 'start/dateTime',
      $select: config.CALENDAR_SELECT_FIELDS
    }

    const response = await callGraphAPI(accessToken, 'GET', endpoint, null, queryParams)

    if (!response.value || response.value.length === 0) {
      return {
        content: [{ type: 'text', text: 'No calendar events found.' }]
      }
    }

    const eventList = response.value
      .map((event: any, index: number) => {
        const formatDateTime = (dateTimeData: any): string => {
          if (!dateTimeData) return ''
          const dateTime = typeof dateTimeData === 'string' ? dateTimeData : dateTimeData.dateTime || ''
          const timeZone = typeof dateTimeData === 'object' ? dateTimeData.timeZone : undefined
          if (!dateTime) return ''

          const hasOffset = /[zZ]$|[+-]\d{2}:\d{2}$/.test(dateTime)

          const formatDateObj = (date: Date): string => {
            if (Number.isNaN(date.getTime())) return dateTime
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
            const options: Intl.DateTimeFormatOptions = {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }
            if (tz) options.timeZone = tz
            return date.toLocaleString('en-US', options)
          }

          if (timeZone === 'UTC' || hasOffset || !timeZone) {
            const iso = dateTime.endsWith('Z') || hasOffset ? dateTime : `${dateTime}Z`
            const date = new Date(iso)
            return formatDateObj(date)
          }

          return `${dateTime} (${timeZone})`
        }

        const startDateStr = formatDateTime(event.start)
        const endDateStr = formatDateTime(event.end)
        const location = event.location?.displayName || 'No location'

        return `${index + 1}. ${event.subject} - Location: ${location}\nStart: ${startDateStr}\nEnd: ${endDateStr}\nSummary: ${event.bodyPreview}\nID: ${event.id}\n`
      })
      .join('\n')

    return {
      content: [{ type: 'text', text: `Found ${response.value.length} events:\n\n${eventList}` }]
    }
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [{ type: 'text', text: "Authentication required. Please use the 'authenticate' tool first." }]
      }
    }

    return {
      content: [{ type: 'text', text: `Error listing events: ${error.message}` }]
    }
  }
}

export default handleListEvents
