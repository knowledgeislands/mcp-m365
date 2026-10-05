import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import TokenStorage from '../../src/main/auth/index.js'
import { tokenNetwork } from '../../src/main/auth/msal.js'
import { withTokenLock } from '../../src/main/auth/token-lock.js'

const [file, mode, signal, trace] = process.argv.slice(2) as [string, string, string, string]
if (mode === 'stale') {
  await fs.mkdir(`${file}.lock`, { mode: 0o700 })
  await fs.writeFile(path.join(`${file}.lock`, 'owner.json'), JSON.stringify({ pid: process.pid, nonce: 'fixture-stale' }), { mode: 0o600 })
  process.stdout.write('ready\n')
} else if (mode === 'hold') {
  await withTokenLock(file, async () => {
    process.stdout.write('ready\n')
    await new Promise<void>((resolve) => { process.stdin.once('data', () => resolve()); process.stdin.resume() })
    process.stdin.pause()
  })
} else {
  const storage = new TokenStorage({ tokenStorePath: file, clientId: 'fixture-client', clientSecret: 'fixture-secret', scopes: ['Mail.Read'] })
  tokenNetwork.sendPostRequestAsync = async <T>(_endpoint: string, options?: { body?: string }) => {
    const form = new URLSearchParams(options?.body)
    await fs.appendFile(trace, `${JSON.stringify({ grant: form.get('grant_type'), refresh: form.get('refresh_token') })}\n`)
    await delay(80)
    return { status: 200, headers: {}, body: { access_token: `fixture-access-${form.get('grant_type')}`, refresh_token: `fixture-rotation-${form.get('grant_type')}`, expires_in: 3600 } as T }
  }
  await storage.getTokens()
  process.stdout.write('ready\n')
  while (!(await fs.stat(signal).catch(() => null))) await delay(5)
  if (mode === 'refresh') process.stdout.write(`${await storage.refreshAccessToken()}\n`)
  else await storage.exchangeCodeForTokens('fixture-code', 'fixture-verifier')
}
