// POST /api/inquiries — the quote form. multipart fields: name, email, phone, service, boat, boat_location, message,
// company (honeypot), idempotency_key, page, kind, turnstile_token, chat_session, photos[]
// → 200 {ok:true, ref} | 400 {ok:false, error, fields} | 429 | 503
// Flow: rate-limit → honeypot → validate → Turnstile → idempotency/duplicate → store (+photos, +chat photos) → email → audit.
import { audit } from '../lib/audit.js'
import { getDb } from '../lib/db.js'
import { env } from '../lib/env.js'
import { enqueueAndSendInquiryEmail } from '../lib/email/send.js'
import { header, HttpError, requireMethod, route, sendJson } from '../lib/http.js'
import { ImageRejectedError, processImage } from '../lib/images.js'
import { createInquiry, findByIdempotencyKey, findRecentDuplicate, inquiryInput } from '../lib/inquiries.js'
import { clientIp, ipHash } from '../lib/ip.js'
import { parseMultipart } from '../lib/multipart.js'
import { storePhoto } from '../lib/photos.js'
import { enforce, RULES } from '../lib/ratelimit.js'
import { isUuid, verifySessionCookie, SESSION_COOKIE } from '../lib/session.js'
import { cookies } from '../lib/http.js'
import { verifyTurnstile } from '../lib/turnstile.js'

export default route(async (req, res) => {
  requireMethod(req, 'POST')
  const db = await getDb()
  const ip = ipHash(req)
  await enforce(db, RULES.inquiryIp, ip, 'Too many requests from this connection. Please wait a while and try again, or call us.')

  const form = await parseMultipart(req, { maxFiles: env.maxPhotos, maxFileBytes: env.maxPhotoBytes, maxTotalBytes: env.maxRequestBytes })
  const f = form.fields

  // honeypot: real visitors never see or fill this field
  if ((f.company || '').trim()) throw new HttpError(400, 'Your submission could not be accepted.')

  const parsed = inquiryInput.safeParse({
    name: f.name, email: f.email, phone: f.phone, service: f.service, boat: f.boat, boat_location: f.boat_location,
    message: f.message, page: f.page, kind: f.kind, idempotency_key: f.idempotency_key,
  })
  if (!parsed.success) {
    const fields: Record<string, string> = {}
    for (const issue of parsed.error.issues) { const k = String(issue.path[0] || ''); if (k && !fields[k]) fields[k] = issue.message }
    throw new HttpError(400, 'Please fix the highlighted fields.', { fields })
  }
  const input = parsed.data

  // photo size rejections are reported before the CAPTCHA so the visitor can fix them without a new token
  const oversized = form.rejected.filter((r) => r.reason !== 'too_many_files')
  if (oversized.length) throw new HttpError(413, `Those photos are too large (${oversized.map((r) => r.filename).join(', ')}). Please remove some and try again.`)

  await verifyTurnstile((f.turnstile_token || '').trim(), clientIp(req))

  // idempotent resubmit (same form render) → same ref, no second email
  const existing = await findByIdempotencyKey(db, input.idempotency_key)
  if (existing) { sendJson(res, 200, { ok: true, ref: existing.ref, duplicate: true }); return }
  const dupe = await findRecentDuplicate(db, input.email, input.message)
  if (dupe) { sendJson(res, 200, { ok: true, ref: dupe.ref, duplicate: true }); return }

  // the chat session is only trusted when it matches this browser's cookie
  const cookieSession = verifySessionCookie(cookies(req)[SESSION_COOKIE])
  const chatSession = isUuid(f.chat_session) && cookieSession === f.chat_session.toLowerCase() ? cookieSession : null

  // validate every photo before anything is written, so a bad file never leaves a half-stored inquiry
  const images = []
  const photoErrors: string[] = []
  for (const file of form.files.filter((x) => x.field === 'photos')) {
    try { images.push(await processImage(file.buffer, file.mime)) }
    catch (e) { if (e instanceof ImageRejectedError) photoErrors.push(`${file.filename}: ${e.message}`); else throw e }
  }
  if (photoErrors.length) throw new HttpError(400, photoErrors.join(' · '), { fields: { photos: photoErrors[0] } })
  if (form.rejected.some((r) => r.reason === 'too_many_files')) throw new HttpError(400, `Please attach at most ${env.maxPhotos} photos.`, { fields: { photos: `maximum ${env.maxPhotos}` } })

  const inquiry = await createInquiry(db, { input, source: 'form', chatSessionId: chatSession, ipHash: ip, userAgent: header(req, 'user-agent') })
  for (const img of images) await storePhoto(db, img, { inquiryId: inquiry.id })
  await audit(db, 'visitor', 'inquiry.create', 'inquiry', inquiry.id, { ref: inquiry.ref, source: 'form', photos: images.length, chatSession: !!chatSession, page: input.page })

  const email = await enqueueAndSendInquiryEmail(db, inquiry)
  if (!email.sent) await audit(db, 'system', 'email.' + email.delivery.status, 'email_delivery', email.delivery.id, { reason: email.reason || null, inquiry: inquiry.id })

  sendJson(res, 200, { ok: true, ref: inquiry.ref })
})
