/**
 * Builders for the Microsoft Graph `$search` parameter on message collections.
 *
 * Graph reads `$search` as one double-quoted string holding a KQL query. Any
 * `"` or `\` inside that string must be backslash-escaped; KQL phrase quotes
 * nested without the escape end the outer string early, so Graph either
 * rejects the query (`Syntax error: character '@' is not valid`) or parses
 * only part of it. The form proved against live Graph on 17 October 2026 is:
 *
 *     "recipients:\"finance@example.com\" AND subject:\"Your receipt #12\""
 *
 * Clauses are joined with an explicit uppercase `AND` (operators sit outside
 * any phrase), and property values are always phrase-quoted so `@`, `:`, `#`
 * and spaces stay inside the value.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the intent
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the intent
const PHRASE_UNSAFE = /["\\\u0000-\u001f\u007f]/g

/** Message properties the builders accept as a KQL property restriction. */
export type KqlMessageProperty = 'subject' | 'from' | 'to' | 'recipients' | 'participants'

/**
 * A property value made safe for a KQL phrase. KQL has no escape inside a
 * phrase, and Graph's search matches words, so `"` and `\` are dropped rather
 * than escaped; control characters are dropped and runs of whitespace become
 * one space. Letters in any script are kept.
 */
export const kqlPhraseValue = (value: string): string => value.replace(PHRASE_UNSAFE, ' ').replace(/\s+/g, ' ').trim()

/** `property:"value"`, or null when nothing searchable is left of the value. */
export const kqlPropertyClause = (property: KqlMessageProperty, value: string): string | null => {
  const phrase = kqlPhraseValue(value)
  return phrase ? `${property}:"${phrase}"` : null
}

/**
 * Caller-written KQL, kept as written (so `subject:"a b"` or `x OR y` still
 * mean what the caller meant) apart from control characters, and bracketed so
 * its own `OR` cannot bind across the clauses it is joined to. Null when blank.
 */
export const kqlFreeTextClause = (text: string): string | null => {
  const cleaned = text.replace(CONTROL_CHARACTERS, ' ').trim()
  return cleaned ? `(${cleaned})` : null
}

/**
 * The `$search` value for a set of KQL clauses: joined with `AND`, wrapped in
 * double quotes, with every inner `"` and `\` backslash-escaped. Throws on an
 * empty list, because an empty search would silently match everything.
 */
export const messageSearchQuery = (clauses: readonly string[]): string => {
  if (clauses.length === 0) throw new Error('A message search needs at least one clause.')
  const kql = clauses.join(' AND ')
  return `"${kql.replace(/[\\"]/g, '\\$&')}"`
}
