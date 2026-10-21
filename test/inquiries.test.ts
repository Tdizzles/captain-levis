import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { db, makeJpeg, postMultipart, startServer, validInquiry, type TestServer } from './helpers.js'

let srv: TestServer
let n = 0
const ip = () => ({ 'x-forwarded-for': `10.0.${Math.floor(n / 250)}.${(n++ % 250) + 1}` })

beforeAll(async () => { srv = await startServer() })
afterAll(async () => { await srv.close() })
afterEach(() => { vi.unstubAllGlobals(); process.env.VERCEL_ENV = 'development'; delete process.env.TURNSTILE_SECRET_KEY; delete process.env.ALLOW_UNVERIFIED_FORMS })

describe('POST /api/inquiries', () => {
  it('stores the inquiry, its photo and an email_deliveries row (pending_config without RESEND_API_KEY)', async () => {
    const jpeg = await makeJpeg(800, 600)
    const r = await postMultipart(`${srv.url}/api/inquiries`, validInquiry(), [{ field: 'photos', filename: 'damage.jpg', type: 'image/jpeg', data: jpeg }], { headers: ip() })
    expect(r.status).toBe(200)
    expect(r.json.ok).toBe(true)
    expect(r.json.ref).toMatch(/^CL-\d{4}-\d{4}$/)
    const d = await db()
    const inq = (await d.query<any>('SELECT * FROM inquiries WHERE ref = $1', [r.json.ref])).rows[0]
    expect(inq).toBeTruthy()
    expect(inq.boat_make).toBe('Boston Whaler')
    expect(inq.boat_year).toBe(2004)
    expect(inq.boat_model).toBe('Outrage 24')
    expect(inq.source).toBe('form')
    expect(inq.ip_hash).toMatch(/^[0-9a-f]{32}$/)
    const photos = (await d.query<any>('SELECT mime, width, height, size FROM photos WHERE inquiry_id = $1', [inq.id])).rows
    expect(photos).toHaveLength(1)
    expect(photos[0].mime).toBe('image/jpeg')
    const del = (await d.query<any>('SELECT status, "to", subject FROM email_deliveries WHERE inquiry_id = $1', [inq.id])).rows[0]
    expect(del.status).toBe('pending_config')
    expect(del.to).toBe('captainlevis@yahoo.com')
    expect(del.subject).toBe(`[Quote Request ${r.json.ref}] Transom Repair / Replacement — 2004 Boston Whaler Outrage 24 — Tyler Tester`)
    const audit = (await d.query<any>('SELECT action FROM audit_events WHERE entity_id = $1', [inq.id])).rows
    expect(audit.map((a: any) => a.action)).toContain('inquiry.create')
  })

  it('rejects the honeypot', async () => {
    const r = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ company: 'Acme Bots' }), [], { headers: ip() })
    expect(r.status).toBe(400)
    expect(r.json.ok).toBe(false)
  })

  it('returns field errors for invalid input', async () => {
    const r = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: 'nope', phone: '123', message: 'short' }), [], { headers: ip() })
    expect(r.status).toBe(400)
    expect(r.json.fields).toMatchObject({ email: expect.any(String), phone: expect.any(String), message: expect.any(String) })
  })

  it('is idempotent: the same idempotency_key returns the same ref and sends no second email', async () => {
    const body = validInquiry({ email: 'idem@example.com', message: 'Idempotency check message about a cracked hull near the bow.' })
    const a = await postMultipart(`${srv.url}/api/inquiries`, body, [], { headers: ip() })
    const b = await postMultipart(`${srv.url}/api/inquiries`, body, [], { headers: ip() })
    expect(a.status).toBe(200); expect(b.status).toBe(200)
    expect(b.json.ref).toBe(a.json.ref)
    const d = await db()
    const count = (await d.query<any>('SELECT count(*) AS n FROM email_deliveries e JOIN inquiries i ON i.id = e.inquiry_id WHERE i.ref = $1', [a.json.ref])).rows[0].n
    expect(Number(count)).toBe(1)
  })

  it('treats the same email + message within 10 minutes as the same inquiry', async () => {
    const msg = 'Duplicate detection: gelcoat chips along the starboard side from dock rash.'
    const a = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: 'dupe@example.com', message: msg }), [], { headers: ip() })
    const b = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: 'Dupe@Example.com', message: msg + ' ' }), [], { headers: ip() })
    expect(b.json.ref).toBe(a.json.ref)
    expect(b.json.duplicate).toBe(true)
  })

  it('production without TURNSTILE_SECRET_KEY refuses with 503 unless ALLOW_UNVERIFIED_FORMS', async () => {
    process.env.VERCEL_ENV = 'production'
    const a = await postMultipart(`${srv.url}/api/inquiries`, validInquiry(), [], { headers: ip() })
    expect(a.status).toBe(503)
    expect(a.json.error).toMatch(/call/i)
    process.env.ALLOW_UNVERIFIED_FORMS = 'true'
    const b = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: 'prod-ok@example.com', message: 'Allowed without verification because the flag is set on.' }), [], { headers: ip() })
    expect(b.status).toBe(200)
  })

  it('production with a secret rejects a missing token and accepts a token the siteverify call approves', async () => {
    process.env.VERCEL_ENV = 'production'
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA'
    const realFetch = globalThis.fetch
    const calls: { secret: string | null; response: string | null }[] = []
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = String(input)
      if (url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) {
        const body = init?.body as URLSearchParams
        calls.push({ secret: body.get('secret'), response: body.get('response') })
        const ok = body.get('response') === 'XXXX.DUMMY.TOKEN.XXXX'
        return new Response(JSON.stringify(ok ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] }), { headers: { 'content-type': 'application/json' } })
      }
      return realFetch(input, init)
    })
    const missing = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ turnstile_token: '' }), [], { headers: ip() })
    expect(missing.status).toBe(400)
    expect(missing.json.fields?.turnstile_token).toBe('missing')
    const bad = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ turnstile_token: 'expired-or-replayed', email: 'bad@example.com', message: 'Token rejected by the verifier, should fail cleanly.' }), [], { headers: ip() })
    expect(bad.status).toBe(400)
    const good = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ turnstile_token: 'XXXX.DUMMY.TOKEN.XXXX', email: 'good@example.com', message: 'Token accepted by the verifier using the always-pass secret.' }), [], { headers: ip() })
    expect(good.status).toBe(200)
    expect(calls.length).toBe(2)
    expect(calls[0].secret).toBe('1x0000000000000000000000000000000AA')
  })

  it('rate-limits the 6th inquiry from one IP within an hour with Retry-After', async () => {
    const headers = { 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }
    let last: any
    for (let i = 0; i < 6; i++) {
      last = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: `rl${i}@example.com`, message: `Rate limit probe number ${i} with enough words to pass validation.` }), [], { headers })
      if (i < 5) expect(last.status).toBe(200)
    }
    expect(last.status).toBe(429)
    expect(last.res.headers.get('retry-after')).toMatch(/^\d+$/)
  })

  it('rejects a non-image renamed .jpg before storing anything', async () => {
    const exe = Buffer.concat([Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff\x00\x00', 'binary'), Buffer.alloc(512)])
    const r = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: 'exe@example.com', message: 'Trying to attach something that is not a photo at all here.' }), [{ field: 'photos', filename: 'photo.jpg', type: 'image/jpeg', data: exe }], { headers: ip() })
    expect(r.status).toBe(400)
    expect(r.json.error).toMatch(/JPEG, PNG or WebP/)
    const d = await db()
    expect((await d.query('SELECT 1 FROM inquiries WHERE email = $1', ['exe@example.com'])).rows).toHaveLength(0)
  })
})
