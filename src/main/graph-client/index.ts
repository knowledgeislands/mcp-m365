/**
 * Microsoft Graph API helper functions.
 *
 * Config injection (standard §1/§2): nothing here reads `process.env` or imports
 * a module-level Graph endpoint. Every entry point takes the Graph endpoint as
 * its FIRST argument — the value is threaded down from the loaded `Config` via
 * the {@link GraphContext} a `main/` handler receives. The SSRF host-pin is
 * derived from that injected endpoint per call.
 */
import https from 'node:https'
import type { GraphResponse, GraphValue } from '../../types.js'
import { errMessage } from '../../utils/errors.js'

/**
 * The injected slice every Graph-calling `main/` handler receives as its first
 * argument. Carries the Graph base endpoint (for URL building + the SSRF
 * host-pin) and the auth gate (a token provider bound to an injected
 * `TokenStorage`). A server entry point constructs one at boot and threads it
 * into each tool registration; handlers never reach a module global.
 */
export interface GraphContext {
  graphApiEndpoint: string
  ensureAuthenticated: (forceNew?: boolean) => Promise<string>
}

/**
 * Host-pin a full URL before we attach the Bearer token to it (SSRF defence,
 * standard §13.5). A full URL only ever reaches `callGraphAPI` via an
 * `@odata.nextLink` echoed back from a prior Graph response — but that value is
 * server-controlled output we must treat as untrusted, so we assert the scheme
 * is `https:` and the host is exactly the Graph host before sending the token.
 * A forged/tampered nextLink pointing at another origin is rejected here, so it
 * can never exfiltrate the access token. The expected host is derived from the
 * injected `graphApiEndpoint`, not a module-level constant.
 */
export const assertGraphUrl = (graphApiEndpoint: string, url: string): void => {
  const graphHost = new URL(graphApiEndpoint).hostname
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Refusing to call a malformed URL: ${url}`)
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== graphHost) {
    throw new Error(`Refusing to send credentials to a non-Graph URL: ${url} (expected https://${graphHost})`)
  }
}

export const callGraphAPI = async <T = GraphResponse>(
  graphApiEndpoint: string,
  accessToken: string,
  method: string,
  path: string,
  data: unknown = null,
  queryParams: Record<string, unknown> = {}
): Promise<T> => {
  let finalUrl: string
  if (path.startsWith('http://') || path.startsWith('https://')) {
    assertGraphUrl(graphApiEndpoint, path)
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

    finalUrl = `${graphApiEndpoint}${encodedPath}${queryString}`
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
  graphApiEndpoint: string,
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
    const response = await callGraphAPI<GraphResponse<T>>(
      graphApiEndpoint,
      accessToken,
      method,
      currentUrl,
      null,
      currentParams
    )

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

export const callGraphAPIDownload = async (
  graphApiEndpoint: string,
  accessToken: string,
  path: string
): Promise<string> => {
  return new Promise((resolve, reject) => {
    let fullUrl: string
    if (path.startsWith('http://') || path.startsWith('https://')) {
      try {
        assertGraphUrl(graphApiEndpoint, path)
      } catch (e) {
        reject(e)
        return
      }
      fullUrl = path
    } else {
      fullUrl = `${graphApiEndpoint}${path}`
    }

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
