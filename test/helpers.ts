// Shared test harness: in-memory PGlite, the real node adapter on a random port, fetch helpers with a cookie jar.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'pglite://memory'
process.env.VERCEL_ENV = 'development'
process.env.AUTO_MIGRATE = 'true'
delete process.env.ANTHROPIC_API_KEY
delete process.env.RESEND_API_KEY
delete process.env.TURNSTILE_SECRET_KEY
delete process.env.SESSION_SECRET
delete process.env.ADMIN_API_TOKEN
delete process.env.ALLOW_UNVERIFIED_FORMS

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export interface TestServer { url: string; close: () => Promise<void> }

export async function startServer(): Promise<TestServer> {
  const { resetDbForTests, getDb } = await import('../lib/db.js')
  await resetDbForTests()
  await getDb()
  const { createSiteServer, listen } = await import('../lib/node-adapter.js')
  const server = createSiteServer({ root: ROOT })
  const l = await listen(server, 0)
  process.env.SITE_URL = l.url
  return { url: l.url, close: l.close }
}

export async function db() {
  const { getDb } = await import('../lib/db.js')
  return getDb()
}

export class Jar {
  cookies = new Map<string, string>()
  absorb(res: Response) {
    const list = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() || []
    for (const c of list) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies.set(kv.slice(0, i), kv.slice(i + 1)) }
  }
  header(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
}

export async function postJson(url: string, body: unknown, opts: { jar?: Jar; headers?: Record<string, string> } = {}): Promise<{ status: number; json: any; res: Response }> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(opts.jar ? { cookie: opts.jar.header() } : {}), ...(opts.headers || {}) }, body: JSON.stringify(body) })
  opts.jar?.absorb(res)
  let json: any = null
  try { json = await res.json() } catch { /* empty */ }
  return { status: res.status, json, res }
}

export interface FilePart { field: string; filename: string; type: string; data: Buffer }

export async function postMultipart(url: string, fields: Record<string, string>, files: FilePart[] = [], opts: { jar?: Jar; headers?: Record<string, string> } = {}): Promise<{ status: number; json: any; res: Response }> {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.append(k, v)
  for (const f of files) fd.append(f.field, new Blob([new Uint8Array(f.data)], { type: f.type }), f.filename)
  const res = await fetch(url, { method: 'POST', body: fd, headers: { ...(opts.jar ? { cookie: opts.jar.header() } : {}), ...(opts.headers || {}) } })
  opts.jar?.absorb(res)
  let json: any = null
  try { json = await res.json() } catch { /* empty */ }
  return { status: res.status, json, res }
}

export async function makeJpeg(width = 640, height = 480, withExif = false): Promise<Buffer> {
  let p = sharp({ create: { width, height, channels: 3, background: { r: 0, g: 38, b: 75 } } }).jpeg({ quality: 80 })
  if (withExif) p = p.withMetadata({ exif: { IFD0: { Copyright: 'metadata-should-be-stripped', ImageDescription: 'secret location' } } })
  return p.toBuffer()
}

export const validInquiry = (over: Record<string, string> = {}) => ({
  name: 'Tyler Tester', email: 'tyler@example.com', phone: '727-555-0100', service: 'transom-replacement',
  boat: '2004 Boston Whaler Outrage 24', boat_location: 'On a trailer in Largo', message: 'The transom feels soft near the drain plug and the motor flexes when trimmed.',
  company: '', idempotency_key: crypto.randomUUID(), page: 'index', kind: 'quote', turnstile_token: '', chat_session: '', ...over,
})

export const chatMsg = (message: string, page = 'index', extra: Record<string, unknown> = {}) => ({ sessionId: 'client-side-id', message, page, pageTitle: 'Test page', context: '', ...extra })
