// chat_sessions persistence. Messages are capped at 60 stored turns.
import type { Queryable } from '../db.js'
import type { ChatSessionRow, Slots, State, StoredMessage } from './types.js'

const MAX_STORED = 60
const COLS = 'id, state, slots, page, messages, cost_usd::float8 AS cost_usd, token_in, token_out, inquiry_id, created_at, last_seen_at'

export async function loadOrCreateSession(db: Queryable, id: string, page: string | null): Promise<ChatSessionRow> {
  const r = await db.query<ChatSessionRow>(`SELECT ${COLS} FROM chat_sessions WHERE id = $1`, [id])
  if (r.rows[0]) {
    const row = r.rows[0]
    row.state = (row.state && typeof row.state === 'object' ? row.state : { mode: 'start' }) as State
    row.slots = (row.slots && typeof row.slots === 'object' ? row.slots : {}) as Slots
    row.messages = Array.isArray(row.messages) ? row.messages : []
    return row
  }
  const ins = await db.query<ChatSessionRow>(
    `INSERT INTO chat_sessions (id, state, slots, page, messages) VALUES ($1, $2::jsonb, '{}'::jsonb, $3, '[]'::jsonb)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = now() RETURNING ${COLS}`,
    [id, JSON.stringify({ mode: 'start' }), page],
  )
  const row = ins.rows[0]
  row.state = { mode: 'start' }; row.slots = {}; row.messages = []
  return row
}

export async function saveSession(db: Queryable, s: ChatSessionRow, delta: { cost?: number; tokensIn?: number; tokensOut?: number; page?: string | null }): Promise<void> {
  const messages = s.messages.slice(-MAX_STORED)
  await db.query(
    `UPDATE chat_sessions SET state = $2::jsonb, slots = $3::jsonb, messages = $4::jsonb, page = coalesce($5, page),
       cost_usd = cost_usd + $6, token_in = token_in + $7, token_out = token_out + $8, last_seen_at = now(), inquiry_id = coalesce($9, inquiry_id)
     WHERE id = $1`,
    [s.id, JSON.stringify(s.state), JSON.stringify(s.slots), JSON.stringify(messages), delta.page ?? null, delta.cost || 0, delta.tokensIn || 0, delta.tokensOut || 0, s.inquiry_id],
  )
}

export function pushMessage(s: ChatSessionRow, role: StoredMessage['role'], text: string): void {
  s.messages.push({ role, text: text.slice(0, 1000), ts: new Date().toISOString() })
  if (s.messages.length > MAX_STORED) s.messages = s.messages.slice(-MAX_STORED)
}
