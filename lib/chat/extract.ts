// Slot extraction from one visitor message. Deterministic path (always available) and a model path
// (structured output, used when a key exists and the budget allows). Both return the same shape.
import { z } from 'zod'
import { callModel } from '../ai.js'
import type { Queryable } from '../db.js'
import { BOAT_MAKES, parseBoat } from '../boat.js'
import { PERSONA } from './persona.js'
import { guessService, SERVICES, type SvcKey } from './quoteflow.js'
import type { DamageKind, DamageLocation, Extracted, Slots, Step, StoredMessage } from './types.js'

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/
export const PHONE_RE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/
const NOT_SURE_RE = /^(not sure|unsure|i'?m not sure|no idea|don'?t know|dont know|idk|unknown|n\/a|skip)\b/i

export function inferDamageLocation(text: string): DamageLocation | undefined {
  const t = text.toLowerCase()
  if (/\btransom/.test(t)) return 'transom'
  if (/\bstringer/.test(t)) return 'stringers'
  if (/\bbulkhead/.test(t)) return 'bulkheads'
  if (/\bgel ?coat|\bspider ?crack|\bcrazing|\boxidi|\bchip(s|ped)?\b|\bscratch/.test(t)) return 'gelcoat'
  if (/\bdeck\b|\bfloor\b|\bsole\b/.test(t)) return 'deck'
  if (/\bhull\b|\bkeel\b|\bchine\b|\bblister|\bosmosis|\bbottom\b/.test(t)) return 'hull'
  if (/\bnot sure what|\bno idea\b|\bdon'?t know (where|what)/.test(t)) return 'not sure'
  return undefined
}

export function inferDamageKind(text: string): DamageKind | undefined {
  const t = text.toLowerCase()
  if (/\bstructural|\bsoft\b|\bspongy|\bflex|\bdelaminat|\brot(ten|ted)?\b|\bwet core|\bmushy/.test(t)) return 'structural'
  if (/\bimpact|\bcollision|\bhit\b|\bcrash|\bran (into|over|aground)|\bdock rash|\btrailer (bunk|damage)|\bgouge/.test(t)) return 'impact'
  if (/\bcosmetic|\bscratch|\bchip|\bfade|\boxidi|\bstain|\bscuff|\bspider ?crack|\bcrazing/.test(t)) return 'cosmetic'
  if (NOT_SURE_RE.test(t.trim())) return 'not sure'
  return undefined
}

export function inferWhere(text: string): string | undefined {
  const t = text.toLowerCase()
  if (/\bin the water\b|\bin-water\b|\bat the dock\b|\bon a lift\b|\bslip\b|\bmoor/.test(t)) return 'In the water'
  if (/\btrailer/.test(t)) return 'On a trailer'
  if (/\bmarina\b|\byard\b|\bstorage\b|\bdry stack\b|\bboatyard\b/.test(t)) {
    const name = text.match(/\b(?:at|in)\s+([A-Z][\w'&.-]+(?:\s+[A-Z][\w'&.-]+){0,3})/)?.[1]
    return name ? `${/marina|yard/i.test(name) ? '' : 'At '}${name}`.trim() : (/marina/.test(t) ? 'At a marina' : 'At a yard')
  }
  return undefined
}

function cleanName(text: string): string | undefined {
  let s = text.trim().replace(/^(my name is|my name's|i am|i'm|im|it's|its|this is|name:?)\s+/i, '').replace(/[.!]+$/, '').trim()
  s = s.replace(/\s+(here|speaking)$/i, '')
  if (!s || s.length > 80 || /\d/.test(s) || EMAIL_RE.test(s) || s.split(/\s+/).length > 5) return undefined
  if (/^(move on|skip|next|ok|okay|yes|no|sure|done|continue|hello|hi|hey)$/i.test(s)) return undefined
  return s
}

/** Deterministic extraction. `step` tells us which free-text slot the message most likely answers. */
export function extractDeterministic(message: string, step: Step | undefined, slots: Slots): Extracted {
  const out: Extracted = {}
  const text = message.trim()
  if (!text) return out
  const email = text.match(EMAIL_RE)?.[0]
  if (email) out.email = email.toLowerCase()
  const phone = text.match(PHONE_RE)?.[0]
  if (phone && phone.replace(/\D/g, '').length >= 10) out.phone = phone.trim()
  const notSure = NOT_SURE_RE.test(text)
  if (notSure) out.notSure = true

  const loc = inferDamageLocation(text)
  const kind = inferDamageKind(text)
  const where = inferWhere(text)
  const boat = parseBoat(text)
  const mentionsBoat = !!(boat.make || boat.year)

  switch (step) {
    case 'boat': {
      if (notSure) { out.boat = 'Not sure' }
      else if (!email && !phone) { out.boat = text.slice(0, 120); if (boat.make) out.boatMake = boat.make; if (boat.model) out.boatModel = boat.model; if (boat.year) out.boatYear = boat.year }
      if (/\b(center console|bay boat|flats|skiff|bowrider|cuddy|cruiser|sailboat|pontoon|jet ?ski|pwc|wave ?runner|sea ?doo|kayak|deck boat|ski boat|wake ?boat|sportfish)\b/i.test(text)) out.boatType = text.match(/\b(center console|bay boat|flats|skiff|bowrider|cuddy|cruiser|sailboat|pontoon|jet ?ski|pwc|wave ?runner|sea ?doo|kayak|deck boat|ski boat|wake ?boat|sportfish)\b/i)![1]
      if (loc) out.damageLocation = loc
      break
    }
    case 'service':
    case 'notes': {
      out.damage = notSure ? 'Not sure yet' : text.slice(0, 500)
      const svc = guessService(text)
      if (svc) out.svc = svc
      if (loc) out.damageLocation = loc
      if (kind) out.damageKind = kind
      if (where) out.where = where
      if (mentionsBoat) { out.boat = text.slice(0, 120); if (boat.make) out.boatMake = boat.make; if (boat.model) out.boatModel = boat.model; if (boat.year) out.boatYear = boat.year }
      break
    }
    case 'where': {
      if (where) out.where = where
      else if (notSure) out.where = 'Not sure'
      else if (!email && !phone) out.where = text.slice(0, 160)
      break
    }
    case 'contact': {
      // "Tyler Salta, 727-555-0100, tyler@example.com" in one go: whatever is left after the email and phone is the name
      const rest = text.replace(EMAIL_RE, ' ').replace(PHONE_RE, ' ').replace(/[,;|]+/g, ' ').replace(/\s+/g, ' ').trim()
      const n = rest ? cleanName(rest) : undefined
      if (n) out.name = n
      break
    }
    default: {
      if (mentionsBoat) { out.boat = text.slice(0, 120); if (boat.make) out.boatMake = boat.make; if (boat.model) out.boatModel = boat.model; if (boat.year) out.boatYear = boat.year }
      if (loc) out.damageLocation = loc
      if (kind) out.damageKind = kind
      if (where) out.where = where
      const svc = guessService(text)
      if (svc) out.svc = svc
    }
  }
  return out
}

const extractSchema = z.object({
  fields: z.object({
    boat: z.string().nullable().describe('Free-text boat description exactly as the visitor gave it, if they described a boat'),
    boatMake: z.string().nullable(),
    boatModel: z.string().nullable(),
    boatYear: z.number().int().nullable(),
    boatType: z.string().nullable().describe('e.g. center console, bay boat, pontoon, jet ski'),
    damage: z.string().nullable().describe('What is wrong with the boat, in the visitor\'s words, if they described damage'),
    damageLocation: z.enum(['hull', 'deck', 'transom', 'stringers', 'bulkheads', 'gelcoat', 'other', 'not sure']).nullable(),
    damageKind: z.enum(['structural', 'cosmetic', 'impact', 'not sure']).nullable(),
    service: z.enum(SERVICES.map((v) => v.key) as [SvcKey, ...SvcKey[]]).nullable().describe(`Job type, only when the visitor clearly described it: ${SERVICES.map((v) => `${v.key} = ${v.label}`).join('; ')}`),
    where: z.string().nullable().describe('Where the boat is kept: in the water, on a trailer, at a yard, or a marina name'),
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    notSure: z.boolean().describe('true when the visitor says they do not know the thing they were asked'),
  }),
  reply: z.string().describe('One to three sentences in Captain Levi\'s voice acknowledging what the visitor said and answering any genuine boat question. Do not ask the next question; the website appends it.'),
})

export type ModelExtraction = { fields: Extracted; reply: string; cost: number; tokensIn: number; tokensOut: number }

export async function extractWithModel(db: Queryable, args: {
  message: string; step: Step | undefined; slots: Slots; history: StoredMessage[]; page: string; pageTitle: string; nextQuestionHint: string
}): Promise<ModelExtraction | null> {
  const context = [
    `Context for this turn (from the website, not the visitor):`,
    `- Visitor is on page "${args.pageTitle || args.page}" (slug: ${args.page}).`,
    `- Quote intake is in progress. Current step: ${args.step || 'none'}. The website will append this question after your reply: "${args.nextQuestionHint}" — do not ask it yourself.`,
    `- Already collected: ${JSON.stringify(args.slots)}`,
    `- Known boat makes to recognise: ${BOAT_MAKES.slice(0, 60).join(', ')}.`,
    `Task: fill "fields" only with information present in the visitor's latest message (null when absent; never guess), then write "reply".`,
  ].join('\n')
  const history = args.history.slice(-30).map((m) => ({ role: m.role, content: m.text || '(photo added)' }))
  const res = await callModel(db, 'chat', {
    system: [PERSONA, context],
    messages: [...history, { role: 'user', content: args.message }],
    schema: extractSchema,
    maxTokens: 600,
  })
  if (!res || !res.parsed) return null
  const f = res.parsed.fields
  const fields: Extracted = {}
  if (f.boat) fields.boat = f.boat.slice(0, 120)
  if (f.boatMake) fields.boatMake = f.boatMake.slice(0, 60)
  if (f.boatModel) fields.boatModel = f.boatModel.slice(0, 60)
  if (f.boatYear && f.boatYear > 1900 && f.boatYear < 2100) fields.boatYear = f.boatYear
  if (f.boatType) fields.boatType = f.boatType.slice(0, 40)
  if (f.damage) fields.damage = f.damage.slice(0, 500)
  if (f.damageLocation) fields.damageLocation = f.damageLocation
  if (f.damageKind) fields.damageKind = f.damageKind
  if (f.service) fields.svc = f.service
  if (f.where) fields.where = f.where.slice(0, 160)
  if (f.name) fields.name = f.name.slice(0, 80)
  if (f.email && EMAIL_RE.test(f.email)) fields.email = f.email.match(EMAIL_RE)![0].toLowerCase()
  if (f.phone && f.phone.replace(/\D/g, '').length >= 10) fields.phone = f.phone.slice(0, 40)
  if (f.notSure) fields.notSure = true
  return { fields, reply: (res.parsed.reply || '').trim().slice(0, 700), cost: res.cost, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens }
}
