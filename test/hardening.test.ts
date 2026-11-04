// 2026-11-04 hardening: greetings get a greeting, cookie writes must be same-origin, AI has a daily ceiling,
// and health exposes a rejected key.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chatMsg, db, Jar, postJson, startServer, type TestServer } from './helpers.js'
import { hashPassword } from '../lib/staff.js'
import { budget } from '../lib/ai.js'

let srv: TestServer
beforeAll(async () => { srv = await startServer() })
afterAll(async () => { await srv.close() })
afterEach(() => { delete process.env.STAFF_PASSWORD_HASH; delete process.env.AI_DAILY_BUDGET_USD; delete process.env.AI_MONTHLY_BUDGET_USD })

const say = (jar: Jar, message: string) => postJson(`${srv.url}/api/chat`, chatMsg(message), { jar })

describe('chat small talk', () => {
  it('answers "hi" with a greeting, not the no-match line', async () => {
    const jar = new Jar()
    for (const hello of ['hi', 'Hey there!', 'good morning captain', 'hello']) {
      const r = await say(jar, hello)
      expect(r.status).toBe(200)
      expect(r.json.reply).toMatch(/Captain Levi/)
      expect(r.json.reply).not.toMatch(/good answer/i)
      expect(r.json.chips.length).toBeGreaterThan(0)
    }
    const t = await say(jar, 'thanks!')
    expect(t.json.reply).toMatch(/anytime/i)
  })

  it('still treats a greeting followed by a real request as the request', async () => {
    const r = await say(new Jar(), 'hi I need a quote for my transom')
    expect(r.json.event).toBe('quote_start')
  })
})

describe('same-origin guard on cookie-authenticated writes', () => {
  it('refuses a cross-site login and a cross-site admin PATCH, allows same-origin and bearer', async () => {
    process.env.STAFF_PASSWORD_HASH = hashPassword('pw-123456789')
    const host = new URL(srv.url).host
    const evil = await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: 'pw-123456789' }, { headers: { origin: 'https://evil.example' } })
    expect(evil.status).toBe(403)

    const jar = new Jar()
    const ok = await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: 'pw-123456789' }, { jar, headers: { origin: `http://${host}` } })
    expect(ok.status).toBe(200)

    const id = '00000000-0000-4000-8000-000000000000'
    const patch = (origin?: string) => fetch(`${srv.url}/api/admin/inquiries?id=${id}`, {
      method: 'PATCH', body: JSON.stringify({ status: 'contacted' }),
      headers: { 'content-type': 'application/json', cookie: jar.header(), ...(origin ? { origin } : {}) },
    })
    expect((await patch('https://evil.example')).status).toBe(403)
    expect((await patch(`http://${host}`)).status).toBe(404) // got past auth + origin; the row just does not exist
  })
})

describe('AI daily ceiling', () => {
  it('stops model calls once today\'s spend reaches AI_DAILY_BUDGET_USD, under the monthly cap', async () => {
    const d = await db()
    process.env.AI_MONTHLY_BUDGET_USD = '100'
    process.env.AI_DAILY_BUDGET_USD = '1'
    expect((await budget(d)).ok).toBe(true)
    await d.query("INSERT INTO ai_usage (kind, model, tokens_in, tokens_out, cost_usd) VALUES ('chat', 'claude-sonnet-5-5', 1, 1, 1.5)")
    expect((await budget(d)).ok).toBe(false)
    await d.query('DELETE FROM ai_usage')
  })
})
