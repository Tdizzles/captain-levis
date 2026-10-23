// The first reply to a quote request, written by rules, not by a model. Captain Levi's voice, and SHORT: a long
// first email loses the customer. It asks only for the basics (photos, the boat, where it is); the year, size,
// insurance paperwork and the rest get picked up later. Never prices, never dates, never promises. Staff read
// it, edit if they like, and send it themselves.
import { business } from '../business.js'
import { describeBoat } from '../boat.js'
import type { InquiryRow } from '../inquiries.js'
import { assessInquiry, questionsToAsk, type Assessment } from './missing.js'

function greeting(name: string): string {
  const first = (name || '').trim().split(/\s+/)[0] || 'there'
  return `Hi ${first},`
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

export interface TemplatedReply { subject: string; body: string; assessment: Assessment; asked: string[] }

export function templatedReply(i: InquiryRow, photoCount: number): TemplatedReply {
  const biz = business()
  const a = assessInquiry(i, photoCount)
  const asked = questionsToAsk(a)
  const boat = describeBoat({ make: i.boat_make, model: i.boat_model, year: i.boat_year, raw: i.boat_raw })

  const paragraphs: string[] = [greeting(i.name)]
  const thanks = `Captain Levi here. Thanks for reaching out${boat ? ` about the ${boat}` : ''}${photoCount ? ', and for the photos' : ''}.`

  if (asked.length === 0) {
    paragraphs.push(`${thanks} That’s everything I need to get started on your quote.`)
  } else if (asked.length === 1) {
    paragraphs.push(`${thanks} To get you a quote I just need ${lower(asked[0].question)}.`)
  } else {
    paragraphs.push(`${thanks} To get you a quote, send me:\n${asked.map((g) => `- ${g.question}`).join('\n')}`)
  }
  if (a.insurance) paragraphs.push('We work with insurance all the time. We can sort out the claim details later.')
  paragraphs.push(asked.length
    ? `Just reply here or text me at ${biz.phone}.`
    : `Any questions, call or text me at ${biz.phone}.`)
  paragraphs.push(`Fair winds,\nCaptain Levi\n${biz.name} · ${biz.phone}`)

  const subject = `Re: your quote request ${i.ref} — ${biz.name}`
  return { subject, body: paragraphs.join('\n\n'), assessment: a, asked: asked.map((g) => g.key) }
}
