import { EventEmitter } from 'node:events'
import https from 'node:https'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callGraphAPI, callGraphAPIDownload, callGraphAPIPaginated } from './index.js'

vi.mock('node:https', () => ({
  default: { request: vi.fn() }
}))

// Build a fake (req, res) pair for one https.request call. The caller can
// drive the response via the returned handle.
const mockHttpsOnce = (opts: { statusCode: number; body?: string; headers?: Record<string, string>; emitNetworkError?: Error }): { reqWritten: string[] } => {
  const reqWritten: string[] = []

  const res = new EventEmitter() as EventEmitter & { statusCode: number; headers: Record<string, string> }
  res.statusCode = opts.statusCode
  res.headers = opts.headers ?? {}

  const req = new EventEmitter() as EventEmitter & { write: (data: string) => void; end: () => void }
  req.write = (data: string) => {
    reqWritten.push(data)
  }
  req.end = () => {
    if (opts.emitNetworkError) {
      // Allow caller to assert error path
      setImmediate(() => req.emit('error', opts.emitNetworkError))
      return
    }
    // Hand off to the response listener that was registered on construction
    setImmediate(() => {
      if (opts.body !== undefined) {
        res.emit('data', opts.body)
      }
      res.emit('end')
    })
  }

  ;(https.request as unknown as Mock).mockImplementationOnce((_url: string, _options: object, callback: (r: typeof res) => void) => {
    callback(res)
    return req
  })

  return { reqWritten }
}

describe('callGraphAPI', () => {
  beforeEach(() => {
    ;(https.request as unknown as Mock).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves with parsed JSON on 2xx', async () => {
    mockHttpsOnce({ statusCode: 200, body: JSON.stringify({ ok: true }) })
    await expect(callGraphAPI('tok', 'GET', 'me/messages')).resolves.toEqual({ ok: true })
  })

  it('treats an empty 2xx body as {}', async () => {
    mockHttpsOnce({ statusCode: 204, body: '' })
    await expect(callGraphAPI('tok', 'POST', 'me/messages', {})).resolves.toEqual({})
  })

  it('rejects with UNAUTHORIZED on 401', async () => {
    mockHttpsOnce({ statusCode: 401, body: '' })
    await expect(callGraphAPI('tok', 'GET', 'me/messages')).rejects.toThrow('UNAUTHORIZED')
  })

  it('rejects with status + body on other errors', async () => {
    mockHttpsOnce({ statusCode: 500, body: 'server boom' })
    await expect(callGraphAPI('tok', 'GET', 'me/messages')).rejects.toThrow(/500.*server boom/)
  })

  it('rejects with a parse error on malformed 2xx JSON', async () => {
    mockHttpsOnce({ statusCode: 200, body: 'not-json' })
    await expect(callGraphAPI('tok', 'GET', 'me/messages')).rejects.toThrow(/Error parsing API response/)
  })

  it('uses a full URL directly when path starts with https://', async () => {
    mockHttpsOnce({ statusCode: 200, body: '{}' })
    await callGraphAPI('tok', 'GET', 'https://graph.microsoft.com/v1.0/me/messages?$skip=10')
    const url = (https.request as unknown as Mock).mock.calls[0][0] as string
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/messages?$skip=10')
  })

  it('builds query string from queryParams (with $filter encoded last)', async () => {
    mockHttpsOnce({ statusCode: 200, body: '{}' })
    await callGraphAPI('tok', 'GET', 'me/messages', null, { $top: 5, $filter: 'isRead eq false' })
    const url = (https.request as unknown as Mock).mock.calls[0][0] as string
    // Standard params go through URLSearchParams (so `$` is %-encoded), but
    // $filter is appended raw with the value URI-encoded — that's the
    // contract this helper preserves.
    expect(url).toContain('%24top=5')
    expect(url).toContain('$filter=isRead%20eq%20false')
  })

  it('builds a query string from non-filter params only', async () => {
    mockHttpsOnce({ statusCode: 200, body: '{}' })
    await callGraphAPI('tok', 'GET', 'me/messages', null, { $top: 5, $orderby: 'receivedDateTime desc' })
    const url = (https.request as unknown as Mock).mock.calls[0][0] as string
    expect(url).toContain('%24top=5')
    expect(url).not.toContain('$filter')
  })

  it('builds a query string from $filter alone (no other params)', async () => {
    mockHttpsOnce({ statusCode: 200, body: '{}' })
    await callGraphAPI('tok', 'GET', 'me/messages', null, { $filter: 'isRead eq false' })
    const url = (https.request as unknown as Mock).mock.calls[0][0] as string
    expect(url).toContain('?$filter=isRead%20eq%20false')
    expect(url).not.toContain('&')
  })

  it('writes a JSON-stringified body for POST', async () => {
    const handle = mockHttpsOnce({ statusCode: 200, body: '{}' })
    await callGraphAPI('tok', 'POST', 'me/messages', { subject: 'Hi' })
    expect(handle.reqWritten).toEqual([JSON.stringify({ subject: 'Hi' })])
  })

  it('writes a raw string body unchanged for POST', async () => {
    const handle = mockHttpsOnce({ statusCode: 200, body: '{}' })
    await callGraphAPI('tok', 'POST', 'me/messages', '{"raw":true}')
    expect(handle.reqWritten).toEqual(['{"raw":true}'])
  })

  it('does not write a body for GET even when data is supplied', async () => {
    const handle = mockHttpsOnce({ statusCode: 200, body: '{}' })
    await callGraphAPI('tok', 'GET', 'me/messages', { ignored: true })
    expect(handle.reqWritten).toEqual([])
  })

  it('rejects on a network error', async () => {
    mockHttpsOnce({ statusCode: 0, emitNetworkError: new Error('connect ECONNREFUSED') })
    await expect(callGraphAPI('tok', 'GET', 'me/messages')).rejects.toThrow(/Network error.*ECONNREFUSED/)
  })
})

describe('callGraphAPIPaginated', () => {
  beforeEach(() => {
    ;(https.request as unknown as Mock).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws when method is not GET', async () => {
    await expect(callGraphAPIPaginated('tok', 'POST', 'me/messages')).rejects.toThrow(/only supports GET/)
  })

  it('returns a single page when no nextLink', async () => {
    mockHttpsOnce({ statusCode: 200, body: JSON.stringify({ value: [{ id: '1' }, { id: '2' }] }) })
    const r = await callGraphAPIPaginated<{ id: string }>('tok', 'GET', 'me/messages')
    expect((r.value ?? []).map((v) => v.id)).toEqual(['1', '2'])
    expect(r['@odata.count']).toBe(2)
  })

  it('tolerates a page that omits the value array', async () => {
    mockHttpsOnce({ statusCode: 200, body: JSON.stringify({ '@odata.context': 'x' }) })
    const r = await callGraphAPIPaginated('tok', 'GET', 'me/messages')
    expect(r.value).toEqual([])
    expect(r['@odata.count']).toBe(0)
  })

  it('follows nextLink across multiple pages', async () => {
    mockHttpsOnce({
      statusCode: 200,
      body: JSON.stringify({ value: [{ id: '1' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?$skip=1' })
    })
    mockHttpsOnce({ statusCode: 200, body: JSON.stringify({ value: [{ id: '2' }] }) })
    const r = await callGraphAPIPaginated<{ id: string }>('tok', 'GET', 'me/messages')
    expect((r.value ?? []).map((v) => v.id)).toEqual(['1', '2'])
  })

  it('truncates to maxCount when supplied', async () => {
    mockHttpsOnce({
      statusCode: 200,
      body: JSON.stringify({ value: [{ id: '1' }, { id: '2' }, { id: '3' }] })
    })
    const r = await callGraphAPIPaginated<{ id: string }>('tok', 'GET', 'me/messages', {}, 2)
    expect(r.value ?? []).toHaveLength(2)
  })

  it('preserves @odata.count from the last page that included it', async () => {
    mockHttpsOnce({
      statusCode: 200,
      body: JSON.stringify({ value: [{ id: '1' }], '@odata.count': 17, '@odata.nextLink': 'https://x/y' })
    })
    mockHttpsOnce({ statusCode: 200, body: JSON.stringify({ value: [{ id: '2' }] }) })
    const r = await callGraphAPIPaginated<{ id: string }>('tok', 'GET', 'me/messages')
    expect(r['@odata.count']).toBe(17)
  })

  it('propagates errors thrown by the underlying request', async () => {
    mockHttpsOnce({ statusCode: 500, body: 'fail' })
    await expect(callGraphAPIPaginated('tok', 'GET', 'me/messages')).rejects.toThrow(/500/)
  })
})

describe('callGraphAPIDownload', () => {
  beforeEach(() => {
    ;(https.request as unknown as Mock).mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves to the Location header on 302', async () => {
    mockHttpsOnce({ statusCode: 302, headers: { location: 'https://blob.example.com/abc' } })
    await expect(callGraphAPIDownload('tok', 'me/drive/items/X/content')).resolves.toBe('https://blob.example.com/abc')
  })

  it('resolves to @microsoft.graph.downloadUrl on 200 JSON', async () => {
    mockHttpsOnce({ statusCode: 200, body: JSON.stringify({ '@microsoft.graph.downloadUrl': 'https://blob.example.com/x' }) })
    await expect(callGraphAPIDownload('tok', 'me/drive/items/X')).resolves.toBe('https://blob.example.com/x')
  })

  it('rejects when 200 JSON has no download URL', async () => {
    mockHttpsOnce({ statusCode: 200, body: JSON.stringify({ id: 'X' }) })
    await expect(callGraphAPIDownload('tok', 'me/drive/items/X')).rejects.toThrow(/No download URL/)
  })

  it('rejects on malformed 2xx JSON', async () => {
    mockHttpsOnce({ statusCode: 200, body: 'not-json' })
    await expect(callGraphAPIDownload('tok', 'me/drive/items/X')).rejects.toThrow(/Error parsing download response/)
  })

  it('rejects with UNAUTHORIZED on 401', async () => {
    mockHttpsOnce({ statusCode: 401, body: '' })
    await expect(callGraphAPIDownload('tok', 'me/drive/items/X')).rejects.toThrow('UNAUTHORIZED')
  })

  it('rejects with status + body on other errors', async () => {
    mockHttpsOnce({ statusCode: 404, body: 'not-found' })
    await expect(callGraphAPIDownload('tok', 'me/drive/items/X')).rejects.toThrow(/404.*not-found/)
  })

  it('rejects on network error', async () => {
    mockHttpsOnce({ statusCode: 0, emitNetworkError: new Error('ETIMEDOUT') })
    await expect(callGraphAPIDownload('tok', 'me/drive/items/X')).rejects.toThrow(/Network error.*ETIMEDOUT/)
  })
})
