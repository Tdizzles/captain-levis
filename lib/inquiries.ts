// Inquiry persistence: reference numbers, idempotency, duplicate detection, photo linking.
import { z } from 'zod'
import { parseBoat } from './boat.js'
import { serviceValues } from './business.js'
import type { Db, Queryable } from './db.js'
import type { InquiryDetails } from './chat/quoteflow.js'
import { sha256 } from './ip.js'

export const KINDS = ['quote', 'contact', 'insurance', 'yard'] as const
export const STATUSES = ['new', 'contacted', 'quoted', 'closed'] as const
export type InquiryStatus = (typeof STATUSES)[number]

const trimmed = (max: number) => z.string().trim().max(max)
export const emailSchema = z.string().trim().toLowerCase().max(200).regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please enter a valid email address.')
export const phoneSchema = z.string().trim().max(40).refine((v) => v.replace(/\D/g, '').length >= 10, 'Please enter a phone number we can reach you on.')

export const inquiryInput = z.object({
  name: trimmed(120).min(1, 'Please enter your name.'),
  email: emailSchema,
  phone: phoneSchema,
  service: z.string().trim().max(60).refine((v) => serviceValues().includes(v), 'Please pick the closest service.'),
  boat: trimmed(120).optional().default(''),
  boat_location: trimmed(160).optional().default(''),
  message: trimmed(4000).min(10, 'Tell us a little about the boat and the damage.'),
  page: trimmed(80).optional().default(''),
  kind: z.string().trim().max(30).optional().default('quote'),
  idempotency_key: trimmed(80).optional().default(''),
})
export type InquiryInput = z.infer<typeof inquiryInput>

export interface InquiryRow {
  id: string; ref: string; kind: string; status: InquiryStatus; name: string; email: string; phone: string; service: string
  boat_make: string | null; boat_model: string | null; boat_year: number | null; boat_raw: string | null; boat_location: string | null
  damage_location: string | null; damage_type: string | null; message: string; page: string | null; source: 'form' | 'chat'
  chat_session_id: string | null; idempotency_key: string | null; ip_hash: string | null; user_agent: string | null
  /** structured quote-flow answers from the chat ({} for form inquiries) */
  details?: Partial<InquiryDetails>
  created_at: Date | string; updated_at: Date | string
}

export const INQUIRY_COLS = `id, ref, kind, status, name, email, phone, service, boat_make, boat_model, boat_year, boat_raw, boat_location,
  damage_location, damage_type, message, page, source, chat_session_id, idempotency_key, ip_hash, user_agent, details, created_at, updated_at`

export async function nextRef(tx: Queryable, now = new Date()): Promise<string> {
  const year = now.getFullYear()
  const r = await tx.query<{ n: number }>(
    'INSERT INTO ref_counters (year, n) VALUES ($1, 1) ON CONFLICT (year) DO UPDATE SET n = ref_counters.n + 1 RETURNING n',
    [year],
  )
  return `CL-${year}-${String(Number(r.rows[0].n)).padStart(4, '0')}`
}

export function messageHash(email: string, message: string): string {
  return sha256(`${email.trim().toLowerCase()}\n${message.trim().replace(/\s+/g, ' ').toLowerCase()}`)
}

export async function findByIdempotencyKey(db: Queryable, key: string): Promise<InquiryRow | null> {
  if (!key) return null
  return (await db.query<InquiryRow>(`SELECT ${INQUIRY_COLS} FROM inquiries WHERE idempotency_key = $1`, [key])).rows[0] || null
}

export async function findRecentDuplicate(db: Queryable, email: string, message: string, windowMs = 10 * 60_000): Promise<InquiryRow | null> {
  const since = new Date(Date.now() - windowMs).toISOString()
  return (await db.query<InquiryRow>(
    `SELECT ${INQUIRY_COLS} FROM inquiries WHERE email = $1 AND message_hash = $2 AND created_at >= $3 ORDER BY created_at DESC LIMIT 1`,
    [email.trim().toLowerCase(), messageHash(email, message), since],
  )).rows[0] || null
}

export async function getInquiry(db: Queryable, id: string): Promise<InquiryRow | null> {
  return (await db.query<InquiryRow>(`SELECT ${INQUIRY_COLS} FROM inquiries WHERE id = $1`, [id])).rows[0] || null
}

export interface CreateInquiryOpts {
  input: InquiryInput
  source: 'form' | 'chat'
  chatSessionId?: string | null
  damageLocation?: string | null
  damageType?: string | null
  details?: InquiryDetails | null
  ipHash: string | null
  userAgent: string | null
}

/** Inserts the inquiry (with its ref) and links any photos already uploaded through the chat session. */
export async function createInquiry(db: Db, opts: CreateInquiryOpts): Promise<InquiryRow> {
  const { input } = opts
  const boat = parseBoat(input.boat)
  return db.transaction(async (tx) => {
    const ref = await nextRef(tx)
    const r = await tx.query<InquiryRow>(
      `INSERT INTO inquiries (ref, kind, name, email, phone, service, boat_make, boat_model, boat_year, boat_raw, boat_location,
         damage_location, damage_type, message, message_hash, page, source, chat_session_id, idempotency_key, ip_hash, user_agent, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb)
       RETURNING ${INQUIRY_COLS}`,
      [ref, (KINDS as readonly string[]).includes(input.kind) ? input.kind : 'quote', input.name, input.email, input.phone, input.service,
        boat.make, boat.model, boat.year, boat.raw || null, input.boat_location || null,
        opts.damageLocation || null, opts.damageType || null, input.message, messageHash(input.email, input.message), input.page || null,
        opts.source, opts.chatSessionId || null, input.idempotency_key || null, opts.ipHash, opts.userAgent?.slice(0, 300) || null,
        JSON.stringify(opts.details || {})],
    )
    const row = r.rows[0]
    if (opts.chatSessionId) {
      await tx.query('UPDATE photos SET inquiry_id = $1 WHERE chat_session_id = $2 AND inquiry_id IS NULL', [row.id, opts.chatSessionId])
      await tx.query('UPDATE chat_sessions SET inquiry_id = $1 WHERE id = $2', [row.id, opts.chatSessionId])
    }
    return row
  })
}

export async function setStatus(db: Queryable, id: string, status: InquiryStatus): Promise<InquiryRow | null> {
  return (await db.query<InquiryRow>(`UPDATE inquiries SET status = $2, updated_at = now() WHERE id = $1 RETURNING ${INQUIRY_COLS}`, [id, status])).rows[0] || null
}
