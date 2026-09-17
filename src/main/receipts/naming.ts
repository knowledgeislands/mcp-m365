/**
 * Receipt filename derivation — pure, so every rule here is unit-testable
 * without a mailbox, a PDF, or the `pdftotext` binary.
 *
 * The target convention is `YYYY-MM-DD_vendor_amount.pdf`, matching the names
 * already present in the bookkeeping archive. Two decisions in here are
 * load-bearing and were taken against real mail rather than guessed:
 *
 * 1. **The amount comes from the PDF, never from the email body.** Receipt mail
 *    routinely quotes several money values — line items, a running balance, a
 *    converted currency — and the transaction total is not reliably the first
 *    or the largest. One observed Anthropic receipt quoted £46.32 and £41.18 in
 *    the body while the invoice, subtotal and amount paid were all £5.14. The
 *    PDF is the document of record; the body is marketing wrapper.
 * 2. **A vendor that sends both an invoice and a receipt yields two files.**
 *    They describe one transaction, so date, vendor and amount are identical
 *    and the names would collide. The receipt keeps the canonical name and the
 *    invoice takes an `_invoice` suffix.
 */

/** Non-inline PDFs whose name or subject looks like a receipt rather than general correspondence. */
export const RECEIPT_PATTERN = /receipt|invoice|payment/i

/**
 * Company-form suffixes stripped before slugging, so `Anthropic, PBC` and
 * `Linear Orbit, Inc.` become `anthropic` and `linear-orbit` rather than
 * carrying a legal form that adds nothing to a filename.
 */
const LEGAL_SUFFIX = /,?\s*\b(pbc|inc|ltd|limited|llc|gmbh|bv|b\.v\.|corp|co|plc|sa|ag|oy|ab|as)\b\.?/gi

/** Strip any stack of `Re:` / `Fw:` / `Fwd:` prefixes a forwarded receipt has accumulated. */
export const stripReplyPrefixes = (subject: string): string => subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, '').trim()

/**
 * Pull the vendor's display name out of a subject line.
 *
 * Ordered most to least specific. Stripe-generated mail (which covers Anthropic,
 * Granola, Linear and anything else billing through Stripe) uses
 * `Your receipt from <vendor> #<number>`, so that pattern carries most of the
 * corpus. The bracketed form catches forwarded platform mail such as
 * `FW: [GitHub] Payment Receipt for ...`.
 *
 * Returns `null` rather than a guess when nothing matches, so the caller can
 * mark the file for a human instead of inventing a vendor.
 */
export const vendorFromSubject = (subject: string): string | null => {
  const s = stripReplyPrefixes(subject)
  const fromVendor = s.match(/(?:receipt|invoice|statement)\s+from\s+(.+?)\s*(?:#|$)/i)
  if (fromVendor?.[1]) return fromVendor[1]
  const bracketed = s.match(/^\[([^\]]+)\]/)
  if (bracketed?.[1]) return bracketed[1]
  const leading = s.match(/^([A-Za-z0-9&.'\- ]{2,40}?)\s+(?:invoice|receipt|payment)\b/i)
  if (leading?.[1]) return leading[1]
  return null
}

/** Lowercase, hyphenated, filesystem-safe vendor token. Returns `null` when nothing survives. */
export const slugifyVendor = (vendor: string | null): string | null => {
  if (!vendor) return null
  const slug = String(vendor)
    .replace(LEGAL_SUFFIX, '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || null
}

/**
 * Labelled totals, most authoritative first. `Amount paid` is what a Stripe
 * receipt states; `Total` is what its invoice states. `Amount due` is last
 * because an unpaid invoice is the weakest evidence of what was actually spent.
 *
 * Each pattern allows a bounded run of non-numeric characters between the label
 * and the figure, which is what a table cell, a colon or a currency word looks
 * like once whitespace is flattened. The bound stops a label pairing with a
 * figure several columns of other text away; it does not — and cannot, after
 * flattening — measure distance on the printed page.
 *
 * The label is carried alongside rather than derived from the pattern source,
 * so the reported label reads as English rather than as a mangled regex.
 */
const AMOUNT_LABELS: readonly { label: string; pattern: RegExp }[] = [
  { label: 'amount paid', pattern: /amount\s+paid[^0-9£$€]{0,24}([£$€])?\s?([\d,]+\.\d{2})/i },
  { label: 'total', pattern: /\btotal[^0-9£$€]{0,24}([£$€])?\s?([\d,]+\.\d{2})/i },
  { label: 'amount due', pattern: /amount\s+due[^0-9£$€]{0,24}([£$€])?\s?([\d,]+\.\d{2})/i }
]

export interface AmountMatch {
  /** Normalised to plain decimal digits, e.g. `347.23` — no symbol, no thousands separator. */
  amount: string
  /** The currency symbol found next to the figure, when the document printed one. */
  currency: string | null
  /** Which label produced the match, for the report line. */
  label: string
}

/**
 * Find the transaction total in text extracted from a receipt or invoice PDF.
 *
 * Whitespace is flattened first: `pdftotext -layout` preserves column alignment
 * with long runs of spaces, and a label and its figure otherwise look far apart.
 */
export const amountFromPdfText = (text: string): AmountMatch | null => {
  const flat = text.replace(/\s+/g, ' ')
  for (const { label, pattern } of AMOUNT_LABELS) {
    const found = flat.match(pattern)
    if (found?.[2]) return { amount: found[2].replace(/,/g, ''), currency: found[1] ?? null, label }
  }
  return null
}

/** `invoice` when the source attachment is the invoice half of an invoice/receipt pair. */
export type DocumentKind = 'receipt' | 'invoice'

export const documentKind = (attachmentName: string): DocumentKind =>
  /invoice/i.test(attachmentName) ? 'invoice' : 'receipt'

export interface NameParts {
  /** `YYYY-MM-DD`, taken from the message's received date. */
  date: string
  vendor: string | null
  amount: string | null
  kind: DocumentKind
}

/**
 * Compose the destination filename.
 *
 * A missing vendor or amount is surfaced in the name rather than silently
 * dropped: an `unknown-vendor` or `no-amount` file is obvious in the folder and
 * gets corrected, whereas a plausible-looking wrong figure does not.
 */
export const composeFilename = ({ date, vendor, amount, kind }: NameParts): string => {
  const segments = [date, vendor ?? 'unknown-vendor', amount ?? 'no-amount']
  const suffix = kind === 'invoice' ? '_invoice' : ''
  return `${segments.join('_')}${suffix}.pdf`
}

/**
 * Append `-2`, `-3` … when a name is already taken.
 *
 * `taken` is consulted rather than the filesystem so the caller can seed it with
 * both the existing directory listing and the names planned earlier in the same
 * run — two messages harvested in one pass can otherwise agree on a name that
 * neither found on disk.
 */
export const deconflict = (filename: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(filename)) return filename
  const dot = filename.lastIndexOf('.')
  const stem = dot === -1 ? filename : filename.slice(0, dot)
  const ext = dot === -1 ? '' : filename.slice(dot)
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!taken.has(candidate)) return candidate
  }
  throw new Error(`Cannot find a free filename for ${filename} after 999 attempts`)
}
