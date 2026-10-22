import { describe, expect, it } from 'vitest'
import {
  calcLine,
  calcTotals,
  documentTitle,
  formatDateNumeric,
  formatMoney,
  laborLabel,
  layoutLines,
  lineNumberOf,
  percentOf,
  pricingNote,
  sectionLetter,
} from '../lib/estimates/calc.js'
import { estimateSchema, newEstimate, newLine, normalizeEstimate, type Estimate, type EstimateLine } from '../lib/estimates/types.js'
import { renderEstimateHtml } from '../app/print/estimate-print.js'

const BUSINESS = {
  name: 'Test Yard',
  legalName: 'Test Yard LLC',
  phone: '727-555-0100',
  email: 'yard@example.com',
  address: { street: '1 Dock St', city: 'Largo', state: 'FL', zip: '33773' },
}

function line(id: string, hours: number, materials: number, extra: Partial<EstimateLine> = {}): EstimateLine {
  return { id, sectionId: null, description: id, qty: 1, unit: '', hours, rate: 125, materials, materialsOnly: false, taxable: true, ...extra }
}

function doc(partial: Partial<Estimate>): Estimate {
  return normalizeEstimate(partial)
}

describe('calcTotals', () => {
  it('reproduces the old engine’s worked example (half-up tax and deposit rounding)', () => {
    const t = calcTotals(doc({ lines: [line('a', 4, 220), line('b', 1.5, 85), line('c', 1, 18)], pricing: { laborRate: 125, taxRate: 7, taxNote: '', depositPct: 20 } }))
    expect(t.laborCents).toBe(81250)
    expect(t.materialsCents).toBe(32300)
    expect(t.subtotalCents).toBe(113550)
    expect(t.taxCents).toBe(7949) // 7948.5 rounds half-up
    expect(t.totalCents).toBe(121499)
    expect(t.depositCents).toBe(24300) // 24299.8
    expect(t.remainingCents).toBe(97199)
    expect(t.laborHours).toBe(6.5)
    expect(laborLabel(t)).toBe('Labor (6.5 hrs @ $125.00)')
  })

  it('gives materials-only lines no labor, whatever their hours say', () => {
    const t = calcTotals(doc({ lines: [line('a', 2, 100), line('m', 3, 50.5, { materialsOnly: true })] }))
    expect(t.lines[1].laborCents).toBe(0)
    expect(t.lines[1].laborHours).toBe(0)
    expect(t.lines[1].lineTotalCents).toBe(5050)
    expect(t.laborHours).toBe(2)
    expect(t.laborCents).toBe(25000)
    expect(t.materialsCents).toBe(15050)
    expect(t.subtotalCents).toBe(40050)
    expect(t.taxCents).toBe(2804) // 2803.5 → half-up
    expect(t.totalCents).toBe(42854)
    expect(laborLabel(t)).toBe('Labor (2 hrs @ $125.00)')
  })

  it('taxes the whole repair charge (labor + materials) and rounds once at the cent', () => {
    // 0.3 h × $125 = 37.50 → 3750; 7% = 262.5 → 263
    const t = calcTotals(doc({ lines: [line('a', 0.3, 0)] }))
    expect(t.lines[0].laborCents).toBe(3750)
    expect(t.taxableCents).toBe(3750)
    expect(t.taxCents).toBe(263)
    expect(percentOf(3750, 7)).toBe(263)
    expect(percentOf(1, 50)).toBe(1) // 0.5 → 1
    expect(percentOf(100, 7.25)).toBe(7) // 7.25 → 7
  })

  it('leaves a non-taxable line out of the tax base only', () => {
    const t = calcTotals(doc({ lines: [line('a', 1, 0), line('b', 0, 100, { taxable: false })] }))
    expect(t.subtotalCents).toBe(22500)
    expect(t.taxableCents).toBe(12500)
    expect(t.taxCents).toBe(875)
  })

  it('computes a 0 deposit when depositPct is 0', () => {
    const t = calcTotals(doc({ lines: [line('a', 1, 0)] }))
    expect(t.depositPct).toBe(0)
    expect(t.depositCents).toBe(0)
    expect(t.remainingCents).toBe(t.totalCents)
  })

  it('reports mixed rates and keeps per-line labor = hours × that line’s rate', () => {
    const t = calcTotals(doc({ lines: [line('a', 2, 0), line('b', 1, 0, { rate: 95 })] }))
    expect(t.lines[1].laborCents).toBe(9500)
    expect(t.uniformRateCents).toBeNull()
    expect(laborLabel(t)).toBe('Labor (3 hrs, mixed rates)')
  })

  it('qty multiplies nothing (parity with the old app, which had no line quantity)', () => {
    const a = calcLine(line('a', 2, 40, { qty: 1 }))
    const b = calcLine(line('b', 2, 40, { qty: 5 }))
    expect(b.lineTotalCents).toBe(a.lineTotalCents)
  })
})

describe('sections and numbering', () => {
  it('letters sections A…Z, AA, AB and numbers lines continuously with unsectioned lines first', () => {
    expect(sectionLetter(0)).toBe('A')
    expect(sectionLetter(25)).toBe('Z')
    expect(sectionLetter(26)).toBe('AA')
    expect(sectionLetter(27)).toBe('AB')
    const e = doc({
      sections: [
        { id: 's1', title: 'Structural Repair' },
        { id: 's2', title: '' },
        { id: 's3', title: 'Finish' },
      ],
      lines: [
        line('x', 1, 0, { sectionId: 's3' }),
        line('u', 1, 0),
        line('y', 1, 0, { sectionId: 's1' }),
        line('z', 1, 0, { sectionId: 's1' }),
        line('orphan', 1, 0, { sectionId: 'gone' }),
      ],
    })
    const l = layoutLines(e)
    expect(l.unsectioned.map((p) => p.line.id)).toEqual(['u', 'orphan'])
    expect(l.unsectioned.map((p) => p.number)).toEqual([1, 2])
    expect(l.sections.map((s) => s.heading)).toEqual(['A. Structural Repair', 'B. Untitled section', 'C. Finish'])
    expect(l.sections[0].lines.map((p) => p.number)).toEqual([3, 4])
    expect(l.sections[1].lines).toEqual([])
    expect(l.sections[2].lines.map((p) => p.number)).toEqual([5])
    expect(l.all.map((p) => p.line.id)).toEqual(['u', 'orphan', 'y', 'z', 'x'])
    expect(lineNumberOf(e, 'x')).toBe(5)
    expect(lineNumberOf(e, 'nope')).toBe(0)
  })
})

describe('titles, notes and formatting', () => {
  it('builds the document title from docKind + revision', () => {
    expect(documentTitle({ docKind: 'estimate', revision: 3 })).toEqual({ title: 'REPAIR ESTIMATE' })
    expect(documentTitle({ docKind: 'supplement', revision: 0 })).toEqual({ title: 'REPAIR ESTIMATE', subtitle: 'SUPPLEMENT REQUEST' })
    expect(documentTitle({ docKind: 'supplement', revision: 5 })).toEqual({ title: 'REPAIR ESTIMATE', subtitle: 'SUPPLEMENT REQUEST — REV. 5' })
  })

  it('prints the Rev. 5 pricing note', () => {
    expect(pricingNote(newEstimate()).replace(/\s+/g, ' ')).toBe('Labor rate: $125.00/hr · Sales tax: 7% (6% Florida + 1% Pinellas County) on the total repair charge.')
  })

  it('formats money and numeric dates', () => {
    expect(formatMoney(121499)).toBe('$1,214.99')
    expect(formatMoney(0)).toBe('$0.00')
    expect(formatMoney(-250)).toBe('-$2.50')
    expect(formatMoney(123456789)).toBe('$1,234,567.89')
    expect(formatDateNumeric('2026-09-11')).toBe('09/11/2026')
    expect(formatDateNumeric('2026-08-29T14:00:00.000Z')).toBe('08/29/2026')
    expect(formatDateNumeric('')).toBe('')
    expect(formatDateNumeric('Sept 1')).toBe('Sept 1')
  })
})

describe('normalizeEstimate / newEstimate', () => {
  it('turns {} into a valid empty draft with ids, dates and defaults', () => {
    const e = normalizeEstimate({})
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(e.status).toBe('draft')
    expect(e.docKind).toBe('estimate')
    expect(e.revision).toBe(0)
    expect(e.number).toBe('')
    expect(e.customer).toEqual({ name: '', company: '', email: '', phone: '', addressLines: [] })
    expect(e.vessel.registration).toBe('')
    expect(e.insurance.enabled).toBe(false)
    expect(e.directionToPay).toBe(false)
    expect(e.pricing).toEqual({ laborRate: 125, taxRate: 7, taxNote: '6% Florida + 1% Pinellas County', depositPct: 0 })
    expect(e.sections).toEqual([])
    expect(e.lines).toEqual([])
    expect(e.photos).toEqual([])
    expect(e.estimateDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(e.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(estimateSchema.safeParse(e).success).toBe(true)
    expect(normalizeEstimate(e)).toEqual(e) // idempotent
  })

  it('fills partial lines (rate from the document), drops junk, keeps what is there', () => {
    const e = newEstimate({
      number: 'E-1001',
      pricing: { laborRate: 110 },
      insurance: { enabled: true, carrier: 'Progressive' },
      sections: [{ id: 'A', title: 'Hull' }],
      lines: [{ description: 'Grind\nDetail', hours: 2, sectionId: 'A' }, { description: 'Resin', materials: 40, materialsOnly: true, sectionId: 'missing' }],
      photos: [{ url: 'blob:1', caption: 'Port side' }],
    })
    expect(e.number).toBe('E-1001')
    expect(e.directionToPay).toBe(true) // follows insurance when absent
    expect(e.lines[0].rate).toBe(110)
    expect(e.lines[0].id).toBeTruthy()
    expect(e.lines[0].taxable).toBe(true)
    expect(e.lines[1].sectionId).toBeNull()
    expect(e.lines[1].materialsOnly).toBe(true)
    expect(e.photos[0].id).toBeTruthy()
    const n = newLine(e)
    expect(n.rate).toBe(110)
    expect(normalizeEstimate(null).status).toBe('draft')
    expect(normalizeEstimate({ status: 'bogus', lines: ['junk', null, { hours: 'x' }] }).lines).toHaveLength(1)
  })

  it('maps legacy ESTIMATER fields (cents, yearMake, adjuster, address string)', () => {
    const e = normalizeEstimate({
      date: '2026-09-11',
      depositPct: 10,
      customer: { name: 'J', address: '1 Dock St, Tampa, FL 33602' },
      vessel: { yearMake: '2004 Sea Ray', model: '270', boatName: 'Sundance' },
      insurance: { enabled: true, adjuster: 'Steve', carrierEstimate: '26-1' },
      pricing: { laborRateCents: 12500, taxRatePct: 7 },
      lines: [{ id: 'l1', description: 'x', hours: 1, rateCents: 9500, materialsLumpCents: 1234 }],
    })
    expect(e.estimateDate).toBe('2026-09-11')
    expect(e.pricing.depositPct).toBe(10)
    expect(e.customer.addressLines).toEqual(['1 Dock St, Tampa, FL 33602'])
    expect(e.vessel).toMatchObject({ year: '2004', make: 'Sea Ray', model: '270', name: 'Sundance' })
    expect(e.insurance.adjusterName).toBe('Steve')
    expect(e.insurance.carrierEstimateNumber).toBe('26-1')
    expect(e.lines[0]).toMatchObject({ rate: 95, materials: 12.34 })
  })
})

describe('renderEstimateHtml', () => {
  const base = () =>
    newEstimate({
      number: 'E-1002',
      docKind: 'supplement',
      revision: 2,
      estimateDate: '2026-09-11',
      customer: { name: 'Jane <McKinney>', phone: '727-555-0101', email: 'jane@example.com', addressLines: ['1 Bay Dr', 'Largo, FL 33773'] },
      vessel: { year: '2019', make: 'Robalo', model: 'R242', name: 'Reel Deal', hin: 'ABC12345D919', registration: 'FL1914TV', location: 'On trailer at the yard' },
      insurance: {
        enabled: true,
        carrier: 'Progressive',
        claimNumber: '26-918740453-01',
        dateOfLoss: '2026-08-29',
        reportedDate: '2026-08-30',
        adjusterName: 'Steven O.',
        adjusterPhone: '800-555-0199',
        adjusterEmail: 'steve@carrier.example',
        appraiserName: 'Pat Q.',
        carrierEstimateNumber: '26-918740453-01',
        carrierEstimateDate: '2026-09-11',
      },
      sections: [{ id: 's1', title: 'Structural Repair — Starboard Side' }],
      lines: [
        { id: 'l1', sectionId: 's1', description: 'Grind and laminate\nSee Photo 1 for the crack.', hours: 4, rate: 125, materials: 220 },
        { id: 'l2', sectionId: 's1', description: 'Resin & cloth', materials: 85, materialsOnly: true },
      ],
      notes: 'Owner to remove gear.',
      terms: 'Due on completion.',
      photos: [{ id: 'p1', url: 'https://example.com/p1.jpg', caption: 'Starboard crack' }],
    })

  const render = (e: Estimate) => renderEstimateHtml(e, BUSINESS, calcTotals(e), layoutLines(e))

  it('prints the Rev. 5 supplement with insurance, Direction to Pay and the photo appendix', () => {
    const e = base()
    const html = render(e)
    expect(html).toContain('Jane &lt;McKinney&gt;')
    expect(html).not.toContain('<McKinney>')
    expect(html).toContain('SUPPLEMENT REQUEST — REV. 2')
    expect(html).toContain('REPAIR ESTIMATE')
    expect(html).toContain('E-1002-R2')
    expect(html).toContain('Owner / Insured')
    expect(html).toContain('Owner / Insured signature (authorizes work)')
    expect(html).toContain('FL Reg.')
    expect(html).toContain('Reel Deal')
    expect(html).toContain('08/29/2026')
    expect(html).toContain('26-918740453-01 (Original, 09/11/2026)')
    expect(html).toContain('A. Structural Repair — Starboard Side')
    expect(html).toContain('Direction to Pay')
    expect(html).toContain('authorize and direct Progressive to issue payment')
    expect(html).toContain('Payable to: <strong>Test Yard LLC</strong>')
    expect(html).toContain('Photo Appendix')
    expect(html).toContain('href="#photo-1"')
    expect(html).toContain('id="photo-1"')
    expect(html).toContain('Starboard crack')
    // totals: labor 500.00, materials 305.00, subtotal 805.00, tax 56.35, total 861.35
    expect(html).toContain('$861.35')
    expect(html).toContain('$56.35')
    expect(html).toContain('Labor (4 hrs @ $125.00)')
    // materials-only row prints dashes in HRS / RATE / LABOR
    expect(html).toMatch(/Resin &amp; cloth<\/div><\/td>\n<td>—<\/td>\n<td>—<\/td>\n<td>—<\/td>\n<td>\$85\.00<\/td>/)
    expect(html).toContain('Claim # 26-918740453-01 · Jane &lt;McKinney&gt; · 2019 Robalo R242')
    expect(html).toContain('1 Dock St, Largo, FL 33773')
    expect(html).not.toContain('Deposit Due')
  })

  it('prints a plain estimate as CUSTOMER with no Direction to Pay page when insurance is off', () => {
    const e = base()
    e.insurance.enabled = false
    e.docKind = 'estimate'
    e.photos = []
    const html = render(e)
    expect(html).toContain('>Customer<')
    expect(html).not.toContain('Owner / Insured')
    expect(html).not.toContain('Direction to Pay')
    expect(html).not.toContain('SUPPLEMENT REQUEST')
    expect(html).not.toContain('Photo Appendix')
    expect(html).toContain('Customer signature (authorizes work)')
    expect(html).toContain('Insurance Claim Information (If Applicable)')
    expect(html).toContain('Make payment payable to <strong>Test Yard LLC</strong>')
  })

  it('shows deposit rows only when the deposit percentage is above 0', () => {
    const e = base()
    e.pricing.depositPct = 20
    expect(render(e)).toContain('Deposit Due (20%)')
  })
})
