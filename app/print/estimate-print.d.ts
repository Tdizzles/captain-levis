// Types for the plain-ESM renderer next to this file (app/print/estimate-print.js).
import type { Estimate } from '../../lib/estimates/types.js'
import type { LineLayout, Totals } from '../../lib/estimates/calc.js'

export interface PrintBusiness {
  name: string
  legalName?: string
  phone?: string
  email?: string
  website?: string
  address?: string | { street?: string; city?: string; state?: string; zip?: string }
  /** Who checks are made out to; defaults to legalName, then name */
  payableTo?: string
  logoUrl?: string
}

export function renderEstimateHtml(estimate: Estimate, business: PrintBusiness, totals: Totals, layout: LineLayout): string
export function esc(value: unknown): string
export function formatMoney(cents: number): string
export function formatHours(hours: number): string
export function formatDateNumeric(value?: string): string
export function formatDate(value?: string): string
export function formatAddress(address: PrintBusiness['address']): string
export function businessContactLine(business: PrintBusiness): string
export function runningFooter(estimate: Estimate, business: PrintBusiness): string
export function splitDescription(description: string): { title: string; body: string }
export function laborLabel(totals: Totals): string
export function pricingNote(estimate: Pick<Estimate, 'pricing'>): string
export function documentTitle(estimate: Pick<Estimate, 'docKind' | 'revision'>): { title: string; subtitle?: string }
export function estimateNumberLabel(estimate: Pick<Estimate, 'number' | 'revision'>): string
