// One estimate document — the model behind the printed Rev. 5 estimate / supplement.
// Ported (trimmed) from the retired ESTIMATER app's src/lib/types.ts + src/data/docs.ts.
//
// Money on the document is stored in DOLLARS as plain numbers (rate: 125, materials: 340.5);
// lib/estimates/calc.ts converts to integer cents before any arithmetic. Percentages are plain
// numbers (7 = 7%). Dates are ISO strings: calendar dates "YYYY-MM-DD", timestamps full ISO.
//
// No Node-only or DOM dependencies here besides the global `crypto.randomUUID()` (Node ≥ 19 and
// every modern browser), so the same schema can be mirrored client-side.

import { z } from 'zod'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DocKind = 'estimate' | 'supplement'
export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'declined'

export interface EstimateCustomer {
  name: string
  company: string
  email: string
  phone: string
  /** Postal address, one line per entry (street / city-state-zip). Blank entries are dropped. */
  addressLines: string[]
}

export interface EstimateVessel {
  year: string
  make: string
  model: string
  name: string
  hin: string
  /** State registration number, printed as "<state> Reg." (FL Reg.) */
  registration: string
  /** Where the vessel is (address or marina) */
  location: string
}

export interface EstimateInsurance {
  enabled: boolean
  carrier: string
  claimNumber: string
  dateOfLoss: string
  /** Date the loss was reported to the carrier */
  reportedDate: string
  adjusterName: string
  adjusterPhone: string
  adjusterEmail: string
  appraiserName: string
  appraiserPhone: string
  appraiserEmail: string
  /** Date of the carrier's original estimate, printed as "(Original, MM/DD/YYYY)" */
  carrierEstimateDate: string
  carrierEstimateNumber: string
}

/** A lettered heading that groups lines ("A. Structural Repair"). Letters follow array order. */
export interface EstimateSection {
  id: string
  title: string
}

export interface EstimateLine {
  id: string
  /** Section this line prints under; null = before the first section */
  sectionId: string | null
  /** First line prints bold as the title, the rest as detail text */
  description: string
  /** Informational only — it multiplies nothing (the old app had no line quantity). */
  qty: number
  unit: string
  hours: number
  /** Labor rate in dollars per hour for this line */
  rate: number
  /** Materials for this line, in dollars (a lump sum, like the old materialsLumpCents) */
  materials: number
  /** No labor: prints "—" in HRS / RATE / LABOR and contributes no labor hours */
  materialsOnly: boolean
  /** When false the line total is left out of the tax base. Default true (Rev. 5 taxes everything). */
  taxable: boolean
}

export interface EstimatePricing {
  /** Dollars per hour, the default for new lines */
  laborRate: number
  /** Percent, 7 = 7% */
  taxRate: number
  /** How the rate is made up, printed in the pricing note */
  taxNote: string
  /** Percent of the total due as deposit; 0 hides the deposit rows */
  depositPct: number
}

export interface EstimatePhoto {
  id: string
  url: string
  caption: string
}

export interface Estimate {
  id: string
  /** "E-1001" — assigned by the caller; empty on a brand-new draft */
  number: string
  status: EstimateStatus
  docKind: DocKind
  /** 0 = original. A supplement with revision N prints "SUPPLEMENT REQUEST — REV. N" */
  revision: number
  customer: EstimateCustomer
  vessel: EstimateVessel
  insurance: EstimateInsurance
  sections: EstimateSection[]
  lines: EstimateLine[]
  notes: string
  terms: string
  pricing: EstimatePricing
  /** Print the Direction to Pay page (only when insurance is enabled) */
  directionToPay: boolean
  photos: EstimatePhoto[]
  estimateDate: string
  createdAt: string
  updatedAt: string
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_LABOR_RATE = 125
export const DEFAULT_TAX_RATE = 7
/** From the shop's Rev. 5 estimate */
export const DEFAULT_TAX_NOTE = '6% Florida + 1% Pinellas County'

export function newId(): string {
  return crypto.randomUUID()
}

export function nowISO(): string {
  return new Date().toISOString()
}

/** Today's local calendar date as YYYY-MM-DD */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Schemas ───────────────────────────────────────────────────────────────────
// Every field has a fallback so a partial (or legacy) object normalizes instead of failing:
// `.catch()` replaces anything missing or of the wrong type with the default, `.prefault({})`
// runs an absent nested object through its own schema so its defaults apply too.

const str = z.string().catch('')
const num = (fallback: number) => z.number().catch(fallback)
const bool = (fallback: boolean) => z.boolean().catch(fallback)
const id = z.string().min(1).catch(() => newId())
const isoDate = (fallback: () => string) => z.string().catch(fallback)

const stringLines = z
  .union([z.array(z.unknown()), z.string()])
  .catch([])
  .transform((v) => (typeof v === 'string' ? v.split(/\r?\n/) : v).map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean))

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Normalize an array field element-by-element: non-object entries are dropped, the rest parsed. */
const listOf = <S extends z.ZodType>(schema: S) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((arr) => arr.filter(isRecord).map((x) => schema.parse(x) as z.output<S>))

export const customerSchema = z.preprocess(
  (v) => {
    // Legacy: a single `address` string becomes the address lines
    if (isRecord(v) && v.addressLines === undefined && typeof v.address === 'string') return { ...v, addressLines: v.address }
    return v
  },
  z.object({ name: str, company: str, email: str, phone: str, addressLines: stringLines }),
)

export const vesselSchema = z.preprocess(
  (v) => {
    // Legacy: `yearMake: "2004 Sea Ray"` → year + make; `boatName` → name
    if (!isRecord(v)) return v
    const out: Record<string, unknown> = { ...v }
    if (out.name === undefined && typeof out.boatName === 'string') out.name = out.boatName
    if (out.year === undefined && out.make === undefined && typeof out.yearMake === 'string') {
      const m = out.yearMake.trim().match(/^(\d{4})\s*(.*)$/)
      if (m) {
        out.year = m[1]
        out.make = m[2]
      } else out.make = out.yearMake.trim()
    }
    return out
  },
  z.object({ year: str, make: str, model: str, name: str, hin: str, registration: str, location: str }),
)

export const insuranceSchema = z.preprocess(
  (v) => {
    // Legacy: `adjuster` → adjusterName, `carrierEstimate` → carrierEstimateNumber
    if (!isRecord(v)) return v
    const out: Record<string, unknown> = { ...v }
    if (out.adjusterName === undefined && typeof out.adjuster === 'string') out.adjusterName = out.adjuster
    if (out.carrierEstimateNumber === undefined && typeof out.carrierEstimate === 'string') out.carrierEstimateNumber = out.carrierEstimate
    return out
  },
  z.object({
    enabled: bool(false),
    carrier: str,
    claimNumber: str,
    dateOfLoss: str,
    reportedDate: str,
    adjusterName: str,
    adjusterPhone: str,
    adjusterEmail: str,
    appraiserName: str,
    appraiserPhone: str,
    appraiserEmail: str,
    carrierEstimateDate: str,
    carrierEstimateNumber: str,
  }),
)

export const sectionSchema = z.object({ id, title: str })

/** `rate` stays nullable here; `estimateSchema` fills a missing rate with the document's labor rate. */
const rawLineSchema = z.preprocess(
  (v) => {
    // Legacy cents fields from the old app
    if (!isRecord(v)) return v
    const out: Record<string, unknown> = { ...v }
    if (out.rate === undefined && typeof out.rateCents === 'number') out.rate = out.rateCents / 100
    if (out.materials === undefined && typeof out.materialsLumpCents === 'number') out.materials = out.materialsLumpCents / 100
    if (typeof out.materials !== 'number') delete out.materials
    return out
  },
  z.object({
    id,
    sectionId: z.string().min(1).nullable().catch(null),
    description: str,
    qty: num(1),
    unit: str,
    hours: num(0),
    rate: z.number().nullable().catch(null),
    materials: num(0),
    materialsOnly: bool(false),
    taxable: bool(true),
  }),
)

export const pricingSchema = z.preprocess(
  (v) => {
    if (!isRecord(v)) return v
    const out: Record<string, unknown> = { ...v }
    if (out.laborRate === undefined && typeof out.laborRateCents === 'number') out.laborRate = out.laborRateCents / 100
    if (out.taxRate === undefined && typeof out.taxRatePct === 'number') out.taxRate = out.taxRatePct
    return out
  },
  z.object({
    laborRate: num(DEFAULT_LABOR_RATE),
    taxRate: num(DEFAULT_TAX_RATE),
    taxNote: z.string().catch(DEFAULT_TAX_NOTE),
    depositPct: num(0),
  }),
)

export const photoSchema = z.object({ id, url: str, caption: str })

const rawEstimateSchema = z.object({
  id,
  number: str,
  status: z.enum(['draft', 'sent', 'approved', 'declined']).catch('draft'),
  docKind: z.enum(['estimate', 'supplement']).catch('estimate'),
  revision: z.number().int().min(0).catch(0),
  customer: customerSchema.prefault({}),
  vessel: vesselSchema.prefault({}),
  insurance: insuranceSchema.prefault({}),
  sections: listOf(sectionSchema),
  lines: listOf(rawLineSchema),
  notes: str,
  terms: str,
  pricing: pricingSchema.prefault({}),
  /** Absent → follows insurance.enabled (old upgrade rule); explicit boolean wins */
  directionToPay: z.boolean().nullable().catch(null),
  photos: listOf(photoSchema),
  estimateDate: isoDate(todayISO),
  createdAt: isoDate(nowISO),
  updatedAt: isoDate(nowISO),
})

/** Parses anything into a complete `Estimate`; never throws for non-object input (it becomes an empty draft). */
export const estimateSchema = z.preprocess(
  (v) => {
    if (!isRecord(v)) return {}
    const out: Record<string, unknown> = { ...v }
    // Legacy: `date` → estimateDate, `depositPct` at the root → pricing.depositPct
    if (out.estimateDate === undefined && typeof out.date === 'string') out.estimateDate = out.date
    if (typeof out.depositPct === 'number') out.pricing = { ...(isRecord(out.pricing) ? out.pricing : {}), depositPct: out.depositPct }
    return out
  },
  rawEstimateSchema.transform((e): Estimate => {
    const sectionIds = new Set(e.sections.map((s) => s.id))
    return {
      ...e,
      lines: e.lines.map((l) => ({
        ...l,
        rate: l.rate ?? e.pricing.laborRate,
        sectionId: l.sectionId && sectionIds.has(l.sectionId) ? l.sectionId : null,
      })),
      directionToPay: e.directionToPay ?? e.insurance.enabled,
    }
  }),
)

export function normalizeEstimate(input: unknown): Estimate {
  return estimateSchema.parse(input)
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? DeepPartial<U>[] : T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** A valid empty draft (fresh ids and dates) with any given fields applied. */
export function newEstimate(partial: DeepPartial<Estimate> = {}): Estimate {
  return normalizeEstimate(partial)
}

/** A blank line that inherits the document's labor rate. */
export function newLine(estimate: Pick<Estimate, 'pricing'>, partial: Partial<EstimateLine> = {}): EstimateLine {
  return {
    id: newId(),
    sectionId: null,
    description: '',
    qty: 1,
    unit: '',
    hours: 0,
    rate: estimate.pricing.laborRate,
    materials: 0,
    materialsOnly: false,
    taxable: true,
    ...partial,
  }
}
