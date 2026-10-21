// Business facts and the quote-form service list, read from the same JSON the pages are built from.
// Loaded with new URL(..., import.meta.url) so Vercel's file tracer bundles the files with the functions.
import { readFileSync } from 'node:fs'
import { env } from './env.js'

export interface Business {
  name: string; legalName: string; tagline: string; phone: string; phoneHref: string; email: string
  address: { street: string; city: string; state: string; zip: string; mapsUrl: string; mapsEmbed?: string }
  hours: { display: string; short: string; note: string; timezone: string }
  yearsClaim: string; serviceArea: string[]; siteUrl: string; turnstileSiteKey?: string
}

const FALLBACK_SERVICES: { value: string; label: string }[] = [
  { value: 'fiberglass-repair', label: 'Fiberglass Repair (not sure which)' },
  { value: 'structural-fiberglass', label: 'Structural Fiberglass Repair' },
  { value: 'hull-repairs', label: 'Hull Repairs' },
  { value: 'deck-repairs', label: 'Deck Repairs' },
  { value: 'transom-replacement', label: 'Transom Repair / Replacement' },
  { value: 'stringer-repairs', label: 'Stringer Repairs' },
  { value: 'bulkhead-repairs', label: 'Bulkhead Repairs' },
  { value: 'custom-fabrication', label: 'Custom Fabrication' },
  { value: 'gelcoat-repair', label: 'Gelcoat Repair & Color Matching' },
  { value: 'boat-detailing', label: 'Boat Detailing' },
  { value: 'boat-restoration', label: 'Boat Restoration' },
  { value: 'boat-yard', label: 'Boat Yard / Storage / Haul-Out' },
  { value: 'pwc-repair', label: 'Jet Ski / Sea-Doo / WaveRunner' },
  { value: 'kayak-repair', label: 'Kayak Repair' },
  { value: 'insurance-claim', label: 'Insurance Claim Repair' },
  { value: 'other', label: 'Other / Not Sure' },
]

let biz: Business | null = null
let services: { value: string; label: string }[] | null = null

function readJson<T>(rel: string): T | null {
  try { return JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as T } catch { return null }
}

export function business(): Business {
  if (!biz) {
    biz = readJson<Business>('../site/business.json') || {
      name: "Captain Levi's", legalName: "Boat Yard Captain Levi's LLC", tagline: 'Tampa Bay Fiberglass Boat Repair',
      phone: '727-391-7639', phoneHref: 'tel:7273917639', email: 'captainlevis@yahoo.com',
      address: { street: '11600 66th St N', city: 'Largo', state: 'FL', zip: '33773', mapsUrl: 'https://www.google.com/maps/search/?api=1&query=11600+66th+St+N,+Largo,+FL+33773' },
      hours: { display: 'Mon – Sat: 7:30 AM – 3:30 PM', short: 'Mon–Sat 7:30am–3:30pm', note: 'Closed Sunday', timezone: 'America/New_York' },
      yearsClaim: '50+ Years', serviceArea: ['Largo', 'Tampa Bay'], siteUrl: 'https://www.captainlevis.com',
    }
  }
  return biz
}

export function serviceOptions(): { value: string; label: string }[] {
  if (!services) {
    const reg = readJson<{ services?: { value: string; label: string }[] }>('../site/pages.json')
    const list = (reg?.services || []).filter((s) => s.value)
    services = list.length ? list : FALLBACK_SERVICES
  }
  return services
}

export function serviceValues(): string[] { return serviceOptions().map((s) => s.value) }

export function serviceLabel(value: string): string {
  return serviceOptions().find((s) => s.value === value)?.label || value || 'Not given'
}

export function siteUrl(): string { return env.siteUrl || business().siteUrl.replace(/\/$/, '') }

export function phoneDigits(): string { return business().phone.replace(/\D/g, '') }
