// /api/admin/inquiries  (staff cookie from /api/auth/login, or Authorization: Bearer ADMIN_API_TOKEN)
//   GET  ?status=&limit=&offset=      list (newest first) with signed photo URLs and delivery status
//   GET  ?id=<uuid>                   one inquiry + photos + deliveries + chat transcript + missing-info assessment + templated reply
//   PATCH ?id=<uuid>  {status}        update status (audited)
// api/admin/inquiries/[id].ts maps /api/admin/inquiries/<id> onto the same handler.
import { z } from 'zod'
import { audit } from '../../lib/audit.js'
import { requireAdmin } from '../../lib/admin.js'
import { getDb, type Db } from '../../lib/db.js'
import { HttpError, query, readJson, requireMethod, route, sendJson } from '../../lib/http.js'
import { getInquiry, INQUIRY_COLS, setStatus, STATUSES, type InquiryRow } from '../../lib/inquiries.js'
import { listPhotos, signPhotoUrl } from '../../lib/photos.js'
import { isUuid } from '../../lib/session.js'
import { assessInquiry } from '../../lib/quote/missing.js'
import { templatedReply } from '../../lib/quote/reply.js'

function present(i: InquiryRow, photos: { id: string; filename: string; mime: string; width: number; height: number; size: number }[]) {
  const { ip_hash: _ip, ...rest } = i
  return { ...rest, photos: photos.map((p) => ({ id: p.id, filename: p.filename, mime: p.mime, width: p.width, height: p.height, size: p.size, url: signPhotoUrl(p.id, 24 * 3600) })) }
}

async function deliveries(db: Db, inquiryId: string) {
  return (await db.query('SELECT id, provider, provider_id, "to", subject, status, attempts, last_error, created_at, sent_at FROM email_deliveries WHERE inquiry_id = $1 ORDER BY created_at', [inquiryId])).rows
}

export default route(async (req, res) => {
  requireMethod(req, 'GET', 'PATCH')
  const actor = requireAdmin(req)
  const db = await getDb()
  const q = query(req)
  const id = q.get('id') || ''

  if (req.method === 'PATCH') {
    if (!isUuid(id)) throw new HttpError(400, 'id must be a uuid.')
    const body = z.object({ status: z.enum(STATUSES) }).safeParse(await readJson(req))
    if (!body.success) throw new HttpError(400, `status must be one of ${STATUSES.join(', ')}.`)
    const before = await getInquiry(db, id)
    if (!before) throw new HttpError(404, 'Not found.')
    const after = await setStatus(db, id, body.data.status)
    await audit(db, actor.label, 'inquiry.status', 'inquiry', id, { from: before.status, to: body.data.status })
    sendJson(res, 200, { ok: true, inquiry: present(after!, await listPhotos(db, { inquiryId: id })) })
    return
  }

  if (id) {
    if (!isUuid(id)) throw new HttpError(400, 'id must be a uuid.')
    const i = await getInquiry(db, id)
    if (!i) throw new HttpError(404, 'Not found.')
    const photos = await listPhotos(db, { inquiryId: id })
    let chat: unknown = null
    if (i.chat_session_id) {
      const r = await db.query('SELECT id, state, slots, messages, created_at, last_seen_at, cost_usd::float8 AS cost_usd FROM chat_sessions WHERE id = $1', [i.chat_session_id])
      chat = r.rows[0] || null
    }
    const reply = templatedReply(i, photos.length)
    sendJson(res, 200, { ok: true, inquiry: present(i, photos), deliveries: await deliveries(db, id), chat, assessment: reply.assessment, reply: { subject: reply.subject, body: reply.body } })
    return
  }

  const status = q.get('status') || ''
  const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50))
  const offset = Math.max(0, Number(q.get('offset')) || 0)
  const where = status ? 'WHERE status = $3' : ''
  const params: unknown[] = [limit, offset]
  if (status) { if (!(STATUSES as readonly string[]).includes(status)) throw new HttpError(400, 'Bad status filter.'); params.push(status) }
  const rows = (await db.query<InquiryRow>(`SELECT ${INQUIRY_COLS} FROM inquiries ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`, params)).rows
  const total = Number((await db.query<{ n: string | number }>(`SELECT count(*) AS n FROM inquiries ${status ? 'WHERE status = $1' : ''}`, status ? [status] : [])).rows[0]?.n || 0)
  const ids = rows.map((r) => r.id)
  const photoRows = ids.length ? (await db.query<{ id: string; inquiry_id: string; filename: string; mime: string; width: number; height: number; size: number }>('SELECT id, inquiry_id, filename, mime, width, height, size FROM photos WHERE inquiry_id = ANY($1::uuid[]) ORDER BY created_at', [ids])).rows : []
  const emailRows = ids.length ? (await db.query<{ inquiry_id: string; status: string }>('SELECT inquiry_id, status FROM email_deliveries WHERE inquiry_id = ANY($1::uuid[])', [ids])).rows : []
  const items = rows.map((r) => { const ph = photoRows.filter((p) => p.inquiry_id === r.id); const a = assessInquiry(r, ph.length); return { ...present(r, ph), email_status: emailRows.find((e) => e.inquiry_id === r.id)?.status || null, readiness: a.readiness, gap_count: a.gaps.length, insurance: a.insurance } })
  sendJson(res, 200, { ok: true, total, items })
})
