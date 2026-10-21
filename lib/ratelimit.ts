// Fixed-window rate limiting in Postgres (rate_limits: key, window_start, count).
// Windows align to multiples of `windowMs`; the 429 carries Retry-After = seconds until the window rolls.
import type { Queryable } from './db.js'
import { HttpError } from './http.js'

export interface RateRule { name: string; limit: number; windowMs: number }

export const RULES = {
  chatSession: { name: 'chat:session', limit: 20, windowMs: 60_000 },
  chatIp: { name: 'chat:ip', limit: 120, windowMs: 3_600_000 },
  inquiryIp: { name: 'inq:ip', limit: 5, windowMs: 3_600_000 },
  uploadSession: { name: 'up:session', limit: 12, windowMs: 3_600_000 },
  eventsIp: { name: 'ev:ip', limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateRule>

export interface RateResult { allowed: boolean; count: number; limit: number; retryAfterSec: number }

export async function hit(db: Queryable, rule: RateRule, subject: string, now = Date.now()): Promise<RateResult> {
  const windowStart = new Date(Math.floor(now / rule.windowMs) * rule.windowMs)
  const key = `${rule.name}:${subject}`
  const r = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowStart.toISOString()],
  )
  const count = Number(r.rows[0]?.count ?? 1)
  const retryAfterSec = Math.max(1, Math.ceil((windowStart.getTime() + rule.windowMs - now) / 1000))
  // opportunistic cleanup of windows older than a day (cheap; keeps the table small)
  if (count === 1 && Math.random() < 0.05) {
    db.query('DELETE FROM rate_limits WHERE window_start < $1', [new Date(now - 86_400_000).toISOString()]).catch(() => {})
  }
  return { allowed: count <= rule.limit, count, limit: rule.limit, retryAfterSec }
}

/** Throws a 429 HttpError with Retry-After when over the limit. */
export async function enforce(db: Queryable, rule: RateRule, subject: string, message = 'Too many requests. Please wait a minute and try again.'): Promise<void> {
  const r = await hit(db, rule, subject)
  if (!r.allowed) throw new HttpError(429, message, { retryAfter: r.retryAfterSec }, { 'Retry-After': String(r.retryAfterSec) })
}
