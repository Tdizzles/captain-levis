// Staff sign-in for the quote backend (/app): email + shared password, no third party.
//   STAFF_EMAILS          comma-separated allow-list (defaults to the owner addresses in business facts)
//   STAFF_PASSWORD_HASH   scrypt hash produced by `node scripts/hash-password.mjs` (never the password itself)
// A successful login sets cl_staff=<base64url email>.<exp>.<hmac> (HttpOnly, SameSite=Lax, Secure in production, 12 h).
// /api/admin/* accepts either this cookie or the legacy ADMIN_API_TOKEN bearer (lib/admin.ts).
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { business } from './business.js'
import { effectiveSecret, env } from './env.js'
import { cookies, HttpError, type Req, type Res } from './http.js'

export const STAFF_COOKIE = 'cl_staff'
export const STAFF_SESSION_SECONDS = 12 * 60 * 60
const SCRYPT_N = 16384, SCRYPT_R = 8, SCRYPT_P = 1, KEYLEN = 32

export function staffEmails(): string[] {
  const raw = process.env.STAFF_EMAILS || ''
  const list = raw.split(/[,\s;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  if (list.length) return list
  return ['tyler.salta@icloud.com', business().email.toLowerCase()].filter((v, i, a) => a.indexOf(v) === i)
}

export function staffLoginConfigured(): boolean {
  return !!process.env.STAFF_PASSWORD_HASH && /^scrypt\$/.test(process.env.STAFF_PASSWORD_HASH)
}

/** scrypt$N$r$p$salt$hash (base64url). Deterministic given the salt; a fresh salt every time it is called. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password.normalize('NFKC'), salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

export function verifyPassword(password: string, stored: string | undefined): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  try {
    const expected = Buffer.from(hashB64, 'base64url')
    const got = scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
    return got.length === expected.length && timingSafeEqual(got, expected)
  } catch { return false }
}

function sign(email: string, exp: number): string {
  return createHmac('sha256', effectiveSecret().secret).update(`staff:${email}:${exp}`).digest('base64url').slice(0, 32)
}

export function makeStaffToken(email: string, now = Date.now()): { value: string; exp: number } {
  const exp = Math.floor(now / 1000) + STAFF_SESSION_SECONDS
  return { value: `${Buffer.from(email, 'utf8').toString('base64url')}.${exp}.${sign(email, exp)}`, exp }
}

export interface StaffIdentity { email: string; exp: number }

export function verifyStaffToken(value: string | undefined, now = Date.now()): StaffIdentity | null {
  if (!value) return null
  const parts = value.split('.')
  if (parts.length !== 3) return null
  let email = ''
  try { email = Buffer.from(parts[0], 'base64url').toString('utf8').toLowerCase() } catch { return null }
  if (!email.includes('@')) return null
  const exp = Number(parts[1])
  if (!Number.isFinite(exp) || exp * 1000 < now) return null
  if (!staffEmails().includes(email)) return null // revoked by removing from the allow-list
  const expected = sign(email, exp)
  if (parts[2].length !== expected.length || !timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expected))) return null
  return { email, exp }
}

function appendCookie(res: Res, cookie: string): void {
  const prev = res.getHeader('Set-Cookie')
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : []
  res.setHeader('Set-Cookie', [...list, cookie])
}

export function setStaffCookie(res: Res, email: string): StaffIdentity {
  const { value, exp } = makeStaffToken(email)
  const parts = [`${STAFF_COOKIE}=${value}`, 'Path=/', `Max-Age=${STAFF_SESSION_SECONDS}`, 'HttpOnly', 'SameSite=Lax']
  if (env.isProduction) parts.push('Secure')
  appendCookie(res, parts.join('; '))
  return { email, exp }
}

export function clearStaffCookie(res: Res): void {
  appendCookie(res, `${STAFF_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${env.isProduction ? '; Secure' : ''}`)
}

export function staffFromRequest(req: Req): StaffIdentity | null {
  return verifyStaffToken(cookies(req)[STAFF_COOKIE])
}

/** Validates a login attempt; throws 401 with a single generic message so emails cannot be enumerated. */
export function checkLogin(email: unknown, password: unknown): string {
  if (!staffLoginConfigured()) throw new HttpError(503, 'Staff sign-in is not set up yet (STAFF_PASSWORD_HASH unset).')
  const e = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const p = typeof password === 'string' ? password : ''
  const known = staffEmails().includes(e)
  const ok = verifyPassword(p, process.env.STAFF_PASSWORD_HASH) // always run, constant-ish time
  if (!known || !ok) throw new HttpError(401, 'That email and password do not match.')
  return e
}
