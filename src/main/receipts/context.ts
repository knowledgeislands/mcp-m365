/**
 * The injected slice the receipt harvest receives.
 *
 * The destination is configuration, not a tool parameter — the same rule the
 * triage engine applies to its tracking cache. A caller-supplied destination
 * would let any prompt write mail attachments anywhere the server process can
 * reach, and attachments are attacker-supplied bytes. A call may name a
 * subdirectory of the configured destination, and that is checked against the
 * roots like everything else.
 */
import type { GraphContext } from '../graph-client/index.js'
import type { PdfTextExtractor } from './pdf-text.js'

export interface ReceiptsContext extends GraphContext {
  /** Directories the harvest may write into. Empty disables the tool. */
  roots: readonly string[]
  /** Where harvested receipts land. From `MCP_M365_RECEIPTS_DIR`; must resolve inside {@link roots}. */
  destination: string
  /** PDF text extraction, injected so tests need neither `pdftotext` nor a real document. */
  extractPdfText: PdfTextExtractor
}
