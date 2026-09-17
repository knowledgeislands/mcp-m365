/**
 * PDF text extraction, behind an injectable seam.
 *
 * Extraction is shelled out to `pdftotext` (poppler) rather than done in
 * process: it is the only PDF text extractor present on this machine — no
 * mutool, qpdf, pypdf or pymupdf — and adding a JS parser would mean carrying a
 * dependency that parses attacker-supplied documents. A subprocess with a byte
 * cap and a timeout is the smaller surface.
 *
 * The extractor is passed into the harvest handler as a function, so the tests
 * need neither the binary nor a real PDF.
 */
import { spawn } from 'node:child_process'

/** Extracts the text of a PDF held in memory. Resolves to `null` when the document yields no usable text. */
export type PdfTextExtractor = (pdf: Buffer) => Promise<string | null>

/**
 * `-layout` preserves column alignment, which is what keeps a label and its
 * figure on the same visual line; `-q` silences poppler's progress chatter. The
 * two `-` arguments are stdin and stdout, so nothing is written to a temporary
 * file — one less path to constrain, and no scratch bytes left behind when a
 * call fails midway.
 */
const PDFTOTEXT_ARGS = ['-layout', '-q', '-', '-'] as const

export interface PdftotextOptions {
  /** Enough for a long invoice; a document needing more than this is not a receipt. */
  maxBytes?: number
  /** A wedged or password-prompting binary must not hold the MCP call open until the client times out. */
  timeoutMs?: number
}

const DEFAULTS = { maxBytes: 8 * 1024 * 1024, timeoutMs: 20_000 } as const

/** Build an extractor backed by the `pdftotext` binary. */
export const makePdftotextExtractor =
  (binary = '/opt/homebrew/bin/pdftotext', options: PdftotextOptions = {}): PdfTextExtractor =>
  (pdf: Buffer) =>
    new Promise<string | null>((resolve) => {
      // A failure anywhere below resolves `null` rather than rejecting. Losing
      // the amount is not fatal to the harvest — the file is still saved, named
      // `no-amount`, which is visible in the folder and correctable — whereas a
      // throw would abandon messages that were about to be filed correctly.
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(binary, [...PDFTOTEXT_ARGS], { stdio: ['pipe', 'pipe', 'ignore'] })
      } catch {
        resolve(null)
        return
      }

      const chunks: Buffer[] = []
      let bytes = 0
      let settled = false
      const finish = (text: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child.kill('SIGKILL')
        resolve(text)
      }
      const timer = setTimeout(() => finish(null), options.timeoutMs ?? DEFAULTS.timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        bytes += chunk.length
        if (bytes > (options.maxBytes ?? DEFAULTS.maxBytes)) {
          finish(null)
          return
        }
        chunks.push(chunk)
      })
      child.on('error', () => finish(null))
      child.on('close', (code) => {
        if (code !== 0) {
          finish(null)
          return
        }
        const text = Buffer.concat(chunks).toString('utf8')
        finish(text.trim() ? text : null)
      })

      // EPIPE is expected when the child exits before consuming the whole
      // document — an encrypted PDF does exactly that — so it is ignored here
      // rather than surfacing as an unhandled stream error.
      child.stdin?.on('error', () => {})
      child.stdin?.end(pdf)
    })
