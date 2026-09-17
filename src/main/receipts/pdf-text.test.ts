import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makePdftotextExtractor } from './pdf-text.js'

/**
 * The extractor is exercised against real subprocesses rather than a mocked
 * `spawn`: what is being tested is the handling of a child process that exits
 * badly, prints too much, or hangs, and a mock of `spawn` would only test the
 * mock. Each fake binary ignores the `pdftotext` arguments it is handed.
 */
let dir: string

const fakeBinary = async (name: string, body: string): Promise<string> => {
  const file = path.join(dir, name)
  await fs.writeFile(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return file
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdftotext-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const PDF = Buffer.from('%PDF-1.4 pretend document')

describe('makePdftotextExtractor', () => {
  it('returns the text the binary writes to stdout', async () => {
    const binary = await fakeBinary('ok.sh', 'cat > /dev/null; printf "Amount paid   £5.14\\n"')
    expect(await makePdftotextExtractor(binary)(PDF)).toContain('£5.14')
  })

  it('pipes the document in on stdin rather than via a temporary file', async () => {
    const binary = await fakeBinary('echo-stdin.sh', 'cat')
    expect(await makePdftotextExtractor(binary)(PDF)).toBe(PDF.toString('utf8'))
    // Nothing was left behind beside the binary.
    expect(await fs.readdir(dir)).toEqual(['echo-stdin.sh'])
  })

  it('treats whitespace-only output as no text', async () => {
    const binary = await fakeBinary('blank.sh', 'cat > /dev/null; printf "   \\n\\n"')
    expect(await makePdftotextExtractor(binary)(PDF)).toBeNull()
  })

  it('returns null when the binary exits non-zero', async () => {
    const binary = await fakeBinary('fail.sh', 'cat > /dev/null; printf "partial"; exit 1')
    expect(await makePdftotextExtractor(binary)(PDF)).toBeNull()
  })

  it('returns null when the binary is missing, rather than throwing into the harvest', async () => {
    expect(await makePdftotextExtractor(path.join(dir, 'not-installed'))(PDF)).toBeNull()
  })

  it('returns null when the binary cannot be spawned at all', async () => {
    // An empty binary name fails inside `spawn` itself, before any child exists.
    expect(await makePdftotextExtractor('')(PDF)).toBeNull()
  })

  it('abandons output over the byte cap instead of buffering it', async () => {
    const binary = await fakeBinary('flood.sh', 'cat > /dev/null; printf "%0.sx" $(seq 1 500)')
    expect(await makePdftotextExtractor(binary, { maxBytes: 16 })(PDF)).toBeNull()
  })

  it('gives up on a binary that hangs', async () => {
    const binary = await fakeBinary('hang.sh', 'cat > /dev/null; sleep 30')
    expect(await makePdftotextExtractor(binary, { timeoutMs: 50 })(PDF)).toBeNull()
  })

  it('tolerates a binary that exits before reading the whole document', async () => {
    // Closing stdin early raises EPIPE on the write, which must not surface.
    const binary = await fakeBinary('early.sh', 'printf "Total £1.00\\n"; exit 0')
    const big = Buffer.alloc(4 * 1024 * 1024, 0x41)
    expect(await makePdftotextExtractor(binary)(big)).toContain('£1.00')
  })
})
