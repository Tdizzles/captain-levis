// The first reply to a quote request, written by rules, not by a model. Captain Levi's voice: plain,
// friendly, salt-of-the-earth, a working captain who has seen it all and is on the customer's side.
// Never prices, never dates, never promises. Staff read it, edit if they like, and send it themselves.
import { business, serviceLabel } from '../business.js'
import { describeBoat } from '../boat.js'
import type { InquiryRow } from '../inquiries.js'
import { assessInquiry, questionsToAsk, type Assessment } from './missing.js'

const OPENERS: Record<string, string> = {
  'transom-replacement': 'A soft or cracked transom is the one thing on a boat I never let anyone sit on. Good call getting it looked at before the motor does the deciding for you.',
  'stringer-repairs': 'Stringers are the backbone of the boat, and when they go soft the whole hull starts to work against itself. Glad you caught it.',
  'bulkhead-repairs': 'Bulkheads keep the hull from flexing, and once they let go everything around them starts to crack. Worth fixing right.',
  'hull-repairs': 'Hull damage is our bread and butter. Most of what looks ugly is very fixable once we grind back to good glass.',
  'deck-repairs': 'A spongy deck is almost always wet core underneath, and it only spreads. The sooner we open it up, the smaller the repair.',
  'gelcoat-repair': 'Gelcoat work is where we get picky: the repair has to disappear, not just get covered up. Color matching is half the job.',
  'structural-fiberglass': 'Structural glass is what this yard was built on. We rebuild it to the original layup or better, not a patch over a problem.',
  'custom-fabrication': 'Custom glass work is my favorite kind of job. Tell me what you are picturing and we will figure out how to build it strong.',
  'boat-detailing': 'A proper compound and polish brings back more shine than most folks expect, especially on an older hull.',
  'boat-restoration': 'Restorations are a labor of love. We do the structure first and the pretty part last, so the boat is sound before it is shiny.',
  'boat-yard': 'We have room in the yard, and plenty of jobs are better done out of the water. Let me get a few details so I can plan the haul-out.',
  'pwc-repair': 'Jet skis take a beating and their hulls are thin, so cracks spread fast. We fix a lot of them, insurance jobs included.',
  'kayak-repair': 'Fiberglass kayaks repair beautifully if the crack is caught early. Let me take a look at what you have got.',
  'insurance-claim': 'Insurance claims are a big part of what we do, and we know how the adjusters want the estimate written. I will walk you through it.',
}
const DEFAULT_OPENER = 'Thanks for sending this over. Fiberglass is what we do all day, every day, and most damage is more fixable than it looks.'

function greeting(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || 'there'
  return `Hi ${first},`
}

export interface TemplatedReply { subject: string; body: string; assessment: Assessment; asked: string[] }

export function templatedReply(i: InquiryRow, photoCount: number): TemplatedReply {
  const biz = business()
  const a = assessInquiry(i, photoCount)
  const asked = questionsToAsk(a)
  const boat = describeBoat({ make: i.boat_make, model: i.boat_model, year: i.boat_year, raw: i.boat_raw })
  const service = serviceLabel(i.service)
  const opener = OPENERS[i.service] || DEFAULT_OPENER

  const paragraphs: string[] = []
  paragraphs.push(greeting(i.name))
  paragraphs.push(`Captain Levi here. Got your request${boat ? ` about the ${boat}` : ''} (reference ${i.ref}). ${opener}`)

  if (asked.length) {
    const lead = a.readiness === 'needs_info'
      ? 'Before I can put real numbers on it I need a little more from you:'
      : 'I have most of what I need. A couple of quick things so the quote is right the first time:'
    paragraphs.push(lead + '\n' + asked.map((g, n) => `${n + 1}. ${g.question}`).join('\n'))
  } else {
    paragraphs.push('You gave me everything I need to get started, which makes my day easier. Thank you.')
  }

  const inWater = a.mentions.inWater
  const nextStep = a.insurance
    ? 'Once I have that, I will write the estimate up as a proper supplement in the format the carrier expects, with photos, so there is no back-and-forth with the adjuster.'
    : inWater === false
      ? 'Once I have that, I will put a written estimate together. For most trailer boats we can look at it at your place or you can swing by the yard in Largo, whichever is easier.'
      : inWater === true
        ? 'Once I have that, I will put a written estimate together. Some of this can be done at the dock; anything below the waterline means a short trip to the yard, and we can arrange the haul-out.'
        : 'Once I have that, I will put a written estimate together and we can decide whether we come to you or you bring her to the yard in Largo.'
  paragraphs.push(nextStep)
  paragraphs.push(`If it is easier to talk it through, call or text me at ${biz.phone}, ${biz.hours.short.replace(/–/g, '-')}. Photos can go straight to this email.`)
  paragraphs.push(`Fair winds,\nCaptain Levi\n${biz.name} · ${biz.address.street}, ${biz.address.city}, ${biz.address.state} ${biz.address.zip}\n${biz.phone} · ${biz.email}`)

  const subject = `Re: your ${service} quote request ${i.ref} — ${biz.name}`
  return { subject, body: paragraphs.join('\n\n'), assessment: a, asked: asked.map((g) => g.key) }
}
