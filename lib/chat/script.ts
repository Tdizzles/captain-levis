// Scripted lines and chips for every state. The machine picks the state; these supply the words
// when no model is available (and the question text even when one is).
import { business, phoneDigits } from '../business.js'
import { describeBoat } from '../boat.js'
import { choiceChips, composeQuoteMessage, questionFor, reviewRows, svcDef } from './quoteflow.js'
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
  if (slots.answers?.insurance?.[0] === 'yes') return 'insurance-claim'
  const svc = svcDef(slots.svc)
  if (svc) return svc.service
  if (slots.damageLocation && SERVICE_FOR_LOCATION[slots.damageLocation]) return SERVICE_FOR_LOCATION[slots.damageLocation]
  if (slots.damageKind === 'structural') return 'structural-fiberglass'
  if (slots.damageKind === 'cosmetic') return 'gelcoat-repair'
  return 'fiberglass-repair'
}

export function composeMessage(slots: Slots): string {
  return composeQuoteMessage(slots)
}

export function draftFor(slots: Slots): Draft {
  const d: Draft = {}
  if (slots.name) d.name = slots.name
  if (slots.email) d.email = slots.email
  if (slots.phone) d.phone = slots.phone
  if (slots.svc || slots.damageLocation || slots.damageKind) d.service = serviceFor(slots)
  const boat = describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat })
  if (boat && boat !== 'Not sure') d.boat = boat
  if (slots.where) d.boatLocation = slots.where
  const msg = composeMessage(slots)
  if (msg) d.message = msg
  return d
}

export function question(step: Step, slots: Slots): string {
  return questionFor(step, slots)
}

export function ackForStep(step: Step | undefined, slots: Slots, extractedKeys: string[]): string {
  // short, scripted acknowledgement of what was just captured from typed text (no-key mode)
  if (!step) return ''
  if (step === 'contact') return extractedKeys.includes('name') && slots.name ? `Thanks, ${slots.name.split(' ')[0]}.` : extractedKeys.length ? 'Got it.' : ''
  if ((step === 'boat' || (step === 'service' && !extractedKeys.includes('svc'))) && extractedKeys.includes('boat')) {
    const b = describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat })
    return b === 'Not sure' ? 'No problem, we can sort that out when we see her.' : `A ${b}, nice.`
  }
  if (step === 'service' && extractedKeys.includes('svc')) return svcDef(slots.svc)?.ack || 'Understood.'
  if (step === 'where' && extractedKeys.includes('where')) return 'Good to know.'
  return extractedKeys.length ? 'Noted.' : ''
}

export function chipsForStep(step: Step, slots: Slots): Chip[] {
  const form = formChip(draftFor(slots))
  const choices: Chip[] = choiceChips(step, slots)
  if (choices.length) return choices
  switch (step) {
    // job tiles, boat card and photo buttons carry their own "not sure" / "skip"; only the form way out goes below
    case 'photos': return slots.photos ? [{ label: 'Move on', send: 'Move on', primary: true }, form] : [form]
    case 'notes': return [{ label: "That's everything", answer: { step, value: 'none' }, primary: true }]
    case 'contact': return [{ label: 'Why do you need this?', send: 'Why do you need my contact details?' }, form]
    case 'review': return [{ label: 'Send it to the crew', send: 'Send it', primary: true }, { label: 'Change something', send: 'Change something' }, form]
    default: return [form]
  }
}

export const CHANGE_CHIPS: Chip[] = [
  { label: 'The job', send: 'Change the job' }, { label: 'Boat', send: 'Change the boat' }, { label: 'Damage details', send: 'Change the damage' },
  { label: 'Where she is', send: 'Change where the boat is' }, { label: 'Contact info', send: 'Change my contact info' },
]

export function reviewCard(slots: Slots): [string, string][] {
  return reviewRows(slots, describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat }))
}

export function hoursReply(): string {
  const a = biz.address
  return `We're open **${biz.hours.display}** (${biz.hours.note.toLowerCase()}). The yard is at [${a.street}, ${a.city}, ${a.state} ${a.zip}](${a.mapsUrl}), and you can call or text [${biz.phone}](tel:${phoneDigits()}) any time during those hours.`
}

export const LINES = {
  quoteStart: "Let's get her sorted. A few quick taps and a real crew member puts your quote together; nothing here is a price.",
  quoteResume: "Welcome back. Let's pick up where we left off.",
  anotherQuestion: 'Sure thing. Ask me anything about fiberglass, gelcoat or the yard and I will do my best.',
  photosHow: 'Tap "Take photos" (or the camera icon next to the message box) and add up to five JPEG, PNG or WebP photos, 10 MB each. They stay with this conversation and go to the crew with your request.',
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
