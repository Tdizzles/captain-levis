// GET /api/photo?id=&exp=&sig= → the image when the HMAC is valid and not expired; 404 otherwise.
import { getDb } from '../lib/db.js'
import { query, requireMethod, route, sendEmpty } from '../lib/http.js'
import { photoBytes, verifyPhotoSig } from '../lib/photos.js'
import { isUuid } from '../lib/session.js'

export default route(async (req, res) => {
  requireMethod(req, 'GET', 'HEAD')
  const q = query(req)
  const id = q.get('id') || ''
  const exp = q.get('exp') || ''
  const sig = q.get('sig') || ''
  if (!isUuid(id) || !verifyPhotoSig(id, exp, sig)) { sendEmpty(res, 404); return }
  const db = await getDb()
  const photo = await photoBytes(db, id)
  if (!photo) { sendEmpty(res, 404); return }
  res.statusCode = 200
  res.setHeader('Content-Type', photo.mime)
  res.setHeader('Content-Length', String(photo.bytes.length))
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('Content-Disposition', `inline; filename="${photo.filename}"`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.method === 'HEAD') { res.end(); return }
  res.end(photo.bytes)
})
