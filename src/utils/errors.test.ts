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
