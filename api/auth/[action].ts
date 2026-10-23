// Staff auth, one function for all three routes (Vercel Hobby allows 12 functions per deployment):
//   POST /api/auth/login {email, password} → sets the staff cookie. 10 attempts per IP per 15 minutes.
//   POST /api/auth/logout                 → clears it.
//   GET  /api/auth/me                     → {ok, staff:{email, expiresAt} | null, loginConfigured}
import { audit } from '../../lib/audit.js'
import { getDb } from '../../lib/db.js'
import { HttpError, query, readJson, requireMethod, route, sendJson, type Req, type Res } from '../../lib/http.js'
import { ipHash } from '../../lib/ip.js'
import { enforce } from '../../lib/ratelimit.js'
import { checkLogin, clearStaffCookie, setStaffCookie, staffFromRequest, staffLoginConfigured } from '../../lib/staff.js'

const LOGIN_RULE = { name: 'login:ip', limit: 10, windowMs: 15 * 60_000 }

async function login(req: Req, res: Res): Promise<void> {
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
}

function logout(req: Req, res: Res): void {
  requireMethod(req, 'POST')
  clearStaffCookie(res)
  sendJson(res, 200, { ok: true })
}

function me(req: Req, res: Res): void {
  requireMethod(req, 'GET')
  const s = staffFromRequest(req)
  sendJson(res, 200, { ok: true, staff: s ? { email: s.email, expiresAt: new Date(s.exp * 1000).toISOString() } : null, loginConfigured: staffLoginConfigured() })
}

export default route(async (req, res) => {
  const action = query(req).get('action') || ''
  if (action === 'login') return login(req, res)
  if (action === 'logout') return logout(req, res)
  if (action === 'me') return me(req, res)
  throw new HttpError(404, 'Not found.')
})
