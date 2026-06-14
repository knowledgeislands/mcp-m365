/**
 * Microsoft Graph API helper functions
 */
import https from 'node:https'
import { GRAPH_API_ENDPOINT } from '../../config/index.js'
import type { GraphResponse, GraphValue } from '../../types.js'
import { errMessage } from '../../utils/errors.js'

/**
 * Host-pin a full URL before we attach the Bearer token to it (SSRF defence,
 * standard §13.5). A full URL only ever reaches `callGraphAPI` via an
 * `@odata.nextLink` echoed back from a prior Graph response — but that value is
 * server-controlled output we must treat as untrusted, so we assert the scheme
 * is `https:` and the host is exactly the Graph host before sending the token.
 * A forged/tampered nextLink pointing at another origin is rejected here, so it
 * can never exfiltrate the access token.
 */
const GRAPH_HOST = new URL(GRAPH_API_ENDPOINT).hostname

export const assertGraphUrl = (url: string): void => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Refusing to call a malformed URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== GRAPH_HOST) {
    throw new Error(`Refusing to send credentials to a non-Graph URL: ${url} (expected https://${GRAPH_HOST})`)
  }
}

export const callGraphAPI = async <T = GraphResponse>(accessToken: string, method: string, path: string, data: unknown = null, queryParams: Record<string, unknown> = {}): Promise<T> => {
  let finalUrl: string
  if (path.startsWith('http://') || path.startsWith('https://')) {
    assertGraphUrl(path)
    finalUrl = path
  } else {
    const encodedPath = path
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')

    let queryString = ''
    if (Object.keys(queryParams).length > 0) {
      const filter = queryParams.$filter
      if (filter) {
        delete queryParams.$filter
      }

      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(queryParams)) {
        params.append(key, String(value))
      }

      queryString = params.toString()

      if (filter) {
        const encoded = encodeURIComponent(String(filter))
        queryString = queryString ? `${queryString}&$filter=${encoded}` : `$filter=${encoded}`
      }

      /* v8 ignore next — with at least one queryParam present, the assembled queryString is never empty here */
      if (queryString) {
        queryString = `?${queryString}`
      }
    }

    finalUrl = `${GRAPH_API_ENDPOINT}${encodedPath}${queryString}`
  }

  return new Promise<T>((resolve, reject) => {
    const options: https.RequestOptions = {
      method: method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }

    const req = https.request(finalUrl, options, (res) => {
      let responseData = ''

      res.on('data', (chunk) => {
        responseData += chunk
      })

      res.on('end', () => {
        /* v8 ignore next — Node always sets statusCode on a delivered response */
        const status = res.statusCode ?? 0
        if (status >= 200 && status < 300) {
          try {
            responseData = responseData ? responseData : '{}'
            const jsonResponse = JSON.parse(responseData) as T
            resolve(jsonResponse)
          } catch (error) {
            reject(new Error(`Error parsing API response: ${errMessage(error)}`))
          }
        } else if (status === 401) {
          reject(new Error('UNAUTHORIZED'))
        } else {
          reject(new Error(`API call failed with status ${status}: ${responseData}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(new Error(`Network error during API call: ${error.message}`))
    })

    if (data && (method === 'POST' || method === 'PATCH' || method === 'PUT')) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data))
    }

    req.end()
  })
}

export const callGraphAPIPaginated = async <T = GraphValue>(
  accessToken: string,
  method: string,
  path: string,
  queryParams: Record<string, unknown> = {},
  maxCount: number = 0
): Promise<GraphResponse<T>> => {
  if (method !== 'GET') {
    throw new Error('Pagination only supports GET requests')
  }

  const allItems: T[] = []
  let totalCount: number | null = null
  let nextLink: string | null = null
  let currentUrl = path
  let currentParams = queryParams

  do {
    const response = await callGraphAPI<GraphResponse<T>>(accessToken, method, currentUrl, null, currentParams)

    if (response.value && Array.isArray(response.value)) {
      allItems.push(...response.value)
    }

    const odataCount = response['@odata.count']
    if (typeof odataCount === 'number' && Number.isFinite(odataCount)) {
      totalCount = odataCount
    }

    if (maxCount > 0 && allItems.length >= maxCount) {
      break
    }

    nextLink = response['@odata.nextLink'] ?? null

    if (nextLink) {
      currentUrl = nextLink
      currentParams = {}
    }
  } while (nextLink)

  const finalItems = maxCount > 0 ? allItems.slice(0, maxCount) : allItems

  return {
    value: finalItems,
    '@odata.count': totalCount !== null ? totalCount : finalItems.length
  }
}

export const callGraphAPIDownload = async (accessToken: string, path: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const fullUrl = `${GRAPH_API_ENDPOINT}${path}`

    const options: https.RequestOptions = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }

    const req = https.request(fullUrl, options, (res) => {
      /* v8 ignore next — Node always sets statusCode on a delivered response */
      const status = res.statusCode ?? 0
      if (status === 302 && res.headers.location) {
        resolve(res.headers.location)
      } else if (status >= 200 && status < 300) {
        let responseData = ''
        res.on('data', (chunk) => {
          responseData += chunk
        })
        res.on('end', () => {
          try {
            const jsonResponse = JSON.parse(responseData)
            if (jsonResponse['@microsoft.graph.downloadUrl']) {
              resolve(jsonResponse['@microsoft.graph.downloadUrl'])
            } else {
              reject(new Error('No download URL found in response'))
            }
          } catch (error) {
            reject(new Error(`Error parsing download response: ${errMessage(error)}`))
          }
        })
      } else if (status === 401) {
        reject(new Error('UNAUTHORIZED'))
      } else {
        let responseData = ''
        res.on('data', (chunk) => {
          responseData += chunk
        })
        res.on('end', () => {
          reject(new Error(`Download request failed with status ${status}: ${responseData}`))
        })
      }
    })

    req.on('error', (error) => {
      reject(new Error(`Network error during download request: ${error.message}`))
    })

    req.end()
  })
}
