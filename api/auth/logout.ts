// POST /api/auth/logout → clears the staff cookie.
import { requireMethod, route, sendJson } from '../../lib/http.js'
import { clearStaffCookie } from '../../lib/staff.js'

export default route(async (req, res) => {
  requireMethod(req, 'POST')
  clearStaffCookie(res)
  sendJson(res, 200, { ok: true })
})
