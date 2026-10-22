// POST /api/admin/retry-email?id=<delivery uuid> (bearer) → re-renders and resends a failed / pending_config delivery.
// GET  /api/admin/retry-email?status=failed      lists deliveries (default: failed + pending_config).
import { audit } from '../../lib/audit.js'
import { requireAdmin } from '../../lib/admin.js'
import { getDb } from '../../lib/db.js'
import { listDeliveries, retryDelivery } from '../../lib/email/send.js'
import { HttpError, query, requireMethod, route, sendJson } from '../../lib/http.js'
import { isUuid } from '../../lib/session.js'

export default route(async (req, res) => {
  requireMethod(req, 'GET', 'POST')
  const actor = requireAdmin(req)
  const db = await getDb()
  const q = query(req)
  if (req.method === 'GET') {
    const status = q.get('status') || ''
    const rows = status ? await listDeliveries(db, status) : [...(await listDeliveries(db, 'failed')), ...(await listDeliveries(db, 'pending_config'))]
    sendJson(res, 200, { ok: true, items: rows })
    return
  }
  const id = q.get('id') || ''
  if (!isUuid(id)) throw new HttpError(400, 'id must be a delivery uuid.')
  const out = await retryDelivery(db, id)
  if (!out) throw new HttpError(404, 'Delivery not found.')
  await audit(db, actor.label, 'email.retry', 'email_delivery', id, { sent: out.sent, status: out.delivery.status, reason: out.reason || null })
  sendJson(res, out.sent ? 200 : 202, { ok: out.sent, delivery: out.delivery, reason: out.reason || null })
})
