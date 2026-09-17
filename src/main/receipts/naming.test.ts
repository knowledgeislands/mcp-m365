import { describe, expect, it } from 'vitest'
import {
  amountFromPdfText,
  composeFilename,
  deconflict,
  documentKind,
  RECEIPT_PATTERN,
  slugifyVendor,
  stripReplyPrefixes,
  vendorFromSubject
} from './naming.js'

describe('stripReplyPrefixes', () => {
  it('strips a stack of forward and reply prefixes', () => {
    expect(stripReplyPrefixes('Re: FW: Fwd: Your receipt')).toBe('Your receipt')
  })

  it('leaves a clean subject alone', () => {
    expect(stripReplyPrefixes('Your receipt from Anthropic')).toBe('Your receipt from Anthropic')
  })
})

describe('vendorFromSubject', () => {
  // Every subject below is a real one from _TRIAGE/282 HNR Finance.
  it.each([
    ['Your receipt from Anthropic, PBC #2842-9910', 'Anthropic, PBC'],
    ['Your receipt from Granola #1102-4471', 'Granola'],
    ['Invoice from Linear Orbit, Inc. #A41B', 'Linear Orbit, Inc.'],
    ['FW: [GitHub] Payment Receipt for kris', 'GitHub'],
    ['Trainline receipt for your journey', 'Trainline']
  ])('reads the vendor out of %j', (subject, expected) => {
    expect(vendorFromSubject(subject)).toBe(expected)
  })

  it('sees through forwarding prefixes', () => {
    expect(vendorFromSubject('Fwd: Your receipt from Granola #1102-4471')).toBe('Granola')
  })

  it('returns null rather than guessing when nothing matches', () => {
    expect(vendorFromSubject('Sales Ledger Debtors Letters')).toBeNull()
    expect(vendorFromSubject('')).toBeNull()
  })
})

describe('slugifyVendor', () => {
  it.each([
    ['Anthropic, PBC', 'anthropic'],
    ['Linear Orbit, Inc.', 'linear-orbit'],
    ['GitHub', 'github'],
    ['Marks & Spencer', 'marks-and-spencer'],
    ['  Crezco Ltd.  ', 'crezco']
  ])('slugs %j to %j', (vendor, expected) => {
    expect(slugifyVendor(vendor)).toBe(expected)
  })

  it('propagates a missing vendor rather than inventing one', () => {
    expect(slugifyVendor(null)).toBeNull()
    expect(slugifyVendor('!!!')).toBeNull()
  })
})

describe('amountFromPdfText', () => {
  it('prefers the amount paid over other figures on the page', () => {
    // Shape of a real Stripe receipt: the same transaction appears three times,
    // and unrelated figures sit nearby.
    const text = `
      Receipt from Anthropic, PBC
      Subtotal                 £5.14
      VAT (20%)                £1.03
      Amount paid              £5.14
    `
    expect(amountFromPdfText(text)).toEqual({ amount: '5.14', currency: '£', label: 'amount paid' })
  })

  it('falls back to the total on an invoice, which has no amount paid line', () => {
    expect(amountFromPdfText('Invoice\n\nTotal    $234.00\n')).toMatchObject({ amount: '234.00', currency: '$' })
  })

  it('takes amount due last', () => {
    expect(amountFromPdfText('Amount due   £1,250.00')).toMatchObject({ amount: '1250.00' })
  })

  it('strips thousands separators so names sort and compare', () => {
    expect(amountFromPdfText('Amount paid £12,345.67')?.amount).toBe('12345.67')
  })

  it('survives the column padding that pdftotext -layout emits', () => {
    expect(amountFromPdfText('Amount paid                      £347.23')?.amount).toBe('347.23')
  })

  it('does not pair a label with a figure separated by other text', () => {
    // The bound is on intervening characters, not on printed distance —
    // flattening whitespace makes layout gaps unmeasurable by design.
    expect(amountFromPdfText(`Amount paid by card ending 4242 ${'x'.repeat(40)} £99.99`)).toBeNull()
  })

  it('reports the figure with no currency when the document printed none', () => {
    expect(amountFromPdfText('Amount paid 5.14')).toEqual({ amount: '5.14', currency: null, label: 'amount paid' })
  })

  it('reports no amount rather than a wrong one when nothing is labelled', () => {
    expect(amountFromPdfText('Thank you for your payment of some money.')).toBeNull()
    expect(amountFromPdfText('')).toBeNull()
  })
})

describe('documentKind', () => {
  it('distinguishes the invoice half of an invoice/receipt pair', () => {
    expect(documentKind('Invoice-A41B-0001.pdf')).toBe('invoice')
    expect(documentKind('Receipt-2842-9910.pdf')).toBe('receipt')
  })
})

describe('composeFilename', () => {
  it('builds the agreed date_vendor_amount convention', () => {
    expect(composeFilename({ date: '2026-09-13', vendor: 'anthropic', amount: '347.23', kind: 'receipt' })).toBe(
      '2026-09-13_anthropic_347.23.pdf'
    )
  })

  it('suffixes the invoice so a matched pair does not collide', () => {
    const parts = { date: '2026-09-13', vendor: 'anthropic', amount: '347.23' } as const
    expect(composeFilename({ ...parts, kind: 'invoice' })).toBe('2026-09-13_anthropic_347.23_invoice.pdf')
    expect(composeFilename({ ...parts, kind: 'receipt' })).not.toBe(composeFilename({ ...parts, kind: 'invoice' }))
  })

  it('makes a missing part visible in the name instead of dropping it', () => {
    expect(composeFilename({ date: '2026-09-13', vendor: null, amount: null, kind: 'receipt' })).toBe(
      '2026-09-13_unknown-vendor_no-amount.pdf'
    )
  })
})

describe('deconflict', () => {
  it('leaves a free name alone', () => {
    expect(deconflict('a.pdf', new Set())).toBe('a.pdf')
  })

  it('numbers from 2 and keeps the extension', () => {
    expect(deconflict('a.pdf', new Set(['a.pdf']))).toBe('a-2.pdf')
    expect(deconflict('a.pdf', new Set(['a.pdf', 'a-2.pdf']))).toBe('a-3.pdf')
  })

  it('handles a name with no extension at all', () => {
    expect(deconflict('receipt', new Set(['receipt']))).toBe('receipt-2')
  })

  it('gives up rather than looping forever when every candidate is taken', () => {
    const taken = new Set(['a.pdf', ...Array.from({ length: 998 }, (_, n) => `a-${n + 2}.pdf`)])
    expect(() => deconflict('a.pdf', taken)).toThrow(/after 999 attempts/)
  })

  it('does not treat the amount’s decimal point as an extension', () => {
    expect(deconflict('2026-09-13_anthropic_347.23.pdf', new Set(['2026-09-13_anthropic_347.23.pdf']))).toBe(
      '2026-09-13_anthropic_347.23-2.pdf'
    )
  })
})

describe('RECEIPT_PATTERN', () => {
  it('accepts receipt mail and rejects other finance correspondence', () => {
    expect(RECEIPT_PATTERN.test('Your receipt from Granola')).toBe(true)
    expect(RECEIPT_PATTERN.test('Invoice-A41B-0001.pdf')).toBe(true)
    // The message that made a blanket sweep unsafe.
    expect(RECEIPT_PATTERN.test('Sales Ledger Debtors Letters.pdf')).toBe(false)
  })
})
