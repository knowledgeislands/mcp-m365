/**
 * Receipt attachment harvesting: mail in a finance folder becomes named PDFs in
 * the bookkeeping staging folder, and the mail is archived once they are safely
 * on disk.
 */
export type { ReceiptsContext } from './context.js'
export {
  DEFAULT_ARCHIVE_FOLDER,
  DEFAULT_SOURCE_FOLDER,
  type HarvestResult,
  handleHarvest,
  harvestResultSchema
} from './harvest.js'
export { makePdftotextExtractor, type PdfTextExtractor } from './pdf-text.js'
