// The website quote flow (Captain Levi on the public site): which questions to ask, in what order, and the
// quick-fill widgets that answer them. Pure data + pure functions. machine.ts drives it, script.js renders the
// widgets, and an answer comes back either as a tapped widget value ({step, value}) or as typed text.
//
// Order: job → boat → the job's own follow-ups → where on the boat → how big → photos → where she is
// (+ "can you bring her in?" for trailer boats) → timing → anything else → contact → review.
// A step is skipped once its slot is filled, so whatever the visitor already typed is never asked again.
import { BOAT_MAKES, parseBoat } from '../boat.js'
import type { DamageKind, DamageLocation, Slots } from './types.js'

export type SvcKey = 'impact' | 'cracks' | 'chips' | 'soft' | 'transom' | 'stringers' | 'blisters' | 'oxidation' | 'detailing' | 'fabrication' | 'pwc' | 'other'

export interface SvcDef {
  key: SvcKey; label: string; hint: string; icon: string
  service: string                       // site/pages.json service value the inquiry is filed under
  kind: DamageKind; location?: DamageLocation
  zones: boolean; size: boolean          // ask "where on the boat" / "how big"
  ack: string
}

export const SERVICES: SvcDef[] = [
  { key: 'impact', label: 'Collision or impact', hint: 'Hit a dock, piling or another boat', icon: 'impact', service: 'hull-repairs', kind: 'impact', zones: true, size: true, ack: 'Impact damage, got it.' },
  { key: 'cracks', label: 'Cracks', hint: 'Spider, stress or long cracks', icon: 'crack', service: 'gelcoat-repair', kind: 'cosmetic', location: 'gelcoat', zones: true, size: true, ack: 'Cracks, got it.' },
  { key: 'chips', label: 'Chips, scratches, gouges', hint: 'Dock rash, scuffs, deep gouges', icon: 'chip', service: 'gelcoat-repair', kind: 'cosmetic', location: 'gelcoat', zones: true, size: true, ack: 'Chips and scratches are everyday work for us.' },
  { key: 'soft', label: 'Soft spots', hint: 'Deck feels spongy or flexes', icon: 'soft', service: 'structural-fiberglass', kind: 'structural', location: 'deck', zones: true, size: true, ack: 'Soft spots, got it. Best to catch those early.' },
  { key: 'transom', label: 'Transom', hint: 'Cracks or flex at the motor', icon: 'transom', service: 'transom-replacement', kind: 'structural', location: 'transom', zones: false, size: false, ack: 'Transom work, got it.' },
  { key: 'stringers', label: 'Stringers & bulkheads', hint: 'Hull flexing or rot inside', icon: 'stringers', service: 'stringer-repairs', kind: 'structural', location: 'stringers', zones: false, size: false, ack: 'Stringers and bulkheads, got it.' },
  { key: 'blisters', label: 'Blisters & bottom', hint: 'Blisters, keel or bottom damage', icon: 'blister', service: 'hull-repairs', kind: 'not sure', location: 'hull', zones: false, size: true, ack: 'Bottom work, got it.' },
  { key: 'oxidation', label: 'Faded or chalky gelcoat', hint: 'Oxidation and color restoration', icon: 'sun', service: 'boat-restoration', kind: 'cosmetic', location: 'gelcoat', zones: false, size: false, ack: 'Bringing the shine back, got it.' },
  { key: 'detailing', label: 'Detailing', hint: 'Wash, polish, wax, ceramic', icon: 'sparkle', service: 'boat-detailing', kind: 'cosmetic', zones: false, size: false, ack: 'Detailing, got it.' },
  { key: 'fabrication', label: 'Custom work', hint: 'Consoles, hatches, livewells, parts', icon: 'wrench', service: 'custom-fabrication', kind: 'not sure', location: 'other', zones: false, size: false, ack: 'Custom work, now we are talking.' },
  { key: 'pwc', label: 'Jet ski or kayak', hint: 'PWC and kayak hull repairs', icon: 'pwc', service: 'pwc-repair', kind: 'not sure', zones: false, size: true, ack: 'A jet ski or kayak, got it.' },
  { key: 'other', label: 'Something else', hint: 'Not sure? Tell me and I will sort it', icon: 'question', service: 'fiberglass-repair', kind: 'not sure', zones: true, size: false, ack: 'No problem, we will figure it out together.' },
]
export const svcDef = (k: string | undefined): SvcDef | undefined => SERVICES.find((s) => s.key === k)

/** Typed text → job type. Order matters: the most specific wording wins. */
const SVC_WORDS: [RegExp, SvcKey][] = [
  [/\btransom\b/i, 'transom'],
  [/\bstringers?\b|\bbulkheads?\b/i, 'stringers'],
  [/\bblisters?\b|\bosmosis\b|\bkeel\b|\bbottom paint\b/i, 'blisters'],
  [/\bsoft\b|\bspongy\b|\bdelaminat|\bflex(es|ing)?\b|\brot(ten)?\b|\bwet core\b|\bmushy\b/i, 'soft'],
  [/\bhit\b|\bcollision\b|\bcrash|\bran (into|aground)|\bimpact\b|\bpiling\b|\bt-?boned\b|\bstruck\b|\bgrounded\b/i, 'impact'],
  [/\bspider ?cracks?\b|\bstress cracks?\b|\bcrazing\b|\bcrack(s|ed|ing)?\b/i, 'cracks'],
  [/\bchips?\b|\bchipped\b|\bscratch|\bgouge|\bscuff|\bdock rash\b|\bding\b/i, 'chips'],
  [/\boxidi[sz]|\bchalky\b|\bfaded?\b|\bdull\b|\byellow(ed|ing)\b|\bcolor restor/i, 'oxidation'],
  [/\bdetail|\bwax\b|\bceramic\b|\bpolish|\bcompound\b|\bclean(ing)?\b/i, 'detailing'],
  [/\bcustom\b|\bfabricat|\bconsole\b|\bhatch(es)?\b|\blivewell\b|\bfish ?box\b|\bleaning post\b|\bone-?off\b/i, 'fabrication'],
  [/\bjet ?ski\b|\bpwc\b|\bwave ?runner\b|\bsea-?doo\b|\bkayak\b|\bcanoe\b/i, 'pwc'],
]
export function guessService(text: string): SvcKey | undefined {
  return SVC_WORDS.find(([re]) => re.test(text))?.[1]
}

// ---------------------------------------------------------------- follow-ups (per job, plus one for trailer boats)
export interface FollowUp {
  id: string; q: string; options: [string, string][]; multi?: boolean
  when?: (s: Slots) => boolean
  short: string                        // label on the review card and in the shop email
}

const YES_NO_UNSURE: [string, string][] = [['no', 'No'], ['yes', 'Yes'], ['unsure', 'Not sure']]

export const FOLLOWUPS: Record<SvcKey, FollowUp[]> = {
  impact: [
    { id: 'how', short: 'How it happened', q: 'How did it happen?', options: [['dock', 'Hit a dock or piling'], ['boat', 'Another boat'], ['trailer', 'Trailer or lift'], ['ground', 'Ran aground or hit something'], ['storm', 'Storm'], ['other', 'Something else']] },
    { id: 'insurance', short: 'Insurance', q: 'Are you going through insurance on this one?', options: [['yes', "Yes, there's a claim"], ['maybe', 'Thinking about it'], ['no', "No, I'm paying"]] },
    { id: 'water', short: 'Taking on water', q: 'Is she taking on any water?', options: [['no', 'No'], ['some', 'A little'], ['yes', 'Yes'], ['unsure', 'Not sure']] },
  ],
  cracks: [
    { id: 'pattern', short: 'Crack pattern', q: 'What do the cracks look like?', options: [['spider', 'Spider or star cracks'], ['line', 'One long crack'], ['fittings', 'Around hardware or fittings'], ['many', 'Lots of small ones'], ['unsure', 'Not sure']] },
    { id: 'flex', short: 'Flexes when pressed', q: 'Does the area flex when you press on it?', options: YES_NO_UNSURE },
  ],
  chips: [
    { id: 'depth', short: 'Depth', q: 'How deep does it go?', options: [['surface', 'Just the surface'], ['gelcoat', 'Through the gelcoat'], ['glass', 'Down to the fiberglass'], ['unsure', 'Not sure']] },
    { id: 'count', short: 'Spots', q: 'How many spots are we talking about?', options: [['one', 'Just one'], ['few', '2 to 5'], ['many', '6 or more']] },
    { id: 'color', short: 'Gelcoat color', q: 'What color is the gelcoat there?', options: [['white', 'White'], ['offwhite', 'Off-white or cream'], ['colored', 'A color'], ['unsure', 'Not sure']] },
  ],
  soft: [
    { id: 'feel', short: 'Symptoms', q: 'What are you noticing? Tap all that apply.', multi: true, options: [['soft', 'Soft or spongy underfoot'], ['flex', 'Flexes or bounces'], ['cracks', 'Cracks around it'], ['weep', 'Water weeping from screws'], ['smell', 'Musty or rot smell']] },
    { id: 'area', short: 'Soft area', q: 'Where is it soft?', options: [['cockpit', 'Cockpit floor'], ['bow', 'Bow or casting deck'], ['helm', 'Around the console'], ['hatch', 'Hatch lids'], ['several', 'Several places']] },
  ],
  transom: [
    { id: 'engine', short: 'Power', q: "What's hanging on the transom?", options: [['outboard', 'Outboard'], ['twins', 'Twin outboards'], ['io', 'I/O or sterndrive'], ['inboard', 'Inboard'], ['none', 'Nothing right now']] },
    { id: 'symptom', short: 'Symptoms', q: 'What are you seeing? Tap all that apply.', multi: true, options: [['flex', 'Flexes when you push the motor'], ['cracks', 'Cracks at the bolts or corners'], ['soft', 'Soft or rotten core'], ['water', 'Water coming in'], ['worried', 'Not sure, just worried']] },
  ],
  stringers: [
    { id: 'symptom', short: 'Symptoms', q: 'What made you suspect the stringers? Tap all that apply.', multi: true, options: [['flex', 'Hull flexes or pounds'], ['cracks', 'Cracks on the hull bottom'], ['soft', 'Soft floor'], ['rot', 'Rot or wet wood showing'], ['survey', 'A surveyor flagged it']] },
  ],
  blisters: [
    { id: 'kept', short: 'Kept', q: 'How is she usually kept?', options: [['water', 'In the water year-round'], ['lift', 'On a lift'], ['dry', 'Trailer or dry storage']] },
    { id: 'paint', short: 'Bottom paint', q: 'Is there bottom paint on her?', options: [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']] },
  ],
  oxidation: [
    { id: 'state', short: 'Condition', q: 'How bad is the fade?', options: [['dull', 'Dull, lost its shine'], ['chalky', 'Chalky, rubs off on your hand'], ['stained', 'Stained or yellowed'], ['unsure', 'Not sure']] },
    { id: 'color', short: 'Gelcoat color', q: 'What color is the gelcoat?', options: [['white', 'White'], ['colored', 'A color'], ['mixed', 'White with a colored hull'], ['unsure', 'Not sure']] },
  ],
  detailing: [
    { id: 'services', short: 'Wants', q: 'What does she need? Tap all that apply.', multi: true, options: [['wash', 'Wash and wax'], ['compound', 'Compound and polish'], ['ceramic', 'Ceramic coating'], ['interior', 'Interior, vinyl, non-skid'], ['bottom', 'Bottom cleaning'], ['recommend', 'Not sure, recommend something']] },
    { id: 'last', short: 'Last detailed', q: 'When was she last detailed?', options: [['recent', 'Within 6 months'], ['year', 'About a year ago'], ['long', 'Longer, or never'], ['unsure', 'Not sure']] },
  ],
  fabrication: [
    { id: 'what', short: 'Building', q: 'What are we building?', options: [['console', 'Console or dash'], ['hatch', 'Hatch or lid'], ['livewell', 'Livewell or fish box'], ['seat', 'Seat base or leaning post'], ['part', 'A one-off part'], ['other', 'Something else']] },
    { id: 'plans', short: 'Sketch or measurements', q: 'Do you have a sketch, measurements, or a photo of something similar?', options: [['yes', 'Yes'], ['no', 'Not yet']] },
  ],
  pwc: [
    { id: 'craft', short: 'Craft', q: 'What is it?', options: [['pwc', 'Jet ski or PWC'], ['kayak', 'Kayak or canoe'], ['other', 'Something else small']] },
    { id: 'issue', short: 'Problem', q: "What's wrong with it?", options: [['crack', 'Crack or hole'], ['scuff', 'Scuffs or gouges'], ['bottom', 'Bottom or keel damage'], ['other', 'Something else']] },
  ],
  other: [],
}

export const BRING: FollowUp = {
  id: 'bring', short: 'Can bring her to the yard', q: 'Could you trailer her to our yard in Largo, or should the crew come to you?',
  options: [['yes', 'I can bring her in'], ['no', 'Come to me'], ['unsure', 'Not sure yet']],
  when: (s) => s.whereStatus === 'trailer',
}

// ---------------------------------------------------------------- the other quick-fill option sets
export const BOAT_TYPES: [string, string][] = [
  ['center-console', 'Center console'], ['bay', 'Bay boat'], ['flats', 'Flats or skiff'], ['bowrider', 'Bowrider or deck boat'],
  ['cruiser', 'Cruiser or yacht'], ['pontoon', 'Pontoon'], ['sail', 'Sailboat'], ['pwc', 'Jet ski'], ['other', 'Other'],
]
export const BOAT_LENGTHS: [string, string][] = [['u18', 'Under 18 ft'], ['18-22', '18–22 ft'], ['23-27', '23–27 ft'], ['28-34', '28–34 ft'], ['35+', '35 ft +']]
export const ZONES: [string, string][] = [
  ['bow', 'Bow'], ['port', 'Port side (left)'], ['starboard', 'Starboard side (right)'], ['deck', 'Deck or cockpit'], ['console', 'Console or helm'],
  ['stern', 'Stern or transom'], ['bottom', 'Bottom, below the waterline'], ['inside', 'Inside (bilge, hatches)'], ['unsure', 'Not sure'],
]
export const SIZES: [string, string, number][] = [
  ['coin', 'Coin', 1], ['palm', 'Palm', 2], ['plate', 'Dinner plate', 3], ['foot', '1–2 feet', 4], ['bigger', 'Bigger than 2 ft', 5], ['several', 'Several spots', 0],
]
export const WHERE_STATUS: [string, string][] = [
  ['dock', 'In the water at a dock'], ['lift', 'On a lift'], ['trailer', 'On a trailer'], ['storage', 'Dry storage or marina rack'], ['yard', 'Already at a yard'],
]
export const CITIES = ['Largo', 'Clearwater', 'St. Petersburg', 'Seminole', 'Pinellas Park', 'Dunedin', 'Palm Harbor', 'Tampa']
export const TIMELINES: [string, string][] = [['asap', 'As soon as possible'], ['2wk', 'Within 2 weeks'], ['month', 'This month'], ['flexible', 'Flexible, just pricing']]
const MAKES = Array.from(new Set(BOAT_MAKES.filter((m) => !/^(Grady White|Sea Doo|SeaDoo|Proline|Pro Line)$/.test(m))))

// ---------------------------------------------------------------- the plan
export type QStep = 'service' | 'boat' | `fu:${string}` | 'zones' | 'size' | 'photos' | 'where' | 'timeline' | 'notes' | 'contact' | 'review'
export const QSTEP_RE = /^(service|boat|zones|size|photos|where|timeline|notes|contact|review|fu:[a-z]+)$/

function followUps(s: Slots): FollowUp[] {
  const svc = svcDef(s.svc)
  return [...(svc ? FOLLOWUPS[svc.key] : []), BRING]
}
export function followUp(s: Slots, id: string): FollowUp | undefined { return followUps(s).find((f) => f.id === id) }

/** Every step this visitor will see, in order, given what we know so far (it changes as answers arrive). */
export function plan(s: Slots): QStep[] {
  const svc = svcDef(s.svc)
  const out: QStep[] = ['service', 'boat']
  for (const f of svc ? FOLLOWUPS[svc.key] : []) out.push(`fu:${f.id}`)
  if (!svc || svc.zones) out.push('zones')
  if (svc?.size) out.push('size')
  out.push('photos', 'where')
  if (BRING.when!(s)) out.push('fu:bring')
  out.push('timeline', 'notes', 'contact', 'review')
  return out
}

export function isFilled(s: Slots, step: QStep): boolean {
  switch (step) {
    case 'service': return !!s.svc
    case 'boat': return !!(s.boat || s.boatType || s.boatLength)
    case 'zones': return !!s.zones?.length
    case 'size': return !!s.size
    case 'photos': return !!(s.photos || s.photosDeclined)
    case 'where': return !!s.where
    case 'timeline': return !!s.timeline
    case 'notes': return !!s.notesDone
    case 'contact': return !!(s.name && s.email && s.phone)
    case 'review': return false
    default: return !!s.answers?.[step.slice(3)]?.length
  }
}

export function nextQuoteStep(s: Slots): QStep {
  return plan(s).find((st) => !isFilled(s, st)) || 'review'
}

export function progress(s: Slots): { n: number; of: number } {
  const p = plan(s)
  const n = p.filter((st) => st !== 'review' && isFilled(s, st)).length
  return { n: Math.min(n + 1, p.length), of: p.length }
}

// ---------------------------------------------------------------- questions + widgets
export interface WidgetOption { value: string; label: string; hint?: string; icon?: string; scale?: number }
export interface Widget {
  type: 'tiles' | 'boat' | 'multi' | 'zones' | 'size' | 'photos' | 'where' | 'contact'
  step: string
  options?: WidgetOption[]
  types?: [string, string][]; lengths?: [string, string][]; makes?: string[]; years?: [number, number]
  cities?: string[]; prefill?: Record<string, string>; error?: string
}

export function questionFor(step: QStep, s: Slots): string {
  switch (step) {
    case 'service': return 'What can we help with? Tap the closest one, or just tell me in your own words.'
    case 'boat': return s.svc === 'pwc' ? 'Tell me about the craft: make and year if you know them.' : 'Tell me about the boat. Tap what you know; "not sure" is fine too.'
    case 'zones': return 'Where on the boat is it? Tap every spot that applies.'
    case 'size': return 'About how big is the damaged area?'
    case 'photos': return 'Photos are the fastest way to an accurate quote. Snap a few: one up close, one from a few feet back.'
    case 'where': return 'Where is she right now?'
    case 'timeline': return 'When are you hoping to get it done?'
    case 'notes': return s.svc === 'other' && !s.damage ? "Tell me a little about what's going on with her." : 'Anything else the crew should know? Type it below, or tap "That\'s everything".'
    case 'contact': return contactQuestion(s)
    case 'review': return 'Here is your quote request. Does it look right?'
    default: return followUp(s, step.slice(3))?.q || 'One more quick one.'
  }
}

function contactQuestion(s: Slots): string {
  const missing = [!s.name && 'your name', !s.phone && 'a phone number', !s.email && 'an email'].filter(Boolean) as string[]
  if (missing.length === 3) return 'Last step: who should the crew get back to? Your phone can autofill this.'
  return `Almost there. I still need ${missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`}.`
}

export function widgetFor(step: QStep, s: Slots, error?: string): Widget | undefined {
  switch (step) {
    case 'service': return { type: 'tiles', step, options: SERVICES.map((v) => ({ value: v.key, label: v.label, hint: v.hint, icon: v.icon })) }
    case 'boat': return { type: 'boat', step, types: BOAT_TYPES, lengths: BOAT_LENGTHS, makes: MAKES, years: [new Date().getFullYear() + 1, 1970] }
    case 'zones': return { type: 'zones', step, options: ZONES.map(([value, label]) => ({ value, label })) }
    case 'size': return { type: 'size', step, options: SIZES.map(([value, label, scale]) => ({ value, label, scale })) }
    case 'photos': return { type: 'photos', step }
    case 'where': return { type: 'where', step, options: WHERE_STATUS.map(([value, label]) => ({ value, label })), cities: CITIES }
    case 'contact': return { type: 'contact', step, prefill: { name: s.name || '', email: s.email || '', phone: s.phone || '' }, ...(error ? { error } : {}) }
    default: {
      if (!step.startsWith('fu:')) return undefined
      const f = followUp(s, step.slice(3))
      return f?.multi ? { type: 'multi', step, options: f.options.map(([value, label]) => ({ value, label })) } : undefined
    }
  }
}

/** Single-choice follow-ups and timing answer straight from the quick-reply chips. */
export function choiceChips(step: QStep, s: Slots): { label: string; answer: { step: string; value: string } }[] {
  if (step === 'timeline') return TIMELINES.map(([value, label]) => ({ label, answer: { step, value } }))
  if (step.startsWith('fu:')) {
    const f = followUp(s, step.slice(3))
    if (f && !f.multi) return f.options.map(([value, label]) => ({ label, answer: { step, value } }))
  }
  return []
}

// ---------------------------------------------------------------- applying an answer
export type AnswerValue = string | string[] | Record<string, string>
export interface Applied { ok: boolean; error?: string; ack?: string }

const str = (v: unknown, max = 160): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const labelOf = (list: [string, string, ...unknown[]][], v: string | undefined) => list.find((x) => x[0] === v)?.[1]
const asRecord = (v: AnswerValue): Record<string, string> => (typeof v === 'object' && !Array.isArray(v) ? v : {})

/** A tapped widget answer. Unknown values are rejected (the widget only offers valid ones). Contact is the machine's. */
export function applyAnswer(s: Slots, step: QStep, value: AnswerValue): Applied {
  switch (step) {
    case 'service': {
      const d = svcDef(str(value))
      if (!d) return { ok: false, error: 'Tap one of the options.' }
      setService(s, d.key)
      return { ok: true, ack: d.ack }
    }
    case 'boat': {
      const v = asRecord(value)
      if (str(v.unsure) === 'yes') { s.boat = 'Not sure'; return { ok: true, ack: 'No problem, the crew will sort that out when they see her.' } }
      const type = labelOf(BOAT_TYPES, str(v.type)), length = labelOf(BOAT_LENGTHS, str(v.length))
      const make = str(v.make, 60), model = str(v.model, 60), yearN = Number(str(v.year, 4))
      const year = Number.isInteger(yearN) && yearN >= 1950 && yearN <= new Date().getFullYear() + 1 ? yearN : undefined
      if (!type && !length && !make && !model && !year) return { ok: false, error: 'Tap at least one thing about the boat, or "Not sure".' }
      if (type) s.boatType = type
      if (length) s.boatLength = length
      if (make) s.boatMake = make
      if (model) s.boatModel = model
      if (year) s.boatYear = year
      s.boat = [year, make, model].filter(Boolean).join(' ') || [length, type].filter(Boolean).join(' ')
      const named = [year, make, model].filter(Boolean).join(' ')
      return { ok: true, ack: named ? `A ${named}. Nice.` : type ? `A ${type.toLowerCase()}, got it.` : 'Got it.' }
    }
    case 'zones': {
      const vals = (Array.isArray(value) ? value : [str(value)]).filter((z) => ZONES.some(([k]) => k === z))
      if (!vals.length) return { ok: false, error: 'Tap at least one spot on the boat, or "Not sure".' }
      s.zones = vals.includes('unsure') ? ['unsure'] : Array.from(new Set(vals))
      return { ok: true, ack: s.zones[0] === 'unsure' ? 'That is fine, the crew will find it.' : 'Got it.' }
    }
    case 'size': {
      const v = str(value)
      if (!SIZES.some(([k]) => k === v)) return { ok: false, error: 'Tap the closest size.' }
      s.size = v
      return { ok: true, ack: 'Thanks, that helps a lot.' }
    }
    case 'photos': {
      if (str(value) !== 'skip') return { ok: false, error: 'Add photos with the buttons, or skip for now.' }
      s.photosDeclined = true
      return { ok: true, ack: 'No problem. You can always text them to the crew later.' }
    }
    case 'where': {
      const v = asRecord(value)
      const status = WHERE_STATUS.find(([k]) => k === str(v.status))
      const city = str(v.city, 60)
      if (!status && !city) return { ok: false, error: 'Tap where she is, or pick a city.' }
      if (status) s.whereStatus = status[0]
      if (city) s.city = city
      s.where = [status?.[1], city].filter(Boolean).join(', ')
      return { ok: true, ack: s.whereStatus === 'dock' || s.whereStatus === 'lift' ? 'Good to know. A lot of what we do can happen right at the dock.' : 'Good to know.' }
    }
    case 'timeline': {
      const t = TIMELINES.find(([k]) => k === str(value))
      if (!t) return { ok: false, error: 'Tap the closest one.' }
      s.timeline = t[0]
      return { ok: true, ack: t[0] === 'asap' ? 'Understood, I will flag it as urgent.' : 'Understood.' }
    }
    case 'notes': {
      const v = str(value, 500)
      if (v && v !== 'none') s.damage = s.damage ? `${s.damage}\n${v}`.slice(0, 1000) : v
      s.notesDone = true
      return { ok: true, ack: v && v !== 'none' ? 'Thanks, I added that.' : '' }
    }
    case 'contact':
    case 'review':
      return { ok: false }
    default: {
      const f = followUp(s, step.slice(3))
      if (!f) return { ok: false, error: 'That question has moved on.' }
      const vals = (Array.isArray(value) ? value : [str(value)]).filter((x) => f.options.some(([k]) => k === x))
      if (!vals.length) return { ok: false, error: f.multi ? 'Tap at least one.' : 'Tap one of the options.' }
      ;(s.answers ||= {})[f.id] = f.multi ? Array.from(new Set(vals)) : [vals[0]]
      return { ok: true, ack: followUpAck(f, vals) }
    }
  }
}

function followUpAck(f: FollowUp, vals: string[]): string {
  if (f.id === 'insurance' && vals[0] === 'yes') return 'Good, we will write it up the way the insurance company needs it.'
  if (f.id === 'water' && vals[0] === 'yes') return 'Keep an eye on the bilge pump. If it is getting worse, call or text us right away.'
  if (f.id === 'bring' && vals[0] === 'no') return 'No problem, we do mobile work around Tampa Bay.'
  return 'Noted.'
}

export function setService(s: Slots, key: SvcKey): void {
  const d = svcDef(key)!
  if (s.svc && s.svc !== key) { s.answers = {}; s.zones = undefined; s.size = undefined }
  s.svc = key
  s.damageKind = d.kind
  if (d.location) s.damageLocation = d.location
  if (key === 'pwc' && !s.boatType) s.boatType = 'Jet ski'
}

/** Typed text on a choice step: match it to an option label or value, loosely. */
export function matchOption(options: [string, string, ...unknown[]][], text: string): string | undefined {
  const t = text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  const exact = options.find(([v, l]) => l.toLowerCase() === t || v === t)
  if (exact) return exact[0]
  const words = t.split(' ').filter((w) => w.length > 2)
  let best: { v: string; score: number } | undefined
  for (const [v, l] of options) {
    const lw = l.toLowerCase()
    const score = words.filter((w) => lw.includes(w)).length
    if (score && (!best || score > best.score)) best = { v, score }
  }
  return best?.v
}

const ZONE_WORDS: [RegExp, string][] = [
  [/\bbow\b|\bfront\b|\bnose\b/i, 'bow'], [/\bport\b|\bleft\b/i, 'port'], [/\bstarboard\b|\bright side\b/i, 'starboard'],
  [/\bdeck\b|\bcockpit\b|\bfloor\b/i, 'deck'], [/\bconsole\b|\bhelm\b|\bdash\b/i, 'console'], [/\bstern\b|\btransom\b|\bback\b|\brear\b/i, 'stern'],
  [/\bbottom\b|\bkeel\b|\bunder ?water\b|\bbelow the waterline\b/i, 'bottom'], [/\binside\b|\bbilge\b|\bhatch/i, 'inside'],
]
export function zonesFromText(text: string): string[] {
  return ZONE_WORDS.filter(([re]) => re.test(text)).map(([, z]) => z)
}
const SIZE_WORDS: [RegExp, string][] = [
  [/\bseveral\b|\bmultiple\b|\blots\b|\ball over\b/i, 'several'],
  [/\b([3-9]|\d{2}) ?(ft|feet|foot)\b|\bhuge\b|\blarge\b|\bwhole\b/i, 'bigger'],
  [/\b[12] ?(ft|feet|foot)\b|\bcouple (of )?feet\b|\bforearm\b/i, 'foot'],
  [/\bplate\b|\bfootball\b/i, 'plate'],
  [/\bpalm\b|\bhand\b|\bfist\b|\bbaseball\b|\bfew inches\b/i, 'palm'],
  [/\bcoin\b|\bdime\b|\bquarter\b|\bpenny\b|\btiny\b/i, 'coin'],
]
export function sizeFromText(text: string): string | undefined {
  return SIZE_WORDS.find(([re]) => re.test(text))?.[1]
}
/**
 * The boat inside a sentence ("backed into a piling and cracked the stern on my 2018 Robalo"): make and year from
 * parseBoat, but the model only from the few words right after the make, so the rest of the story never becomes
 * the model name.
 */
const MODEL_STOP = /^(is|was|were|are|the|and|or|my|a|an|on|with|into|in|at|has|have|had|got|it|its|it's|that|this|but|so|to|for|of|from|needs?|hit|cracked|broke|broken|transom|hull|deck|stern|bow|side|bottom|soft|damage|damaged|chips?|cracks?|which|when|where|there|after|before|while|because|again|too|also|feet|foot|ft|boat|got)$/i
export function boatFromSentence(text: string): { make?: string; model?: string; year?: number } {
  const b = parseBoat(text)
  if (!b.make && !b.year) return {}
  let model: string | undefined
  if (b.make) {
    const at = text.toLowerCase().replace(/-/g, ' ').indexOf(b.make.toLowerCase().replace(/-/g, ' '))
    if (at >= 0) {
      const toks: string[] = []
      for (const t of text.slice(at + b.make.length).trim().split(/\s+/)) {
        const w = t.replace(/[^\w'-]/g, '')
        if (!w || MODEL_STOP.test(w) || toks.length >= 3) break
        toks.push(w)
      }
      model = toks.join(' ') || undefined
    }
  }
  return { make: b.make || undefined, model, year: b.year || undefined }
}

/** Follow-up answers a visitor often gives up front, so those questions are skipped. Only fills what is empty. */
const PREFILL: Record<string, [RegExp, string][]> = {
  'impact.how': [[/\b(dock|piling|pier|sea ?wall|fuel dock|slip)\b/i, 'dock'], [/\b(another|other) boat\b|\bhit by a boat\b|\bt-?boned\b/i, 'boat'], [/\btrailer\b|\blift\b/i, 'trailer'], [/\baground\b|\bsand ?bar\b|\brocks?\b|\boyster|\bsubmerged\b|\bhit something\b/i, 'ground'], [/\bstorm\b|\bhurricane\b/i, 'storm']],
  'impact.insurance': [[/\binsurance\b|\bclaim\b|\badjuster\b/i, 'yes']],
  'impact.water': [[/\btaking on water\b|\bleak(s|ing)?\b|\bwater (is )?coming in\b/i, 'yes']],
  'cracks.pattern': [[/\bspider|\bstar cracks?\b/i, 'spider'], [/\bcleat|\bhardware|\bfitting|\brail\b|\bscrews?\b/i, 'fittings'], [/\blong crack\b|\bstress crack\b/i, 'line']],
  'chips.depth': [[/\bgouge|\bdeep\b|\bdown to (the )?(glass|fiberglass)\b/i, 'glass'], [/\bchips?\b|\bchipped\b/i, 'gelcoat'], [/\bscratch|\bscuff/i, 'surface']],
  'transom.engine': [[/\btwin\b|\btwins\b/i, 'twins'], [/\boutboard\b/i, 'outboard'], [/\bi\/o\b|\bsterndrive\b|\bstern drive\b/i, 'io'], [/\binboard\b/i, 'inboard']],
  'blisters.paint': [[/\bbottom paint\b/i, 'yes']],
  'pwc.craft': [[/\bkayak|\bcanoe/i, 'kayak'], [/\bjet ?ski|\bpwc\b|\bwave ?runner|\bsea-?doo/i, 'pwc']],
  'fabrication.what': [[/\bconsole|\bdash\b/i, 'console'], [/\bhatch|\blid\b/i, 'hatch'], [/\blivewell|\bfish ?box/i, 'livewell'], [/\bleaning post|\bseat/i, 'seat']],
}
const STRICT_ZONES: [RegExp, string][] = [
  [/\bbow\b/i, 'bow'], [/\bport side\b/i, 'port'], [/\bstarboard\b/i, 'starboard'], [/\bdeck\b|\bcockpit\b/i, 'deck'],
  [/\bconsole\b|\bhelm\b/i, 'console'], [/\bstern\b|\btransom\b/i, 'stern'], [/\bkeel\b|\bbelow the waterline\b|\bbottom of the (hull|boat)\b/i, 'bottom'], [/\bbilge\b/i, 'inside'],
]
export function prefillFromText(s: Slots, text: string): string[] {
  const d = svcDef(s.svc)
  if (!d || !text) return []
  const filled: string[] = []
  for (const f of FOLLOWUPS[d.key]) {
    if (s.answers?.[f.id]?.length) continue
    const v = PREFILL[`${d.key}.${f.id}`]?.find(([re]) => re.test(text))?.[1]
    if (v) { (s.answers ||= {})[f.id] = [v]; filled.push(`fu:${f.id}`) }
  }
  if (d.zones && !s.zones?.length) {
    const z = STRICT_ZONES.filter(([re]) => re.test(text)).map(([, k]) => k)
    if (z.length) { s.zones = Array.from(new Set(z)); filled.push('zones') }
  }
  if (d.size && !s.size) {
    const v = sizeFromText(text)
    if (v) { s.size = v; filled.push('size') }
  }
  return filled
}

export function cityFromText(text: string): string | undefined {
  if (/\bst\.? ?pete(rsburg)?\b|\bsaint petersburg\b/i.test(text)) return 'St. Petersburg'
  return CITIES.find((c) => new RegExp(`\\b${c}\\b`, 'i').test(text))
}

// ---------------------------------------------------------------- what the crew sees
export interface InquiryDetails {
  v: 1
  job?: SvcKey
  jobLabel?: string
  rows: [string, string][]                // ready-to-show question → answer pairs, in flow order
  answers: Record<string, string[]>
  zones?: string[]
  size?: string
  boatType?: string
  boatLength?: string
  whereStatus?: string
  city?: string
  inWater?: boolean | null
  insurance?: boolean | null
  timeline?: string
  photos?: number
}

export function detailsFor(s: Slots): InquiryDetails {
  const d = svcDef(s.svc)
  const rows: [string, string][] = []
  if (d) rows.push(['Job', d.label])
  const boatBits = [s.boatType, s.boatLength].filter(Boolean).join(', ')
  if (boatBits) rows.push(['Boat type', boatBits])
  const answerRow = (f: FollowUp) => {
    const vals = s.answers?.[f.id]
    if (vals?.length) rows.push([f.short, vals.map((v) => f.options.find(([k]) => k === v)?.[1] || v).join(', ')])
  }
  for (const f of followUps(s)) if (f !== BRING) answerRow(f)
  if (s.zones?.length) rows.push(['Where on the boat', s.zones.map((z) => labelOf(ZONES, z) || z).join(', ')])
  if (s.size) rows.push(['Size', labelOf(SIZES, s.size) || s.size])
  if (s.where) rows.push(['Where she is', s.where])
  answerRow(BRING)
  if (s.timeline) rows.push(['Timing', labelOf(TIMELINES, s.timeline) || s.timeline])
  rows.push(['Photos', s.photos ? `${s.photos} sent in the chat` : 'None yet'])
  const ins = s.answers?.insurance?.[0]
  const kept = s.answers?.kept?.[0]
  return {
    v: 1, job: d?.key, jobLabel: d?.label, rows, answers: s.answers || {}, zones: s.zones, size: s.size,
    boatType: s.boatType, boatLength: s.boatLength, whereStatus: s.whereStatus, city: s.city,
    inWater: s.whereStatus ? ['dock', 'lift'].includes(s.whereStatus) : kept ? kept === 'water' : null,
    insurance: ins ? ins === 'yes' : null,
    timeline: s.timeline, photos: s.photos || 0,
  }
}

/** The review card the visitor sees before sending. */
export function reviewRows(s: Slots, boat: string): [string, string][] {
  const rows: [string, string][] = [['Boat', boat || 'Not given'], ...detailsFor(s).rows]
  if (s.damage) rows.push(['Notes', s.damage])
  rows.push(['Name', s.name || ''], ['Phone', s.phone || ''], ['Email', s.email || ''])
  return rows
}

/** The plain-text message stored on the inquiry and shown in the shop email. */
export function composeQuoteMessage(s: Slots): string {
  const parts: string[] = []
  if (s.damage) parts.push(s.damage)
  parts.push(detailsFor(s).rows.map(([k, v]) => `${k}: ${v}`).join('\n'))
  return parts.join('\n\n')
}
