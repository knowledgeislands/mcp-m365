/**
 * OData helper functions for Microsoft Graph API
 */

export const escapeODataString = (str: string): string => {
  if (!str) return str

  str = str.replace(/'/g, "''")
  str = str.replace(/[(){}[\]:;,/?&=+*%$#@!^]/g, '')

  console.error(`Escaped OData string: '${str}'`)
  return str
}

export const buildODataFilter = (conditions: string[]): string => {
  if (!conditions || conditions.length === 0) {
    return ''
  }

  return conditions.join(' and ')
}

/**
 * Normalise a caller-supplied OneDrive path before interpolating it into a
 * Graph endpoint like `me/drive/root:/${path}` or
 * `me/drive/root:/${path}:/children`.
 *
 * Defense-in-depth against path-injection: `:` is Graph's path/id separator,
 * so a path of `foo:/items/{id}` would pivot the request onto a different
 * resource. We reject `:` (and `\`) in any segment, strip outer slashes, and
 * encodeURIComponent each segment so `?`, `#`, `&`, etc. can't break out of
 * the path component.
 *
 * Throws `OneDrive path "X" contains a disallowed character …` for rejected
 * inputs so callers can surface the error via the standard errorResult shape.
 */
export const sanitizeOneDrivePath = (raw: string): string => {
  if (!raw) return ''
  const trimmed = raw.replace(/^\/+|\/+$/g, '')
  if (trimmed === '') return ''
  const segments = trimmed.split('/')
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new Error(`OneDrive path "${raw}" contains an invalid segment "${seg}".`)
    }
    if (seg.includes(':') || seg.includes('\\')) {
      throw new Error(`OneDrive path "${raw}" contains a disallowed character (":" or "\\") in segment "${seg}".`)
    }
  }
  return segments.map(encodeURIComponent).join('/')
}
