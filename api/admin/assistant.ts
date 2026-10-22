// /api/admin/assistant (staff cookie or bearer) — Captain Levi, the estimate assistant.
//   GET  ?estimate_id=<uuid>                 chat history + whether the assistant is configured
//   POST {estimate_id, message}              one turn: the model may edit the estimate (saved as a version)
import { audit } from '../../lib/audit.js'
import { requireAdmin } from '../../lib/admin.js'
import { getDb } from '../../lib/db.js'
import { assistantConfigured, assistantModel, loadChat, runAssistant } from '../../lib/estimates/assistant.js'
import { getEstimate, listVersions, present } from '../../lib/estimates/store.js'
import { HttpError, query, readJson, requireMethod, route, sendJson } from '../../lib/http.js'
import { isUuid } from '../../lib/session.js'

export default route(async (req, res) => {
  requireMethod(req, 'GET', 'POST')
  const actor = requireAdmin(req)
  const db = await getDb()
  if (req.method === 'GET') {
    const id = query(req).get('estimate_id') || ''
    if (!isUuid(id)) throw new HttpError(400, 'estimate_id must be a uuid.')
    sendJson(res, 200, { ok: true, configured: assistantConfigured(), model: assistantModel(), messages: await loadChat(db, id) })
    return
  }
  const body = (await readJson(req)) as { estimate_id?: unknown; message?: unknown }
  const id = typeof body?.estimate_id === 'string' ? body.estimate_id : ''
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  if (!isUuid(id)) throw new HttpError(400, 'estimate_id must be a uuid.')
  if (!message) throw new HttpError(400, 'Say something for Captain Levi to do.')
  if (!(await getEstimate(db, id))) throw new HttpError(404, 'Estimate not found.')
  const out = await runAssistant(db, { estimateId: id, message, actor: actor.label })
  if (out.changes.length) await audit(db, actor.label, 'estimate.assistant', 'estimate', id, { changes: out.changes.length, costUsd: out.costUsd })
  const row = out.row || (await getEstimate(db, id))
  sendJson(res, out.unavailable ? 503 : 200, { ok: !out.unavailable, reply: out.reply, changes: out.changes, costUsd: out.costUsd, messages: out.messages, configured: assistantConfigured(), ...(row ? { ...present(row), versions: await listVersions(db, id) } : {}) })
})
