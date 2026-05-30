import { promises as fs } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import querystring from 'node:querystring'
import type { Mock } from 'vitest'
import { loadConfig } from '../../config/index.js'
import TokenStorage, { _resetTokenStorage, createTokenStorage, getTokenStorage, initTokenStorage } from './index.js'

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn()
  }
}))
vi.mock('https')

const mockHomeDir = '/mock/home'
process.env.HOME = mockHomeDir

const baseConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'http://localhost/callback',
  scopes: ['test_scope'],
  tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token'
}

describe('TokenStorage', () => {
  let tokenStorage: TokenStorage
  const tokenStorePath = path.join(mockHomeDir, '.mcp-m365-tokens.json')

  beforeEach(() => {
    vi.resetAllMocks()
    tokenStorage = new TokenStorage(baseConfig)
    tokenStorage.tokens = null
    tokenStorage._loadPromise = null
    tokenStorage._refreshPromise = null
  })

  describe('Constructor', () => {
    it('should initialize with default and provided config', () => {
      expect(tokenStorage.config.clientId).toBe('test-client-id')
      expect(tokenStorage.config.tokenStorePath).toBe(tokenStorePath)
      expect(tokenStorage.config.refreshTokenBuffer).toBe(5 * 60 * 1000)
    })

    it('should warn if client ID or secret is missing', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      new TokenStorage({ ...baseConfig, clientId: undefined as any })
      expect(consoleWarnSpy).toHaveBeenCalledWith('TokenStorage: MCP_M365_CLIENT_ID or MCP_M365_CLIENT_SECRET is not configured. Token refresh will fail.')
      consoleWarnSpy.mockRestore()
    })
  })

  describe('_loadTokensFromFile', () => {
    it('should load and parse tokens if file exists', async () => {
      const mockTokens = { access_token: 'loaded_token', expires_at: Date.now() + 3600000 }
      ;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(mockTokens))
      const loaded = await tokenStorage._loadTokensFromFile()
      expect(fs.readFile).toHaveBeenCalledWith(tokenStorePath, 'utf8')
      expect(loaded).toEqual(mockTokens)
      expect(tokenStorage.tokens).toEqual(mockTokens)
    })

    it('should return null and log if file does not exist (ENOENT)', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      ;(fs.readFile as Mock).mockRejectedValue({ code: 'ENOENT' })
      const loaded = await tokenStorage._loadTokensFromFile()
      expect(loaded).toBeNull()
      expect(tokenStorage.tokens).toBeNull()
      expect(consoleLogSpy).toHaveBeenCalledWith('Token file not found. No tokens loaded.')
      consoleLogSpy.mockRestore()
    })

    it('should return null and log error for other read errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      ;(fs.readFile as Mock).mockRejectedValue(new Error('Read error'))
      const loaded = await tokenStorage._loadTokensFromFile()
      expect(loaded).toBeNull()
      expect(tokenStorage.tokens).toBeNull()
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading token cache:', expect.any(Error))
      consoleErrorSpy.mockRestore()
    })
  })

  describe('_saveTokensToFile', () => {
    it('should write tokens atomically: writeFile to a temp path, then rename to final path', async () => {
      tokenStorage.tokens = { access_token: 'save_token' }
      await tokenStorage._saveTokensToFile()

      // writeFile target is a temp path with the form `<final>.tmp.<pid>.<hex>`
      const writeCall = (fs.writeFile as Mock).mock.calls[0]
      const writtenPath = writeCall[0] as string
      expect(writtenPath).toMatch(new RegExp(`^${tokenStorePath.replace(/\./g, '\\.')}\\.tmp\\.\\d+\\.[0-9a-f]+$`))
      expect(writeCall[1]).toBe(JSON.stringify(tokenStorage.tokens, null, 2))
      expect(writeCall[2]).toEqual({ mode: 0o600 })

      // rename moves the temp file to the final path
      expect(fs.rename).toHaveBeenCalledWith(writtenPath, tokenStorePath)
    })

    it('should log warning if no tokens to save', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      tokenStorage.tokens = null
      const result = await tokenStorage._saveTokensToFile()
      expect(result).toBe(false)
      expect(fs.writeFile).not.toHaveBeenCalled()
      expect(fs.rename).not.toHaveBeenCalled()
      expect(consoleWarnSpy).toHaveBeenCalledWith('No tokens to save.')
      consoleWarnSpy.mockRestore()
    })

    it('should throw error if fs.writeFile fails', async () => {
      tokenStorage.tokens = { access_token: 'test_token' }
      const writeError = new Error('Disk full')
      ;(fs.writeFile as Mock).mockRejectedValue(writeError)
      await expect(tokenStorage._saveTokensToFile()).rejects.toThrow(writeError)
    })

    it('should throw error if rename fails (and leave the temp file in place rather than corrupt the final file)', async () => {
      tokenStorage.tokens = { access_token: 'test_token' }
      const renameError = new Error('EXDEV: cross-device link')
      ;(fs.rename as Mock).mockRejectedValue(renameError)
      await expect(tokenStorage._saveTokensToFile()).rejects.toThrow(renameError)
    })
  })

  describe('getTokens', () => {
    it('should return cached tokens if available', async () => {
      tokenStorage.tokens = { access_token: 'cached_token' }
      const tokens = await tokenStorage.getTokens()
      expect(tokens).toEqual({ access_token: 'cached_token' })
      expect(fs.readFile).not.toHaveBeenCalled()
    })

    it('should load tokens from file if not cached', async () => {
      const mockFileTokens = { access_token: 'file_token' }
      ;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(mockFileTokens))
      const tokens = await tokenStorage.getTokens()
      expect(tokens).toEqual(mockFileTokens)
      expect(fs.readFile).toHaveBeenCalledTimes(1)
    })

    it('should only call _loadTokensFromFile once for concurrent calls', async () => {
      const mockFileTokens = { access_token: 'concurrent_load_token' }
      ;(fs.readFile as Mock).mockResolvedValue(JSON.stringify(mockFileTokens))

      const promise1 = tokenStorage.getTokens()
      const promise2 = tokenStorage.getTokens()

      const [tokens1, tokens2] = await Promise.all([promise1, promise2])

      expect(tokens1).toEqual(mockFileTokens)
      expect(tokens2).toEqual(mockFileTokens)
      expect(fs.readFile).toHaveBeenCalledTimes(1)
    })
  })

  describe('getExpiryTime', () => {
    it('should return expires_at if tokens exist', () => {
      const expiry = Date.now() + 1000
      tokenStorage.tokens = { expires_at: expiry }
      expect(tokenStorage.getExpiryTime()).toBe(expiry)
    })
    it('should return 0 if no tokens or expires_at', () => {
      tokenStorage.tokens = null
      expect(tokenStorage.getExpiryTime()).toBe(0)
      tokenStorage.tokens = { access_token: 'no_expiry' }
      expect(tokenStorage.getExpiryTime()).toBe(0)
    })
  })

  describe('isTokenExpired', () => {
    it('should return true if no tokens or expires_at', () => {
      tokenStorage.tokens = null
      expect(tokenStorage.isTokenExpired()).toBe(true)
      tokenStorage.tokens = { access_token: 'no_expiry_token' }
      expect(tokenStorage.isTokenExpired()).toBe(true)
    })

    it('should return true if token is past expiration time (considering buffer)', () => {
      tokenStorage.tokens = { expires_at: Date.now() - (tokenStorage.config.refreshTokenBuffer + 1000) }
      expect(tokenStorage.isTokenExpired()).toBe(true)
    })

    it('should return true if token is within buffer period', () => {
      tokenStorage.tokens = { expires_at: Date.now() + (tokenStorage.config.refreshTokenBuffer - 1000) }
      expect(tokenStorage.isTokenExpired()).toBe(true)
    })

    it('should return false if token is not expired and outside buffer', () => {
      tokenStorage.tokens = { expires_at: Date.now() + (tokenStorage.config.refreshTokenBuffer + 60000) }
      expect(tokenStorage.isTokenExpired()).toBe(false)
    })
  })

  describe('exchangeCodeForTokens', () => {
    let mockHttpsRequest: any
    const mockAuthCode = 'auth_code_123'

    beforeEach(() => {
      mockHttpsRequest = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'error') mockHttpsRequest.errorHandler = cb
          return mockHttpsRequest
        }),
        write: vi.fn(),
        end: vi.fn()
      }
      ;(https.request as unknown as Mock).mockImplementation((_url: any, _options: any, callback: any) => {
        mockHttpsRequest.callback = callback
        return mockHttpsRequest
      })
    })

    const mockSuccessfulTokenResponse = {
      access_token: 'new_access_token',
      refresh_token: 'new_refresh_token',
      expires_in: 3600,
      scope: 'test_scope',
      token_type: 'Bearer'
    }

    it('should successfully exchange code for tokens and save them', async () => {
      const saveSpy = vi.spyOn(tokenStorage, '_saveTokensToFile')

      const exchangePromise = tokenStorage.exchangeCodeForTokens(mockAuthCode)

      const mockRes = {
        statusCode: 200,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(mockSuccessfulTokenResponse)))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)

      const tokens = await exchangePromise

      expect(https.request).toHaveBeenCalledTimes(1)
      const requestArgs = (https.request as unknown as Mock).mock.calls[0]
      expect(requestArgs[0]).toBe(baseConfig.tokenEndpoint)
      expect(requestArgs[1].method).toBe('POST')

      const requestBody = querystring.parse(mockHttpsRequest.write.mock.calls[0][0])
      expect(requestBody.grant_type).toBe('authorization_code')
      expect(requestBody.code).toBe(mockAuthCode)
      expect(requestBody.client_id).toBe(baseConfig.clientId)

      expect(tokens.access_token).toBe('new_access_token')
      expect(tokenStorage.tokens?.access_token).toBe('new_access_token')
      expect(tokenStorage.tokens?.expires_at).toBeGreaterThan(Date.now())
      expect(saveSpy).toHaveBeenCalled()
    })

    it('should reject if saving exchanged token fails', async () => {
      const saveError = new Error('Disk space full')
      vi.spyOn(tokenStorage, '_saveTokensToFile').mockRejectedValueOnce(saveError)

      const exchangePromise = tokenStorage.exchangeCodeForTokens(mockAuthCode)
      const mockRes = {
        statusCode: 200,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(mockSuccessfulTokenResponse)))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)

      await expect(exchangePromise).rejects.toThrow(`Tokens exchanged but failed to save: ${saveError.message}`)
      expect(tokenStorage.tokens?.access_token).toBe(mockSuccessfulTokenResponse.access_token)
    })

    it('should reject on token exchange API error', async () => {
      const errorResponse = { error: 'invalid_grant', error_description: 'Bad auth code' }
      const exchangePromise = tokenStorage.exchangeCodeForTokens(mockAuthCode)
      const mockRes = {
        statusCode: 400,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(errorResponse)))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)

      await expect(exchangePromise).rejects.toThrow(errorResponse.error_description)
    })

    it('should reject on network error during token exchange', async () => {
      const networkError = new Error('Network fail')
      const exchangePromise = tokenStorage.exchangeCodeForTokens(mockAuthCode)

      mockHttpsRequest.errorHandler(networkError)

      await expect(exchangePromise).rejects.toThrow('Network fail')
    })

    it('should reject if client ID or secret is missing', async () => {
      tokenStorage.config.clientId = ''
      await expect(tokenStorage.exchangeCodeForTokens(mockAuthCode)).rejects.toThrow('Client ID or Client Secret is not configured. Cannot exchange code for tokens.')
    })
  })

  describe('refreshAccessToken', () => {
    let mockHttpsRequest: any

    beforeEach(() => {
      mockHttpsRequest = {
        on: vi.fn((event: string, cb: any) => {
          if (event === 'error') mockHttpsRequest.errorHandler = cb
          return mockHttpsRequest
        }),
        write: vi.fn(),
        end: vi.fn()
      }
      ;(https.request as unknown as Mock).mockImplementation((_url: any, _options: any, callback: any) => {
        mockHttpsRequest.callback = callback
        return mockHttpsRequest
      })
      tokenStorage.tokens = {
        access_token: 'old_access_token',
        refresh_token: 'valid_refresh_token',
        expires_at: Date.now() - 7200000
      }
    })

    const mockSuccessfulRefreshResponse = {
      access_token: 'refreshed_access_token',
      expires_in: 3600
    }

    it('should successfully refresh token and save', async () => {
      const saveSpy = vi.spyOn(tokenStorage, '_saveTokensToFile')
      const refreshPromise = tokenStorage.refreshAccessToken()

      const mockRes = {
        statusCode: 200,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(mockSuccessfulRefreshResponse)))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)

      const accessToken = await refreshPromise
      expect(accessToken).toBe('refreshed_access_token')
      expect(tokenStorage.tokens?.access_token).toBe('refreshed_access_token')
      expect(tokenStorage.tokens?.expires_at).toBeGreaterThan(Date.now())
      expect(saveSpy).toHaveBeenCalled()

      const requestBody = querystring.parse(mockHttpsRequest.write.mock.calls[0][0])
      expect(requestBody.grant_type).toBe('refresh_token')
      expect(requestBody.refresh_token).toBe('valid_refresh_token')
    })

    it('should reject if saving refreshed token fails', async () => {
      const saveError = new Error('Failed to save disk')
      vi.spyOn(tokenStorage, '_saveTokensToFile').mockRejectedValueOnce(saveError)

      const refreshPromise = tokenStorage.refreshAccessToken()
      const mockRes = {
        statusCode: 200,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(mockSuccessfulRefreshResponse)))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)

      await expect(refreshPromise).rejects.toThrow(`Access token refreshed but failed to save: ${saveError.message}`)
      expect(tokenStorage.tokens?.access_token).toBe(mockSuccessfulRefreshResponse.access_token)
    })

    it('should use existing refresh_token if new one is not in response', async () => {
      const refreshPromise = tokenStorage.refreshAccessToken()
      const mockRes = {
        statusCode: 200,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify({ ...mockSuccessfulRefreshResponse, refresh_token: undefined })))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)
      await refreshPromise
      expect(tokenStorage.tokens?.refresh_token).toBe('valid_refresh_token')
    })

    it('should update refresh_token if a new one is in response', async () => {
      const refreshPromise = tokenStorage.refreshAccessToken()
      const mockRes = {
        statusCode: 200,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify({ ...mockSuccessfulRefreshResponse, refresh_token: 'new_returned_refresh_token' })))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)
      await refreshPromise
      expect(tokenStorage.tokens?.refresh_token).toBe('new_returned_refresh_token')
    })

    it('should reject and clear promise on refresh API error', async () => {
      const errorResponse = { error: 'invalid_grant', error_description: 'Refresh token expired' }
      const refreshPromise = tokenStorage.refreshAccessToken()
      const mockRes = {
        statusCode: 400,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(errorResponse)))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)

      await expect(refreshPromise).rejects.toThrow(errorResponse.error_description)
      expect(tokenStorage._refreshPromise).toBeNull()
    })

    it('should throw if no refresh token is available', async () => {
      if (tokenStorage.tokens) tokenStorage.tokens.refresh_token = undefined
      await expect(tokenStorage.refreshAccessToken()).rejects.toThrow('No refresh token available to refresh the access token.')
    })

    it('should handle concurrent refresh calls by returning the same promise', async () => {
      const promise1 = tokenStorage.refreshAccessToken()
      const promise2 = tokenStorage.refreshAccessToken()

      expect(tokenStorage._refreshPromise).not.toBeNull()

      const mockRes = {
        statusCode: 200,
        on: (event: string, cb: any) => {
          if (event === 'data') cb(Buffer.from(JSON.stringify(mockSuccessfulRefreshResponse)))
          if (event === 'end') cb()
        }
      }
      mockHttpsRequest.callback(mockRes)

      const [accessToken1, accessToken2] = await Promise.all([promise1, promise2])
      expect(accessToken1).toBe('refreshed_access_token')
      expect(accessToken2).toBe('refreshed_access_token')
      expect(https.request).toHaveBeenCalledTimes(1)
      expect(tokenStorage._refreshPromise).toBeNull()
    })
  })

  describe('getValidAccessToken', () => {
    beforeEach(() => {
      vi.spyOn(tokenStorage, 'getTokens').mockImplementation(async () => tokenStorage.tokens)
    })

    it('should return existing token if valid and not near expiry', async () => {
      tokenStorage.tokens = { access_token: 'valid_token', expires_at: Date.now() + 3600000 }
      const token = await tokenStorage.getValidAccessToken()
      expect(token).toBe('valid_token')
      expect(https.request).not.toHaveBeenCalled()
    })

    it('should attempt refresh if token is expired and refresh token exists', async () => {
      tokenStorage.tokens = {
        access_token: 'expired_token',
        refresh_token: 'can_refresh',
        expires_at: Date.now() - 1000
      }
      const refreshSpy = vi.spyOn(tokenStorage, 'refreshAccessToken').mockResolvedValue('refreshed_token_from_spy')

      const token = await tokenStorage.getValidAccessToken()
      expect(refreshSpy).toHaveBeenCalled()
      expect(token).toBe('refreshed_token_from_spy')
    })

    it('should return null and clear tokens if refresh fails', async () => {
      tokenStorage.tokens = {
        access_token: 'expired_token_will_fail',
        refresh_token: 'will_fail_refresh',
        expires_at: Date.now() - 1000
      }
      vi.spyOn(tokenStorage, 'refreshAccessToken').mockRejectedValue(new Error('Refresh failed'))
      const saveSpy = vi.spyOn(tokenStorage, '_saveTokensToFile')

      const token = await tokenStorage.getValidAccessToken()
      expect(token).toBeNull()
      expect(tokenStorage.tokens).toBeNull()
      expect(saveSpy).toHaveBeenCalled()
    })

    it('should propagate error if saving nulled token fails after refresh failure', async () => {
      tokenStorage.tokens = { access_token: 'expired_token_save_fail', refresh_token: 'refresh_me', expires_at: Date.now() - 1000 }
      vi.spyOn(tokenStorage, 'refreshAccessToken').mockRejectedValue(new Error('Refresh API down'))
      const saveError = new Error('Disk write error during null save')
      vi.spyOn(tokenStorage, '_saveTokensToFile').mockRejectedValueOnce(saveError)

      await expect(tokenStorage.getValidAccessToken()).rejects.toThrow(saveError)
      expect(tokenStorage.tokens).toBeNull()
    })

    it('should return null and clear tokens if expired and no refresh token', async () => {
      tokenStorage.tokens = {
        access_token: 'expired_no_refresh',
        expires_at: Date.now() - 1000
      }
      const saveSpy = vi.spyOn(tokenStorage, '_saveTokensToFile').mockResolvedValue(true)
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const token = await tokenStorage.getValidAccessToken()
      expect(token).toBeNull()
      expect(consoleWarnSpy).toHaveBeenCalledWith('No refresh token available. Cannot refresh access token.')
      expect(tokenStorage.tokens).toBeNull()
      expect(saveSpy).toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })

    it('should propagate error if saving nulled token fails (no refresh token path)', async () => {
      tokenStorage.tokens = { access_token: 'expired_no_refresh_save_fail', expires_at: Date.now() - 1000 }
      const saveError = new Error('Disk write error during null save (no-refresh path)')
      vi.spyOn(tokenStorage, '_saveTokensToFile').mockRejectedValueOnce(saveError)

      await expect(tokenStorage.getValidAccessToken()).rejects.toThrow(saveError)
      expect(tokenStorage.tokens).toBeNull()
    })

    it('should return null if no tokens are loaded initially', async () => {
      tokenStorage.tokens = null
      ;(tokenStorage.getTokens as Mock).mockResolvedValue(null)

      const token = await tokenStorage.getValidAccessToken()
      expect(token).toBeNull()
    })
  })

  describe('clearTokens', () => {
    it('should set tokens to null and attempt to delete file', async () => {
      tokenStorage.tokens = { access_token: 'some_token' }
      ;(fs.unlink as Mock).mockResolvedValue(undefined)

      await tokenStorage.clearTokens()

      expect(tokenStorage.tokens).toBeNull()
      expect(fs.unlink).toHaveBeenCalledWith(tokenStorePath)
    })

    it('should log if token file does not exist during unlink', async () => {
      ;(fs.unlink as Mock).mockRejectedValue({ code: 'ENOENT' })
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await tokenStorage.clearTokens()

      expect(consoleLogSpy).toHaveBeenCalledWith('Token file not found, nothing to delete.')
      consoleLogSpy.mockRestore()
    })

    it('should log error for other unlink errors', async () => {
      ;(fs.unlink as Mock).mockRejectedValue(new Error('Deletion failed'))
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await tokenStorage.clearTokens()

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error deleting token file:', expect.any(Error))
      consoleErrorSpy.mockRestore()
    })
  })

  describe('config-injected factory + shared instance', () => {
    afterEach(() => {
      _resetTokenStorage()
    })

    it('createTokenStorage maps the Config auth slice onto TokenStorage config', () => {
      const cfg = loadConfig({ HOME: '/mock/home', MCP_M365_CLIENT_ID: 'cid', MCP_M365_CLIENT_SECRET: 'sec' } as NodeJS.ProcessEnv)
      const ts = createTokenStorage(cfg)
      expect(ts.config.clientId).toBe('cid')
      expect(ts.config.clientSecret).toBe('sec')
      expect(ts.config.tokenStorePath).toBe('/mock/home/.mcp-m365-tokens.json')
      expect(ts.config.scopes).toEqual(cfg.auth.scopes)
      expect(ts.config.tokenEndpoint).toBe(cfg.auth.tokenEndpoint)
    })

    it('getTokenStorage throws before initTokenStorage is called', () => {
      _resetTokenStorage()
      expect(() => getTokenStorage()).toThrow(/TokenStorage not initialised/)
    })

    it('initTokenStorage caches a shared instance returned by getTokenStorage', () => {
      const cfg = loadConfig({ HOME: '/mock/home', MCP_M365_CLIENT_ID: 'cid', MCP_M365_CLIENT_SECRET: 'sec' } as NodeJS.ProcessEnv)
      const created = initTokenStorage(cfg)
      expect(getTokenStorage()).toBe(created)
    })
  })
})
