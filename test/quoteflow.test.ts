import { describe, expect, it } from 'vitest'
import { applyAnswer, boatFromSentence, detailsFor, guessService, matchOption, nextQuoteStep, plan, prefillFromText, setService, sizeFromText, WHERE_STATUS } from '../lib/chat/quoteflow.js'
import type { Slots } from '../lib/chat/types.js'
import { assessInquiry } from '../lib/quote/missing.js'
import { skeletonFor } from '../lib/quote/skeleton.js'
import type { InquiryRow } from '../lib/inquiries.js'

describe('quote flow plan', () => {
  it('asks each job its own follow-ups, and only the diagram and size where they matter', () => {
    const impact: Slots = {}; setService(impact, 'impact')
    expect(plan(impact)).toEqual(['service', 'boat', 'fu:how', 'fu:insurance', 'fu:water', 'zones', 'size', 'photos', 'where', 'timeline', 'notes', 'contact', 'review'])
    const transom: Slots = {}; setService(transom, 'transom')
    expect(plan(transom)).toEqual(['service', 'boat', 'fu:engine', 'fu:symptom', 'photos', 'where', 'timeline', 'notes', 'contact', 'review'])
    const detailing: Slots = {}; setService(detailing, 'detailing')
    expect(plan(detailing)).not.toContain('zones')
    expect(plan(detailing)).not.toContain('size')
  })

  it('adds "can you bring her in?" only for trailer boats', () => {
    const s: Slots = {}; setService(s, 'chips')
    expect(plan(s)).not.toContain('fu:bring')
    applyAnswer(s, 'where', { status: 'trailer', city: 'Largo' })
    expect(plan(s)).toContain('fu:bring')
    expect(s.where).toBe('On a trailer, Largo')
  })

  it('skips what is already known and walks forward as answers arrive', () => {
    const s: Slots = { boat: '2016 Grady-White' }
    expect(nextQuoteStep(s)).toBe('service')
    applyAnswer(s, 'service', 'soft')
    expect(nextQuoteStep(s)).toBe('fu:feel')
    expect(applyAnswer(s, 'fu:feel', ['soft', 'smell', 'bogus'])).toMatchObject({ ok: true })
    expect(s.answers!.feel).toEqual(['soft', 'smell'])
    expect(nextQuoteStep(s)).toBe('fu:area')
  })

  it('rejects values the widget never offers', () => {
    const s: Slots = {}
    expect(applyAnswer(s, 'service', 'nuclear').ok).toBe(false)
    expect(applyAnswer(s, 'size', 'galaxy').ok).toBe(false)
    expect(applyAnswer(s, 'boat', {}).ok).toBe(false)
    expect(applyAnswer(s, 'zones', ['moon']).ok).toBe(false)
    expect(applyAnswer(s, 'timeline', 'yesterday').ok).toBe(false)
  })

  it('changing the job clears the old job’s answers', () => {
    const s: Slots = {}; setService(s, 'impact')
    applyAnswer(s, 'fu:how', 'dock'); applyAnswer(s, 'size', 'palm')
    setService(s, 'cracks')
    expect(s.answers).toEqual({})
    expect(s.size).toBeUndefined()
  })

  it('reads typed answers', () => {
    expect(guessService('my transom is soft')).toBe('transom')
    expect(guessService('hit a piling at the fuel dock')).toBe('impact')
    expect(guessService('needs a ceramic coat')).toBe('detailing')
    expect(sizeFromText('about the size of my palm')).toBe('palm')
    expect(sizeFromText('maybe 4 feet long')).toBe('bigger')
    expect(matchOption(WHERE_STATUS, 'she is on a lift')).toBe('lift')
  })
})

describe('reading a whole sentence', () => {
  it('takes only the boat out of a story', () => {
    expect(boatFromSentence('backed into a piling and cracked the stern on my 2018 Robalo')).toEqual({ make: 'Robalo', model: undefined, year: 2018 })
    expect(boatFromSentence('my 2004 Boston Whaler Outrage 24 transom is soft')).toEqual({ make: 'Boston Whaler', model: 'Outrage 24', year: 2004 })
    expect(boatFromSentence('the gelcoat is chipped')).toEqual({})
  })

  it('pre-fills the follow-ups the visitor already answered', () => {
    const s: Slots = {}; setService(s, 'impact')
    expect(prefillFromText(s, 'backed into a piling and cracked the stern, insurance is involved')).toEqual(['fu:how', 'fu:insurance', 'zones'])
    expect(s.answers).toEqual({ how: ['dock'], insurance: ['yes'] })
    expect(s.zones).toEqual(['stern'])
    expect(nextQuoteStep(s)).toBe('boat')
    const t: Slots = {}; setService(t, 'transom')
    prefillFromText(t, 'twin outboards and the transom flexes')
    expect(t.answers).toEqual({ engine: ['twins'] })
    // "I left it at the dock" is not the port side
    const u: Slots = {}; setService(u, 'chips')
    prefillFromText(u, 'I left it at the dock and found scratches')
    expect(u.zones).toBeUndefined()
  })
})

describe('draft estimate skeleton', () => {
  it('names the work for the job without inventing prices', () => {
    const s: Slots = {}; setService(s, 'impact')
    applyAnswer(s, 'fu:water', 'some'); applyAnswer(s, 'zones', ['bow', 'bottom']); applyAnswer(s, 'size', 'plate')
    applyAnswer(s, 'where', { status: 'dock' })
    const sk = skeletonFor(detailsFor(s))
    expect(sk.map((x) => x.title)).toEqual(['Impact damage repair (bow, bottom, below the waterline)', 'Below the waterline', 'Haul-out'])
    expect(sk[0].lines[0]).toMatch(/water intrusion/)
    expect(sk[0].lines[1]).toMatch(/about dinner plate size/)
  })

  it('leaves out engine work when nothing hangs on the transom', () => {
    const s: Slots = {}; setService(s, 'transom')
    applyAnswer(s, 'fu:engine', 'none'); applyAnswer(s, 'where', { status: 'yard' })
    const lines = skeletonFor(detailsFor(s)).flatMap((x) => x.lines)
    expect(lines.some((l) => /engine/i.test(l))).toBe(false)
  })
})

describe('what we still need (chat answers count)', () => {
  const row = (over: Partial<InquiryRow>): InquiryRow => ({
    id: 'x', ref: 'CL-2026-0009', kind: 'quote', status: 'new', name: 'T', email: 't@example.com', phone: '7275550100', service: 'hull-repairs',
    boat_make: 'Mako', boat_model: '21', boat_year: 1998, boat_raw: '1998 Mako 21', boat_location: 'On a trailer, Largo', damage_location: 'bow',
    damage_type: 'impact', message: 'Job: Collision or impact\nInsurance: No, I\'m paying', page: 'index', source: 'chat', chat_session_id: null,
    idempotency_key: null, ip_hash: null, user_agent: null, created_at: new Date(), updated_at: new Date(), ...over,
  })

  it('an "Insurance: No" answer is not an insurance job, and size and timing from the chat count', () => {
    const s: Slots = {}; setService(s, 'impact')
    applyAnswer(s, 'fu:insurance', 'no'); applyAnswer(s, 'size', 'palm'); applyAnswer(s, 'timeline', 'month'); applyAnswer(s, 'where', { status: 'trailer' })
    const a = assessInquiry(row({ details: detailsFor(s) }), 2)
    expect(a.insurance).toBe(false)
    expect(a.have).toEqual(expect.arrayContaining(['size', 'in_water', 'timeline', 'area']))
    expect(a.readiness).toBe('ready')
  })
})
