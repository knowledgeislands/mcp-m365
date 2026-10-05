import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

it('real callback server keeps single-use state, verifier/challenge binding and redacted failed exchange', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm365-callback-test-'))
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = (reservation.address() as { port: number }).port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const file = path.join(dir, 'tokens.json')
  const trace = path.join(dir, 'trace.json')
  const child = spawn('bun', [path.resolve('scripts', 'fixtures', 'callback-worker.ts'), trace], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: '',
      MCP_M365_AUTH_PORT: String(port),
      MCP_M365_TOKEN_PATH: file,
      MCP_M365_CLIENT_ID: 'fixture-client',
      MCP_M365_CLIENT_SECRET: 'fixture-client-secret',
      MCP_M365_SCOPES: 'Mail.Read offline_access',
      MCP_M365_AUTHORITY_HOST: 'https://callback.example',
      MCP_M365_TENANT_ID: 'tenant',
      MCP_M365_TOKEN_ENDPOINT: 'https://ignored.example/token'
    }
  })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  try {
    await vi.waitFor(() => expect(output).toContain('Authentication server running'), { timeout: 3000 })
    const base = `http://127.0.0.1:${port}`
    const auth = async () =>
      new URL((await fetch(`${base}/auth`, { redirect: 'manual' })).headers.get('location') as string)
    expect((await fetch(`${base}/auth/callback?code=fixture`)).status).toBe(403)
    const location = await auth()
    expect(location.searchParams.get('scope')).toBe('Mail.Read offline_access')
    const state = location.searchParams.get('state') as string
    expect((await fetch(`${base}/auth/callback?state=${state}&code=good-fixture`)).status).toBe(200)
    const captured = JSON.parse(await fs.readFile(trace, 'utf8'))
    expect(captured.endpoint).toBe('https://callback.example/tenant/oauth2/v2.0/token')
    expect(createHash('sha256').update(captured.form.code_verifier).digest('base64url')).toBe(
      location.searchParams.get('code_challenge')
    )
    expect(captured.form.grant_type).toBe('authorization_code')
    expect((await fetch(`${base}/auth/callback?state=${state}&code=good-fixture`)).status).toBe(403)
    const prior = await fs.readFile(file)
    const failedState = (await auth()).searchParams.get('state') as string
    const failed = await fetch(`${base}/auth/callback?state=${failedState}&code=bad-fixture`)
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toMatch(/fixture-(secret|access|refresh)-response/)
    expect(output).not.toMatch(/fixture-(secret|access|refresh)-response/)
    expect(await fs.readFile(file)).toEqual(prior)
    expect((await fetch(`${base}/auth/callback?state=${failedState}&code=good-fixture`)).status).toBe(403)
    const cancelledState = (await auth()).searchParams.get('state') as string
    expect((await fetch(`${base}/auth/callback?state=${cancelledState}&error=access_denied`)).status).toBe(400)
    expect((await fetch(`${base}/auth/callback?state=${cancelledState}&code=good-fixture`)).status).toBe(403)
  } finally {
    child.kill('SIGTERM')
    await once(child, 'exit')
    await fs.rm(dir, { recursive: true, force: true })
  }
})
