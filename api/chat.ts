// POST /api/chat — Captain Levi. Body {sessionId, message, page, pageTitle, context, photoIds?, note?}
// → {sessionId, reply, chips, links?, card?, draft?, navigate?, event?, done?}
import { z } from 'zod'
import { getDb } from '../lib/db.js'
import { header, HttpError, readJson, requireMethod, route, sendJson } from '../lib/http.js'
import { ipHash } from '../lib/ip.js'
import { enforce, RULES } from '../lib/ratelimit.js'
import { resolveSession } from '../lib/session.js'
import { runTurn } from '../lib/chat/machine.js'
import { loadOrCreateSession, saveSession } from '../lib/chat/store.js'
import { START_CHIPS } from '../lib/chat/script.js'

const bodySchema = z.object({
  sessionId: z.string().max(64).optional(),
  message: z.string().max(1000).optional().default(''),
  page: z.string().max(80).optional().default('index'),
  pageTitle: z.string().max(200).optional().default(''),
  context: z.string().max(600).optional().default(''),
  photoIds: z.array(z.string().uuid()).max(5).optional(),
  note: z.string().max(200).optional(),
})

export default route(async (req, res) => {
  requireMethod(req, 'POST')
  const parsed = bodySchema.safeParse(await readJson(req, 32 * 1024))
  if (!parsed.success) throw new HttpError(400, 'Invalid chat request.')
  const body = parsed.data
  const session = resolveSession(req, res, body.sessionId)
  const db = await getDb()
  const ip = ipHash(req)
  await enforce(db, RULES.chatSession, session.id, 'Easy there, too many messages at once. Give it a minute and try again.')
  await enforce(db, RULES.chatIp, ip, 'Too many messages from this connection. Please wait a while or call us.')

  const page = body.page.replace(/[^a-z0-9-]/gi, '').slice(0, 80) || 'index'
  const s = await loadOrCreateSession(db, session.id, page)

  let photoCount = 0
  if (body.photoIds?.length) {
    const r = await db.query<{ n: string | number }>('SELECT count(*) AS n FROM photos WHERE chat_session_id = $1 AND id = ANY($2::uuid[])', [session.id, body.photoIds])
    photoCount = Number(r.rows[0]?.n || 0)
    if (!photoCount && !body.message) {
      sendJson(res, 200, { sessionId: session.id, reply: 'Those photos are not attached to this conversation, so I could not add them. Try uploading again, or attach them on the quote form.', chips: START_CHIPS })
      return
    }
  }

  const out = await runTurn(db, s, {
    message: body.message, page, pageTitle: body.pageTitle, context: body.context, photoCount, note: body.note,
    ipHash: ip, userAgent: header(req, 'user-agent'),
  })
  await saveSession(db, s, { cost: out.cost, tokensIn: out.tokensIn, tokensOut: out.tokensOut, page })
  sendJson(res, 200, { sessionId: session.id, ...out.response })
})
