// Pricing + layout math for an estimate document. Ported faithfully from the retired ESTIMATER's
// src/lib/pricing.ts, src/lib/money.ts, src/lib/sections.ts, src/lib/util.ts and src/data/docs.ts.
//
// Rules (unchanged from the old app, as printed on the shop's Rev. 5 estimate):
//   • Labor per line     = hours × rate, rounded to the cent (hours carried to 0.001 h).
//     A materials-only line has no labor whatever its hours field says.
//   • Materials per line = the line's materials amount (a lump sum; nothing is multiplied by qty).
//   • Line total         = labor + materials.
//   • Tax                = taxable base × tax rate, rounded to the cent. The base is the sum of the
//                          taxable lines' totals — all of them unless a line sets taxable: false.
//   • Deposit            = total × deposit %, rounded to the cent. Remaining = total − deposit.
// Rounding is half away from zero at each of those steps and nowhere else. All arithmetic is on
// integer cents (BigInt for the products) so numbers match the old engine exactly.
//
// Pure: no DOM, no Node APIs — the same code can be mirrored client-side.

import type { DocKind, Estimate, EstimateLine, EstimatePricing, EstimateSection } from './types.js'

// ─── Fixed-point helpers (money.ts) ────────────────────────────────────────────

const HOURS_SCALE = 1000 // 0.001 h
const PCT_SCALE = 10000 // percentages carried to 0.0001%

/** Round half away from zero of numerator/denominator, both integers. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('roundDiv: division by zero')
  const neg = numerator < 0n !== denominator < 0n
  const n = numerator < 0n ? -numerator : numerator
  const d = denominator < 0n ? -denominator : denominator
  const q = (n * 2n + d) / (2n * d)
  return neg ? -q : q
}

/** Decimal number → scaled integer, e.g. toFixedInt(6.5, 100) = 650n. Non-finite → 0n. */
export function toFixedInt(value: number, scale: number): bigint {
  if (!Number.isFinite(value)) return 0n
  return BigInt(Math.round(value * scale))
}

/** Dollars (as stored on the document) → integer cents. */
export function toCents(dollars: number): number {
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0
}

export function laborCents(hours: number, rateCents: number): number {
  return Number(roundDiv(toFixedInt(hours, HOURS_SCALE) * BigInt(Math.round(rateCents)), BigInt(HOURS_SCALE)))
}

/** pct % of cents, rounded half-up to the cent. */
export function percentOf(cents: number, pct: number): number {
  return Number(roundDiv(BigInt(Math.round(cents)) * toFixedInt(pct, PCT_SCALE), BigInt(100 * PCT_SCALE)))
}

// ─── Lines ─────────────────────────────────────────────────────────────────────

/** Hours that count as labor: a materials-only line has none. */
export function laborHoursOf(line: Pick<EstimateLine, 'hours' | 'materialsOnly'>): number {
  return line.materialsOnly ? 0 : line.hours
}

export interface LineCalc {
  id: string
  laborHours: number
  rateCents: number
  laborCents: number
  materialsCents: number
  lineTotalCents: number
  taxable: boolean
}

export function calcLine(line: EstimateLine, _pricing?: EstimatePricing): LineCalc {
  const hours = laborHoursOf(line)
  const rateCents = toCents(line.rate)
  const labor = laborCents(hours, rateCents)
  const materials = toCents(line.materials)
  return {
    id: line.id,
    laborHours: hours,
    rateCents,
    laborCents: labor,
    materialsCents: materials,
    lineTotalCents: labor + materials,
    taxable: line.taxable !== false,
  }
}

// ─── Totals ────────────────────────────────────────────────────────────────────

export interface Totals {
  lines: LineCalc[]
  laborHours: number
  /** Single rate (cents) when every line with hours uses the same rate, else null ("mixed rates") */
  uniformRateCents: number | null
  laborCents: number
  materialsCents: number
  subtotalCents: number
  taxableCents: number
  taxRate: number
  taxCents: number
  totalCents: number
  depositPct: number
  depositCents: number
  remainingCents: number
}

export function calcTotals(estimate: Pick<Estimate, 'lines' | 'pricing'>): Totals {
  const lines = estimate.lines.map((l) => calcLine(l, estimate.pricing))
  const laborHoursMilli = estimate.lines.reduce((s, l) => s + Math.round(laborHoursOf(l) * HOURS_SCALE), 0)
  const rates = new Set(lines.filter((l) => l.laborHours > 0).map((l) => l.rateCents))
  const labor = lines.reduce((s, l) => s + l.laborCents, 0)
  const materials = lines.reduce((s, l) => s + l.materialsCents, 0)
  const subtotal = labor + materials
  const taxable = lines.filter((l) => l.taxable).reduce((s, l) => s + l.lineTotalCents, 0)
  const tax = percentOf(taxable, estimate.pricing.taxRate)
  const total = subtotal + tax
  const deposit = percentOf(total, estimate.pricing.depositPct)
  return {
    lines,
    laborHours: laborHoursMilli / HOURS_SCALE,
    uniformRateCents: rates.size === 1 ? [...rates][0] : null,
    laborCents: labor,
    materialsCents: materials,
    subtotalCents: subtotal,
    taxableCents: taxable,
    taxRate: estimate.pricing.taxRate,
    taxCents: tax,
    totalCents: total,
    depositPct: estimate.pricing.depositPct,
    depositCents: deposit,
    remainingCents: total - deposit,
  }
}

/** "Labor (6.5 hrs @ $125.00)" — the label used on the paper's totals block */
export function laborLabel(t: Totals): string {
  const hrs = Math.round(t.laborHours * 100) / 100
  if (t.uniformRateCents == null) return t.laborHours > 0 ? `Labor (${hrs} hrs, mixed rates)` : 'Labor'
  return `Labor (${hrs} hrs @ $${(t.uniformRateCents / 100).toFixed(2)})`
}

/** "Sales Tax (7%)" */
export function taxLabel(taxRate: number): string {
  return `Sales Tax (${Math.round(taxRate * 1000) / 1000}%)`
}

// ─── Sections and numbering (sections.ts) ──────────────────────────────────────

/** A, B … Z, AA, AB … */
export function sectionLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

export interface PlacedLine {
  line: EstimateLine
  /** 1-based, continuous across sections */
  number: number
  /** Index into `sections` (undefined for lines before the first section) */
  sectionIndex?: number
}

export interface PlacedSection {
  section: EstimateSection
  index: number
  letter: string
  /** "A. Transport & Inspection" */
  heading: string
  lines: PlacedLine[]
}

export interface LineLayout {
  /** Lines that belong to no section — printed first */
  unsectioned: PlacedLine[]
  sections: PlacedSection[]
  /** Every line in print order */
  all: PlacedLine[]
}

/**
 * Lines in print order: unsectioned lines first (array order), then each section's lines (array
 * order). Numbering is continuous. A line whose section no longer exists counts as unsectioned.
 */
export function layoutLines(estimate: Pick<Estimate, 'sections' | 'lines'>): LineLayout {
  const { sections, lines } = estimate
  const ids = new Set(sections.map((s) => s.id))
  const unsectioned: PlacedLine[] = []
  const bySection = new Map<string, PlacedLine[]>(sections.map((s) => [s.id, []]))
  for (const line of lines) {
    if (line.sectionId && ids.has(line.sectionId)) bySection.get(line.sectionId)!.push({ line, number: 0 })
    else unsectioned.push({ line, number: 0 })
  }
  const all: PlacedLine[] = []
  let n = 0
  for (const p of unsectioned) {
    p.number = ++n
    all.push(p)
  }
  const placed: PlacedSection[] = sections.map((section, index) => {
    const own = bySection.get(section.id)!
    for (const p of own) {
      p.number = ++n
      p.sectionIndex = index
      all.push(p)
    }
    const letter = sectionLetter(index)
    return { section, index, letter, heading: `${letter}. ${section.title.trim() || 'Untitled section'}`, lines: own }
  })
  return { unsectioned, sections: placed, all }
}

/** Line ids in print order — what "line N" refers to. */
export function orderedLineIds(estimate: Pick<Estimate, 'sections' | 'lines'>): string[] {
  return layoutLines(estimate).all.map((p) => p.line.id)
}

/** The printed number of a line (1-based), or 0 when it isn't on the document. */
export function lineNumberOf(estimate: Pick<Estimate, 'sections' | 'lines'>, lineId: string): number {
  return orderedLineIds(estimate).indexOf(lineId) + 1
}

/** The first line of a description is its title (printed bold); the rest is the detail text. */
export function splitDescription(description: string): { title: string; body: string } {
  const [first = '', ...rest] = description.split('\n')
  return { title: first.trim(), body: rest.join('\n').trim() }
}

/** A line with nothing on it — the old paper left these off the document. */
export function isBlankLine(line: EstimateLine): boolean {
  return !line.description.trim() && !line.hours && !line.materials
}

// ─── Titles and notes (sections.ts / docs.ts) ──────────────────────────────────

export const DOC_KIND_LABEL: Record<DocKind, string> = { estimate: 'Repair Estimate', supplement: 'Supplement Request' }

/** Title/subtitle printed at the top of the document. */
export function documentTitle(estimate: Pick<Estimate, 'docKind' | 'revision'>): { title: string; subtitle?: string } {
  if (estimate.docKind === 'supplement') {
    return { title: 'REPAIR ESTIMATE', subtitle: estimate.revision > 0 ? `SUPPLEMENT REQUEST — REV. ${estimate.revision}` : 'SUPPLEMENT REQUEST' }
  }
  return { title: 'REPAIR ESTIMATE' }
}

/** "E-1001-R2" — the number printed on a revision (0 = the base number). */
export function estimateNumberLabel(estimate: Pick<Estimate, 'number' | 'revision'>): string {
  return estimate.revision > 0 ? `${estimate.number}-R${estimate.revision}` : estimate.number
}

/** "Labor rate: $125.00/hr  ·  Sales tax: 7% (6% Florida + 1% Pinellas County) on the total repair charge." */
export function pricingNote(estimate: Pick<Estimate, 'pricing'>): string {
  const p = estimate.pricing
  const rate = `Labor rate: $${(toCents(p.laborRate) / 100).toFixed(2)}/hr`
  const pct = `${Math.round(p.taxRate * 1000) / 1000}%`
  const breakdown = p.taxNote.trim() ? ` (${p.taxNote.trim()})` : ''
  return `${rate}  ·  Sales tax: ${pct}${breakdown} on the total repair charge.`
}

// ─── Formatting (money.ts / util.ts) — no Intl so output is identical everywhere ──

/** "$1,234.56" / "−$12.00" from integer cents */
export function formatMoney(cents: number): string {
  const n = Math.round(Number.isFinite(cents) ? cents : 0)
  const abs = Math.abs(n)
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = String(abs % 100).padStart(2, '0')
  return `${n < 0 ? '-' : ''}$${whole}.${frac}`
}

/** "1,234.56" without the currency symbol */
export function formatAmount(cents: number): string {
  return formatMoney(cents).replace(/^(-?)\$/, '$1')
}

/** 2 → "2.0", 1.5 → "1.5", 1.333 → "1.33" */
export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? hours.toFixed(1) : String(Math.round(hours * 100) / 100)
}

/** "08/29/2026" from "2026-08-29" (or an ISO timestamp). Anything else is returned unchanged. */
export function formatDateNumeric(value?: string): string {
  if (!value) return ''
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return value
  const [, y, mo, d] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d))
  if (Number.isNaN(date.getTime())) return value
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${date.getFullYear()}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Sep 14, 2026" from "2026-09-14" (or an ISO timestamp, in local time). */
export function formatDate(value?: string): string {
  if (!value) return ''
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}
