// POST /api/auth/login {email, password} → sets the staff cookie. 10 attempts per IP per 15 minutes.
import { audit } from '../../lib/audit.js'
import { getDb } from '../../lib/db.js'
import { HttpError, readJson, requireMethod, route, sendJson } from '../../lib/http.js'
import { ipHash } from '../../lib/ip.js'
import { enforce } from '../../lib/ratelimit.js'
import { checkLogin, setStaffCookie } from '../../lib/staff.js'

const LOGIN_RULE = { name: 'login:ip', limit: 10, windowMs: 15 * 60_000 }

export default route(async (req, res) => {
  requireMethod(req, 'POST')
  const db = await getDb()
  await enforce(db, LOGIN_RULE, ipHash(req), 'Too many sign-in attempts. Wait 15 minutes and try again.')
  const body = (await readJson(req)) as { email?: unknown; password?: unknown }
  let email: string
  try {
    email = checkLogin(body?.email, body?.password)
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) await audit(db, 'anonymous', 'staff.login_failed', 'staff', typeof body?.email === 'string' ? body.email.slice(0, 120) : null)
    throw e
  }
  const who = setStaffCookie(res, email)
  await audit(db, email, 'staff.login', 'staff', email)
  sendJson(res, 200, { ok: true, staff: { email: who.email, expiresAt: new Date(who.exp * 1000).toISOString() } })
})
