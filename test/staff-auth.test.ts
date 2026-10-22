import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Jar, postJson, startServer, type TestServer } from './helpers.js'
import { hashPassword, verifyPassword } from '../lib/staff.js'

let srv: TestServer
beforeAll(async () => { srv = await startServer() })
afterAll(async () => { await srv.close() })
afterEach(() => { delete process.env.STAFF_PASSWORD_HASH; delete process.env.STAFF_EMAILS })

const PW = 'test-password-123'

describe('password hashing', () => {
  it('round-trips and rejects wrong passwords / malformed hashes', () => {
    const h = hashPassword(PW)
    expect(h.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword(PW, h)).toBe(true)
    expect(verifyPassword('nope', h)).toBe(false)
    expect(verifyPassword(PW, 'garbage')).toBe(false)
    expect(verifyPassword(PW, undefined)).toBe(false)
    expect(hashPassword(PW)).not.toBe(h) // fresh salt each time
  })
})

describe('/api/auth/*', () => {
  it('is 503 until STAFF_PASSWORD_HASH is set', async () => {
    const r = await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: PW })
    expect(r.status).toBe(503)
    const me: any = await fetch(`${srv.url}/api/auth/me`).then((x) => x.json())
    expect(me.loginConfigured).toBe(false)
  })

  it('signs a staff member in, grants /api/admin/*, and signs out', async () => {
    process.env.STAFF_PASSWORD_HASH = hashPassword(PW)
    const jar = new Jar()
    const bad = await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: 'wrong' }, { jar })
    expect(bad.status).toBe(401)
    const unknown = await postJson(`${srv.url}/api/auth/login`, { email: 'stranger@example.com', password: PW }, { jar })
    expect(unknown.status).toBe(401)
    expect(unknown.json.error).toBe(bad.json.error) // no enumeration
    const noAuth = await fetch(`${srv.url}/api/admin/inquiries`)
    expect(noAuth.status).toBe(401)

    const ok = await postJson(`${srv.url}/api/auth/login`, { email: 'Tyler.Salta@icloud.com ', password: PW }, { jar })
    expect(ok.status).toBe(200)
    expect(ok.json.staff.email).toBe('tyler.salta@icloud.com')
    expect(jar.cookies.has('cl_staff')).toBe(true)
    const me: any = await fetch(`${srv.url}/api/auth/me`, { headers: { cookie: jar.header() } }).then((x) => x.json())
    expect(me.staff.email).toBe('tyler.salta@icloud.com')
    const list = await fetch(`${srv.url}/api/admin/inquiries`, { headers: { cookie: jar.header() } })
    expect(list.status).toBe(200)
    expect(((await list.json()) as any).ok).toBe(true)

    const out = await postJson(`${srv.url}/api/auth/logout`, {}, { jar })
    expect(out.status).toBe(200)
    expect(jar.cookies.get('cl_staff')).toBe('')
    const after: any = await fetch(`${srv.url}/api/auth/me`, { headers: { cookie: jar.header() } }).then((x) => x.json())
    expect(after.staff).toBeNull()
  })

  it('honours STAFF_EMAILS and revokes a cookie whose email left the list', async () => {
    process.env.STAFF_PASSWORD_HASH = hashPassword(PW)
    process.env.STAFF_EMAILS = 'crew@example.com, boss@example.com'
    const jar = new Jar()
    const owner = await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: PW }, { jar })
    expect(owner.status).toBe(401)
    const crew = await postJson(`${srv.url}/api/auth/login`, { email: 'crew@example.com', password: PW }, { jar })
    expect(crew.status).toBe(200)
    process.env.STAFF_EMAILS = 'boss@example.com'
    const me: any = await fetch(`${srv.url}/api/auth/me`, { headers: { cookie: jar.header() } }).then((x) => x.json())
    expect(me.staff).toBeNull()
  })

  it('rate-limits sign-in attempts per IP', async () => {
    process.env.STAFF_PASSWORD_HASH = hashPassword(PW)
    const ip = { 'x-forwarded-for': '203.0.113.77' }
    let last = 0
    for (let n = 0; n < 11; n++) last = (await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: 'wrong' }, { headers: ip })).status
    expect(last).toBe(429)
  })
})
