// GET/PATCH /api/admin/inquiries/<id> — Vercel puts the path segment on req.query.id; the shared handler reads it.
import handler from '../inquiries.js'
export default handler
