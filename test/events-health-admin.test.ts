import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { db, postJson, postMultipart, startServer, validInquiry, type TestServer } from './helpers.js'

let srv: TestServer
beforeAll(async () => { srv = await startServer() })
afterAll(async () => { await srv.close() })
afterEach(() => { delete process.env.ADMIN_API_TOKEN })

describe('POST /api/events', () => {
  it('stores allow-listed events (204) and silently drops unknown names', async () => {
    const ok = await postJson(`${srv.url}/api/events`, { name: 'page_view', props: { title: 'Home' }, page: 'index', ref: 'google.com', ts: Date.now(), sid: 'abc' })
    expect(ok.status).toBe(204)
    const junk = await postJson(`${srv.url}/api/events`, { name: 'drop_table', props: {}, page: 'index' })
    expect(junk.status).toBe(204)
    const d = await db()
    const rows = (await d.query<any>('SELECT name, props, page, referrer_host, session_hash FROM analytics_events ORDER BY id')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'page_view', page: 'index', referrer_host: 'google.com' })
    expect(rows[0].session_hash).not.toBe('abc')
    expect(rows[0].props.title).toBe('Home')
  })
})

describe('GET /api/health', () => {
  it('reports which credentials are missing without leaking values', async () => {
    const res = await fetch(`${srv.url}/api/health`)
    const json: any = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.configured).toEqual({ database: false, anthropic: false, resend: false, turnstile: false, session_secret: false, admin_token: false, staff_login: false })
    expect(json.missing).toEqual(expect.arrayContaining(['anthropic', 'resend', 'turnstile', 'session_secret']))
    expect(json.database).toEqual({ mode: 'pglite', reachable: true })
    expect(json.knowledge.pages).toBeGreaterThan(10)
    expect(JSON.stringify(json)).not.toMatch(/sk-ant-|re_[A-Za-z0-9]{8}|insecure-secret|postgres:\/\//i)
  })
})

describe('/api/admin/*', () => {
  it('is 503 without a token, 401 with the wrong one, and lists inquiries with signed photo URLs', async () => {
    const a = await fetch(`${srv.url}/api/admin/inquiries`)
    expect(a.status).toBe(503)
    process.env.ADMIN_API_TOKEN = 'test-admin-token-1234567890'
    const b = await fetch(`${srv.url}/api/admin/inquiries`, { headers: { authorization: 'Bearer nope' } })
    expect(b.status).toBe(401)

    const created = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: 'admin-list@example.com' }), [], { headers: { 'x-forwarded-for': '198.51.100.9' } })
    expect(created.status).toBe(200)
    const auth = { authorization: 'Bearer test-admin-token-1234567890' }
    const list: any = await (await fetch(`${srv.url}/api/admin/inquiries?limit=10`, { headers: auth })).json()
    expect(list.ok).toBe(true)
    expect(list.total).toBeGreaterThanOrEqual(1)
    const item = list.items.find((i: any) => i.ref === created.json.ref)
    expect(item.email_status).toBe('pending_config')
    expect(item.ip_hash).toBeUndefined()

    const one: any = await (await fetch(`${srv.url}/api/admin/inquiries/${item.id}`, { headers: auth })).json()
    expect(one.inquiry.ref).toBe(created.json.ref)
    expect(one.deliveries).toHaveLength(1)

    const patched = await fetch(`${srv.url}/api/admin/inquiries?id=${item.id}`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ status: 'contacted' }) })
    expect(patched.status).toBe(200)
    expect(((await patched.json()) as any).inquiry.status).toBe('contacted')
    const d = await db()
    const audit = (await d.query<any>("SELECT data FROM audit_events WHERE action = 'inquiry.status' AND entity_id = $1", [item.id])).rows
    expect(audit[0].data).toEqual({ from: 'new', to: 'contacted' })

    const retry: any = await (await fetch(`${srv.url}/api/admin/retry-email?id=${one.deliveries[0].id}`, { method: 'POST', headers: auth })).json()
    expect(retry.ok).toBe(false)
    expect(retry.reason).toMatch(/RESEND_API_KEY/)
  })
})

describe('GET /api/photo', () => {
  it('serves a photo only with a valid, unexpired signature', async () => {
    const { signPhotoUrl } = await import('../lib/photos.js')
    const { makeJpeg } = await import('./helpers.js')
    const created = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ email: 'photo@example.com' }), [{ field: 'photos', filename: 'a.jpg', type: 'image/jpeg', data: await makeJpeg(200, 100) }], { headers: { 'x-forwarded-for': '198.51.100.10' } })
    expect(created.status).toBe(200)
    const d = await db()
    const id = (await d.query<any>('SELECT p.id FROM photos p JOIN inquiries i ON i.id = p.inquiry_id WHERE i.ref = $1', [created.json.ref])).rows[0].id
    const good = await fetch(signPhotoUrl(id, 60, srv.url))
    expect(good.status).toBe(200)
    expect(good.headers.get('content-type')).toBe('image/jpeg')
    const tampered = await fetch(signPhotoUrl(id, 60, srv.url).replace(/sig=.{4}/, 'sig=AAAA'))
    expect(tampered.status).toBe(404)
    const expired = await fetch(signPhotoUrl(id, -60, srv.url))
    expect(expired.status).toBe(404)
  })
})
