// Visitor session cookie: cl_session=<uuid>.<hmac>, HttpOnly, SameSite=Lax, Secure in production, 30 days.
// Rule: the cookie is authoritative. A sessionId supplied in a request body is honored only when it matches
// the cookie; otherwise the cookie's session is used (or a brand-new one issued when no valid cookie exists)
// and the response carries the id the client should adopt. One visitor can therefore never read another's session.
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { effectiveSecret, env } from './env.js'
import { cookies, type Req, type Res } from './http.js'

export const SESSION_COOKIE = 'cl_session'
const MAX_AGE = 30 * 24 * 60 * 60

function sign(id: string): string {
  return createHmac('sha256', effectiveSecret().secret).update(`session:${id}`).digest('base64url').slice(0, 32)
}

export function isUuid(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
}

export function verifySessionCookie(value: string | undefined): string | null {
  if (!value) return null
  const i = value.lastIndexOf('.')
  if (i < 0) return null
  const id = value.slice(0, i), sig = value.slice(i + 1)
  if (!isUuid(id)) return null
  const expected = sign(id)
  if (sig.length !== expected.length) return null
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id.toLowerCase() : null
}

export function setSessionCookie(res: Res, id: string): void {
  const parts = [`${SESSION_COOKIE}=${id}.${sign(id)}`, 'Path=/', `Max-Age=${MAX_AGE}`, 'HttpOnly', 'SameSite=Lax']
  if (env.isProduction) parts.push('Secure')
  const prev = res.getHeader('Set-Cookie')
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : []
  res.setHeader('Set-Cookie', [...list, parts.join('; ')])
}

export interface ResolvedSession { id: string; isNew: boolean; matchedClient: boolean }

/** Resolve the visitor session for this request; always leaves a valid cookie on the response. */
export function resolveSession(req: Req, res: Res, clientId: unknown): ResolvedSession {
  const fromCookie = verifySessionCookie(cookies(req)[SESSION_COOKIE])
  if (fromCookie) {
    const matched = isUuid(clientId) && clientId.toLowerCase() === fromCookie
    setSessionCookie(res, fromCookie) // refresh expiry
    return { id: fromCookie, isNew: false, matchedClient: matched }
  }
  const id = randomUUID()
  setSessionCookie(res, id)
  return { id, isNew: true, matchedClient: false }
}
