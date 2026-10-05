import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

type LockOptions = { timeoutMs?: number; retryMs?: number }
const codeIs = (error: unknown, code: string): boolean => (error as NodeJS.ErrnoException).code === code

async function recoverDeadOwner(lock: string): Promise<void> {
  const guard = `${lock}.recovery`
  try {
    await fs.mkdir(guard, { mode: 0o700 })
  } catch (error) {
    if (codeIs(error, 'EEXIST')) return
    throw error
  }
  try {
    if (!(await fs.lstat(lock)).isDirectory()) return
    const ownerFile = path.join(lock, 'owner.json')
    const stat = await fs.lstat(ownerFile)
    if (!stat.isFile() || stat.size > 512) return
    const owner = JSON.parse(await fs.readFile(ownerFile, 'utf8'))
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.nonce !== 'string') return
    try {
      process.kill(owner.pid, 0)
      return // Live or reused PID: never steal its lock.
    } catch (error) {
      if (!codeIs(error, 'ESRCH')) return // Unknown ownership is not stale evidence.
    }
    // Reclaimers are serialized. Acquisition cannot succeed while this directory
    // exists; no live owner can replace it between this read and removal.
    await fs.unlink(ownerFile)
    await fs.rmdir(lock)
  } catch (error) {
    if (!codeIs(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error
  } finally {
    await fs.rmdir(guard)
  }
}

/** Bounded cross-process serialization. Unknown locks are retained for operator review. */
export async function withTokenLock<T>(
  file: string,
  operation: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const parent = await fs.realpath(path.dirname(file))
  const lock = path.join(parent, `${path.basename(file)}.lock`)
  const deadline = Date.now() + (options.timeoutMs ?? 5_000)
  const ownerFile = path.join(lock, 'owner.json')
  const owner = JSON.stringify({ pid: process.pid, nonce: randomBytes(16).toString('hex') })
  for (;;) {
    try {
      await fs.mkdir(lock, { mode: 0o700 })
      break
    } catch (error) {
      if (!codeIs(error, 'EEXIST')) throw new Error('OAuth token lock unavailable')
      await recoverDeadOwner(lock)
      if (Date.now() >= deadline) throw new Error('OAuth token lock timed out')
      await delay(options.retryMs ?? 20)
    }
  }
  try {
    try {
      await fs.writeFile(ownerFile, owner, { mode: 0o600, flag: 'wx' })
    } catch {
      throw new Error('OAuth token lock owner could not be saved')
    }
    return await operation()
  } finally {
    // Only our newly created directory is released; never recursively remove
    // unexpected contents or locks whose ownership has changed.
    await fs.unlink(ownerFile).catch((error) => {
      if (!codeIs(error, 'ENOENT')) throw error
    })
    await fs.rmdir(lock)
  }
}
