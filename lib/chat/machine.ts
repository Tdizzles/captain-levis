// The chat as a server-side state machine. Control flow lives here and is fully deterministic; a model, when
// available, only phrases acknowledgements and answers questions. Every path works with no API key.
//
// The quote flow itself (which questions, in what order, the quick-fill widgets) is quoteflow.ts. An answer
// arrives either as a tapped widget value (input.answer, validated, no model call) or as typed text (matched
// against the step's options, with the model adding language and any extra fields it can pull out).
import { z } from 'zod'
import { aiConfigured, budget, callModel } from '../ai.js'
import { business, phoneDigits } from '../business.js'
import { describeBoat, parseBoat } from '../boat.js'
import type { Db } from '../db.js'
import { createEstimate, draftFromInquiry, inquiryPhotosFor } from '../estimates/store.js'
import { createInquiry, emailSchema, phoneSchema, type InquiryRow } from '../inquiries.js'
import { enqueueAndSendInquiryEmail } from '../email/send.js'
import { EMAIL_RE, extractDeterministic, extractWithModel, inferWhere } from './extract.js'
import { pageBySlug, routeFor, searchPages, TOPIC_ANSWERS } from './knowledge.js'
import { PERSONA } from './persona.js'
import {
  applyAnswer, cityFromText, detailsFor, followUp, guessService, matchOption, nextQuoteStep, progress, setService,
  SIZES, sizeFromText, TIMELINES, WHERE_STATUS, widgetFor, zonesFromText, type AnswerValue, type QStep,
} from './quoteflow.js'
import { CHANGE_CHIPS, chipsForStep, draftFor, formChip, hoursReply, LINES, question, reviewCard, serviceFor, composeMessage, START_CHIPS, ackForStep } from './script.js'
import { pushMessage } from './store.js'
import type { ChatResponse, ChatSessionRow, Chip, Extracted, Link, Slots, Step } from './types.js'

export interface TurnInput {
  message: string
  page: string
  pageTitle: string
  context: string
  photoCount?: number    // photos attached with this turn (already verified to belong to the session)
  note?: string
  /** a tapped quick-fill answer for the current step; `message` then carries its label */
  answer?: { step: string; value: AnswerValue }
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
const NOTHING_RE = /^(no|nope|nothing( else)?|that'?s (it|all|everything)|all good|none|n\/a|that is (all|everything))\b/i
const NOT_SURE_RE = /^(not sure|unsure|i'?m not sure|no idea|don'?t know|dont know|idk|unknown)\b/i
const URGENT_RE = /\b(asap|urgent|right away|as soon as|this week|tomorrow|today)\b/i
const QUESTION_RE = /\?\s*$/
const START_QUOTE_RE = /^i need a quote\b|\b(get|need|want|like|start)\b.{0,12}\b(quote|estimate)\b|\bquote\b/i

function nextStep(slots: Slots): Step {
  return nextQuoteStep(slots)
}

/** The step the visitor is on. Always derived from the answers, so sessions saved by the older flow re-plan cleanly. */
function currentStep(s: ChatSessionRow): Step {
  return nextStep(s.slots)
}

function linkFor(text: string, page: string): Link[] | undefined {
  const r = routeFor(text)
  if (!r || r.slug === page) return undefined
  return [r.link]
}

function merge(slots: Slots, ex: Extracted, step: Step | undefined): string[] {
  const keys: string[] = []
  const set = <K extends keyof Slots>(k: K, v: Slots[K] | undefined) => { if (v !== undefined && v !== null && v !== '') { slots[k] = v; keys.push(k) } }
  if (ex.boat && !(step !== 'boat' && slots.boat)) {
    set('boat', ex.boat)
    const parsed = parseBoat(ex.boat)
    set('boatMake', ex.boatMake ?? parsed.make ?? undefined)
    set('boatModel', ex.boatModel ?? parsed.model ?? undefined)
    set('boatYear', ex.boatYear ?? parsed.year ?? undefined)
  }
  if (ex.boatType && !slots.boatType) set('boatType', ex.boatType)
  if (ex.svc && (!slots.svc || step === 'service')) { setService(slots, ex.svc); keys.push('svc') }
  if (ex.damage && ex.damage !== 'Not sure yet' && !(slots.damage || '').includes(ex.damage)) set('damage', slots.damage ? `${slots.damage}\n${ex.damage}`.slice(0, 1000) : ex.damage)
  if (ex.damageLocation && !slots.damageLocation) set('damageLocation', ex.damageLocation)
  if (ex.damageKind && !slots.damageKind) set('damageKind', ex.damageKind)
  if (ex.where && (!slots.where || step === 'where')) set('where', ex.where)
  set('name', ex.name)
  if (ex.email && emailSchema.safeParse(ex.email).success) set('email', ex.email.toLowerCase())
  if (ex.phone && phoneSchema.safeParse(ex.phone).success) set('phone', ex.phone)
  if (ex.notSure && step === 'boat' && !slots.boat) set('boat', 'Not sure')
  return keys
}

function stepResponse(s: ChatSessionRow, ack: string, extra: Partial<Omit<ChatResponse, 'sessionId'>> = {}, error?: string): Omit<ChatResponse, 'sessionId'> {
  const step = nextStep(s.slots)
  s.state.step = step
  const q = question(step, s.slots)
  const reply = [ack, q].filter(Boolean).join(' ')
  const out: Omit<ChatResponse, 'sessionId'> = {
    reply, chips: chipsForStep(step, s.slots), draft: draftFor(s.slots), progress: progress(s.slots), ...extra,
  }
  const widget = widgetFor(step, s.slots, error)
  if (widget) out.widget = widget
  if (step === 'review') out.card = reviewCard(s.slots)
  return out
}

/** Re-ask the step the visitor is on (after a side question, a bad value, or a stale tap). */
function sameStep(s: ChatSessionRow, step: Step, lead: string, extra: Partial<Omit<ChatResponse, 'sessionId'>> = {}, error?: string): Omit<ChatResponse, 'sessionId'> {
  s.state.step = step
  const out: Omit<ChatResponse, 'sessionId'> = {
    reply: [lead, question(step, s.slots)].filter(Boolean).join('\n\n'), chips: chipsForStep(step, s.slots), draft: draftFor(s.slots), progress: progress(s.slots), ...extra,
  }
  const widget = widgetFor(step, s.slots, error)
  if (widget) out.widget = widget
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

/** Saves the request, emails the shop, and has a draft estimate waiting in the Quote Desk (prices left for the crew). */
async function submitQuote(db: Db, s: ChatSessionRow, input: TurnInput): Promise<{ ok: true; inquiry: InquiryRow; estimateNumber: string | null } | { ok: false }> {
  const slots = s.slots
  const message = composeMessage(slots) || 'Quote requested through the website chat.'
  let inquiry: InquiryRow
  try {
    inquiry = await createInquiry(db, {
      input: {
        name: slots.name || 'Unknown', email: slots.email || '', phone: slots.phone || '', service: serviceFor(slots),
        boat: describeBoat({ make: slots.boatMake, model: slots.boatModel, year: slots.boatYear, raw: slots.boat }) || '',
        boat_location: slots.where || '', message: message.length >= 10 ? message : `${message} (details above)`, page: input.page, kind: slots.answers?.insurance?.[0] === 'yes' ? 'insurance' : 'quote',
        idempotency_key: `chat:${s.id}`,
      },
      source: 'chat', chatSessionId: s.id, damageLocation: zoneSummary(slots) || slots.damageLocation || null, damageType: slots.damageKind || null,
      details: detailsFor(slots), ipHash: input.ipHash, userAgent: input.userAgent,
    })
    s.inquiry_id = inquiry.id
  } catch (err) {
    console.error('[chat] submit failed', err)
    return { ok: false }
  }
  let estimateNumber: string | null = null
  try {
    const est = await createEstimate(db, draftFromInquiry(inquiry, await inquiryPhotosFor(db, inquiry.id)), { inquiryId: inquiry.id, actor: 'Captain Levi (website chat)' })
    estimateNumber = est.number
  } catch (err) {
    console.error('[chat] draft estimate failed', err) // the inquiry is saved; staff can still start the estimate by hand
  }
  await enqueueAndSendInquiryEmail(db, inquiry) // never throws; delivery status is recorded
  return { ok: true, inquiry, estimateNumber }
}

function zoneSummary(slots: Slots): string | null {
  const z = (slots.zones || []).filter((x) => x !== 'unsure')
  return z.length ? z.join(', ') : null
}

/**
 * Typed text on a step that is normally tapped. Returns ok:false when the text does not answer the step
 * (the caller then treats it as a question or re-asks). Contact, boat and review are handled elsewhere.
 */
function typedAnswer(slots: Slots, step: Step, text: string): { ok: boolean; ack?: string; boatOnly?: boolean } {
  const question = QUESTION_RE.test(text)
  // "what does gelcoat even do?" mentions an option but is a question; answer it instead of filing it
  if (question && step !== 'service' && step !== 'notes') return { ok: false }
  switch (step) {
    case 'service': {
      const svc = guessService(text)
      if (svc) { setService(slots, svc); return { ok: true } }
      if (question) return { ok: false }
      const b = parseBoat(text)
      if ((b.make || b.year) && text.split(/\s+/).length <= 6) return { ok: true, boatOnly: true } // "1998 Mako 21": take the boat, ask the job again
      setService(slots, 'other')   // they described something we cannot file yet; the crew reads their words
      return { ok: true }
    }
    case 'zones': {
      const z = zonesFromText(text)
      if (z.length) { slots.zones = z; return { ok: true, ack: 'Got it.' } }
      if (NOT_SURE_RE.test(text)) { slots.zones = ['unsure']; return { ok: true, ack: 'That is fine, the crew will find it.' } }
      if (question) return { ok: false }
      slots.zones = ['unsure']; slots.damage = slots.damage ? `${slots.damage}\n${text}`.slice(0, 1000) : text.slice(0, 500)
      return { ok: true, ack: 'Noted.' }
    }
    case 'size': {
      const v = sizeFromText(text) || matchOption(SIZES, text)
      if (v) { slots.size = v; return { ok: true, ack: 'Thanks, that helps a lot.' } }
      if (question) return { ok: false }
      slots.size = text.slice(0, 40)
      return { ok: true, ack: 'Thanks.' }
    }
    case 'where': {
      const status = matchOption(WHERE_STATUS, text)
      const city = cityFromText(text)
      const inferred = inferWhere(text)
      if (!status && !city && !inferred && question) return { ok: false }
      if (status) slots.whereStatus = status
      if (city) slots.city = city
      slots.where = status || city
        ? [WHERE_STATUS.find(([k]) => k === status)?.[1] || inferred, city].filter(Boolean).join(', ')
        : (inferred || text.slice(0, 160))
      return { ok: true, ack: 'Good to know.' }
    }
    case 'timeline': {
      const t = URGENT_RE.test(text) ? 'asap' : matchOption(TIMELINES, text)
      if (t) { slots.timeline = t; return { ok: true, ack: t === 'asap' ? 'Understood, I will flag it as urgent.' : 'Understood.' } }
      if (question) return { ok: false }
      slots.timeline = text.slice(0, 60)
      return { ok: true, ack: 'Understood.' }
    }
    case 'notes': {
      if (NOTHING_RE.test(text)) { slots.notesDone = true; return { ok: true } }
      if (question && text.length < 120) return { ok: false }
      slots.damage = slots.damage ? `${slots.damage}\n${text}`.slice(0, 1000) : text.slice(0, 500)
      slots.notesDone = true
      return { ok: true, ack: 'Thanks, I added that.' }
    }
    default: {
      if (!step.startsWith('fu:')) return { ok: false }
      const f = followUp(slots, step.slice(3))
      if (!f) return { ok: false }
      const parts = f.multi ? text.split(/,|\band\b|\//i).map((x) => x.trim()).filter(Boolean) : [text]
      const vals = Array.from(new Set(parts.map((p) => matchOption(f.options, p)).filter((v): v is string => !!v)))
      if (!vals.length && NOT_SURE_RE.test(text)) { const u = f.options.find(([k]) => k === 'unsure' || k === 'worried' || k === 'recommend'); if (u) vals.push(u[0]) }
      if (!vals.length && question) return { ok: false }
      ;(slots.answers ||= {})[f.id] = vals.length ? (f.multi ? vals : [vals[0]]) : [text.slice(0, 80)]
      return { ok: true, ack: 'Noted.' }
    }
  }
}

/** The contact card: all three at once. Returns the problems, if any (valid fields are kept either way). */
function applyContact(slots: Slots, v: Record<string, string>): string[] {
  const problems: string[] = []
  const name = typeof v.name === 'string' ? v.name.trim().replace(/\s+/g, ' ').slice(0, 80) : ''
  if (name && !/\d/.test(name)) slots.name = name
  else if (!slots.name) problems.push('your name')
  const email = emailSchema.safeParse(typeof v.email === 'string' ? v.email : '')
  if (email.success) slots.email = email.data
  else if (!slots.email || v.email) problems.push('a complete email (like name@example.com)')
  const phone = phoneSchema.safeParse(typeof v.phone === 'string' ? v.phone : '')
  if (phone.success) slots.phone = phone.data
  else if (!slots.phone || v.phone) problems.push('a phone number with at least ten digits')
  return problems
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
  const startQuote = () => { s.state = { mode: 'quote', quoteStartedAt: new Date().toISOString() } }

  // --- photos attached with this turn (no text) -------------------------------------------------
  if (!text && input.photoCount) {
    slots.photos = (slots.photos || 0) + input.photoCount
    const got = `Got ${input.photoCount === 1 ? 'the photo' : `${input.photoCount} photos`}, thank you.`
    if (state.mode === 'quote') {
      slots.photosDeclined = false
      return finish(stepResponse(s, got, { links: undefined }))
    }
    return finish({ reply: `${got} Want me to take the rest of the details for a quote?`, chips: START_CHIPS, draft: draftFor(slots) })
  }
  if (!text && !input.answer) return finish({ reply: LINES.startFallback, chips: START_CHIPS })

  // --- guards that apply in every state ---------------------------------------------------------
  if (INJECTION_RE.test(text)) {
    if (state.mode === 'quote') return finish(sameStep(s, currentStep(s), LINES.injection))
    return finish({ reply: LINES.injection, chips: START_CHIPS })
  }

  // --- a tapped quick-fill answer -----------------------------------------------------------------
  if (input.answer) {
    if (state.mode !== 'quote' && input.answer.step === 'service') startQuote()
    if (s.state.mode === 'quote') {
      const step = currentStep(s)
      if (input.answer.step !== step) return finish(sameStep(s, step, "Let's pick up here."))
      if (step === 'contact') {
        const v = typeof input.answer.value === 'object' && !Array.isArray(input.answer.value) ? input.answer.value : {}
        const problems = applyContact(slots, v)
        if (problems.length) {
          const err = `I still need ${problems.join(' and ')}.`
          return finish(sameStep(s, step, err, {}, err))
        }
        return finish(stepResponse(s, `Thanks, ${slots.name!.split(' ')[0]}.`))
      }
      if (step === 'review') return finish(sameStep(s, step, ''))
      const r = applyAnswer(slots, step as QStep, input.answer.value)
      if (!r.ok) return finish(sameStep(s, step, r.error || '', {}, r.error))
      return finish(stepResponse(s, r.ack || ''))
    }
    // a stale tap after the quote was sent: fall through and treat the label as text
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
    if (state.mode === 'quote') return finish(sameStep(s, currentStep(s), reply))
    return finish({ reply, chips: START_CHIPS })
  }
  if (WHY_CONTACT_RE.test(text) && state.mode === 'quote') {
    return finish(sameStep(s, currentStep(s), LINES.whyContact))
  }
  const stepAtEntry = state.mode === 'quote' ? currentStep(s) : undefined
  if (HOURS_RE.test(text) && stepAtEntry !== 'where' && !(stepAtEntry === 'service' && !/\b(your|you guys|the shop|the yard)\b/i.test(text))) {
    // hours state: answer, then back to the previous flow or start chips
    if (state.mode === 'quote') return finish(sameStep(s, currentStep(s), hoursReply()))
    return finish({ reply: hoursReply(), chips: START_CHIPS })
  }

  // --- done: quote already submitted ------------------------------------------------------------
  if (state.mode === 'done') {
    if (QUOTE_RE.test(text) && /\b(another|new|second|other)\b/i.test(text)) {
      s.slots = {}; startQuote()
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
    if (START_QUOTE_RE.test(text) && !state.asking) {
      startQuote()
      // the visitor may have described the job in the same breath ("quote for my 2004 Mako transom"), or just
      // before tapping "Get a quote for this"; either way, use it so those questions are not asked again
      let said = text.replace(/\bi need (a|another) quote\b/i, '').trim()
      if (said.split(/\s+/).length < 3) {
        const prev = [...s.messages].reverse().find((m) => m.role === 'user')?.text || ''
        if (QUOTE_RE.test(prev) && !START_QUOTE_RE.test(prev)) said = prev
      }
      const ex = extractDeterministic(said, undefined, slots)
      if (ex.svc && said.split(/\s+/).length >= 3) ex.damage = said.slice(0, 500)
      const keys = merge(slots, ex, undefined)
      const ack = keys.includes('svc') ? `${LINES.quoteStart} Sounds like ${'aeiou'.includes((slots.svc || 'x')[0]) ? 'an' : 'a'} ${(SERVICE_NAME[slots.svc!] || 'repair')} job.` : LINES.quoteStart
      return finish(stepResponse(s, ack, { event: 'quote_start', links: linkFor(text, input.page) }))
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
  const step = currentStep(s)
  state.step = step

  if (state.changing) {
    state.changing = false
    if (/\bwhere\b|\blocation\b/i.test(text)) { slots.where = slots.whereStatus = slots.city = undefined; if (slots.answers) delete slots.answers.bring; return finish(stepResponse(s, 'Sure.')) }
    if (/\bjob\b/i.test(text)) { slots.svc = undefined; slots.answers = {}; slots.zones = slots.size = undefined; return finish(stepResponse(s, 'Sure.')) }
    if (/\bdamage\b|\bdetails\b/i.test(text)) {
      const bring = slots.answers?.bring
      slots.answers = bring ? { bring } : {}; slots.zones = slots.size = slots.damage = undefined; slots.notesDone = false
      return finish(stepResponse(s, 'Sure.'))
    }
    if (/\bcontact\b|\bname\b|\bemail\b|\bphone\b/i.test(text)) { slots.name = slots.email = slots.phone = undefined; return finish(stepResponse(s, 'Sure.')) }
    if (/\bboat\b/i.test(text)) { slots.boat = slots.boatMake = slots.boatModel = slots.boatType = slots.boatLength = undefined; slots.boatYear = undefined; return finish(stepResponse(s, 'Sure.')) }
    state.changing = true
    return finish({ reply: LINES.changeWhat, chips: CHANGE_CHIPS, draft: draftFor(slots) })
  }

  if (nextStep(slots) === 'review') {
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

  if (step === 'photos' && (SKIP_PHOTOS_RE.test(text) || (slots.photos && /^(move on|done|that's all|no more)\b/i.test(text)))) {
    slots.photosDeclined = true
    return finish(stepResponse(s, slots.photos ? 'Great.' : 'No problem. You can always text them to the crew later.'))
  }
  if (step === 'boat' && WHAT_NEED_RE.test(text)) {
    return finish(sameStep(s, step, 'Make, model and year are ideal (for example "2004 Boston Whaler Outrage 24"), but even "a 22-foot center console" helps.'))
  }

  // typed answer to a tap-to-answer step; a real question gets answered and the step asked again
  const tapStep = !['boat', 'contact', 'photos'].includes(step)
  const typed = tapStep ? typedAnswer(slots, step, text) : { ok: false }
  if (tapStep && !typed.ok) {
    const a = await answerQuestion(db, s, input, mode); addTally(tally, a)
    return finish(sameStep(s, step, a.reply, { links: a.links }))
  }
  if (step === 'photos' && QUESTION_RE.test(text)) {
    const a = await answerQuestion(db, s, input, mode); addTally(tally, a)
    return finish(sameStep(s, step, a.reply, { links: a.links }))
  }

  // extraction: deterministic floor for the typed steps; the model adds language and anything else it can pull out
  let ack = typed.ack || ''
  const boatOnly = 'boatOnly' in typed && typed.boatOnly
  let ex: Extracted = tapStep ? {} : extractDeterministic(text, step, slots)
  if (boatOnly) ex = extractDeterministic(text, 'boat', slots)
  else if (tapStep && (step === 'service' || step === 'notes')) ex = extractDeterministic(text, step, slots)
  if (mode === 'model') {
    const m = await extractWithModel(db, { message: text, step, slots, history: s.messages, page: input.page, pageTitle: input.pageTitle, nextQuestionHint: question(nextStep({ ...slots, ...(ex as Slots) }), slots) })
    if (m) {
      tally.cost += m.cost; tally.tokensIn += m.tokensIn; tally.tokensOut += m.tokensOut
      // on a tapped-style step the step's own answer is already set; keep only the extras the model found
      const extra: Extracted = tapStep ? { boat: m.fields.boat, boatMake: m.fields.boatMake, boatModel: m.fields.boatModel, boatYear: m.fields.boatYear, boatType: m.fields.boatType, name: m.fields.name, email: m.fields.email, phone: m.fields.phone, ...(step === 'service' ? { svc: m.fields.svc ?? ex.svc } : {}) } : m.fields
      ex = { ...ex, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== undefined)) }
      if (m.reply) ack = m.reply
    }
  }
  const keys = merge(slots, ex, step)

  // validation nudges for the typed contact details
  if (step === 'contact' && !(slots.name && slots.email && slots.phone)) {
    if (/@/.test(text) && !keys.includes('email')) return finish(sameStep(s, step, LINES.invalidEmail, {}, LINES.invalidEmail))
    if ((text.match(/\d/g) || []).length >= 5 && !keys.includes('phone')) return finish(sameStep(s, step, LINES.invalidPhone, {}, LINES.invalidPhone))
    if (!keys.length) return finish(sameStep(s, step, "I didn't catch that."))
  }
  if (step === 'boat' && !keys.length && !slots.boat) return finish(sameStep(s, step, "I didn't catch the boat there."))

  if (!ack) ack = ackForStep(step, slots, keys)
  // answer-first routing: a damage topic described in free text gets a short honest answer (once per topic) plus the page link
  const route = routeFor(text)
  const answered = (state.answered ||= [])
  if (route && mode !== 'model' && step === 'service' && !answered.includes(route.topic) && text.split(/\s+/).length > 1) {
    ack = TOPIC_ANSWERS[route.topic] || ack
    answered.push(route.topic)
  }
  const links = linkFor(text, input.page)
  return finish(stepResponse(s, ack, { links }))
}

const SERVICE_NAME: Record<string, string> = {
  impact: 'impact repair', cracks: 'crack repair', chips: 'chip and scratch', soft: 'soft spot', transom: 'transom', stringers: 'stringer',
  blisters: 'bottom', oxidation: 'restoration', detailing: 'detailing', fabrication: 'custom', pwc: 'small craft', other: 'repair',
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

export { nextStep, EMAIL_RE, phoneDigits }
