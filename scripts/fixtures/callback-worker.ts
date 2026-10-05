import { promises as fs } from 'node:fs'
import { tokenNetwork } from '../../src/main/auth/msal.js'

const trace = process.argv[2]!
tokenNetwork.sendPostRequestAsync = async <T>(endpoint: string, options?: { body?: string }) => {
  const form = Object.fromEntries(new URLSearchParams(options?.body))
  await fs.writeFile(trace, JSON.stringify({ endpoint, form }))
  if (form.code === 'bad-fixture') return { status: 400, headers: {}, body: { error: 'invalid_grant', error_description: 'fixture-secret-response' } as T }
  return { status: 200, headers: {}, body: { access_token: 'fixture-access-response', refresh_token: 'fixture-refresh-response', expires_in: 3600 } as T }
}
await import('../../src/auth-server/index.js')
