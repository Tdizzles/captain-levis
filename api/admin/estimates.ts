// /api/admin/estimates  (staff cookie or bearer)
//   GET    ?status=&inquiry=&limit=     list (newest first; no document bodies)
//   GET    ?id=<uuid>                    one: {estimate, totals, layout, versions, business}
//   GET    ?id=<uuid>&version=N          a past version's document (read-only)
//   POST   {inquiry_id?}                 create a draft (pre-filled from the inquiry when given)
//   PUT    ?id=<uuid>  {estimate}        save the whole document (normalized; previous kept as a version)
//   POST   ?id=<uuid>&restore=N          restore a version (saved as a new version)
//   DELETE ?id=<uuid>
import { audit } from '../../lib/audit.js'
import { requireAdmin } from '../../lib/admin.js'
import { business } from '../../lib/business.js'
import { getDb } from '../../lib/db.js'
import { HttpError, query, readJson, requireMethod, route, sendJson } from '../../lib/http.js'
import { getInquiry } from '../../lib/inquiries.js'
import { blankDraft, createEstimate, deleteEstimate, draftFromInquiry, getEstimate, getVersionDoc, inquiryPhotosFor, listEstimates, listVersions, present, presentDoc, saveEstimate } from '../../lib/estimates/store.js'
import { isUuid } from '../../lib/session.js'

export function printBusiness() {
  const b = business()
  return { name: b.name, legalName: b.legalName, phone: b.phone, email: b.email, website: b.siteUrl.replace(/^https?:\/\//, ''), address: { street: b.address.street, city: b.address.city, state: b.address.state, zip: b.address.zip }, payableTo: b.legalName }
}

export default route(async (req, res) => {
  requireMethod(req, 'GET', 'POST', 'PUT', 'DELETE')
  const actor = requireAdmin(req)
  const db = await getDb()
  const q = query(req)
  const id = q.get('id') || ''
  if (id && !isUuid(id)) throw new HttpError(400, 'id must be a uuid.')

  if (req.method === 'GET') {
    if (!id) {
      const inquiry = q.get('inquiry') || ''
      if (inquiry && !isUuid(inquiry)) throw new HttpError(400, 'inquiry must be a uuid.')
      const items = await listEstimates(db, { status: q.get('status') || undefined, inquiryId: inquiry || undefined, limit: Number(q.get('limit')) || 100 })
      sendJson(res, 200, { ok: true, items })
      return
    }
    const row = await getEstimate(db, id)
    if (!row) throw new HttpError(404, 'Not found.')
    const version = q.get('version')
    if (version) {
      const doc = await getVersionDoc(db, id, Number(version))
      if (!doc) throw new HttpError(404, 'Version not found.')
      sendJson(res, 200, { ok: true, version: Number(version), estimate: presentDoc(doc) })
      return
    }
    sendJson(res, 200, { ok: true, ...present(row), versions: await listVersions(db, id), business: printBusiness() })
    return
  }

  if (req.method === 'POST' && id) {
    const restore = Number(q.get('restore'))
    if (!restore) throw new HttpError(400, 'Nothing to do (restore=N expected).')
    const doc = await getVersionDoc(db, id, restore)
    if (!doc) throw new HttpError(404, 'Version not found.')
    const row = await saveEstimate(db, id, doc, { actor: actor.label, reason: `restored version ${restore}` })
    if (!row) throw new HttpError(404, 'Not found.')
    await audit(db, actor.label, 'estimate.restore', 'estimate', id, { version: restore })
    sendJson(res, 200, { ok: true, ...present(row), versions: await listVersions(db, id) })
    return
  }

  if (req.method === 'POST') {
    const body = (await readJson(req)) as { inquiry_id?: unknown }
    const inquiryId = typeof body?.inquiry_id === 'string' ? body.inquiry_id : ''
    let doc = blankDraft()
    if (inquiryId) {
      if (!isUuid(inquiryId)) throw new HttpError(400, 'inquiry_id must be a uuid.')
      const inquiry = await getInquiry(db, inquiryId)
      if (!inquiry) throw new HttpError(404, 'Inquiry not found.')
      doc = draftFromInquiry(inquiry, await inquiryPhotosFor(db, inquiryId))
    }
    const row = await createEstimate(db, doc, { inquiryId: inquiryId || null, actor: actor.label })
    if (inquiryId) await db.query(`UPDATE inquiries SET status = 'quoted', updated_at = now() WHERE id = $1 AND status IN ('new','contacted')`, [inquiryId])
    await audit(db, actor.label, 'estimate.create', 'estimate', row.id, { number: row.number, inquiry: inquiryId || null })
    sendJson(res, 201, { ok: true, ...present(row), versions: await listVersions(db, row.id), business: printBusiness() })
    return
  }

  if (req.method === 'PUT') {
    if (!id) throw new HttpError(400, 'id required.')
    const body = (await readJson(req, 2 * 1024 * 1024)) as { estimate?: unknown; reason?: unknown }
    if (!body || typeof body.estimate !== 'object' || !body.estimate) throw new HttpError(400, 'Body must be {estimate}.')
    const row = await saveEstimate(db, id, body.estimate, { actor: actor.label, reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : 'edited' })
    if (!row) throw new HttpError(404, 'Not found.')
    sendJson(res, 200, { ok: true, ...present(row) })
    return
  }

  // DELETE
  if (!id) throw new HttpError(400, 'id required.')
  const ok = await deleteEstimate(db, id)
  if (!ok) throw new HttpError(404, 'Not found.')
  await audit(db, actor.label, 'estimate.delete', 'estimate', id)
  sendJson(res, 200, { ok: true })
})
