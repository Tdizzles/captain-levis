// POST /api/events — first-party analytics beacon. JSON {name, props, page, ref, ts, sid} → 204.
// Allow-listed names only; unknown events are dropped silently. Raw IPs are never stored.
import { z } from 'zod'
import { getDb } from '../lib/db.js'
import { readJson, requireMethod, route, sendEmpty } from '../lib/http.js'
import { ipHash, sessionHash } from '../lib/ip.js'
import { hit, RULES } from '../lib/ratelimit.js'

export const EVENT_NAMES = ['page_view', 'call_click', 'quote_submit', 'chat_open', 'chat_quote_start', 'chat_quote_complete', 'text_size', 'consent'] as const

const schema = z.object({
  name: z.string().max(40),
  props: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean(), z.null()])).optional().default({}),
  page: z.string().max(80).optional().default(''),
  ref: z.string().max(120).optional().default(''),
  ts: z.number().optional(),
  sid: z.string().max(64).optional().default(''),
})

export default route(async (req, res) => {
  requireMethod(req, 'POST')
  let body: unknown
  try { body = await readJson(req, 8 * 1024) } catch { sendEmpty(res, 204); return }
  const parsed = schema.safeParse(body)
  if (!parsed.success || !(EVENT_NAMES as readonly string[]).includes(parsed.data.name)) { sendEmpty(res, 204); return }
  const e = parsed.data
  let db
  try { db = await getDb() } catch { sendEmpty(res, 204); return }
  const rl = await hit(db, RULES.eventsIp, ipHash(req))
  if (!rl.allowed) { sendEmpty(res, 429, { 'Retry-After': String(rl.retryAfterSec) }); return }
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(e.props).slice(0, 12)) props[k.slice(0, 40)] = v
  const day = new Date().toISOString().slice(0, 10)
  await db.query(
    'INSERT INTO analytics_events (name, props, page, referrer_host, session_hash, day) VALUES ($1, $2::jsonb, $3, $4, $5, $6)',
    [e.name, JSON.stringify(props), e.page.replace(/[^a-z0-9-]/gi, '').slice(0, 80) || null, e.ref.toLowerCase().slice(0, 120) || null, e.sid ? sessionHash(e.sid) : null, day],
  )
  sendEmpty(res, 204)
})
