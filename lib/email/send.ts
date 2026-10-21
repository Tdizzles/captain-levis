// Email delivery with a durable record per attempt set (email_deliveries). Without RESEND_API_KEY the row is
// stored as 'pending_config' and the inquiry still succeeds; POST /api/admin/retry-email?id= retries later.
import { Resend } from 'resend'
import type { Db } from '../db.js'
import { env } from '../env.js'
import { getInquiry, type InquiryRow } from '../inquiries.js'
import { listPhotos } from '../photos.js'
import { draftReply } from './draft.js'
import { renderInquiryEmail, type ChatSummary } from './render.js'

export const RESEND_TIMEOUT_MS = 10_000

export interface DeliveryRow {
  id: string; inquiry_id: string; provider: string; provider_id: string | null; to: string; subject: string
  status: 'pending' | 'sent' | 'failed' | 'pending_config'; attempts: number; last_error: string | null; created_at: Date | string; sent_at: Date | string | null
}

const COLS = 'id, inquiry_id, provider, provider_id, "to", subject, status, attempts, last_error, created_at, sent_at'

export async function chatSummaryFor(db: Db, inquiry: InquiryRow): Promise<ChatSummary | null> {
  if (inquiry.source !== 'chat' || !inquiry.chat_session_id) return null
  const r = await db.query<{ messages: { role: 'user' | 'assistant'; text: string }[]; created_at: Date | string }>('SELECT messages, created_at FROM chat_sessions WHERE id = $1', [inquiry.chat_session_id])
  const row = r.rows[0]
  if (!row) return null
  const msgs = Array.isArray(row.messages) ? row.messages : []
  const excerpt = msgs.filter((m) => m.role === 'user').slice(0, 6).map((m) => ({ role: m.role, text: m.text.slice(0, 240) }))
  return { turns: msgs.length, started: row.created_at, excerpt }
}

export interface SendOutcome { delivery: DeliveryRow; sent: boolean; reason?: string }

async function sendViaResend(args: { to: string; subject: string; html: string; text: string; replyTo: string; tag: string }): Promise<{ id: string }> {
  const resend = new Resend(env.resendKey)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), RESEND_TIMEOUT_MS)
  try {
    const result = await Promise.race([
      resend.emails.send({ from: env.emailFrom, to: args.to.split(',').map((s) => s.trim()).filter(Boolean), replyTo: args.replyTo, subject: args.subject, html: args.html, text: args.text, headers: { 'X-Entity-Ref-ID': args.tag } }),
      new Promise<never>((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new Error('Resend request timed out after 10 s')), { once: true })),
    ])
    if (result.error) throw new Error(`${result.error.name || 'resend_error'}: ${result.error.message}`)
    if (!result.data?.id) throw new Error('Resend returned no message id')
    return { id: result.data.id }
  } finally {
    clearTimeout(timer)
  }
}

/** Creates the email_deliveries row for an inquiry and tries to send inline (retry 2×). Never throws. */
export async function enqueueAndSendInquiryEmail(db: Db, inquiry: InquiryRow): Promise<SendOutcome> {
  const photos = await listPhotos(db, { inquiryId: inquiry.id })
  const chat = await chatSummaryFor(db, inquiry)
  let draft: string | null = null
  try { draft = await draftReply(db, inquiry) } catch (e) { console.warn('[email] draft failed', (e as Error).message) }
  const { html, text, subject } = renderInquiryEmail({ inquiry, photos, chat, draftReply: draft })
  const to = env.emailTo
  const initialStatus = env.resendKey ? 'pending' : 'pending_config'
  const ins = await db.query<DeliveryRow>(
    `INSERT INTO email_deliveries (inquiry_id, provider, "to", subject, status) VALUES ($1, 'resend', $2, $3, $4) RETURNING ${COLS}`,
    [inquiry.id, to, subject, initialStatus],
  )
  let delivery = ins.rows[0]
  if (!env.resendKey) return { delivery, sent: false, reason: 'RESEND_API_KEY not set' }
  return attemptSend(db, delivery, { html, text, replyTo: inquiry.email })
}

async function attemptSend(db: Db, delivery: DeliveryRow, body: { html: string; text: string; replyTo: string }, tries = 3): Promise<SendOutcome> {
  let lastError = ''
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const { id } = await sendViaResend({ to: delivery.to, subject: delivery.subject, html: body.html, text: body.text, replyTo: body.replyTo, tag: delivery.id })
      const up = await db.query<DeliveryRow>(`UPDATE email_deliveries SET status = 'sent', provider_id = $2, attempts = attempts + 1, sent_at = now(), last_error = NULL WHERE id = $1 RETURNING ${COLS}`, [delivery.id, id])
      return { delivery: up.rows[0], sent: true }
    } catch (e) {
      lastError = ((e as Error)?.message || String(e)).slice(0, 500)
      console.warn(`[email] attempt ${attempt} failed for ${delivery.id}: ${lastError}`)
      if (attempt < tries) await new Promise((r) => setTimeout(r, 400 * attempt))
    }
  }
  const up = await db.query<DeliveryRow>(`UPDATE email_deliveries SET status = 'failed', attempts = attempts + $2, last_error = $3 WHERE id = $1 RETURNING ${COLS}`, [delivery.id, tries, lastError])
  return { delivery: up.rows[0], sent: false, reason: lastError }
}

/** Re-render and resend a delivery that is failed / pending_config (admin action). */
export async function retryDelivery(db: Db, deliveryId: string): Promise<SendOutcome | null> {
  const r = await db.query<DeliveryRow>(`SELECT ${COLS} FROM email_deliveries WHERE id = $1`, [deliveryId])
  const delivery = r.rows[0]
  if (!delivery) return null
  const inquiry = await getInquiry(db, delivery.inquiry_id)
  if (!inquiry) return null
  if (!env.resendKey) {
    await db.query(`UPDATE email_deliveries SET status = 'pending_config' WHERE id = $1`, [delivery.id])
    return { delivery: { ...delivery, status: 'pending_config' }, sent: false, reason: 'RESEND_API_KEY not set' }
  }
  const photos = await listPhotos(db, { inquiryId: inquiry.id })
  const chat = await chatSummaryFor(db, inquiry)
  const { html, text } = renderInquiryEmail({ inquiry, photos, chat, draftReply: null })
  await db.query(`UPDATE email_deliveries SET status = 'pending', "to" = $2 WHERE id = $1`, [delivery.id, env.emailTo])
  return attemptSend(db, { ...delivery, to: env.emailTo }, { html, text, replyTo: inquiry.email })
}

export async function listDeliveries(db: Db, status?: string, limit = 50): Promise<DeliveryRow[]> {
  if (status) return (await db.query<DeliveryRow>(`SELECT ${COLS} FROM email_deliveries WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [status, limit])).rows
  return (await db.query<DeliveryRow>(`SELECT ${COLS} FROM email_deliveries ORDER BY created_at DESC LIMIT $1`, [limit])).rows
}
