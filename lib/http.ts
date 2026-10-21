// Runtime-agnostic request/response helpers. Handlers use only IncomingMessage/ServerResponse
// methods plus the Vercel conveniences when present (req.body / req.query / req.cookies), so the
// same code runs under Vercel's Node runtime and under scripts/dev-server.mjs.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { DbNotConfiguredError } from './db.js'

export type Req = IncomingMessage & { query?: Record<string, string | string[]>; cookies?: Record<string, string>; body?: unknown }
export type Res = ServerResponse
export type Handler = (req: Req, res: Res) => Promise<void> | void

export class HttpError extends Error {
  status: number
  body: Record<string, unknown>
  headers: Record<string, string>
  constructor(status: number, message: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.body = { ok: false, error: message, ...extra }
    this.headers = headers
  }
}

export function sendJson(res: Res, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

export function sendEmpty(res: Res, status: number, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  res.statusCode = status
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end()
}

export function query(req: Req): URLSearchParams {
  const url = new URL(req.url || '/', 'http://localhost')
  const sp = url.searchParams
  // Vercel dynamic-route params (api/x/[id].ts) only live on req.query
  if (req.query) for (const [k, v] of Object.entries(req.query)) if (!sp.has(k)) sp.set(k, Array.isArray(v) ? v[0] : v)
  return sp
}

export function cookies(req: Req): Record<string, string> {
  if (req.cookies) return req.cookies
  const out: Record<string, string> = {}
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export function header(req: Req, name: string): string {
  const v = req.headers[name.toLowerCase()]
  return Array.isArray(v) ? v[0] || '' : v || ''
}

export function contentType(req: Req): string {
  return header(req, 'content-type').split(';')[0].trim().toLowerCase()
}

/** Reads the raw body up to `limit` bytes. Honors a Vercel-prepared Buffer body if present. */
export function readRawBody(req: Req, limit: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    return req.body.length > limit ? Promise.reject(new HttpError(413, 'Request too large.')) : Promise.resolve(req.body)
  }
  const declared = Number(header(req, 'content-length'))
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(new HttpError(413, 'Request too large.'))
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) { reject(new HttpError(413, 'Request too large.')); req.resume(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function readJson(req: Req, limit = 64 * 1024): Promise<unknown> {
  if (req.body !== undefined && !Buffer.isBuffer(req.body)) {
    try {
      const b = req.body
      if (typeof b === 'string') return b ? JSON.parse(b) : {}
      return b
    } catch { throw new HttpError(400, 'Invalid JSON body.') }
  }
  const raw = await readRawBody(req, limit)
  const text = raw.toString('utf8')
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { throw new HttpError(400, 'Invalid JSON body.') }
}

export function requireMethod(req: Req, ...methods: string[]): void {
  if (!methods.includes((req.method || 'GET').toUpperCase())) throw new HttpError(405, 'Method not allowed.', {}, { Allow: methods.join(', ') })
}

/** Wraps a handler: method errors, HttpError → JSON, unexpected errors → 500 without leaking details. */
export function route(handler: Handler): Handler {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      if (err instanceof HttpError) { sendJson(res, err.status, err.body, err.headers); return }
      if (err instanceof DbNotConfiguredError) {
        sendJson(res, 503, { ok: false, error: 'Our server is not fully set up yet, so nothing was saved. Please call us instead.' })
        return
      }
      console.error('[api] unhandled error', (req.method || '') + ' ' + (req.url || ''), err)
      sendJson(res, 500, { ok: false, error: 'Something went wrong on our end. Please try again or call us.' })
    }
  }
}
