// Adapts plain node http requests to the Vercel handler signature and serves the static site with clean URLs.
// Used by scripts/dev-server.mjs and by the tests (which start the same server on a random port).
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Handler, Req, Res } from './http.js'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.gif': 'image/gif', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.map': 'application/json',
}

export interface AdapterOptions { root: string; apiDir?: string; log?: boolean }

interface Match { file: string; params: Record<string, string> }

/** Resolve /api/foo/bar → api/foo/bar.ts, api/foo/[id].ts, or api/foo/bar/index.ts, Vercel-style. */
export function resolveApiFile(apiDir: string, pathname: string): Match | null {
  const segs = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  if (segs.some((s) => s === '..' || s.includes('\\'))) return null
  const walk = (dir: string, i: number, params: Record<string, string>): Match | null => {
    if (i === segs.length) {
      const idx = path.join(dir, 'index.ts')
      return fs.existsSync(idx) ? { file: idx, params } : null
    }
    const seg = segs[i]
    const last = i === segs.length - 1
    if (last) {
      const exact = path.join(dir, `${seg}.ts`)
      if (fs.existsSync(exact)) return { file: exact, params }
    }
    const sub = path.join(dir, seg)
    if (fs.existsSync(sub) && fs.statSync(sub).isDirectory()) { const m = walk(sub, i + 1, params); if (m) return m }
    let entries: string[] = []
    try { entries = fs.readdirSync(dir) } catch { return null }
    for (const e of entries) {
      const dm = e.match(/^\[(\w+)\](\.ts)?$/)
      if (!dm) continue
      const p = { ...params, [dm[1]]: decodeURIComponent(seg) }
      if (dm[2] && last) return { file: path.join(dir, e), params: p }
      if (!dm[2]) { const m = walk(path.join(dir, e), i + 1, p); if (m) return m }
    }
    return null
  }
  return walk(apiDir, 0, {})
}

const handlerCache = new Map<string, Promise<Handler>>()
async function loadHandler(file: string): Promise<Handler> {
  let p = handlerCache.get(file)
  if (!p) {
    p = import(pathToFileURL(file).href).then((m) => (m.default || m.handler) as Handler)
    handlerCache.set(file, p)
  }
  return p
}

function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (h || '').split(';')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()) }
  return out
}

function readBody(req: http.IncomingMessage, limit = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0
    req.on('data', (c: Buffer) => { size += c.length; if (size <= limit) chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** Add Vercel's req.query / req.cookies / req.body and res.status/json/send conveniences. */
async function decorate(req: http.IncomingMessage, res: http.ServerResponse, params: Record<string, string>): Promise<void> {
  const r = req as Req
  const url = new URL(req.url || '/', 'http://localhost')
  const q: Record<string, string | string[]> = { ...params }
  url.searchParams.forEach((v, k) => { const cur = q[k]; q[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v] })
  r.query = q
  r.cookies = parseCookies(req.headers.cookie)
  const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  if (ct === 'application/json' || ct === 'text/plain' || ct === 'application/x-www-form-urlencoded') {
    const raw = await readBody(req)
    const text = raw.toString('utf8')
    if (ct === 'application/json') { try { r.body = text ? JSON.parse(text) : {} } catch { r.body = undefined } }
    else if (ct === 'application/x-www-form-urlencoded') r.body = Object.fromEntries(new URLSearchParams(text))
    else r.body = text
  }
  const v = res as http.ServerResponse & { status?: (n: number) => typeof v; json?: (b: unknown) => typeof v; send?: (b: unknown) => typeof v }
  v.status = (n: number) => { res.statusCode = n; return v }
  v.json = (b: unknown) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(b)); return v }
  v.send = (b: unknown) => { if (Buffer.isBuffer(b)) res.end(b); else if (typeof b === 'object') v.json!(b); else res.end(String(b)); return v }
}

function serveStatic(root: string, pathname: string, res: http.ServerResponse): boolean {
  let rel = decodeURIComponent(pathname)
  if (rel.includes('..')) return false
  if (rel.endsWith('/')) rel += 'index.html'
  const candidates = [rel, `${rel}.html`, path.posix.join(rel, 'index.html')]
  for (const c of candidates) {
    const abs = path.join(root, c)
    if (!abs.startsWith(root)) continue
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const ext = path.extname(abs).toLowerCase()
      res.statusCode = 200
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
      res.setHeader('Cache-Control', 'no-cache')
      fs.createReadStream(abs).pipe(res)
      return true
    }
  }
  return false
}

export function createSiteServer(opts: AdapterOptions): http.Server {
  const root = path.resolve(opts.root)
  const apiDir = path.resolve(opts.apiDir || path.join(root, 'api'))
  return http.createServer(async (req, res) => {
    const started = Date.now()
    const url = new URL(req.url || '/', 'http://localhost')
    const pathname = url.pathname
    const done = () => { if (opts.log) console.log(`${req.method} ${pathname} → ${res.statusCode} (${Date.now() - started} ms)`) }
    res.on('finish', done)
    try {
      if (pathname === '/api' || pathname.startsWith('/api/')) {
        const match = resolveApiFile(apiDir, pathname)
        if (!match) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'Not found' })); return }
        const handler = await loadHandler(match.file)
        await decorate(req, res, match.params)
        await handler(req as Req, res as Res)
        if (!res.writableEnded && !res.headersSent) { res.statusCode = 204; res.end() }
        return
      }
      // clean URLs like Vercel: /x.html → /x
      if (/\.html$/.test(pathname) && pathname !== '/index.html') { res.statusCode = 308; res.setHeader('Location', pathname.replace(/\.html$/, '') + url.search); res.end(); return }
      if (pathname === '/index.html') { res.statusCode = 308; res.setHeader('Location', '/' + url.search); res.end(); return }
      if (serveStatic(root, pathname, res)) return
      const nf = path.join(root, '404.html')
      res.statusCode = 404
      if (fs.existsSync(nf)) { res.setHeader('Content-Type', MIME['.html']); fs.createReadStream(nf).pipe(res) } else res.end('Not found')
    } catch (err) {
      console.error('[dev-server]', err)
      if (!res.headersSent) { res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: false, error: 'Internal error' })) } else res.end()
    }
  })
}

export function listen(server: http.Server, port: number, host = '127.0.0.1'): Promise<{ port: number; url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      const addr = server.address()
      const p = typeof addr === 'object' && addr ? addr.port : port
      resolve({ port: p, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${p}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()) }) })
    })
  })
}
