import { EventEmitter } from 'node:events'
import https from 'node:https'
import type { INetworkModule } from '@azure/msal-node'
import TokenStorage from './index.js'
import { acquireLegacyTokens, assertTokenDestination, tokenNetwork } from './msal.js'

const cfg = new TokenStorage({
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
  redirectUri: 'http://localhost/callback',
  scopes: ['Mail.Read', 'offline_access'],
  tokenEndpoint: 'https://custom.example/odd/token'
}).config

describe('real pinned MSAL public transport feasibility', () => {
  it.each(['refresh', 'code'])(
    'validates %s through public APIs without discovery, preserving rotation and configured destination/scopes',
    async (grant) => {
      const sendPostRequestAsync = vi.fn().mockResolvedValue({
        status: 200,
        headers: {},
        body: {
          access_token: 'fixture-access',
          refresh_token: 'fixture-rotation',
          expires_in: 3600,
          scope: 'Mail.Read',
          token_type: 'Bearer'
        }
      })
      const network: INetworkModule = {
        sendGetRequestAsync: vi.fn().mockRejectedValue(new Error('unexpected discovery')),
        sendPostRequestAsync
      }
      const request =
        grant === 'refresh'
          ? { refreshToken: 'legacy-fixture' }
          : { code: 'code-fixture', codeVerifier: 'verifier-fixture' }
      const tokens = await acquireLegacyTokens(cfg, request, network)
      expect(tokens.refresh_token).toBe('fixture-rotation')
      expect(tokens.access_token).toBe('fixture-access')
      expect(tokens.expires_at).toBeGreaterThan(Date.now())
      expect(network.sendGetRequestAsync).not.toHaveBeenCalled()
      expect(sendPostRequestAsync).toHaveBeenCalledTimes(1)
      const [endpoint, options] = sendPostRequestAsync.mock.calls[0] as [string, { body: string }]
      expect(endpoint).toBe(cfg.tokenEndpoint)
      const form = new URLSearchParams(options.body)
      expect(form.get('scope')).toBe(cfg.scopes.join(' '))
      expect(form.get('grant_type')).toBe(grant === 'refresh' ? 'refresh_token' : 'authorization_code')
      expect(form.get('code_verifier')).toBe(grant === 'code' ? 'verifier-fixture' : null)
    }
  )
})

afterEach(() => vi.restoreAllMocks())

it.each([
  'http://custom.example/token',
  'https://user:secret@custom.example/token',
  'https://custom.example/token#fragment'
])('rejects unsafe endpoint %s before transport', async (tokenEndpoint) => {
  await expect(acquireLegacyTokens({ ...cfg, tokenEndpoint }, { refreshToken: 'fixture' })).rejects.toThrow(
    'Invalid OAuth token endpoint'
  )
})
it('pins full destination, preserving configured query and permitting only MSAL correlation metadata', () => {
  const endpoint = new URL('https://custom.example/exact/token?configured=yes&client-request-id=existing')
  assertTokenDestination('https://custom.example/exact/token?configured=yes&client-request-id=generated', endpoint)
  expect(() => assertTokenDestination('https://evil.example/exact/token?configured=yes', endpoint)).toThrow(
    'Unexpected OAuth destination'
  )
  expect(() => assertTokenDestination('https://custom.example/other/token?configured=yes', endpoint)).toThrow()
  expect(() =>
    assertTokenDestination('https://custom.example/exact/token?configured=yes&extra=yes', endpoint)
  ).toThrow()
})
it.each([
  { access_token: 'fixture-access', expires_in: 0 },
  { access_token: 'fixture-access', expires_in: 'bad' },
  { expires_in: 3600 },
  { access_token: 'fixture-access', expires_in: 3600, id_token: 'not-a-valid-id-token' }
])('requires real MSAL validation and usable token/expiry before returning raw fields', async (body) => {
  const network: INetworkModule = {
    sendGetRequestAsync: vi.fn(),
    sendPostRequestAsync: vi.fn().mockResolvedValue({ status: 200, headers: {}, body })
  }
  await expect(acquireLegacyTokens(cfg, { code: 'fixture-code' }, network)).rejects.toThrow(
    'OAuth token acquisition failed'
  )
})
it('preserves omission and string expiry from provider; rejects errors without retry or leaking raw text', async () => {
  const post = vi
    .fn()
    .mockResolvedValueOnce({ status: 200, headers: {}, body: { access_token: 'fixture-access', expires_in: '3600' } })
    .mockResolvedValueOnce({
      status: 500,
      headers: {},
      body: { error: 'server_error', error_description: 'fixture-secret' }
    })
  const network: INetworkModule = { sendGetRequestAsync: vi.fn(), sendPostRequestAsync: post }
  const result = await acquireLegacyTokens(cfg, { refreshToken: 'fixture-legacy' }, network)
  expect(result.refresh_token).toBeUndefined()
  expect(result.expires_at).toBeGreaterThan(Date.now())
  await expect(acquireLegacyTokens(cfg, { refreshToken: 'fixture-legacy' }, network)).rejects.toThrow(
    'OAuth token acquisition failed'
  )
  expect(post).toHaveBeenCalledTimes(2)
})

function mockHttp() {
  const response = Object.assign(new EventEmitter(), { statusCode: 200 as number | undefined })
  const request = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn((error: Error) => {
      request.emit('error', error)
    })
  })
  vi.spyOn(https, 'request').mockImplementation((_endpoint: unknown, _options: unknown, callback: unknown) => {
    queueMicrotask(() => (callback as (value: unknown) => void)(response))
    return request as never
  })
  return { request, response }
}
it('uses bounded HTTPS POST transport and rejects discovery', async () => {
  const { request, response } = mockHttp()
  const result = tokenNetwork.sendPostRequestAsync('https://custom.example/token', {
    headers: { test: 'value' },
    body: 'fixture=data'
  })
  await Promise.resolve()
  response.emit('data', Buffer.from('{"fixture":true}'))
  response.emit('end')
  expect(await result).toEqual({ status: 200, headers: {}, body: { fixture: true } })
  expect(request.end).toHaveBeenCalledWith('fixture=data')
  expect(vi.mocked(https.request).mock.calls[0]?.[1]).toMatchObject({ signal: expect.any(AbortSignal) })
  await expect(tokenNetwork.sendGetRequestAsync('https://custom.example/discovery')).rejects.toThrow(
    'discovery is disabled'
  )
})
it.each(['json', 'status', 'size', 'request-error', 'response-error'])(
  'handles transport %s without exposing provider bytes',
  async (kind) => {
    const { request, response } = mockHttp()
    const promise = tokenNetwork.sendPostRequestAsync('https://custom.example/token')
    await Promise.resolve()
    if (kind === 'json') {
      response.emit('data', Buffer.from('fixture-secret'))
      response.emit('end')
    }
    if (kind === 'status') {
      response.statusCode = undefined
      response.emit('data', Buffer.from('{}'))
      response.emit('end')
      expect((await promise).status).toBe(0)
      return
    }
    if (kind === 'size') response.emit('data', Buffer.from('x'.repeat(1024 * 1024 + 1)))
    if (kind === 'request-error') request.emit('error', new Error('fixture-secret'))
    if (kind === 'response-error') response.emit('error', new Error('fixture-secret'))
    const error = await promise.catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).not.toContain('fixture-secret')
  }
)
it('default adapter uses the HTTPS transport with the real library', async () => {
  const { response } = mockHttp()
  const result = acquireLegacyTokens(cfg, { code: 'fixture-code' })
  // MSAL authority initialization is asynchronous; wait for the actual HTTPS call.
  await vi.waitFor(() => expect(https.request).toHaveBeenCalled())
  response.emit('data', Buffer.from(JSON.stringify({ access_token: 'fixture-access', expires_in: 3600 })))
  response.emit('end')
  expect((await result).access_token).toBe('fixture-access')
})
