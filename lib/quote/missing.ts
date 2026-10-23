// What a proper quote still needs. Deterministic rules over the inquiry row + its photos; no AI.
// Priority 1 is the basics (photos, the boat, where it is) and is all the first reply asks for. A long first
// email loses the customer; everything else (year, size, insurance paperwork, timing) gets picked up later.
import { svcDef } from '../chat/quoteflow.js'
import type { InquiryRow } from '../inquiries.js'

export type GapKey = 'photos' | 'boat' | 'boat_year' | 'size' | 'area' | 'location' | 'in_water' | 'insurance' | 'timeline'

export interface Gap {
  key: GapKey
  label: string          // short label for the inbox checklist
  why: string            // why the crew needs it (shown to staff only)
  question: string       // priority 1: the short list line the first reply asks; otherwise how to ask it later
  priority: 1 | 2 | 3    // 1 = the basics, asked in the first reply; 2 = changes the job; 3 = nice to have
}

export interface Assessment {
  gaps: Gap[]
  have: GapKey[]
  readiness: 'ready' | 'nearly' | 'needs_info'
  insurance: boolean
  mentions: { inWater: boolean | null; size: boolean; area: string | null; insurance: boolean; urgency: boolean }
}

const AREA_WORDS: [RegExp, string][] = [
  [/\btransom\b/i, 'transom'], [/\bstringers?\b/i, 'stringers'], [/\bbulkheads?\b/i, 'bulkhead'], [/\bdeck\b|\bfloor\b|\bsole\b/i, 'deck'],
  [/\bhull\b|\bbottom\b|\bkeel\b|\bchine\b/i, 'hull'], [/\bbow\b/i, 'bow'], [/\bstern\b/i, 'stern'], [/\bgunwale\b|\bgunnel\b|\brub ?rail\b/i, 'gunwale / rub rail'],
  [/\bconsole\b|\bdash\b/i, 'console'], [/\bhatch(es)?\b|\blid\b/i, 'hatch'], [/\blivewell\b|\bfish ?box\b/i, 'livewell'], [/\bswim ?platform\b/i, 'swim platform'],
  [/\bwaterline\b/i, 'waterline'], [/\bside\b|\bport\b|\bstarboard\b/i, 'side'],
]
const SIZE_RE = /\b\d+(\.\d+)?\s?(["”']|in(ch(es)?)?|ft|feet|foot|cm|mm|square|sq)\b|\b(a|an|one|two|three|four|five|six|half an?|couple of|few|several)\s(foot|feet|inch(es)?|ft|square feet)\b|\b(dime|quarter|golf ?ball|baseball|softball|football|hand|palm|fist|dinner ?plate|basketball)[- ]?(size|sized)?\b|\bsize of\b/i
const IN_WATER_RE = /\b(in the water|in-water|at (the|my|a) (slip|dock|marina)|on a lift|boat ?lift|moored|mooring|wet slip|in (my|the) canal)\b/i
const OUT_WATER_RE = /\b(trailer|on the hard|dry ?stor(age|ed)|in (my|the|a) (yard|garage|driveway|shop|storage)|hauled out|out of the water|on blocks|rack(ed)? stor)/i
const INSURANCE_RE = /\b(insurance|claim|adjuster|appraiser|carrier|progressive|geico|allstate|state farm|boat ?us|boatus|nationwide|markel|foremost|usaa|chubb|travelers)\b/i
const CLAIM_NO_RE = /\b(claim\s*(#|no\.?|number)?\s*[:#]?\s*)?[0-9]{2}-?[0-9]{6,}\b/i
const URGENCY_RE = /\b(asap|urgent|this week|tomorrow|today|right away|soon as possible|deadline|trip|tournament|leaving)\b/i

export function assessInquiry(i: InquiryRow, photoCount: number): Assessment {
  const text = `${i.message || ''}\n${i.damage_location || ''}\n${i.damage_type || ''}\n${i.boat_location || ''}`
  const gaps: Gap[] = []
  const have: GapKey[] = []

  // chat inquiries carry structured answers; they win over guessing from the text (whose "Insurance: No" row
  // would otherwise read as an insurance job). Jobs that never ask size or area (transom, detailing ...) don't need them.
  const det = i.details || {}
  const job = svcDef(det.job)
  const inWater = typeof det.inWater === 'boolean' ? det.inWater : IN_WATER_RE.test(text) ? true : OUT_WATER_RE.test(text) ? false : null
  const size = !!det.size || (job ? !job.size : false) || SIZE_RE.test(text)
  const area = i.damage_location || (job && !job.zones ? job.label.toLowerCase() : null) || AREA_WORDS.find(([re]) => re.test(text))?.[1] || null
  const insurance = i.service === 'insurance-claim' || i.kind === 'insurance' || (typeof det.insurance === 'boolean' ? det.insurance : INSURANCE_RE.test(text))
  const urgency = det.timeline === 'asap' || URGENCY_RE.test(text)
  const timing = urgency || !!det.timeline

  if (photoCount === 0) gaps.push({ key: 'photos', priority: 1, label: 'No photos', why: 'Every quote starts from photos of the damage; without them the crew cannot judge size, depth or whether the laminate is involved.',
    question: 'A few photos of the damage (one up close, one from a few feet back)' })
  else have.push('photos')

  const hasBoat = !!(i.boat_make || i.boat_model || (i.boat_raw && i.boat_raw.length >= 4))
  if (!hasBoat) gaps.push({ key: 'boat', priority: 1, label: 'Boat make / model', why: 'Hull construction, core material and gelcoat type depend on the builder and model.',
    question: 'The boat’s make, model and length' })
  else {
    have.push('boat')
    if (!i.boat_year) gaps.push({ key: 'boat_year', priority: 3, label: 'Model year', why: 'Year tells the crew what layup schedule and gelcoat to expect (and matters for insurance paperwork).',
      question: 'What year is she?' })
    else have.push('boat_year')
  }

  if (!area) gaps.push({ key: 'area', priority: 2, label: 'Where on the boat', why: 'Transom, hull side, deck or bottom all repair differently and some need the boat out of the water.',
    question: 'Where on the boat is the damage: hull side, bottom, deck, transom, or somewhere else?' })
  else have.push('area')

  if (!size) gaps.push({ key: 'size', priority: 2, label: 'Size of the damage', why: 'Hours and materials scale with the area; a chip and a two-foot gouge are different jobs.',
    question: 'About how big is it? A rough measurement is plenty, or compare it to a coin, a hand, a dinner plate.' })
  else have.push('size')

  if (!i.boat_location) gaps.push({ key: 'location', priority: 1, label: 'Where the boat is kept', why: 'Decides mobile versus yard, and travel time for a look.',
    question: 'The city the boat is in' })
  else have.push('location')

  if (inWater === null) gaps.push({ key: 'in_water', priority: 2, label: 'In or out of the water', why: 'Below-waterline work and most structural work need the boat out; it also changes the schedule.',
    question: 'Is she in the water, on a lift, or on a trailer?' })
  else have.push('in_water')

  if (insurance) {
    const hasClaim = CLAIM_NO_RE.test(text) && /\b(claim|adjuster|carrier|policy)\b/i.test(text)
    if (!hasClaim) gaps.push({ key: 'insurance', priority: 2, label: 'Insurance details', why: 'Claims need the carrier, claim number and the adjuster or appraiser contact so the estimate is written as a supplement they will accept.',
      question: 'Since this is going through insurance, who is the carrier, what is the claim number, and do you have the adjuster or appraiser’s name and phone? We write the estimate the way they need it.' })
    else have.push('insurance')
  }

  if (!timing) gaps.push({ key: 'timeline', priority: 3, label: 'Timing', why: 'Lets the crew schedule the inspection and tell the customer honestly when it could start.',
    question: 'Any timing I should know about, like a trip coming up?' })
  else have.push('timeline')

  const p1 = gaps.filter((g) => g.priority === 1).length
  const p2 = gaps.filter((g) => g.priority === 2).length
  const readiness: Assessment['readiness'] = p1 > 0 ? 'needs_info' : p2 >= 2 ? 'nearly' : 'ready'
  return { gaps, have, readiness, insurance, mentions: { inWater, size, area, insurance, urgency } }
}

/** What the first reply asks for: the basics (priority 1) only. Never more than three lines. */
export function questionsToAsk(a: Assessment): Gap[] {
  return a.gaps.filter((g) => g.priority === 1)
}
