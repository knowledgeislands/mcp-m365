import { describe, expect, it } from 'vitest'
import { errorResult, errorText } from './results.js'

describe('errorText', () => {
  it('wraps a verbatim message in an isError envelope', () => {
    const r = errorText('Email ID is required.')
    expect(r).toEqual({
      resultType: 'complete',
      isError: true,
      content: [{ type: 'text', text: 'Email ID is required.' }]
    })
  })
})

describe('errorResult', () => {
  it('formats "Error <action>: <message>" with isError set', () => {
    const r = errorResult('reading email', new Error('boom'))
    expect(r).toEqual({
      resultType: 'complete',
      isError: true,
      content: [{ type: 'text', text: 'Error reading email: boom' }]
    })
  })

  it('appends the auth hint on a 401 Graph error', () => {
    const r = errorResult('reading email', { response: { status: 401, data: { error: { message: 'token expired' } } } })
    expect(r.content[0].text).toContain('m365_auth_start')
  })
})
