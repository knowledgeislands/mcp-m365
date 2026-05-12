import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildODataFilter, escapeODataString } from './odata-helpers.js'

describe('escapeODataString', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns falsy strings unchanged', () => {
    expect(escapeODataString('')).toBe('')
  })

  it('doubles single quotes (OData escape rule)', () => {
    expect(escapeODataString("O'Reilly")).toBe("O''Reilly")
  })

  it('strips OData metacharacters', () => {
    // Each of these characters is removed by the sanitiser
    expect(escapeODataString('a(b){c}[d]:e;f,g/h?i&j=k+l*m%n$o#p!q^r')).toBe('abcdefghijklmnopqr')
  })

  it('combines quote doubling and metachar stripping', () => {
    // Both quotes are doubled (OData escape); the semicolon is stripped.
    expect(escapeODataString("O'Reilly's; book")).toBe("O''Reilly''s book")
  })
})

describe('buildODataFilter', () => {
  it('returns an empty string for no conditions', () => {
    expect(buildODataFilter([])).toBe('')
  })

  it('returns an empty string for nullish input', () => {
    expect(buildODataFilter(undefined as unknown as string[])).toBe('')
  })

  it('joins multiple conditions with " and "', () => {
    expect(buildODataFilter(["from/emailAddress/address eq 'x@y.com'", 'isRead eq false'])).toBe("from/emailAddress/address eq 'x@y.com' and isRead eq false")
  })

  it('returns a single condition unchanged', () => {
    expect(buildODataFilter(['isRead eq false'])).toBe('isRead eq false')
  })
})
