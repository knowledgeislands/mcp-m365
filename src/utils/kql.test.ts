import { describe, expect, it } from 'vitest'
import { kqlFreeTextClause, kqlPhraseValue, kqlPropertyClause, messageSearchQuery } from './kql.js'

describe('kqlPhraseValue', () => {
  it('drops quotes, backslashes and control characters, and collapses whitespace', () => {
    expect(kqlPhraseValue(' He said "hi"\\there\u0007  now ')).toBe('He said hi there now')
  })

  it('keeps colons, symbols and non-ASCII letters', () => {
    expect(kqlPhraseValue('Facture n° 12: Café #3 — 請求書')).toBe('Facture n° 12: Café #3 — 請求書')
  })

  it('leaves nothing of a value made only of quotes and whitespace', () => {
    expect(kqlPhraseValue(' "" \\ ')).toBe('')
  })
})

describe('kqlPropertyClause', () => {
  it('phrase-quotes an address so its @ stays inside the value', () => {
    expect(kqlPropertyClause('recipients', 'finance@example.com')).toBe('recipients:"finance@example.com"')
  })

  it('cannot be broken out of by a quote in the value', () => {
    expect(kqlPropertyClause('subject', 'a" OR from:"evil')).toBe('subject:"a OR from: evil"')
  })

  it('returns null when nothing searchable is left', () => {
    expect(kqlPropertyClause('to', '""')).toBeNull()
  })
})

describe('kqlFreeTextClause', () => {
  it('keeps caller KQL as written and brackets it', () => {
    expect(kqlFreeTextClause(' invoice OR subject:"due date" ')).toBe('(invoice OR subject:"due date")')
  })

  it('drops control characters and returns null for a blank value', () => {
    expect(kqlFreeTextClause('a\u0000b')).toBe('(a b)')
    expect(kqlFreeTextClause(' \u0001 ')).toBeNull()
  })
})

describe('messageSearchQuery', () => {
  it('joins clauses with AND and escapes the inner quotes, in the form Graph accepts', () => {
    const clauses = [
      kqlPropertyClause('recipients', 'finance@example.com'),
      kqlPropertyClause('subject', 'Your receipt from Example, Inc. #2958-4288')
    ] as string[]
    expect(messageSearchQuery(clauses)).toBe(
      String.raw`"recipients:\"finance@example.com\" AND subject:\"Your receipt from Example, Inc. #2958-4288\""`
    )
  })

  it('escapes a backslash in caller KQL as well as its quotes', () => {
    expect(messageSearchQuery(['(a\\b "c")'])).toBe(String.raw`"(a\\b \"c\")"`)
  })

  it('never nests an unescaped quote inside the outer string', () => {
    const query = messageSearchQuery([
      kqlPropertyClause('to', 'kris@kris.me.uk') as string,
      kqlPropertyClause('subject', 'Re: "quoted": Ünïcode') as string
    ])
    expect(query.slice(1, -1)).not.toMatch(/(?<!\\)"/)
  })

  it('refuses an empty clause list rather than searching for everything', () => {
    expect(() => messageSearchQuery([])).toThrow('at least one clause')
  })
})
