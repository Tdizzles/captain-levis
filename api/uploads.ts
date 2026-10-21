// POST /api/uploads — multipart {sessionId, photos[]} → {ok, files:[{id, name, size, width, height}]}
// Photos are validated (magic bytes), re-encoded (≤1600px, metadata stripped) and stored against the session.
import { getDb } from '../lib/db.js'
import { env } from '../lib/env.js'
import { HttpError, requireMethod, route, sendJson } from '../lib/http.js'
import { ImageRejectedError, processImage } from '../lib/images.js'
import { parseMultipart } from '../lib/multipart.js'
import { sessionPhotoUsage, storePhoto } from '../lib/photos.js'
import { enforce, RULES } from '../lib/ratelimit.js'
import { resolveSession } from '../lib/session.js'
import { loadOrCreateSession } from '../lib/chat/store.js'

const SESSION_MAX_BYTES = 30 * 1024 * 1024

export default route(async (req, res) => {
  requireMethod(req, 'POST')
  const db = await getDb()
  // the session id arrives inside the multipart body; resolve the cookie first, then reconcile below
  const form = await parseMultipart(req, { maxFiles: env.maxPhotos, maxFileBytes: env.maxPhotoBytes, maxTotalBytes: env.maxRequestBytes })
  const session = resolveSession(req, res, form.fields.sessionId)
  await enforce(db, RULES.uploadSession, session.id, 'Too many uploads for this conversation. Please wait an hour or use the quote form.')
  await loadOrCreateSession(db, session.id, null)

  const rejected = form.rejected.map((r) => r.reason === 'file_too_large' ? `${r.filename}: larger than ${Math.round(env.maxPhotoBytes / 1024 / 1024)} MB`
    : r.reason === 'too_many_files' ? `${r.filename}: maximum ${env.maxPhotos} photos` : `${r.filename}: total upload too large`)
  if (form.rejected.length && !form.files.length) throw new HttpError(form.rejected.some((r) => r.reason !== 'too_many_files') ? 413 : 400, rejected.join(' · '))

  const usage = await sessionPhotoUsage(db, session.id)
  if (usage.count >= env.maxPhotos) throw new HttpError(400, `This conversation already has ${env.maxPhotos} photos. Attach more on the quote form if you need to.`)

  const files: { id: string; name: string; size: number; width: number; height: number }[] = []
  const errors: string[] = [...rejected]
  let count = usage.count
  let bytes = usage.bytes
  for (const f of form.files.filter((x) => x.field === 'photos' || x.field === 'photo' || x.field === 'file')) {
    if (count >= env.maxPhotos) { errors.push(`${f.filename}: maximum ${env.maxPhotos} photos per conversation`); continue }
    try {
      const img = await processImage(f.buffer, f.mime)
      if (bytes + img.buffer.length > SESSION_MAX_BYTES) { errors.push(`${f.filename}: this conversation's photo limit (30 MB) is full`); continue }
      const row = await storePhoto(db, img, { chatSessionId: session.id })
      files.push({ id: row.id, name: f.filename, size: row.size, width: row.width, height: row.height })
      count++; bytes += img.buffer.length
    } catch (e) {
      if (e instanceof ImageRejectedError) errors.push(`${f.filename}: ${e.message}`)
      else throw e
    }
  }
  if (!files.length) throw new HttpError(400, errors.length ? errors.join(' · ') : 'No photos were included.')
  sendJson(res, 200, { ok: true, sessionId: session.id, files, ...(errors.length ? { warnings: errors } : {}) })
})
