// Bearer-token guard for /api/admin/* (stopgap until the estimater has real auth).
import { timingSafeEqual } from 'node:crypto'
import { env } from './env.js'
import { header, HttpError, type Req } from './http.js'

export function requireAdmin(req: Req): void {
  const token = env.adminToken
  if (!token) throw new HttpError(503, 'Admin API is not configured (ADMIN_API_TOKEN unset).')
  const auth = header(req, 'authorization')
  const m = auth.match(/^Bearer\s+(.+)$/i)
  const given = m ? m[1].trim() : ''
  if (!given || given.length !== token.length || !timingSafeEqual(Buffer.from(given), Buffer.from(token))) {
    throw new HttpError(401, 'Unauthorized.', {}, { 'WWW-Authenticate': 'Bearer' })
  }
}
