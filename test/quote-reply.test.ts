import { describe, expect, it } from 'vitest'
import type { InquiryRow } from '../lib/inquiries.js'
import { assessInquiry, questionsToAsk } from '../lib/quote/missing.js'
import { templatedReply } from '../lib/quote/reply.js'
import { renderInquiryEmail } from '../lib/email/render.js'

const base: InquiryRow = {
  id: '11111111-1111-4111-8111-111111111111', ref: 'CL-2026-0042', kind: 'quote', status: 'new', name: 'Maria Lopez', email: 'maria@example.com', phone: '727-555-0100',
  service: 'gelcoat-repair', boat_make: null, boat_model: null, boat_year: null, boat_raw: null, boat_location: null, damage_location: null, damage_type: null,
  message: 'There is a scratch on my boat, can you fix it?', page: 'contact', source: 'form', chat_session_id: null, idempotency_key: null, ip_hash: null, user_agent: null,
  created_at: new Date('2026-10-22T14:00:00Z'), updated_at: new Date('2026-10-22T14:00:00Z'),
}

describe('assessInquiry', () => {
  it('flags everything on a sparse inquiry but asks only the basics: photos, boat, city', () => {
    const a = assessInquiry(base, 0)
    const keys = a.gaps.map((g) => g.key)
    expect(keys).toEqual(expect.arrayContaining(['photos', 'boat', 'area', 'size', 'location', 'in_water', 'timeline']))
    expect(a.readiness).toBe('needs_info')
    expect(a.insurance).toBe(false)
    expect(questionsToAsk(a).map((g) => g.key)).toEqual(['photos', 'boat', 'location'])
  })

  it('reads size, area, in/out of water and insurance from the text and the structured fields', () => {
    const rich: InquiryRow = { ...base, boat_make: 'Sea Ray', boat_model: '270 SDX', boat_year: 2019, boat_location: 'Dry storage in Clearwater',
      message: 'Gouge about 6 inches long on the starboard hull side above the waterline from the dock. Boat is on a trailer. Going through insurance with Progressive, claim 26-918740453, adjuster is Dan Smith 727-555-0199. Hoping to have it done before a trip next month.' }
    const a = assessInquiry(rich, 3)
    expect(a.gaps.map((g) => g.key)).toEqual([])
    expect(a.readiness).toBe('ready')
    expect(a.insurance).toBe(true)
    expect(a.mentions.inWater).toBe(false)
    expect(a.mentions.area).toBe('hull')
  })

  it('asks for insurance details when a claim is mentioned without a number', () => {
    const a = assessInquiry({ ...base, service: 'insurance-claim', message: 'Hit a piling, insurance is involved, about a foot of damage on the bow, boat is in the water at my dock in Largo.', boat_raw: '2015 Grady-White 230', boat_make: 'Grady-White', boat_model: '230', boat_year: 2015 }, 2)
    expect(a.gaps.map((g) => g.key)).toContain('insurance')
    expect(a.gaps.map((g) => g.key)).not.toContain('size')
    expect(a.mentions.inWater).toBe(true)
    expect(questionsToAsk(a).map((g) => g.key)).toEqual(['location']) // claim details wait until later
  })
})

describe('templatedReply', () => {
  it('writes a short first reply in Captain Levi\'s voice that asks only for the basics', () => {
    const r = templatedReply(base, 0)
    expect(r.subject).toContain('CL-2026-0042')
    expect(r.body.startsWith('Hi Maria,')).toBe(true)
    expect(r.body).toContain('Captain Levi here')
    expect(r.body).toMatch(/\n- A few photos.+\n- The boat’s make, model and length\n- The city the boat is in/)
    expect(r.body).not.toMatch(/\$\d/)
    expect(r.body).not.toMatch(/how big|year|claim|adjuster|in the water|timing|\bHIN\b/i)
    expect(r.body).toContain('727-391-7639')
    expect(r.body).toContain('Fair winds')
    expect(r.body.split(/\s+/).length).toBeLessThanOrEqual(80)
    expect(r.asked).toEqual(['photos', 'boat', 'location'])
  })

  it('asks a single missing basic inline and holds insurance paperwork for later', () => {
    const r = templatedReply({ ...base, service: 'insurance-claim', boat_make: 'Grady-White', boat_model: '230', boat_year: 2015, message: 'Hit a piling, insurance is involved.' }, 2)
    expect(r.body).toContain('I just need the city the boat is in.')
    expect(r.body).toContain('and for the photos')
    expect(r.body).toContain('claim details later')
    expect(r.body).not.toMatch(/claim number|adjuster|carrier/i)
    expect(r.body).not.toMatch(/\n- /)
  })

  it('skips the questions when nothing is missing', () => {
    const rich: InquiryRow = { ...base, service: 'transom-replacement', boat_make: 'Boston Whaler', boat_model: 'Outrage 24', boat_year: 2004, boat_location: 'Trailer in Largo',
      message: 'Transom soft about 2 ft wide around the drain, boat is on the trailer, insurance claim 26-123456789 with BoatUS, adjuster assigned. Trip in three weeks.' }
    const r = templatedReply(rich, 4)
    expect(r.body).not.toMatch(/\n- /)
    expect(r.body).toContain('everything I need')
    expect(r.body).toContain('2004 Boston Whaler Outrage 24')
  })
})

describe('inquiry email', () => {
  it('carries the missing-info list, the reply to send and the quote-builder link', () => {
    const reply = templatedReply(base, 0)
    const { html, text } = renderInquiryEmail({ inquiry: base, photos: [], reply })
    expect(html).toContain('What we still need to quote')
    expect(html).toContain('Reply to send')
    expect(html).toContain('Open in Quote Builder')
    expect(html).toContain('/app/#/inquiries/11111111-1111-4111-8111-111111111111')
    expect(html).not.toContain('Estimater')
    expect(text).toContain('WHAT WE STILL NEED TO QUOTE')
    expect(text).toContain('REPLY TO SEND')
    expect(text).toContain('Captain Levi here')
  })
})
