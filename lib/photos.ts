// Photo storage (bytea in Postgres) and HMAC-signed, time-limited read URLs served by /api/photo.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Queryable } from './db.js'
import { effectiveSecret } from './env.js'
import { sha256 } from './ip.js'
import { siteUrl } from './business.js'
import type { ProcessedImage } from './images.js'

export interface PhotoRow {
  id: string; inquiry_id: string | null; chat_session_id: string | null; filename: string; mime: string
  width: number; height: number; size: number; sha256: string; created_at: Date | string
}

export async function storePhoto(db: Queryable, img: ProcessedImage, owner: { inquiryId?: string | null; chatSessionId?: string | null }): Promise<PhotoRow> {
  const r = await db.query<PhotoRow>(
    `INSERT INTO photos (inquiry_id, chat_session_id, filename, mime, bytes, width, height, size, sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, inquiry_id, chat_session_id, filename, mime, width, height, size, sha256, created_at`,
    [owner.inquiryId ?? null, owner.chatSessionId ?? null, img.filename, img.mime, img.buffer, img.width, img.height, img.buffer.length, sha256(img.buffer)],
  )
  return r.rows[0]
}

export async function photoBytes(db: Queryable, id: string): Promise<{ mime: string; bytes: Buffer; filename: string } | null> {
  const r = await db.query<{ mime: string; bytes: Uint8Array; filename: string }>('SELECT mime, bytes, filename FROM photos WHERE id = $1', [id])
  const row = r.rows[0]
  if (!row) return null
  return { mime: row.mime, bytes: Buffer.from(row.bytes), filename: row.filename }
}

export async function listPhotos(db: Queryable, where: { inquiryId?: string; chatSessionId?: string }): Promise<PhotoRow[]> {
  const cols = 'id, inquiry_id, chat_session_id, filename, mime, width, height, size, sha256, created_at'
  if (where.inquiryId) return (await db.query<PhotoRow>(`SELECT ${cols} FROM photos WHERE inquiry_id = $1 ORDER BY created_at`, [where.inquiryId])).rows
  if (where.chatSessionId) return (await db.query<PhotoRow>(`SELECT ${cols} FROM photos WHERE chat_session_id = $1 ORDER BY created_at`, [where.chatSessionId])).rows
  return []
}

/** Session quota: count + bytes of photos uploaded through chat for this session (linked or not). */
export async function sessionPhotoUsage(db: Queryable, chatSessionId: string): Promise<{ count: number; bytes: number }> {
  const r = await db.query<{ count: string | number; bytes: string | number | null }>('SELECT count(*) AS count, coalesce(sum(size), 0) AS bytes FROM photos WHERE chat_session_id = $1', [chatSessionId])
  return { count: Number(r.rows[0]?.count || 0), bytes: Number(r.rows[0]?.bytes || 0) }
}

function sig(id: string, exp: number): string {
  return createHmac('sha256', effectiveSecret().secret).update(`photo:${id}:${exp}`).digest('base64url').slice(0, 32)
}

export function signPhotoUrl(id: string, ttlSeconds = 7 * 24 * 3600, base = siteUrl()): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds
  return `${base}/api/photo?id=${encodeURIComponent(id)}&exp=${exp}&sig=${sig(id, exp)}`
}

export function verifyPhotoSig(id: string, exp: string | number, signature: string, now = Date.now()): boolean {
  const e = Number(exp)
  if (!Number.isFinite(e) || e * 1000 < now) return false
  const expected = sig(id, e)
  if (!signature || signature.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
