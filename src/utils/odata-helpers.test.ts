import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildODataFilter, escapeODataString, sanitizeOneDrivePath } from './odata-helpers.js'

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

describe('sanitizeOneDrivePath', () => {
  it('returns an empty string for empty / slash-only input', () => {
    expect(sanitizeOneDrivePath('')).toBe('')
    expect(sanitizeOneDrivePath('/')).toBe('')
    expect(sanitizeOneDrivePath('///')).toBe('')
  })

  it('strips leading and trailing slashes and preserves interior structure', () => {
    expect(sanitizeOneDrivePath('/Documents/2026/')).toBe('Documents/2026')
    expect(sanitizeOneDrivePath('Documents/2026')).toBe('Documents/2026')
  })

  it('percent-encodes characters that would otherwise break out of the path component', () => {
    // `?` and `#` would otherwise terminate the URL path / start the fragment.
    expect(sanitizeOneDrivePath('Pillars/Q & A.md')).toBe('Pillars/Q%20%26%20A.md')
    expect(sanitizeOneDrivePath('Notes/Issue?123#a.md')).toBe('Notes/Issue%3F123%23a.md')
  })

  it('rejects ":" anywhere in the path (Graph path/id separator)', () => {
    expect(() => sanitizeOneDrivePath('foo:bar')).toThrow(/disallowed character.*"foo:bar"/)
    expect(() => sanitizeOneDrivePath('Documents/items:{id}')).toThrow(/disallowed character/)
  })

  it('rejects "\\" anywhere in the path', () => {
    expect(() => sanitizeOneDrivePath('foo\\bar')).toThrow(/disallowed character/)
  })

  it('rejects "." and ".." segments (defense in depth — Graph would error too)', () => {
    expect(() => sanitizeOneDrivePath('a/../b')).toThrow(/invalid segment ".."/)
    expect(() => sanitizeOneDrivePath('a/./b')).toThrow(/invalid segment "."/)
  })

  it('rejects empty interior segments (consecutive slashes)', () => {
    expect(() => sanitizeOneDrivePath('a//b')).toThrow(/invalid segment ""/)
  })
})
