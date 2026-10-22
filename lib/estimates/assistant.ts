// "Captain Levi", the estimate assistant: Claude (Opus 5.5 by default) with tools that edit the estimate document.
// The tool executor is pure and tested; the model loop saves one new version per turn and records the chat.
import { readFileSync } from 'node:fs'
import type Anthropic from '@anthropic-ai/sdk'
import { budget, getAnthropic, logUsage } from '../ai.js'
import { business } from '../business.js'
import type { Db } from '../db.js'
import { env } from '../env.js'
import { calcTotals, formatMoney, layoutLines, sectionLetter } from './calc.js'
import { getEstimate, presentDoc, saveEstimate, type EstimateRow } from './store.js'
import { newId, normalizeEstimate, type Estimate, type EstimateLine } from './types.js'

export const MAX_TOOL_ROUNDS = 8
export const MAX_HISTORY = 16

// ─── Knowledge ─────────────────────────────────────────────────────────────────
const KNOWLEDGE_FILES = ['how-we-quote.md', 'insurance-claims.md', 'florida-rules.md']
let knowledgeCache: string | null = null
export function knowledge(): string {
  if (knowledgeCache) return knowledgeCache
  knowledgeCache = KNOWLEDGE_FILES.map((f) => { try { return readFileSync(new URL(`./knowledge/${f}`, import.meta.url), 'utf8') } catch { return '' } }).filter(Boolean).join('\n\n---\n\n')
  return knowledgeCache
}

// ─── Tools (schema the model sees) ───────────────────────────────────────────────
const SET_FIELD_PATHS = /^(customer\.(name|company|email|phone|addressLines\.[01])|vessel\.(year|make|model|name|hin|registration|location)|insurance\.(enabled|carrier|claimNumber|dateOfLoss|reportedDate|adjusterName|adjusterPhone|adjusterEmail|appraiserName|appraiserPhone|appraiserEmail|carrierEstimateDate|carrierEstimateNumber)|notes|terms|docKind|revision|directionToPay|estimateDate|pricing\.(laborRate|taxRate|taxNote|depositPct))$/

export const TOOLS: Anthropic.Tool[] = [
  { name: 'set_field', description: 'Set one document field. Paths: customer.name|company|email|phone|addressLines.0|addressLines.1, vessel.year|make|model|name|hin|registration|location, insurance.enabled|carrier|claimNumber|dateOfLoss|reportedDate|adjusterName|adjusterPhone|adjusterEmail|appraiserName|appraiserPhone|appraiserEmail|carrierEstimateDate|carrierEstimateNumber, notes, terms, docKind (estimate|supplement), revision, directionToPay, estimateDate (YYYY-MM-DD), pricing.laborRate|taxRate|taxNote|depositPct (ask before changing pricing).',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, value: { description: 'string, number or boolean' } }, required: ['path', 'value'] } },
  { name: 'add_section', description: 'Add a lettered section (A, B, C…) at the end, or before another section.', input_schema: { type: 'object', properties: { title: { type: 'string' }, before: { type: 'string', description: 'letter, title or id of the section to insert before (optional)' } }, required: ['title'] } },
  { name: 'rename_section', description: 'Rename a section.', input_schema: { type: 'object', properties: { section: { type: 'string', description: 'letter, title or id' }, title: { type: 'string' } }, required: ['section', 'title'] } },
  { name: 'remove_section', description: 'Remove a section; its lines move to the previous section (or before the first).', input_schema: { type: 'object', properties: { section: { type: 'string' } }, required: ['section'] } },
  { name: 'add_line', description: 'Add a line item. description: first line is the bold title, following lines the detail. hours × rate = labor; materials is a dollar lump sum; materialsOnly lines have no labor.',
    input_schema: { type: 'object', properties: { section: { type: 'string', description: 'letter, title or id; omit for a line before the first section' }, description: { type: 'string' }, hours: { type: 'number' }, rate: { type: 'number', description: 'omit to use the document labor rate' }, materials: { type: 'number' }, materialsOnly: { type: 'boolean' }, after_line: { type: 'number', description: 'line number to insert after (optional; default end of section)' } }, required: ['description'] } },
  { name: 'update_line', description: 'Change fields on an existing line, found by its printed number (1, 2, 3…).', input_schema: { type: 'object', properties: { line: { type: 'number' }, description: { type: 'string' }, hours: { type: 'number' }, rate: { type: 'number' }, materials: { type: 'number' }, materialsOnly: { type: 'boolean' }, section: { type: 'string', description: 'move the line into this section (letter, title or id)' } }, required: ['line'] } },
  { name: 'remove_line', description: 'Remove a line by its printed number.', input_schema: { type: 'object', properties: { line: { type: 'number' } }, required: ['line'] } },
]

// ─── Executor (pure) ──────────────────────────────────────────────────────────────
export interface Applied { ok: boolean; change: string }

function findSection(e: Estimate, ref: string | undefined | null): Estimate['sections'][number] | null {
  if (!ref) return null
  const r = String(ref).trim()
  const byId = e.sections.find((s) => s.id === r)
  if (byId) return byId
  const letterIdx = e.sections.findIndex((_, i) => sectionLetter(i).toLowerCase() === r.toLowerCase().replace(/\.$/, ''))
  if (letterIdx >= 0) return e.sections[letterIdx]
  const byTitle = e.sections.find((s) => s.title.trim().toLowerCase() === r.toLowerCase()) || e.sections.find((s) => s.title.toLowerCase().includes(r.toLowerCase()))
  return byTitle || null
}

function findLine(e: Estimate, n: unknown): EstimateLine | null {
  const num = Number(n)
  if (!Number.isFinite(num)) return null
  const placed = layoutLines(e).all.find((p) => p.number === num)
  return placed ? e.lines.find((l) => l.id === placed.line.id) || null : null
}

const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
const hrs = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0 }
const title = (d: string) => d.split('\n')[0].trim().slice(0, 60)

export function applyTool(e: Estimate, name: string, input: Record<string, unknown>): Applied {
  switch (name) {
    case 'set_field': {
      const path = String(input.path || '')
      if (!SET_FIELD_PATHS.test(path)) return { ok: false, change: `set_field: "${path}" is not an editable field` }
      let value = input.value
      if (path === 'insurance.enabled' || path === 'directionToPay') value = value === true || value === 'true'
      else if (path === 'revision') value = Math.max(0, Math.round(Number(value) || 0))
      else if (path.startsWith('pricing.') && path !== 'pricing.taxNote') value = Number(value) || 0
      else if (path === 'docKind') { if (value !== 'estimate' && value !== 'supplement') return { ok: false, change: 'docKind must be estimate or supplement' } }
      else value = String(value ?? '')
      const parts = path.split('.')
      let obj: Record<string, unknown> = e as unknown as Record<string, unknown>
      for (const k of parts.slice(0, -1)) { if (obj[k] === undefined || obj[k] === null) obj[k] = /^\d+$/.test(parts[parts.indexOf(k) + 1]) ? [] : {}; obj = obj[k] as Record<string, unknown> }
      obj[parts[parts.length - 1]] = value
      if (path.startsWith('customer.addressLines')) e.customer.addressLines = [e.customer.addressLines[0] || '', e.customer.addressLines[1] || '']
      if (path === 'insurance.enabled' && value === true && input.value !== undefined) e.directionToPay = true
      return { ok: true, change: `${path} → ${typeof value === 'string' ? JSON.stringify(value.length > 60 ? value.slice(0, 57) + '…' : value) : String(value)}` }
    }
    case 'add_section': {
      const t = String(input.title || '').trim()
      if (!t) return { ok: false, change: 'add_section needs a title' }
      const s = { id: newId(), title: t }
      const before = findSection(e, input.before as string)
      if (before) e.sections.splice(e.sections.indexOf(before), 0, s); else e.sections.push(s)
      return { ok: true, change: `added section ${sectionLetter(e.sections.indexOf(s))}. ${t}` }
    }
    case 'rename_section': {
      const s = findSection(e, input.section as string)
      if (!s) return { ok: false, change: `no section "${input.section}"` }
      const old = s.title; s.title = String(input.title || '').trim() || old
      return { ok: true, change: `renamed section "${old}" → "${s.title}"` }
    }
    case 'remove_section': {
      const s = findSection(e, input.section as string)
      if (!s) return { ok: false, change: `no section "${input.section}"` }
      const i = e.sections.indexOf(s); const prev = e.sections[i - 1]?.id || null
      e.lines.forEach((l) => { if (l.sectionId === s.id) l.sectionId = prev })
      e.sections.splice(i, 1)
      return { ok: true, change: `removed section "${s.title}" (lines kept)` }
    }
    case 'add_line': {
      const d = String(input.description || '').trim()
      if (!d) return { ok: false, change: 'add_line needs a description' }
      const s = input.section ? findSection(e, input.section as string) : null
      if (input.section && !s) return { ok: false, change: `no section "${input.section}"` }
      const line: EstimateLine = { id: newId(), sectionId: s ? s.id : null, description: d, qty: 1, unit: '', hours: hrs(input.hours), rate: input.rate !== undefined ? money(input.rate) : e.pricing.laborRate, materials: money(input.materials), materialsOnly: input.materialsOnly === true, taxable: true }
      const after = input.after_line !== undefined ? findLine(e, input.after_line) : null
      if (after) e.lines.splice(e.lines.indexOf(after) + 1, 0, line)
      else { const lastIdx = s ? e.lines.map((l) => l.sectionId).lastIndexOf(s.id) : -1; if (lastIdx >= 0) e.lines.splice(lastIdx + 1, 0, line); else e.lines.push(line) }
      const n = layoutLines(e).all.find((p) => p.line.id === line.id)?.number
      return { ok: true, change: `added line ${n}: ${title(d)} (${line.materialsOnly ? 'materials only' : `${line.hours} h @ $${line.rate}`}, materials $${line.materials})` }
    }
    case 'update_line': {
      const l = findLine(e, input.line)
      if (!l) return { ok: false, change: `no line ${input.line}` }
      const changes: string[] = []
      if (typeof input.description === 'string' && input.description.trim()) { l.description = input.description.trim(); changes.push('description') }
      if (input.hours !== undefined) { l.hours = hrs(input.hours); changes.push(`hours ${l.hours}`) }
      if (input.rate !== undefined) { l.rate = money(input.rate); changes.push(`rate $${l.rate}`) }
      if (input.materials !== undefined) { l.materials = money(input.materials); changes.push(`materials $${l.materials}`) }
      if (input.materialsOnly !== undefined) { l.materialsOnly = input.materialsOnly === true; changes.push(l.materialsOnly ? 'materials only' : 'labor + materials') }
      if (input.section) { const s = findSection(e, input.section as string); if (!s) return { ok: false, change: `no section "${input.section}"` }; l.sectionId = s.id; changes.push(`moved to ${s.title}`) }
      return { ok: true, change: `line ${input.line} (${title(l.description)}): ${changes.join(', ') || 'no change'}` }
    }
    case 'remove_line': {
      const l = findLine(e, input.line)
      if (!l) return { ok: false, change: `no line ${input.line}` }
      e.lines.splice(e.lines.indexOf(l), 1)
      return { ok: true, change: `removed line ${input.line}: ${title(l.description)}` }
    }
    default:
      return { ok: false, change: `unknown tool ${name}` }
  }
}

// ─── Prompt ─────────────────────────────────────────────────────────────────────
export function persona(): string {
  const b = business()
  return `You are Captain Levi, the estimator at ${b.name} (${b.legalName}), a fiberglass boat repair yard at ${b.address.street}, ${b.address.city}, ${b.address.state} ${b.address.zip}, phone ${b.phone}. You help the crew write repair estimates and insurance supplements in the shop's quote builder.

Voice: plain, direct, warm, a working captain who has done this for decades. Short sentences. No hype. Talk to the staff member like a colleague; the customer never sees this chat.

How you work:
- You can edit the estimate with the tools. Use them for every change the staff member asks for; never just describe a change you could make. After editing, answer in two or three sentences: what you changed and anything they should check.
- Build lines the shop's way (knowledge below): a bold title line, detail underneath, hours × rate for labor, materials as a lump sum, materials-only lines where there is no labor. Section by area of the boat or phase of work.
- When you lack information to size a line (no photos, no dimensions, unknown core condition), add the line with 0 hours and say what you need. Never invent prices or hours you cannot justify.
- Never change pricing (labor rate, tax rate, tax note, deposit) unless explicitly told to; ask first.
- Never promise dates, outcomes, or what an insurer will pay. Keep customer and vessel details exactly as given.
- Line numbers in your tools are the printed numbers (1, 2, 3…) shown in the current document below; sections by letter (A, B…) or title.
- If the request is unclear or would make a bad estimate, say so and ask one question instead of guessing.

SHOP KNOWLEDGE (seed; the owner will expand it):
${knowledge()}`
}

export function describeEstimate(e: Estimate): string {
  const t = calcTotals(e), lay = layoutLines(e)
  const lines: string[] = []
  const lineStr = (p: { number: number; line: EstimateLine }) => `  ${p.number}. ${p.line.description.replace(/\n/g, ' / ')} — ${p.line.materialsOnly ? 'materials only' : `${p.line.hours} h @ $${p.line.rate}`}, materials $${p.line.materials}`
  for (const p of lay.unsectioned) lines.push(lineStr(p))
  for (const s of lay.sections) { lines.push(`${s.letter}. ${s.section.title}`); for (const p of s.lines) lines.push(lineStr(p)) }
  return `CURRENT DOCUMENT ${e.number || ''} (${e.docKind}${e.revision ? ` rev ${e.revision}` : ''}, status ${e.status}, date ${e.estimateDate})
Customer: ${e.customer.name || '—'} ${e.customer.company ? `(${e.customer.company})` : ''} · ${e.customer.email || '—'} · ${e.customer.phone || '—'} · ${e.customer.addressLines.filter(Boolean).join(', ') || 'no address'}
Vessel: ${[e.vessel.year, e.vessel.make, e.vessel.model].filter(Boolean).join(' ') || '—'}${e.vessel.name ? ` "${e.vessel.name}"` : ''} · HIN ${e.vessel.hin || '—'} · Reg ${e.vessel.registration || '—'} · at ${e.vessel.location || '—'}
Insurance: ${e.insurance.enabled ? `YES · carrier ${e.insurance.carrier || '—'} · claim ${e.insurance.claimNumber || '—'} · loss ${e.insurance.dateOfLoss || '—'} · adjuster ${e.insurance.adjusterName || '—'} ${e.insurance.adjusterPhone || ''} · appraiser ${e.insurance.appraiserName || '—'} · carrier est. ${e.insurance.carrierEstimateNumber || '—'} ${e.insurance.carrierEstimateDate || ''} · direction to pay ${e.directionToPay ? 'printed' : 'not printed'}` : 'no'}
Pricing: labor $${e.pricing.laborRate}/h · tax ${e.pricing.taxRate}% (${e.pricing.taxNote}) · deposit ${e.pricing.depositPct}%
Lines:
${lines.join('\n') || '  (none)'}
Totals: labor ${formatMoney(t.laborCents)} (${t.laborHours} h) · materials ${formatMoney(t.materialsCents)} · subtotal ${formatMoney(t.subtotalCents)} · tax ${formatMoney(t.taxCents)} · TOTAL ${formatMoney(t.totalCents)}
Notes: ${e.notes || '—'}
Photos: ${e.photos.length ? e.photos.map((p, i) => `Photo ${i + 1}: ${p.caption || 'no caption'}`).join('; ') : 'none'}`
}

// ─── Conversation + model loop ──────────────────────────────────────────────────────
export interface ChatMessage { role: 'user' | 'assistant'; text: string; changes?: string[]; at: string; model?: string; costUsd?: number }

export async function loadChat(db: Db, estimateId: string): Promise<ChatMessage[]> {
  const r = await db.query<{ messages: ChatMessage[] }>('SELECT messages FROM estimate_chats WHERE estimate_id = $1', [estimateId])
  return Array.isArray(r.rows[0]?.messages) ? r.rows[0].messages : []
}

async function saveChat(db: Db, estimateId: string, messages: ChatMessage[]): Promise<void> {
  await db.query('INSERT INTO estimate_chats (estimate_id, messages, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (estimate_id) DO UPDATE SET messages = EXCLUDED.messages, updated_at = now()', [estimateId, JSON.stringify(messages.slice(-60))])
}

export function assistantModel(): string { return env.anthropicAssistantModel }

export interface AssistantResult { reply: string; changes: string[]; row: EstimateRow | null; messages: ChatMessage[]; costUsd: number; unavailable?: string }

export async function runAssistant(db: Db, opts: { estimateId: string; message: string; actor: string }): Promise<AssistantResult> {
  const row = await getEstimate(db, opts.estimateId)
  if (!row) throw new Error('estimate not found')
  const history = await loadChat(db, opts.estimateId)
  const userMsg: ChatMessage = { role: 'user', text: opts.message.trim().slice(0, 4000), at: new Date().toISOString() }

  const anthropic = getAnthropic()
  const b = await budget(db)
  const unavailable = !anthropic ? 'Captain Levi needs the Anthropic API key before he can help (ANTHROPIC_API_KEY is not set). You can still edit everything by hand.'
    : !b.ok ? `Captain Levi is over this month's AI budget ($${b.spent.toFixed(2)} of $${b.budget}). Raise AI_MONTHLY_BUDGET_USD or wait for next month.` : null
  if (unavailable) {
    const messages = [...history, userMsg, { role: 'assistant' as const, text: unavailable, at: new Date().toISOString() }]
    await saveChat(db, opts.estimateId, messages)
    return { reply: unavailable, changes: [], row, messages, costUsd: 0, unavailable }
  }

  const working: Estimate = normalizeEstimate(JSON.parse(JSON.stringify(row.doc)))
  const model = assistantModel()
  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: persona(), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: describeEstimate(presentDoc(working)) },
  ]
  const convo: Anthropic.MessageParam[] = [
    ...history.slice(-MAX_HISTORY).map((m): Anthropic.MessageParam => ({ role: m.role, content: m.role === 'assistant' && m.changes?.length ? `${m.text}\n[changes made: ${m.changes.join('; ')}]` : m.text })),
    { role: 'user', content: userMsg.text },
  ]
  const changes: string[] = []
  let reply = ''
  let cost = 0
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await anthropic!.messages.create({ model, max_tokens: 2500, system, tools: TOOLS, messages: convo }, { timeout: 60_000 })
    cost += await logUsage(db, 'estimate_assistant', model, res.usage)
    const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === 'text').map((c) => c.text).join('\n').trim()
    if (text) reply = text
    const uses = res.content.filter((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
    if (res.stop_reason !== 'tool_use' || !uses.length) break
    convo.push({ role: 'assistant', content: res.content })
    const results: Anthropic.ToolResultBlockParam[] = uses.map((u) => {
      const out = applyTool(working, u.name, (u.input && typeof u.input === 'object' ? u.input : {}) as Record<string, unknown>)
      if (out.ok) changes.push(out.change)
      const t = calcTotals(working)
      return { type: 'tool_result', tool_use_id: u.id, content: `${out.ok ? 'OK' : 'ERROR'}: ${out.change}. Running total now ${formatMoney(t.totalCents)}.`, is_error: !out.ok }
    })
    convo.push({ role: 'user', content: results })
    if (round === MAX_TOOL_ROUNDS) reply = reply || 'I made the changes I could in this turn; tell me if you want more.'
  }
  if (!reply) reply = changes.length ? 'Done. Have a look at the lines and tell me what to adjust.' : 'Nothing changed. Tell me what you want on the estimate.'

  let saved: EstimateRow | null = row
  if (changes.length) saved = await saveEstimate(db, opts.estimateId, working, { actor: `Captain Levi (for ${opts.actor})`, reason: `Captain Levi: ${changes.length === 1 ? changes[0] : `${changes.length} changes`}`.slice(0, 200) })
  const assistantMsg: ChatMessage = { role: 'assistant', text: reply, changes, at: new Date().toISOString(), model, costUsd: Math.round(cost * 1e4) / 1e4 }
  const messages = [...history, userMsg, assistantMsg]
  await saveChat(db, opts.estimateId, messages)
  return { reply, changes, row: saved, messages, costUsd: cost }
}

export function assistantConfigured(): boolean { return !!env.anthropicKey }
