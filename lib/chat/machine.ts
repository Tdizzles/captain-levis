// The chat as a server-side state machine. Control flow lives here and is fully deterministic; a model, when
// available, only phrases acknowledgements and answers questions. Every path works with no API key.
import { z } from 'zod'
import { aiConfigured, budget, callModel } from '../ai.js'
import { business, phoneDigits } from '../business.js'
import { describeBoat, parseBoat } from '../boat.js'
import type { Db } from '../db.js'
import { createInquiry, emailSchema, phoneSchema, type InquiryRow } from '../inquiries.js'
import { enqueueAndSendInquiryEmail } from '../email/send.js'
import { EMAIL_RE, extractDeterministic, extractWithModel } from './extract.js'
import { pageBySlug, routeFor, searchPages, TOPIC_ANSWERS } from './knowledge.js'
import { PERSONA } from './persona.js'
import { CHANGE_CHIPS, chipsForStep, draftFor, formChip, hoursReply, LINES, question, reviewCard, serviceFor, composeMessage, START_CHIPS, ackForStep } from './script.js'
import { pushMessage } from './store.js'
import { STEPS, type ChatResponse, type ChatSessionRow, type Chip, type Extracted, type Link, type Slots, type Step } from './types.js'

export interface TurnInput {
  message: string
  page: string
  pageTitle: string
  context: string
  photoCount?: number    // photos attached with this turn (already verified to belong to the session)
  note?: string
  ipHash: string | null
  userAgent: string | null
}

export interface TurnOutput { response: Omit<ChatResponse, 'sessionId'>; cost: number; tokensIn: number; tokensOut: number; aiMode: 'model' | 'scripted' | 'budget' }

type AiMode = TurnOutput['aiMode']

const INJECTION_RE = /ignore (all |any |your |the )?(previous |prior |above |earlier )?(instructions|rules|prompt)|system prompt|reveal (your|the) (instructions|prompt|rules)|print (your|the) (system )?(prompt|instructions)|you are now|pretend (you are|to be)|act as (an? )?(?!captain)|jailbreak|developer mode|show me (your|the) (config|configuration|instructions)|other customers?'? (data|info|details)/i
const HOURS_RE = /\b(hours?|opening|open (today|now|on|until)|closed?|address|directions?|where (are|is) (you|the (shop|yard))|located|location|map)\b/i
const QUOTE_RE = /\b(quote|estimate|pric(e|es|ing)|cost|how much|repair|fix|damage|damaged|broken|cracked|soft|rot|leak)\b/i
const FORM_RE = /\b(fill out|use|do) the form\b|\brather fill\b|\bform myself\b|\bquote form\b/i
const PHOTOS_RE = /\b(send|add|attach|upload|share|take)\b.{0,20}\b(photo|picture|pic|image|pics|photos)s?\b|\bcan i send photos\b|\bphoto\b.{0,15}\b(how|where)\b/i
const PROCESS_RE = /how (does|do|will) (the |this |it |your )?(repair |quote |whole )?(process|it|this|work|happen)|what happens (next|after)|how does it work|next steps?/i
const QUESTION_CHIP_RE = /^i have another question$/i
const WHY_CONTACT_RE = /why do you need|what do you need (that|this|my)/i
const WHAT_NEED_RE = /what do you need to know/i
const SEND_RE = /^(send it|send|yes|yep|yeah|looks good|looks right|that's right|correct|go ahead|submit)\b/i
const CHANGE_RE = /^(change something|change|no|edit|fix)\b/i
const SKIP_PHOTOS_RE = /^(skip|skip photos|no photos|move on|no thanks|later|continue|next)\b/i
const RESTART_RE = /^(start over|restart|reset|new quote)\b/i

function nextStep(slots: Slots): Step {
  if (!slots.boat) return 'boat'
  if (!slots.damage) return 'damage'
  if (!slots.damageLocation) return 'damageLocation'
  if (!slots.damageKind) return 'damageKind'
  if (!slots.where) return 'where'
  if (!slots.photos && !slots.photosDeclined) return 'photos'
  if (!slots.name) return 'name'
  if (!slots.email) return 'email'
  if (!slots.phone) return 'phone'
  return 'review'
}

function linkFor(text: string, page: string): Link[] | undefined {
  const r = routeFor(text)
  if (!r || r.slug === page) return undefined
  return [r.link]
}

function merge(slots: Slots, ex: Extracted, step: Step | undefined): string[] {
  const keys: string[] = []
  const set = <K extends keyof Slots>(k: K, v: Slots[K] | undefined) => { if (v !== undefined && v !== null && v !== '') { slots[k] = v; keys.push(k) } }
  if (ex.boat) {
    set('boat', ex.boat)
    const parsed = parseBoat(ex.boat)
    set('boatMake', ex.boatMake ?? parsed.make ?? undefined)
    set('boatModel', ex.boatModel ?? parsed.model ?? undefined)
    set('boatYear', ex.boatYear ?? parsed.year ?? undefined)
  }
  set('boatType', ex.boatType)
  if (ex.damage) set('damage', step === 'damage' || !slots.damage ? ex.damage : `${slots.damage} ${ex.damage}`.slice(0, 500))
  set('damageLocation', ex.damageLocation)
  set('damageKind', ex.damageKind)
  set('where', ex.where)
  set('name', ex.name)
  if (ex.email && emailSchema.safeParse(ex.email).success) set('email', ex.email)
  if (ex.phone && phoneSchema.safeParse(ex.phone).success) set('phone', ex.phone)
  if (ex.notSure) {
    if (step === 'boat' && !slots.boat) set('boat', 'Not sure')
    if (step === 'damageLocation' && !slots.damageLocation) set('damageLocation', 'not sure')
    if (step === 'damageKind' && !slots.damageKind) set('damageKind', 'not sure')
    if (step === 'where' && !slots.where) set('where', 'Not sure')
  }
  return keys
}

function stepResponse(s: ChatSessionRow, ack: string, extra: Partial<Omit<ChatResponse, 'sessionId'>> = {}): Omit<ChatResponse, 'sessionId'> {
  const step = nextStep(s.slots)
  s.state.step = step
  const q = question(step, s.slots)
  const reply = [ack, q].filter(Boolean).join(' ')
  const out: Omit<ChatResponse, 'sessionId'> = { reply, chips: chipsForStep(step, s.slots), draft: draftFor(s.slots), ...extra }
  if (step === 'review') out.card = reviewCard(s.slots)
  return out
}

async function aiModeFor(db: Db): Promise<AiMode> {
  if (!aiConfigured()) return 'scripted'
  return (await budget(db)).ok ? 'model' : 'budget'
}

const answerSchema = z.object({ answer: z.string(), page_slug: z.string().nullable() })

/** Answer a free question from site knowledge. Returns reply + optional link. */
async function answerQuestion(db: Db, s: ChatSessionRow, input: TurnInput, mode: AiMode): Promise<{ reply: string; links?: Link[]; cost: number; tokensIn: number; tokensOut: number }> {
  const text = input.message
  const route = routeFor(text)
  const hits = searchPages(text, 3)
  const links = linkFor(text, input.page)
  if (mode === 'model') {
    const ctxPages = [route ? pageBySlug(route.slug) : undefined, ...hits.map((h) => h.page)].filter((p): p is NonNullable<typeof p> => !!p)
      .filter((p, i, a) => a.findIndex((x) => x.slug === p.slug) === i).slice(0, 3)
    const context = [
      `Context for this turn (from the website, not the visitor): the visitor is on page "${input.pageTitle || input.page}" (slug ${input.page}) and asked a question.`,
      `Answer in two to four sentences from the page excerpts below only; say so plainly if they do not cover it and point to a call or text at ${business().phone}. Set page_slug to the single most relevant slug (or null). Do not link to the page the visitor is already on.`,
      ...ctxPages.map((p) => `<page slug="${p.slug}">\nTitle: ${p.title}\nHeading: ${p.h1}\nSummary: ${p.description}\nSections: ${p.h2s.join(' | ')}\n${p.text}\n</page>`),
    ].join('\n\n')
    const history = s.messages.slice(-30).map((m) => ({ role: m.role, content: m.text || '(photo added)' }))
    const res = await callModel(db, 'chat', { system: [PERSONA, context], messages: [...history, { role: 'user', content: text }], schema: answerSchema, maxTokens: 600 })
    if (res?.parsed?.answer) {
      let out: Link[] | undefined = links
      const slug = res.parsed.page_slug
      if (!out && slug && slug !== input.page) { const p = pageBySlug(slug); if (p) out = [{ label: p.h1 || p.title, href: `${p.slug}.html` }] }
      return { reply: res.parsed.answer.trim().slice(0, 900), links: out, cost: res.cost, tokensIn: res.usage.input_tokens, tokensOut: res.usage.output_tokens }
    }
  }
  // scripted / fallback
  const prefix = mode === 'budget' ? LINES.simpleMode + ' ' : ''
  if (route) return { reply: prefix + (TOPIC_ANSWERS[route.topic] || LINES.startFallback), links, cost: 0, tokensIn: 0, tokensOut: 0 }
  if (hits.length && hits[0].score >= 5) {
    const p = hits[0].page
    const link = p.slug !== input.page ? [{ label: p.h1 || p.title, href: `${p.slug}.html` }] : undefined
    const desc = p.description ? ` ${p.description}` : ''
    return { reply: `${prefix}The best place for that is our **${p.h1 || p.title}** page.${desc}`.trim(), links: link, cost: 0, tokensIn: 0, tokensOut: 0 }
  }
  return { reply: prefix + LINES.questionNoMatch, links, cost: 0, tokensIn: 0, tokensOut: 0 }
}

async function submitQuote(db: Db, s: ChatSessionRow, input: TurnInput): Promise<{ ok: true; inquiry: InquiryRow } | { ok: false }> {
  const slots = s.slots
  const message = composeMessage(slots) || 'Quote requested through the website chat.'
  try {
    const inquiry = await createInquiry(db, {
      input: {
        name: slots.name || 'Unknown', email: slots.email || '', phone: slots.phone || '', service: serviceFor(slots),
        boat: describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat }) || '',
        boat_location: slots.where || '', message: message.length >= 10 ? message : `${message} (details above)`, page: input.page, kind: 'quote',
        idempotency_key: `chat:${s.id}`,
      },
      source: 'chat', chatSessionId: s.id, damageLocation: slots.damageLocation || null, damageType: slots.damageKind || null,
      ipHash: input.ipHash, userAgent: input.userAgent,
    })
    s.inquiry_id = inquiry.id
    await enqueueAndSendInquiryEmail(db, inquiry) // never throws; delivery status is recorded
    return { ok: true, inquiry }
  } catch (err) {
    console.error('[chat] submit failed', err)
    return { ok: false }
  }
}

export async function runTurn(db: Db, s: ChatSessionRow, input: TurnInput): Promise<TurnOutput> {
  const text = input.message.trim().slice(0, 1000)
  const state = s.state
  const slots = s.slots
  const mode = await aiModeFor(db)
  const tally = { cost: 0, tokensIn: 0, tokensOut: 0 }
  const finish = (response: Omit<ChatResponse, 'sessionId'>): TurnOutput => {
    if (text) pushMessage(s, 'user', text)
    else if (input.photoCount) pushMessage(s, 'user', input.note || `${input.photoCount} photo(s) added`)
    pushMessage(s, 'assistant', response.reply)
    if (!response.chips?.length) response.chips = START_CHIPS
    return { response, aiMode: mode, ...tally }
  }

  // --- photos attached with this turn (no text) -------------------------------------------------
  if (!text && input.photoCount) {
    slots.photos = (slots.photos || 0) + input.photoCount
    if (state.mode === 'quote') {
      slots.photosDeclined = false
      return finish(stepResponse(s, `Got ${input.photoCount === 1 ? 'the photo' : `${input.photoCount} photos`}, thank you.`, { links: undefined }))
    }
    return finish({ reply: `Got ${input.photoCount === 1 ? 'the photo' : `${input.photoCount} photos`}, thank you. Want me to take the rest of the details for a quote?`, chips: START_CHIPS, draft: draftFor(slots) })
  }
  if (!text) return finish({ reply: LINES.startFallback, chips: START_CHIPS })

  // --- guards that apply in every state ---------------------------------------------------------
  if (INJECTION_RE.test(text)) {
    if (state.mode === 'quote' && state.step) return finish({ reply: `${LINES.injection} ${question(state.step, slots)}`, chips: chipsForStep(state.step, slots), draft: draftFor(slots) })
    return finish({ reply: LINES.injection, chips: START_CHIPS })
  }
  if (RESTART_RE.test(text)) {
    s.slots = {}; s.state = { mode: 'start' }
    return finish({ reply: 'Fresh start. What can I do for you?', chips: START_CHIPS })
  }
  if (FORM_RE.test(text)) {
    return finish({ reply: LINES.formHandoff, chips: [formChip(draftFor(slots)), ...START_CHIPS.slice(0, 2)], draft: draftFor(slots) })
  }
  if (PHOTOS_RE.test(text)) {
    const reply = LINES.photosHow
    if (state.mode === 'quote' && state.step) return finish({ reply, chips: chipsForStep(state.step, slots).filter((c) => !/send (more )?photos/i.test(c.label)), draft: draftFor(slots) })
    return finish({ reply, chips: START_CHIPS })
  }
  if (WHY_CONTACT_RE.test(text) && state.mode === 'quote' && state.step) {
    return finish({ reply: `${LINES.whyContact} ${question(state.step, slots)}`, chips: chipsForStep(state.step, slots), draft: draftFor(slots) })
  }
  const stepAtEntry = state.mode === 'quote' ? state.step : undefined
  if (HOURS_RE.test(text) && stepAtEntry !== 'where' && !(stepAtEntry === 'damage' && !/\b(your|you guys|the shop|the yard)\b/i.test(text))) {
    // hours state: answer, then back to the previous flow or start chips
    if (state.mode === 'quote' && state.step) return finish({ reply: `${hoursReply()}\n\n${question(state.step, slots)}`, chips: chipsForStep(state.step, slots), draft: draftFor(slots) })
    return finish({ reply: hoursReply(), chips: START_CHIPS })
  }

  // --- done: quote already submitted ------------------------------------------------------------
  if (state.mode === 'done') {
    if (QUOTE_RE.test(text) && /\b(another|new|second|other)\b/i.test(text)) {
      s.slots = {}; s.state = { mode: 'quote', step: 'boat', quoteStartedAt: new Date().toISOString() }
      return finish(stepResponse(s, LINES.quoteStart, { event: 'quote_start' }))
    }
    if (QUESTION_CHIP_RE.test(text)) { state.asking = true; return finish({ reply: LINES.anotherQuestion, chips: questionChips() }) }
    const a = await answerQuestion(db, s, input, mode); addTally(tally, a)
    return finish({ reply: a.reply, links: a.links, chips: [{ label: 'I need another quote', send: 'I need another quote' }, ...START_CHIPS.slice(1)] })
  }

  // --- start: route by intent -----------------------------------------------------------------------
  if (state.mode === 'start') {
    if (QUESTION_CHIP_RE.test(text)) { state.asking = true; return finish({ reply: LINES.anotherQuestion, chips: questionChips() }) }
    if (PROCESS_RE.test(text)) { state.asking = false; return finish({ reply: LINES.processAnswer, links: input.page !== 'structural-fiberglass-repair' ? [{ label: 'How our repairs work', href: 'structural-fiberglass-repair.html' }] : undefined, chips: START_CHIPS }) }
    const explicitQuote = /^i need a quote\b|\b(get|need|want|like|start)\b.{0,12}\b(quote|estimate)\b|\bquote\b/i.test(text)
    if (explicitQuote && !state.asking) {
      s.state = { mode: 'quote', step: 'boat', quoteStartedAt: new Date().toISOString() }
      // the visitor may have volunteered details in the same breath ("I need a quote for my 2004 Mako transom")
      const ex = extractDeterministic(text.replace(/\bi need a quote\b/i, ''), undefined, slots)
      const keys = merge(slots, ex, undefined)
      const ack = keys.length ? 'Noted.' : ''
      return finish(stepResponse(s, [LINES.quoteStart, ack].filter(Boolean).join(' '), { event: 'quote_start', links: linkFor(text, input.page) }))
    }
    state.asking = false
    const a = await answerQuestion(db, s, input, mode); addTally(tally, a)
    const r0 = routeFor(text)
    if (r0) (state.answered ||= []).push(r0.topic)
    const chips: Chip[] = QUOTE_RE.test(text)
      ? [{ label: 'Get a quote for this', send: 'I need a quote', primary: true }, { label: 'Can I send photos?', send: 'Can I send photos?' }, { label: 'How does the repair process work?', send: 'How does the repair process work?' }]
      : START_CHIPS
    return finish({ reply: a.reply, links: a.links, chips })
  }

  // --- quote: slot filling -----------------------------------------------------------------------------
  const step = state.step || nextStep(slots)
  state.step = step

  if (state.changing) {
    state.changing = false
    if (/\bboat\b/i.test(text)) { slots.boat = undefined; slots.boatMake = slots.boatModel = undefined; slots.boatYear = undefined; return finish(stepResponse(s, LINES.changedBoat.replace(/ Give me.*$/, ''))) }
    if (/\bdamage\b/i.test(text)) { slots.damage = undefined; slots.damageLocation = undefined; slots.damageKind = undefined; return finish(stepResponse(s, 'Sure.')) }
    if (/\bwhere\b|\blocation\b/i.test(text)) { slots.where = undefined; return finish(stepResponse(s, 'Sure.')) }
    if (/\bcontact\b|\bname\b|\bemail\b|\bphone\b/i.test(text)) { slots.name = slots.email = slots.phone = undefined; return finish(stepResponse(s, 'Sure.')) }
    state.changing = true
    return finish({ reply: LINES.changeWhat, chips: CHANGE_CHIPS, draft: draftFor(slots) })
  }

  if (step === 'review') {
    if (SEND_RE.test(text)) {
      const r = await submitQuote(db, s, input)
      if (!r.ok) return finish({ reply: LINES.submitFailed, chips: [{ label: 'Try again', send: 'Send it', primary: true }, formChip(draftFor(slots))], draft: draftFor(slots) })
      s.state = { mode: 'done', inquiryRef: r.inquiry.ref }
      return finish({ reply: LINES.done(r.inquiry.ref), chips: START_CHIPS, event: 'quote_complete', done: true })
    }
    if (CHANGE_RE.test(text)) { state.changing = true; return finish({ reply: LINES.changeWhat, chips: CHANGE_CHIPS, draft: draftFor(slots) }) }
    // free text at review: treat as a correction, merge whatever we can, show the card again
    const ex = extractDeterministic(text, undefined, slots)
    const keys = merge(slots, ex, undefined)
    return finish(stepResponse(s, keys.length ? 'Updated.' : "I didn't catch a change there.", { links: linkFor(text, input.page) }))
  }

  if (step === 'photos') {
    if (SKIP_PHOTOS_RE.test(text) || (slots.photos && /^(move on|done|that's all|no more)\b/i.test(text))) {
      if (!slots.photos) slots.photosDeclined = true
      else slots.photosDeclined = true
      return finish(stepResponse(s, slots.photos ? 'Great.' : 'No problem.'))
    }
  }
  if (step === 'boat' && WHAT_NEED_RE.test(text)) {
    return finish({ reply: `Make, model and year are ideal (for example "2004 Boston Whaler Outrage 24"), but even "a 22-foot center console" helps. ${question('boat', slots)}`, chips: chipsForStep('boat', slots), draft: draftFor(slots) })
  }

  // extraction: model first (language + fields), deterministic always runs as the floor
  let ack = ''
  let ex: Extracted = extractDeterministic(text, step, slots)
  if (mode === 'model') {
    const m = await extractWithModel(db, { message: text, step, slots, history: s.messages, page: input.page, pageTitle: input.pageTitle, nextQuestionHint: question(nextStep({ ...slots, ...(ex as Slots) }), slots) })
    if (m) {
      tally.cost += m.cost; tally.tokensIn += m.tokensIn; tally.tokensOut += m.tokensOut
      ex = { ...ex, ...m.fields }
      ack = m.reply
    }
  }
  const keys = merge(slots, ex, step)

  // validation nudges for the two typed fields
  if (step === 'email' && !slots.email) return finish({ reply: LINES.invalidEmail, chips: chipsForStep('email', slots), draft: draftFor(slots) })
  if (step === 'phone' && !slots.phone) return finish({ reply: LINES.invalidPhone, chips: chipsForStep('phone', slots), draft: draftFor(slots) })
  if (step === 'name' && !slots.name) return finish({ reply: `I didn't catch a name there. ${question('name', slots)}`, chips: chipsForStep('name', slots), draft: draftFor(slots) })
  if ((step === 'damageLocation' || step === 'damageKind') && !keys.includes(step)) {
    return finish({ reply: `${LINES.changeWhat === '' ? '' : ''}Let me put it another way. ${question(step, slots)}`, chips: chipsForStep(step, slots), draft: draftFor(slots) })
  }

  if (!ack) ack = ackForStep(step, slots, keys)
  // answer-first routing: a damage topic described in free text gets a short honest answer (once per topic) plus the page link
  const route = routeFor(text)
  const answered = (state.answered ||= [])
  if (route && mode !== 'model' && step === 'damage' && !answered.includes(route.topic) && text.split(/\s+/).length > 1) {
    ack = TOPIC_ANSWERS[route.topic] || ack
    answered.push(route.topic)
  }
  const links = linkFor(text, input.page)
  return finish(stepResponse(s, ack, { links }))
}

function questionChips(): Chip[] {
  return [
    { label: 'How does the repair process work?', send: 'How does the repair process work?' },
    { label: 'Do you come to the boat?', send: 'Do you come to the boat?' },
    { label: 'I Need a Quote', send: 'I need a quote', primary: true },
  ]
}

function addTally(t: { cost: number; tokensIn: number; tokensOut: number }, a: { cost: number; tokensIn: number; tokensOut: number }) {
  t.cost += a.cost; t.tokensIn += a.tokensIn; t.tokensOut += a.tokensOut
}

export { nextStep, STEPS, EMAIL_RE, phoneDigits }
