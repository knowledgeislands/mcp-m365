/**
 * Improved search emails functionality
 */
import config from '../../config.js'
import { callGraphAPIPaginated } from '../../utils/graph-api.js'
import { ensureAuthenticated } from '../auth/index.js'
import { resolveFolderPath } from './folder-utils.js'

export const handleSearchEmails = async (args: any): Promise<any> => {
  const folder = args.folder || 'inbox'
  const folderId = args.folderId || ''
  const requestedCount = Math.max(1, Math.min(args.count || config.DEFAULT_LIST_SIZE, config.MAX_RESULT_COUNT))
  const query = args.query || ''
  const from = args.from || ''
  const to = args.to || ''
  const subject = args.subject || ''
  const hasAttachments = args.hasAttachments
  const unreadOnly = args.unreadOnly
  const receivedAfter = normalizeDateFilterValue(args.receivedAfter)
  const receivedBefore = normalizeDateFilterValue(args.receivedBefore)
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
    const accessToken = await ensureAuthenticated()

    const effectiveFolderId = folderId

    const endpoint = effectiveFolderId ? `me/mailFolders/${effectiveFolderId}/messages` : await resolveFolderPath(accessToken, folder)
    console.error(`Using endpoint: ${endpoint} for folder: ${effectiveFolderId ? `folderId:${effectiveFolderId}` : folder}`)

    const response = await progressiveSearch(endpoint, accessToken, { query, from, to, subject }, { hasAttachments, unreadOnly, receivedAfter, receivedBefore }, requestedCount)

    if (response && typeof response === 'object') {
      response._searchInfo = {
        ...(response._searchInfo || {}),
        folder,
        folderId: effectiveFolderId || folderId
      }
    }

    return formatSearchResults(response)
  } catch (error: any) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'authenticate' tool first."
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

    return createSearchResponse(`Error searching emails: ${formatSearchError(error, searchContext)}`, {
      type: 'email-search',
      success: false,
      error: error.message || 'Unknown error',
      context: searchContext
    })
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

const progressiveSearch = async (endpoint: string, accessToken: string, searchTerms: any, filterTerms: any, maxCount: number): Promise<any> => {
  const searchAttempts: string[] = []
  const searchErrors: string[] = []

  try {
    const params = buildSearchParams(searchTerms, filterTerms, Math.min(config.DEFAULT_PAGE_SIZE, maxCount))
    console.error('Attempting combined search with params:', params)
    searchAttempts.push('combined-search')

    const response = await callGraphAPIPaginated(accessToken, 'GET', endpoint, params, maxCount)
    if (response.value && response.value.length > 0) {
      console.error(`Combined search successful: found ${response.value.length} results`)
      return response
    }
  } catch (error: any) {
    console.error(`Combined search failed: ${error.message}`)
    searchErrors.push(`combined-search: ${error.message}`)
  }

  const searchPriority = ['subject', 'from', 'to', 'query']

  for (const term of searchPriority) {
    if (searchTerms[term]) {
      try {
        console.error(`Attempting search with only ${term}: "${searchTerms[term]}"`)
        searchAttempts.push(`single-term-${term}`)

        const simplifiedParams: Record<string, any> = {
          $top: Math.min(config.DEFAULT_PAGE_SIZE, maxCount),
          $select: config.EMAIL_SELECT_FIELDS
        }

        const kqlParts: string[] = []

        if (term === 'query') {
          kqlParts.push(searchTerms[term])
        } else {
          kqlParts.push(`${term}:${searchTerms[term]}`)
        }

        addBooleanFiltersAsKQL(kqlParts, filterTerms)

        simplifiedParams.$search = `"${kqlParts.join(' ')}"`

        const response = await callGraphAPIPaginated(accessToken, 'GET', endpoint, simplifiedParams, maxCount)
        if (response.value && response.value.length > 0) {
          console.error(`Search with ${term} successful: found ${response.value.length} results`)
          return response
        }
      } catch (error: any) {
        console.error(`Search with ${term} failed: ${error.message}`)
        searchErrors.push(`single-term-${term}: ${error.message}`)
      }
    }
  }

  if (hasStructuredFilters(filterTerms)) {
    try {
      console.error('Attempting search with only boolean filters')
      searchAttempts.push('boolean-filters-only')

      const filterOnlyParams: Record<string, any> = {
        $top: Math.min(config.DEFAULT_PAGE_SIZE, maxCount),
        $select: config.EMAIL_SELECT_FIELDS,
        $orderby: 'receivedDateTime desc'
      }

      addBooleanFilters(filterOnlyParams, filterTerms)

      const response = await callGraphAPIPaginated(accessToken, 'GET', endpoint, filterOnlyParams, maxCount)
      console.error(`Boolean filter search found ${response.value?.length || 0} results`)
      return response
    } catch (error: any) {
      console.error(`Boolean filter search failed: ${error.message}`)
      searchErrors.push(`boolean-filters-only: ${error.message}`)
    }
  }

  console.error('All search strategies failed, falling back to recent emails')
  searchAttempts.push('recent-emails')

  const basicParams: Record<string, any> = {
    $top: Math.min(config.DEFAULT_PAGE_SIZE, maxCount),
    $select: config.EMAIL_SELECT_FIELDS,
    $orderby: 'receivedDateTime desc'
  }

  let response: any
  try {
    response = await callGraphAPIPaginated(accessToken, 'GET', endpoint, basicParams, maxCount)
    console.error(`Fallback to recent emails found ${response.value?.length || 0} results`)
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
    $select: config.EMAIL_SELECT_FIELDS
  }

  const kqlTerms: string[] = []

  if (searchTerms.query) {
    kqlTerms.push(searchTerms.query)
  }

  if (searchTerms.subject) {
    kqlTerms.push(`subject:"${searchTerms.subject}"`)
  }

  if (searchTerms.from) {
    kqlTerms.push(`from:"${searchTerms.from}"`)
  }

  if (searchTerms.to) {
    kqlTerms.push(`to:"${searchTerms.to}"`)
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

const formatSearchResults = (response: any): any => {
  if (!response.value || response.value.length === 0) {
    return createSearchResponse('No emails found matching your search criteria.', {
      type: 'email-search',
      success: true,
      returnedCount: 0,
      attempts: response._searchInfo?.strategies || [],
      errors: response._searchInfo?.errors || [],
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

  let additionalInfo = ''
  if (response._searchInfo) {
    additionalInfo = `\n(Search used ${response._searchInfo.strategies[response._searchInfo.strategies.length - 1]} strategy)`
  }

  return createSearchResponse(`Found ${response.value.length} emails matching your search criteria:${additionalInfo}\n\n${emailList}`, {
    type: 'email-search',
    success: true,
    returnedCount: response.value.length,
    attempts: response._searchInfo?.strategies || [],
    errors: response._searchInfo?.errors || [],
    originalTerms: response._searchInfo?.originalTerms || {},
    filters: response._searchInfo?.filterTerms || {},
    items: response.value
  })
}

export default handleSearchEmails
