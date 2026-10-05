import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { withTokenLock } from './token-lock.js'

let dir: string
let file: string
const children: ChildProcessWithoutNullStreams[] = []
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'm365-lock-test-'))
  file = path.join(dir, 'tokens.json')
})
afterEach(async () => {
  vi.restoreAllMocks()
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill()
  await fs.rm(dir, { recursive: true, force: true })
})
const start = (mode: string, signal = path.join(dir, 'start')) => {
  const child = spawn(
    'bun',
    [path.resolve('scripts', 'fixtures', 'token-worker.ts'), file, mode, signal, path.join(dir, 'trace')],
    {
      cwd: process.cwd()
    }
  )
  children.push(child)
  let output = ''
  let errors = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    errors += chunk
  })
  const done = once(child, 'exit').then(([code]) => {
    expect(code, errors).toBe(0)
    return output
  })
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', () => {
      if (output.includes('ready\n')) resolve()
    })
    child.on('exit', () => {
      if (!output.includes('ready\n')) reject(new Error(errors || 'fixture exited before ready'))
    })
  })
  return { child, done, ready }
}
const expired = { access_token: 'fixture-old', refresh_token: 'fixture-legacy', expires_at: 1 }
it('two real processes refresh a populated legacy store once after serialized reload', async () => {
  await fs.writeFile(file, JSON.stringify(expired), { mode: 0o600 })
  const a = start('refresh')
  const b = start('refresh')
  await Promise.all([a.ready, b.ready])
  await fs.writeFile(path.join(dir, 'start'), '')
  const results = await Promise.all([a.done, b.done])
  expect(results[0]).toBe(results[1])
  expect((await fs.readFile(path.join(dir, 'trace'), 'utf8')).trim().split('\n')).toHaveLength(1)
  expect(JSON.parse(await fs.readFile(file, 'utf8')).refresh_token).toBe('fixture-rotation-refresh_token')
  expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
  expect(await fs.readdir(dir)).not.toContain('tokens.json.lock')
})
it('parallel code and refresh processes reload the code rotation instead of overwriting it', async () => {
  await fs.writeFile(file, JSON.stringify(expired), { mode: 0o600 })
  const codeSignal = path.join(dir, 'code-start')
  const refreshSignal = path.join(dir, 'refresh-start')
  const code = start('exchange', codeSignal)
  const refresh = start('refresh', refreshSignal)
  await Promise.all([code.ready, refresh.ready])
  await fs.writeFile(codeSignal, '')
  // The trace is written while the code process owns the lock and before its token response.
  while (!(await fs.stat(path.join(dir, 'trace')).catch(() => null)))
    await new Promise((resolve) => setTimeout(resolve, 5))
  await fs.writeFile(refreshSignal, '')
  await Promise.all([code.done, refresh.done])
  expect((await fs.readFile(path.join(dir, 'trace'), 'utf8')).trim().split('\n')).toHaveLength(1)
  expect(JSON.parse(await fs.readFile(file, 'utf8')).refresh_token).toBe('fixture-rotation-authorization_code')
})
it('refuses to steal a live process lock and bounds the wait', async () => {
  const holder = start('hold')
  await holder.ready
  await expect(withTokenLock(file, async () => true, { timeoutMs: 30, retryMs: 5 })).rejects.toThrow('lock timed out')
  expect(JSON.parse(await fs.readFile(path.join(`${file}.lock`, 'owner.json'), 'utf8')).pid).toBe(holder.child.pid)
  holder.child.stdin.write('release\n')
  await holder.done
})
it('recovers only a proven dead owner PID from a terminated fixture process', async () => {
  const child = start('stale')
  await child.done
  await expect(withTokenLock(file, async () => 'recovered')).resolves.toBe('recovered')
  expect(await fs.readdir(dir)).toEqual([])
})
it.each(['malformed', 'missing', 'invalid', 'symlink', 'large', 'not-file', 'guard'])(
  'retains unknown %s lock evidence',
  async (kind) => {
    await fs.mkdir(`${file}.lock`)
    const owner = path.join(`${file}.lock`, 'owner.json')
    if (kind === 'malformed') await fs.writeFile(owner, '{broken')
    if (kind === 'invalid') await fs.writeFile(owner, JSON.stringify({ pid: 0, nonce: 'bad' }))
    if (kind === 'large') await fs.writeFile(owner, 'x'.repeat(513))
    if (kind === 'not-file') await fs.mkdir(owner)
    if (kind === 'guard') await fs.mkdir(`${file}.lock.recovery`)
    if (kind === 'symlink') {
      await fs.rmdir(`${file}.lock`)
      await fs.mkdir(path.join(dir, 'outside'))
      await fs.symlink(path.join(dir, 'outside'), `${file}.lock`)
    }
    await expect(withTokenLock(file, async () => true, { timeoutMs: 0 })).rejects.toThrow('lock timed out')
    expect(await fs.lstat(`${file}.lock`)).toBeDefined()
  }
)
it('retains a lock when PID liveness cannot be established', async () => {
  await fs.mkdir(`${file}.lock`)
  await fs.writeFile(path.join(`${file}.lock`, 'owner.json'), JSON.stringify({ pid: 123, nonce: 'fixture' }))
  vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('denied'), { code: 'EPERM' })
  })
  await expect(withTokenLock(file, async () => true, { timeoutMs: 0 })).rejects.toThrow('lock timed out')
})
it('rejects non-contention acquisition errors and releases after owner-write failure', async () => {
  vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(withTokenLock(file, async () => true)).rejects.toThrow('lock unavailable')
  vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('fixture-secret'))
  await expect(withTokenLock(file, async () => true)).rejects.toThrow('owner could not be saved')
  expect(await fs.readdir(dir)).toEqual([])
})
it('does not recursively discard unexpected lock contents after operation failure', async () => {
  await expect(
    withTokenLock(file, async () => {
      await fs.writeFile(path.join(`${file}.lock`, 'unexpected'), 'evidence')
      throw new Error('operation')
    })
  ).rejects.toThrow()
  expect(await fs.readFile(path.join(`${file}.lock`, 'unexpected'), 'utf8')).toBe('evidence')
})
it('propagates recovery filesystem failures without deleting unknown evidence', async () => {
  await fs.mkdir(`${file}.lock`)
  const mkdir = fs.mkdir
  vi.spyOn(fs, 'mkdir').mockImplementation(async (...args) => {
    if (String(args[0]).endsWith('.recovery')) throw Object.assign(new Error('denied'), { code: 'EACCES' })
    return mkdir(...args)
  })
  await expect(withTokenLock(file, async () => true)).rejects.toThrow('denied')
})
it('propagates a non-ENOENT recovery read failure and cleanup unlink failure', async () => {
  await fs.mkdir(`${file}.lock`)
  vi.spyOn(fs, 'lstat').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(withTokenLock(file, async () => true)).rejects.toThrow('denied')
  vi.restoreAllMocks()
  await fs.rmdir(`${file}.lock`)
  vi.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(withTokenLock(file, async () => true)).rejects.toThrow('denied')
})
