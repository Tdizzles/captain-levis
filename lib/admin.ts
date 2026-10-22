// Guard for /api/admin/*: a signed-in staff member (cl_staff cookie, lib/staff.ts) or the legacy
// ADMIN_API_TOKEN bearer. Returns who is acting so audit rows can name them.
import { timingSafeEqual } from 'node:crypto'
import { env } from './env.js'
import { header, HttpError, type Req } from './http.js'
import { staffFromRequest } from './staff.js'

export interface Actor { kind: 'staff' | 'token'; email: string | null; label: string }

function bearerOk(req: Req): boolean {
  const token = env.adminToken
  if (!token) return false
  const m = header(req, 'authorization').match(/^Bearer\s+(.+)$/i)
  const given = m ? m[1].trim() : ''
  return !!given && given.length === token.length && timingSafeEqual(Buffer.from(given), Buffer.from(token))
}

export function actorFor(req: Req): Actor | null {
  const staff = staffFromRequest(req)
  if (staff) return { kind: 'staff', email: staff.email, label: staff.email }
  if (bearerOk(req)) return { kind: 'token', email: null, label: 'admin-token' }
  return null
}

export function requireAdmin(req: Req): Actor {
  const actor = actorFor(req)
  if (actor) return actor
  const anyWay = !!env.adminToken || !!process.env.STAFF_PASSWORD_HASH
  if (!anyWay) throw new HttpError(503, 'Admin access is not configured (set STAFF_PASSWORD_HASH or ADMIN_API_TOKEN).')
  throw new HttpError(401, 'Unauthorized.', {}, { 'WWW-Authenticate': 'Bearer' })
}
