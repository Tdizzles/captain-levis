// Scripted lines and chips for every state. The machine picks the state; these supply the words
// when no model is available (and the question text even when one is).
import { business, phoneDigits, serviceLabel } from '../business.js'
import { describeBoat } from '../boat.js'
import type { Chip, Draft, Slots, Step } from './types.js'

const biz = business()
export const FORM_HREF = 'contact.html#quote'

export const START_CHIPS: Chip[] = [
  { label: 'I Need a Quote', send: 'I need a quote', primary: true },
  { label: 'Hours & Location', send: 'Hours and location' },
  { label: 'I Have Another Question', send: 'I have another question' },
]

export function formChip(draft: Draft): Chip {
  return { label: "I'd rather fill out the form myself", href: FORM_HREF, draft }
}

export const SERVICE_FOR_LOCATION: Record<string, string> = {
  transom: 'transom-replacement', stringers: 'stringer-repairs', bulkheads: 'bulkhead-repairs', hull: 'hull-repairs',
  deck: 'deck-repairs', gelcoat: 'gelcoat-repair',
}

export function serviceFor(slots: Slots): string {
  if (slots.damageLocation && SERVICE_FOR_LOCATION[slots.damageLocation]) return SERVICE_FOR_LOCATION[slots.damageLocation]
  if (slots.damageKind === 'structural') return 'structural-fiberglass'
  if (slots.damageKind === 'cosmetic') return 'gelcoat-repair'
  return 'fiberglass-repair'
}

export function composeMessage(slots: Slots): string {
  const parts: string[] = []
  if (slots.damage) parts.push(slots.damage)
  const meta: string[] = []
  if (slots.damageLocation && slots.damageLocation !== 'not sure') meta.push(`Area: ${slots.damageLocation}`)
  if (slots.damageKind && slots.damageKind !== 'not sure') meta.push(`Type: ${slots.damageKind}`)
  if (slots.boatType) meta.push(`Boat type: ${slots.boatType}`)
  if (slots.photos) meta.push(`${slots.photos} photo(s) sent through chat`)
  if (meta.length) parts.push(meta.join('. ') + '.')
  return parts.join('\n')
}

export function draftFor(slots: Slots): Draft {
  const d: Draft = {}
  if (slots.name) d.name = slots.name
  if (slots.email) d.email = slots.email
  if (slots.phone) d.phone = slots.phone
  if (slots.damageLocation || slots.damageKind) d.service = serviceFor(slots)
  const boat = describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat })
  if (boat && boat !== 'Not sure') d.boat = boat
  if (slots.where) d.boatLocation = slots.where
  const msg = composeMessage(slots)
  if (msg) d.message = msg
  return d
}

export function question(step: Step, slots: Slots): string {
  switch (step) {
    case 'boat': return "First, what are we working on? Give me the make, model and year if you know them (a \"not sure\" is fine too)."
    case 'damage': return 'What happened to her? Tell me what you are seeing in your own words.'
    case 'damageLocation': return 'Where on the boat is the damage: hull, deck, transom, stringers, bulkheads, gelcoat, or somewhere else?'
    case 'damageKind': return 'Would you call it structural (soft, flexing, rotten core), cosmetic (chips, scratches, faded gelcoat), impact damage, or are you not sure?'
    case 'where': return 'Where is the boat right now: in the water, on a trailer, or at a marina or yard (which one)?'
    case 'photos': return slots.photos
      ? `Got ${slots.photos} photo${slots.photos === 1 ? '' : 's'}, thank you. Want to add more, or shall we move on?`
      : 'Photos help the crew a lot. Use the camera button next to the message box to add a few, or skip for now.'
    case 'name': return 'Who should the crew ask for? Your name, please.'
    case 'email': return 'And the best email for the quote?'
    case 'phone': return 'Last one: a phone number the crew can reach you on.'
    case 'review': return 'Here is what I have. Does it look right?'
  }
}

export function ackForStep(step: Step | undefined, slots: Slots, extractedKeys: string[]): string {
  // short, scripted acknowledgement of what was just captured (no-key mode)
  if (!step) return ''
  if (extractedKeys.includes('email') && step === 'email') return 'Got it.'
  if (extractedKeys.includes('phone') && step === 'phone') return 'Perfect.'
  if (extractedKeys.includes('name') && step === 'name') return `Thanks, ${slots.name?.split(' ')[0]}.`
  if (step === 'boat' && extractedKeys.includes('boat')) {
    const b = describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat })
    return b === 'Not sure' ? 'No problem, we can sort that out when we see her.' : `A ${b}, nice.`
  }
  if (step === 'damage' && extractedKeys.includes('damage')) return 'Understood.'
  if (step === 'damageLocation' && extractedKeys.includes('damageLocation')) return slots.damageLocation === 'not sure' ? 'That is fine, the crew will find it.' : 'Noted.'
  if (step === 'damageKind' && extractedKeys.includes('damageKind')) return 'Noted.'
  if (step === 'where' && extractedKeys.includes('where')) return 'Good to know.'
  return ''
}

export function chipsForStep(step: Step, slots: Slots): Chip[] {
  const form = formChip(draftFor(slots))
  switch (step) {
    case 'boat': return [{ label: "I'm not sure", send: 'Not sure' }, { label: 'What do you need to know?', send: 'What do you need to know about the boat?' }, form]
    case 'damage': return [{ label: "It's my transom", send: "It's my transom" }, { label: 'I have hull damage', send: 'I have hull damage' }, { label: "I'm not sure what's damaged", send: "I'm not sure what's damaged" }, form]
    case 'damageLocation': return [{ label: 'Transom', send: 'Transom' }, { label: 'Hull', send: 'Hull' }, { label: 'Deck', send: 'Deck' }, { label: "I'm not sure", send: "I'm not sure" }]
    case 'damageKind': return [{ label: 'Structural (soft or flexing)', send: 'Structural' }, { label: 'Cosmetic (chips, scratches)', send: 'Cosmetic' }, { label: 'Impact or collision', send: 'Impact' }, { label: 'Not sure', send: 'Not sure' }]
    case 'where': return [{ label: 'In the water', send: 'In the water' }, { label: 'On a trailer', send: 'On a trailer' }, { label: 'At a marina or yard', send: 'At a marina' }, form]
    case 'photos': return slots.photos
      ? [{ label: 'Move on', send: 'Move on', primary: true }, { label: 'Can I send more photos?', send: 'Can I send photos?' }, form]
      : [{ label: 'Can I send photos?', send: 'Can I send photos?' }, { label: 'Skip photos for now', send: 'Skip photos' }, form]
    case 'name': case 'email': case 'phone': return [form, { label: 'Why do you need this?', send: 'Why do you need my contact details?' }]
    case 'review': return [{ label: 'Send it', send: 'Send it', primary: true }, { label: 'Change something', send: 'Change something' }, form]
  }
}

export const CHANGE_CHIPS: Chip[] = [
  { label: 'Boat', send: 'Change the boat' }, { label: 'Damage', send: 'Change the damage' },
  { label: 'Where it is', send: 'Change where the boat is' }, { label: 'Contact info', send: 'Change my contact info' },
]

export function reviewCard(slots: Slots): [string, string][] {
  const rows: [string, string][] = []
  rows.push(['Boat', describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat }) || 'Not given'])
  if (slots.boatType) rows.push(['Type', slots.boatType])
  rows.push(['Damage', slots.damage || 'Not given'])
  rows.push(['Area', slots.damageLocation || 'Not sure'])
  rows.push(['Kind', slots.damageKind || 'Not sure'])
  rows.push(['Where', slots.where || 'Not given'])
  rows.push(['Photos', slots.photos ? `${slots.photos} added` : 'None'])
  rows.push(['Service', serviceLabel(serviceFor(slots))])
  rows.push(['Name', slots.name || ''])
  rows.push(['Email', slots.email || ''])
  rows.push(['Phone', slots.phone || ''])
  return rows
}

export function hoursReply(): string {
  const a = biz.address
  return `We're open **${biz.hours.display}** (${biz.hours.note.toLowerCase()}). The yard is at [${a.street}, ${a.city}, ${a.state} ${a.zip}](${a.mapsUrl}), and you can call or text [${biz.phone}](tel:${phoneDigits()}) any time during those hours.`
}

export const LINES = {
  quoteStart: "Let's get her sorted. I'll ask a few quick questions and a real crew member will follow up with the quote; nothing here is a price.",
  quoteResume: "Welcome back. Let's pick up where we left off.",
  anotherQuestion: 'Sure thing. Ask me anything about fiberglass, gelcoat or the yard and I will do my best.',
  photosHow: 'Tap the camera icon next to the message box and pick up to five JPEG, PNG or WebP photos (10 MB each). They stay attached to this conversation and go to the crew with your request.',
  photosOffline: 'Photo uploads are not available at the moment. You can still attach them on the quote form, or text them to the crew after they call.',
  whyContact: 'Only so a real crew member can reach you with the quote and any questions about the boat. We use your details for nothing else; the privacy policy is linked below the chat.',
  injection: "I'll stick to boats, if that's all right. Where were we?",
  formHandoff: 'No problem. The form has everything we just talked about pre-filled, so you only need to check it and send.',
  invalidEmail: "That doesn't look like a complete email address. Could you check it? Something like name@example.com.",
  invalidPhone: 'I need at least ten digits for the phone number so the crew can reach you. What number works best?',
  needMessageOffline: '',
  simpleMode: "I'm in simple mode right now, so I'll keep it short.",
  changeWhat: 'Which part should I change?',
  changedBoat: 'Sure. Give me the boat again: make, model and year.',
  changedDamage: 'Sure. Tell me again what is wrong with her.',
  changedWhere: 'Sure. Where is the boat right now?',
  changedContact: 'Sure. What name should the crew ask for?',
  done: (ref: string) => `Your request is in, reference **${ref}**. A real crew member will be in touch at the email or phone you gave us. Need us sooner? Call or text [${biz.phone}](tel:${phoneDigits()}).`,
  doneAgain: (ref: string) => `Your request **${ref}** is already with the crew. Anything else I can help with?`,
  submitFailed: `I could not save your request just now, so nothing was sent. Please try again in a moment, use the quote form, or call [${biz.phone}](tel:${phoneDigits()}).`,
  processAnswer: 'Here is how it usually goes: you send the details (and photos if you have them), a crew member looks them over and gets back to you, then they see the boat, either at the yard or where she sits, before giving you a real quote. Repairs are scheduled once you approve it.',
  startFallback: 'Good question. I can get you started on a quote, give you our hours and location, or point you to the right page.',
  questionNoMatch: `I don't have a good answer for that one. The quickest route is a call or text to [${biz.phone}](tel:${phoneDigits()}), or I can get your details for a quote.`,
}
