/**
 * Microsoft Graph API helper functions
 */
import https from 'node:https'
import config from '../config.js'
import type { GraphResponse, GraphValue } from '../types.js'
import { errMessage } from './errors.js'

export const callGraphAPI = async <T = GraphResponse>(accessToken: string, method: string, path: string, data: unknown = null, queryParams: Record<string, unknown> = {}): Promise<T> => {
  try {
    console.error(`Making real API call: ${method} ${path}`)

    let finalUrl: string
    if (path.startsWith('http://') || path.startsWith('https://')) {
      finalUrl = path
      console.error(`Using full URL from nextLink: ${finalUrl}`)
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

        if (queryString) {
          queryString = `?${queryString}`
        }

        console.error(`Query string: ${queryString}`)
      }

      finalUrl = `${config.GRAPH_API_ENDPOINT}${encodedPath}${queryString}`
      console.error(`Full URL: ${finalUrl}`)
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
  } catch (error) {
    console.error('Error calling Graph API:', error)
    throw error
  }
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

  try {
    do {
      const response = await callGraphAPI<GraphResponse<T>>(accessToken, method, currentUrl, null, currentParams)

      if (response.value && Array.isArray(response.value)) {
        allItems.push(...response.value)
        console.error(`Pagination: Retrieved ${response.value.length} items, total so far: ${allItems.length}`)
      }

      const odataCount = response['@odata.count']
      if (typeof odataCount === 'number' && Number.isFinite(odataCount)) {
        totalCount = odataCount
      }

      if (maxCount > 0 && allItems.length >= maxCount) {
        console.error(`Pagination: Reached max count of ${maxCount}, stopping`)
        break
      }

      nextLink = response['@odata.nextLink'] ?? null

      if (nextLink) {
        currentUrl = nextLink
        currentParams = {}
        console.error(`Pagination: Following nextLink, ${allItems.length} items so far`)
      }
    } while (nextLink)

    const finalItems = maxCount > 0 ? allItems.slice(0, maxCount) : allItems

    console.error(`Pagination complete: Retrieved ${finalItems.length} total items`)

    return {
      value: finalItems,
      '@odata.count': totalCount !== null ? totalCount : finalItems.length
    }
  } catch (error) {
    console.error('Error during pagination:', error)
    throw error
  }
}

export const callGraphAPIDownload = async (accessToken: string, path: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const fullUrl = `${config.GRAPH_API_ENDPOINT}${path}`
    console.error(`Making download request: GET ${fullUrl}`)

    const options: https.RequestOptions = {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }

    const req = https.request(fullUrl, options, (res) => {
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
