// GET /api/auth/me → {ok, staff:{email, expiresAt} | null, loginConfigured}
import { requireMethod, route, sendJson } from '../../lib/http.js'
import { staffFromRequest, staffLoginConfigured } from '../../lib/staff.js'

export default route(async (req, res) => {
  requireMethod(req, 'GET')
  const s = staffFromRequest(req)
  sendJson(res, 200, { ok: true, staff: s ? { email: s.email, expiresAt: new Date(s.exp * 1000).toISOString() } : null, loginConfigured: staffLoginConfigured() })
})
