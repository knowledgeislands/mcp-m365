import { describe, expect, it } from 'vitest'
import { errCode, errMessage } from './errors.js'

describe('errMessage', () => {
  it('returns message from Error instances', () => {
    expect(errMessage(new Error('boom'))).toBe('boom')
  })

  it('passes string errors through unchanged', () => {
    expect(errMessage('string error')).toBe('string error')
  })

  it('coerces non-Error, non-string values via String()', () => {
    expect(errMessage(42)).toBe('42')
    expect(errMessage(null)).toBe('null')
    expect(errMessage({ toString: () => 'custom' })).toBe('custom')
  })

  it('formats Graph-style "HTTP <status>: <apiMsg>" when both are present', () => {
    const err = { response: { status: 404, data: { error: { message: 'Not found' } } } }
    expect(errMessage(err)).toBe('HTTP 404: Not found')
  })

  it('falls back to HTTP <status>: <e.message> when apiMsg is missing', () => {
    const err = { statusCode: 500, message: 'Internal' }
    expect(errMessage(err)).toBe('HTTP 500: Internal')
  })

  it('returns apiMsg alone when status is missing', () => {
    const err = { response: { data: { error: { message: 'Just a message' } } } }
    expect(errMessage(err)).toBe('Just a message')
  })

  it('returns e.message alone when both status and apiMsg are missing', () => {
    expect(errMessage({ message: 'bare message' })).toBe('bare message')
  })

  it('extracts numeric status from a string code field', () => {
    const err = { code: '503', message: 'Unavailable' }
    expect(errMessage(err)).toBe('HTTP 503: Unavailable')
  })

  it('appends auth hint on 401 status', () => {
    const err = { response: { status: 401, data: { error: { message: 'token expired' } } } }
    expect(errMessage(err)).toContain('m365_auth_start')
  })

  it('appends auth hint when message hints at unauthorized', () => {
    expect(errMessage(new Error('InvalidAuthenticationToken'))).toContain('m365_auth_start')
  })

  it('does not append auth hint on non-auth failures', () => {
    expect(errMessage(new Error('rate limited'))).toBe('rate limited')
  })
})

describe('errCode', () => {
  it('returns the code from a NodeJS-style error object', () => {
    const err = Object.assign(new Error('x'), { code: 'ENOENT' })
    expect(errCode(err)).toBe('ENOENT')
  })

  it('returns the code from a plain object with a string code', () => {
    expect(errCode({ code: 'EACCES' })).toBe('EACCES')
  })

  it('returns undefined for non-string code values', () => {
    expect(errCode({ code: 42 })).toBeUndefined()
  })

  it('returns undefined when there is no code', () => {
    expect(errCode(new Error('x'))).toBeUndefined()
    expect(errCode(null)).toBeUndefined()
    expect(errCode('plain string')).toBeUndefined()
    expect(errCode(undefined)).toBeUndefined()
  })
})
