/**
 * Improved search emails functionality
 */
import { z } from 'zod'
import { DEFAULT_LIST_SIZE, DEFAULT_PAGE_SIZE, EMAIL_SELECT_FIELDS, MAX_RESULT_COUNT } from '../../config/index.js'
import { AUTH_REQUIRED_MESSAGE } from '../../utils/errors.js'
import { kqlFreeTextClause, kqlPropertyClause, messageSearchQuery } from '../../utils/kql.js'
import { errorText } from '../../utils/results.js'
import { callGraphAPIPaginated, type GraphContext } from '../graph-client/index.js'
import { resolveFolderPath } from './folder-utils.js'

/**
 * Shape of the `structuredContent` returned by `handleSearchEmails`, and (via
 * the same schema) the `outputSchema` declared by the `m365_email_messages_search`
 * tool — so the declared schema and the emitted object cannot drift. `.loose()`
 * keeps the raw Graph `items` and any future field permissive.
 */
export const emailSearchResultSchema = z
  .object({
    type: z.literal('email-search'),
    success: z.boolean(),
    returnedCount: z.number().optional(),
    attempts: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
    search: z.string().optional(),
    originalTerms: z.record(z.string(), z.any()).optional(),
    filters: z.record(z.string(), z.any()).optional(),
    items: z.array(z.any()).optional()
  })
  .loose()

export type EmailSearchResult = z.infer<typeof emailSearchResultSchema>

export const handleSearchEmails = async (ctx: GraphContext, args: any): Promise<any> => {
  const folder = args.folder || 'inbox'
  const folderId = args.folderId || ''
  const requestedCount = Math.max(1, Math.min(args.count || DEFAULT_LIST_SIZE, MAX_RESULT_COUNT))
  const query = args.query || ''
  const from = args.from || ''
  const to = args.to || ''
  const subject = args.subject || ''
  const hasAttachments = args.hasAttachments
  const unreadOnly = args.unreadOnly
  let receivedAfter: string
  let receivedBefore: string
  try {
    receivedAfter = normalizeDateFilterValue(args.receivedAfter)
    receivedBefore = normalizeDateFilterValue(args.receivedBefore)
  } catch (error: any) {
    return errorText(`Error searching emails: ${error.message}`)
  }
  const searchContext = {
    folder,
    folderId,
    count: requestedCount,
    query,
    from,
    to,
    subject,
    hasAttachments,
    unreadOnly,
    receivedAfter,
    receivedBefore
  }
  const searchTerms = { query, from, to, subject }
  const filterTerms = { hasAttachments, unreadOnly, receivedAfter, receivedBefore }
  let params: Record<string, any>
  try {
    params = buildSearchParams(searchTerms, filterTerms, Math.min(DEFAULT_PAGE_SIZE, requestedCount))
  } catch (error: any) {
    return errorText(`Error searching emails: ${error.message}`)
  }

  try {
    const accessToken = await ctx.ensureAuthenticated()

    const endpoint = folderId
      ? `me/mailFolders/${folderId}/messages`
      : await resolveFolderPath(ctx.graphApiEndpoint, accessToken, folder)

    const response = await runSearch(
      ctx.graphApiEndpoint,
      endpoint,
      accessToken,
      params,
      searchTerms,
      filterTerms,
      requestedCount
    )
    response._searchInfo = { ...response._searchInfo, folder, folderId }

    return formatSearchResults(response)
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        isError: true as const,
        content: [
          {
            type: 'text',
            text: AUTH_REQUIRED_MESSAGE
          }
        ],
        structuredContent: {
          type: 'email-search',
          success: false,
          error: 'Authentication required',
          context: searchContext
        }
      }
    }

    return {
      isError: true as const,
      content: [{ type: 'text', text: `Error searching emails: ${formatSearchError(error, searchContext)}` }],
      structuredContent: {
        type: 'email-search',
        success: false,
        error: error.message || 'Unknown error',
        context: searchContext
      }
    }
  }
}

const createSearchResponse = (text: string, structuredContent: any): any => {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

const formatSearchError = (error: any, context: any): string => {
  const lines = [error.message || 'Unknown error']
  const statusMatch = /API call failed with status\s+(\d+)/i.exec(error.message || '')

  if (statusMatch) {
    lines.push(`Source: Microsoft Graph API (${statusMatch[1]}).`)
  } else {
    lines.push('Source: MCP/server-side validation or processing.')
  }

  lines.push(`Context: ${JSON.stringify(context)}`)
  return lines.join('\n')
}

const normalizeDateFilterValue = (value: any): string => {
  if (!value) return ''

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value "${value}". Use ISO 8601 format, e.g. 2024-01-01T00:00:00Z`)
  }

  return value
}

/**
 * Run one search carrying every term the caller gave. Graph cannot combine
 * `$search` with `$filter`, so when there is a text term the boolean and date
 * filters join the KQL as clauses; with no text term they become a `$filter`
 * ordered by date. Nothing relaxes the terms afterwards: a query Graph rejects
 * is an error and no match is an empty result, so every message returned
 * satisfies every term asked for.
 */
const runSearch = async (
  graphApiEndpoint: string,
  endpoint: string,
  accessToken: string,
  params: Record<string, any>,
  searchTerms: any,
  filterTerms: any,
  maxCount: number
): Promise<any> => {
  const response = await callGraphAPIPaginated(graphApiEndpoint, accessToken, 'GET', endpoint, params, maxCount)
  response._searchInfo = {
    attemptsCount: 1,
    strategies: [params.$search ? 'search' : 'filter'],
    errors: [],
    originalTerms: searchTerms,
    filterTerms,
    ...(params.$search ? { search: params.$search } : {})
  }
  return response
}

/** Text terms and the KQL property each restricts. `query` is caller-written KQL. */
const PROPERTY_TERMS = [
  ['subject', 'subject'],
  ['from', 'from'],
  ['to', 'to']
] as const

/**
 * The Graph parameters for a search. Throws when a supplied term has nothing
 * left to search on once cleaned, rather than quietly searching without it.
 */
export const buildSearchParams = (searchTerms: any, filterTerms: any, count: number): Record<string, any> => {
  const params: Record<string, any> = {
    $top: count,
    $select: EMAIL_SELECT_FIELDS
  }

  const kqlTerms: string[] = []
  const unsearchable = (term: string): Error =>
    new Error(
      `The ${term} term has nothing searchable once quotes and control characters are removed; refusing to search without it.`
    )

  if (searchTerms.query?.trim()) {
    const clause = kqlFreeTextClause(searchTerms.query)
    if (!clause) throw unsearchable('query')
    kqlTerms.push(clause)
  }

  for (const [term, property] of PROPERTY_TERMS) {
    if (!searchTerms[term]?.trim()) continue
    const clause = kqlPropertyClause(property, searchTerms[term])
    if (!clause) throw unsearchable(term)
    kqlTerms.push(clause)
  }

  if (kqlTerms.length > 0) {
    addFiltersAsKQL(kqlTerms, filterTerms)
    params.$search = messageSearchQuery(kqlTerms)
  } else {
    params.$orderby = 'receivedDateTime desc'
    addBooleanFilters(params, filterTerms)
  }

  return params
}

const addBooleanFilters = (params: Record<string, any>, filterTerms: any): void => {
  const filterConditions: string[] = []

  if (filterTerms.hasAttachments === true) {
    filterConditions.push('hasAttachments eq true')
  }

  if (filterTerms.unreadOnly === true) {
    filterConditions.push('isRead eq false')
  }

  if (filterTerms.receivedAfter) {
    filterConditions.push(`receivedDateTime ge ${filterTerms.receivedAfter}`)
  }

  if (filterTerms.receivedBefore) {
    filterConditions.push(`receivedDateTime le ${filterTerms.receivedBefore}`)
  }

  if (filterConditions.length > 0) {
    params.$filter = filterConditions.join(' and ')
  }
}

/** The filters as KQL clauses; `received` takes a full ISO 8601 timestamp. */
const addFiltersAsKQL = (kqlTerms: string[], filterTerms: any): void => {
  if (filterTerms.hasAttachments === true) {
    kqlTerms.push('hasAttachments:true')
  }

  if (filterTerms.unreadOnly === true) {
    kqlTerms.push('isRead:false')
  }

  if (filterTerms.receivedAfter) {
    kqlTerms.push(`received>=${kqlTimestamp(filterTerms.receivedAfter)}`)
  }

  if (filterTerms.receivedBefore) {
    kqlTerms.push(`received<=${kqlTimestamp(filterTerms.receivedBefore)}`)
  }
}

/** A validated date as a UTC timestamp without milliseconds, so it holds no space or comma KQL would split on. */
const kqlTimestamp = (value: string): string => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')

/**
 * Render a search response into the text + `structuredContent` envelope.
 * Exported for direct testing of the robustness guards: an externally shaped
 * response without `_searchInfo` or its `strategies` array must not throw.
 */
export const formatSearchResults = (response: any): any => {
  const info = response._searchInfo ?? { strategies: [], errors: [], originalTerms: {}, filterTerms: {} }
  const strategies: string[] = Array.isArray(info.strategies) ? info.strategies : []

  // Name the exact Graph search sent, so a caller can see every term it carried.
  const searched = typeof info.search === 'string' ? { search: info.search } : {}
  const additionalInfo = searched.search ? `\n(Graph search: ${searched.search})` : ''

  if (!response.value || response.value.length === 0) {
    return createSearchResponse(`No emails found matching your search criteria.${additionalInfo}`, {
      type: 'email-search',
      success: true,
      returnedCount: 0,
      attempts: strategies,
      errors: info.errors,
      ...searched,
      items: []
    })
  }

  const emailList = response.value
    .map((email: any, index: number) => {
      const sender = email.from?.emailAddress || { name: 'Unknown', address: 'unknown' }
      const date = new Date(email.receivedDateTime).toLocaleString()
      const readStatus = email.isRead ? '' : '[UNREAD] '

      return `${index + 1}. ${readStatus}${date} - From: ${sender.name} (${sender.address})\nSubject: ${email.subject}\nID: ${email.id}\n`
    })
    .join('\n')

  return createSearchResponse(
    `Found ${response.value.length} emails matching your search criteria:${additionalInfo}\n\n${emailList}`,
    {
      type: 'email-search',
      success: true,
      returnedCount: response.value.length,
      attempts: strategies,
      errors: info.errors,
      ...searched,
      originalTerms: info.originalTerms,
      filters: info.filterTerms,
      items: response.value
    }
  )
}
