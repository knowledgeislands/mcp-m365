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
