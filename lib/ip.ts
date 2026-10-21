// Client IP handling. The raw address is never stored: it is hashed with a daily salt and the
// server secret, so a hash from one day cannot be joined to the next day's.
import { createHash, createHmac } from 'node:crypto'
import { effectiveSecret } from './env.js'
import { header, type Req } from './http.js'

export function clientIp(req: Req): string {
  const xff = header(req, 'x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const real = header(req, 'x-real-ip')
  if (real) return real.trim()
  return req.socket?.remoteAddress || '0.0.0.0'
}

export function dailySalt(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

export function hashIp(ip: string, d = new Date()): string {
  const { secret } = effectiveSecret()
  return createHmac('sha256', secret).update(`ip:${dailySalt(d)}:${ip}`).digest('hex').slice(0, 32)
}

export function ipHash(req: Req): string {
  return hashIp(clientIp(req))
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Stable, non-reversible hash for analytics session ids. */
export function sessionHash(sid: string): string {
  const { secret } = effectiveSecret()
  return createHmac('sha256', secret).update(`sid:${sid}`).digest('hex').slice(0, 24)
}
