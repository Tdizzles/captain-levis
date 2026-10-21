#!/usr/bin/env node
// Local end-to-end server: static site from the repo root + /api/* routed to the TypeScript handlers in api/.
//   npm run dev            → http://localhost:8787 (PORT to change)
// Zero credentials needed: DATABASE_URL defaults to pglite://./.data/dev (persisted on disk), chat runs scripted,
// emails are recorded as pending_config. Put real values in .env.local to light features up (loaded below).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// tiny .env loader (no dependency): .env.local then .env, never overriding real environment variables
for (const name of ['.env.local', '.env']) {
  const p = path.join(ROOT, name)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/i)
    if (!m || line.trim().startsWith('#')) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
process.env.DATABASE_URL ||= 'pglite://./.data/dev'
process.env.VERCEL_ENV ||= 'development'
const PORT = Number(process.env.PORT) || 8787
process.env.SITE_URL ||= `http://localhost:${PORT}`

const { createSiteServer, listen } = await import('../lib/node-adapter.ts')
const server = createSiteServer({ root: ROOT, log: true })
const { url } = await listen(server, PORT, '0.0.0.0')

const { getDb } = await import('../lib/db.ts')
try { await getDb() } catch (e) { console.error('database failed to open:', e.message) }

const flags = {
  database: process.env.DATABASE_URL,
  anthropic: process.env.ANTHROPIC_API_KEY ? 'key set (model ' + (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5') + ')' : 'no key → chat in scripted mode',
  resend: process.env.RESEND_API_KEY ? 'key set' : 'no key → emails stored as pending_config',
  turnstile: process.env.TURNSTILE_SECRET_KEY ? 'secret set' : 'no secret → forms accepted without CAPTCHA (dev)',
  session_secret: process.env.SESSION_SECRET ? 'set' : 'not set → insecure dev key',
  admin: process.env.ADMIN_API_TOKEN ? 'token set' : 'not set → /api/admin/* returns 503',
}
console.log(`\nCaptain Levi's dev server → ${url}\n`)
for (const [k, v] of Object.entries(flags)) console.log(`  ${k.padEnd(15)} ${v}`)
console.log(`\n  health          ${url}/api/health\n`)
