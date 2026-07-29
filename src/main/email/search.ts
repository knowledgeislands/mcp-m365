/**
 * Improved search emails functionality
 */
import { z } from 'zod'
import { DEFAULT_LIST_SIZE, DEFAULT_PAGE_SIZE, EMAIL_SELECT_FIELDS, MAX_RESULT_COUNT } from '../../config/index.js'
import { escapeKqlValue } from '../../utils/odata-helpers.js'
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

  try {
    const accessToken = await ctx.ensureAuthenticated()

    const effectiveFolderId = folderId

    const endpoint = effectiveFolderId ? `me/mailFolders/${effectiveFolderId}/messages` : await resolveFolderPath(ctx.graphApiEndpoint, accessToken, folder)

    const response = await progressiveSearch(
      ctx.graphApiEndpoint,
      endpoint,
      accessToken,
      { query, from, to, subject },
      { hasAttachments, unreadOnly, receivedAfter, receivedBefore },
      requestedCount
    )

    // progressiveSearch always resolves to a Graph response object (or throws),
    // and always populates `_searchInfo.strategies` — so the formatter can read
    // strategies without a guard. We only annotate the resolved folder here.
    response._searchInfo = {
      ...response._searchInfo,
      folder,
      folderId: effectiveFolderId || folderId
    }

    return formatSearchResults(response)
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        isError: true as const,
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'm365_auth_start' tool first."
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

const progressiveSearch = async (
  graphApiEndpoint: string,
  endpoint: string,
  accessToken: string,
  searchTerms: any,
  filterTerms: any,
  maxCount: number
): Promise<any> => {
  const searchAttempts: string[] = []
  const searchErrors: string[] = []

  try {
    const params = buildSearchParams(searchTerms, filterTerms, Math.min(DEFAULT_PAGE_SIZE, maxCount))
    searchAttempts.push('combined-search')

    const response = await callGraphAPIPaginated(graphApiEndpoint, accessToken, 'GET', endpoint, params, maxCount)
    if (response.value && response.value.length > 0) {
      // Early-return path: populate _searchInfo.strategies so downstream
      // formatting (which reads `strategies`) is robust for a non-empty
      // combined-search result.
      response._searchInfo = {
        attemptsCount: searchAttempts.length,
        strategies: [...searchAttempts],
        errors: [...searchErrors],
        originalTerms: searchTerms,
        filterTerms
      }
      return response
    }
  } catch (error: any) {
    searchErrors.push(`combined-search: ${error.message}`)
  }

  const searchPriority = ['subject', 'from', 'to', 'query']

  for (const term of searchPriority) {
    if (searchTerms[term]) {
      try {
        searchAttempts.push(`single-term-${term}`)

        const simplifiedParams: Record<string, any> = {
          $top: Math.min(DEFAULT_PAGE_SIZE, maxCount),
          $select: EMAIL_SELECT_FIELDS
        }

        const kqlParts: string[] = []

        if (term === 'query') {
          kqlParts.push(escapeKqlValue(searchTerms[term]))
        } else {
          kqlParts.push(`${term}:"${escapeKqlValue(searchTerms[term])}"`)
        }

        addBooleanFiltersAsKQL(kqlParts, filterTerms)

        simplifiedParams.$search = `"${kqlParts.join(' ')}"`

        const response = await callGraphAPIPaginated(graphApiEndpoint, accessToken, 'GET', endpoint, simplifiedParams, maxCount)
        if (response.value && response.value.length > 0) {
          response._searchInfo = {
            attemptsCount: searchAttempts.length,
            strategies: [...searchAttempts],
            errors: [...searchErrors],
            originalTerms: searchTerms,
            filterTerms
          }
          return response
        }
      } catch (error: any) {
        searchErrors.push(`single-term-${term}: ${error.message}`)
      }
    }
  }

  if (hasStructuredFilters(filterTerms)) {
    try {
      searchAttempts.push('boolean-filters-only')

      const filterOnlyParams: Record<string, any> = {
        $top: Math.min(DEFAULT_PAGE_SIZE, maxCount),
        $select: EMAIL_SELECT_FIELDS,
        $orderby: 'receivedDateTime desc'
      }

      addBooleanFilters(filterOnlyParams, filterTerms)

      const response = await callGraphAPIPaginated(graphApiEndpoint, accessToken, 'GET', endpoint, filterOnlyParams, maxCount)
      response._searchInfo = {
        attemptsCount: searchAttempts.length,
        strategies: [...searchAttempts],
        errors: [...searchErrors],
        originalTerms: searchTerms,
        filterTerms
      }
      return response
    } catch (error: any) {
      searchErrors.push(`boolean-filters-only: ${error.message}`)
    }
  }

  searchAttempts.push('recent-emails')

  const basicParams: Record<string, any> = {
    $top: Math.min(DEFAULT_PAGE_SIZE, maxCount),
    $select: EMAIL_SELECT_FIELDS,
    $orderby: 'receivedDateTime desc'
  }

  let response: any
  try {
    response = await callGraphAPIPaginated(graphApiEndpoint, accessToken, 'GET', endpoint, basicParams, maxCount)
  } catch (error: any) {
    searchErrors.push(`recent-emails: ${error.message}`)
    throw new Error(`All search strategies failed. ${searchErrors.join(' | ')}`)
  }

  response._searchInfo = {
    attemptsCount: searchAttempts.length,
    strategies: searchAttempts,
    errors: searchErrors,
    originalTerms: searchTerms,
    filterTerms: filterTerms
  }

  return response
}

const buildSearchParams = (searchTerms: any, filterTerms: any, count: number): Record<string, any> => {
  const params: Record<string, any> = {
    $top: count,
    $select: EMAIL_SELECT_FIELDS
  }

  const kqlTerms: string[] = []

  if (searchTerms.query) {
    kqlTerms.push(escapeKqlValue(searchTerms.query))
  }

  if (searchTerms.subject) {
    kqlTerms.push(`subject:"${escapeKqlValue(searchTerms.subject)}"`)
  }

  if (searchTerms.from) {
    kqlTerms.push(`from:"${escapeKqlValue(searchTerms.from)}"`)
  }

  if (searchTerms.to) {
    kqlTerms.push(`to:"${escapeKqlValue(searchTerms.to)}"`)
  }

  if (kqlTerms.length > 0) {
    addBooleanFiltersAsKQL(kqlTerms, filterTerms)
    params.$search = `"${kqlTerms.join(' ')}"`
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

const addBooleanFiltersAsKQL = (kqlTerms: string[], filterTerms: any): void => {
  if (filterTerms.hasAttachments === true) {
    kqlTerms.push('hasAttachments:true')
  }

  if (filterTerms.unreadOnly === true) {
    kqlTerms.push('isRead:false')
  }
}

const hasStructuredFilters = (filterTerms: any): boolean => {
  return filterTerms.hasAttachments === true || filterTerms.unreadOnly === true || Boolean(filterTerms.receivedAfter) || Boolean(filterTerms.receivedBefore)
}

/**
 * Render a progressiveSearch response into the text + `structuredContent`
 * envelope. Exported for direct testing of the robustness guards (the
 * combined-search early-return path used to hand this a `_searchInfo` without a
 * `strategies` array and a non-empty result would then throw).
 */
export const formatSearchResults = (response: any): any => {
  // progressiveSearch always attaches a fully-populated `_searchInfo`; default
  // it here so the formatter is robust even if handed an externally-shaped
  // response (the combined-search early-return regression that used to throw).
  const info = response._searchInfo ?? { strategies: [], errors: [], originalTerms: {}, filterTerms: {} }
  const strategies: string[] = Array.isArray(info.strategies) ? info.strategies : []

  if (!response.value || response.value.length === 0) {
    return createSearchResponse('No emails found matching your search criteria.', {
      type: 'email-search',
      success: true,
      returnedCount: 0,
      attempts: strategies,
      errors: info.errors,
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

  // Guard the summary line so a non-empty result never throws when `strategies`
  // is absent — the latent bug on the combined-search early-return path.
  const additionalInfo = strategies.length > 0 ? `\n(Search used ${strategies[strategies.length - 1]} strategy)` : ''

  return createSearchResponse(`Found ${response.value.length} emails matching your search criteria:${additionalInfo}\n\n${emailList}`, {
    type: 'email-search',
    success: true,
    returnedCount: response.value.length,
    attempts: strategies,
    errors: info.errors,
    originalTerms: info.originalTerms,
    filters: info.filterTerms,
    items: response.value
  })
}
