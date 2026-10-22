import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Jar, makeJpeg, postJson, postMultipart, startServer, validInquiry, type TestServer } from './helpers.js'
import { hashPassword } from '../lib/staff.js'

let srv: TestServer
const jar = new Jar()
beforeAll(async () => {
  srv = await startServer()
  process.env.STAFF_PASSWORD_HASH = hashPassword('test-password-123')
  const r = await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: 'test-password-123' }, { jar })
  expect(r.status).toBe(200)
})
afterAll(async () => { delete process.env.STAFF_PASSWORD_HASH; await srv.close() })

const get = async (path: string) => { const res = await fetch(`${srv.url}${path}`, { headers: { cookie: jar.header() } }); return { status: res.status, json: (await res.json()) as any } }
const send = async (method: string, path: string, body?: unknown) => { const res = await fetch(`${srv.url}${path}`, { method, headers: { cookie: jar.header(), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: res.status, json: (await res.json()) as any } }

describe('/api/admin/estimates', () => {
  it('requires staff', async () => {
    const res = await fetch(`${srv.url}/api/admin/estimates`)
    expect(res.status).toBe(401)
  })

  it('creates a numbered draft from an inquiry with its photos, saves edits with versions, restores and deletes', async () => {
    const inq = await postMultipart(`${srv.url}/api/inquiries`, validInquiry({ message: 'Transom soft about 2 ft wide around the drain plug, boat on the trailer in Largo. Insurance claim 26-123456789 with Progressive.' }), [{ field: 'photos', filename: 'a.jpg', type: 'image/jpeg', data: await makeJpeg() }])
    expect(inq.status).toBe(200)
    const list0 = await get('/api/admin/inquiries')
    const inquiryId = list0.json.items[0].id

    const created = await send('POST', '/api/admin/estimates', { inquiry_id: inquiryId })
    expect(created.status).toBe(201)
    const e = created.json.estimate
    expect(created.json.number).toMatch(/^E-\d{4}$/)
    expect(e.customer.name).toBe('Tyler Tester')
    expect(e.vessel.make).toBe('Boston Whaler')
    expect(e.vessel.year).toBe('2004')
    expect(e.insurance.enabled).toBe(true)
    expect(e.docKind).toBe('supplement')
    expect(e.photos.length).toBe(1)
    expect(e.photos[0].url).toMatch(/\/api\/photo\?id=.*sig=/)
    expect(e.sections.length).toBe(1)
    expect(created.json.totals.totalCents).toBe(0)
    expect(created.json.business.name).toBe("Captain Levi's")
    expect(created.json.versions.length).toBe(1)
    const inqAfter = await get(`/api/admin/inquiries?id=${inquiryId}`)
    expect(inqAfter.json.inquiry.status).toBe('quoted')

    // edit: two lines, one materials-only
    const sec = e.sections[0].id
    const doc = { ...e, lines: [
      { ...e.lines[0], description: 'Grind back to sound laminate\nStarboard transom corner', hours: 6.5, rate: 125, materials: 340.5 },
      { id: 'l2', sectionId: sec, description: 'Gelcoat kit', qty: 1, unit: '', hours: 0, rate: 125, materials: 89, materialsOnly: true, taxable: true },
    ] }
    const saved = await send('PUT', `/api/admin/estimates?id=${created.json.id}`, { estimate: doc, reason: 'test edit' })
    expect(saved.status).toBe(200)
    expect(saved.json.totals.laborCents).toBe(81250)
    expect(saved.json.totals.materialsCents).toBe(42950)
    expect(saved.json.totals.subtotalCents).toBe(124200)
    expect(saved.json.totals.taxCents).toBe(8694)
    expect(saved.json.totals.totalCents).toBe(132894)
    expect(saved.json.layout.sections[0].letter).toBe('A')
    expect(saved.json.layout.sections[0].lines.length).toBe(2)

    const one = await get(`/api/admin/estimates?id=${created.json.id}`)
    expect(one.json.versions.map((v: any) => v.version)).toEqual([2, 1])
    expect(one.json.estimate.lines.length).toBe(2)
    const v1 = await get(`/api/admin/estimates?id=${created.json.id}&version=1`)
    expect(v1.json.estimate.lines.length).toBe(1)

    const restored = await send('POST', `/api/admin/estimates?id=${created.json.id}&restore=1`)
    expect(restored.status).toBe(200)
    expect(restored.json.estimate.lines.length).toBe(1)
    expect(restored.json.versions.length).toBe(3)

    const listed = await get('/api/admin/estimates')
    expect(listed.json.items[0].number).toBe(created.json.number)
    expect(listed.json.items[0].customer_name).toBe('Tyler Tester')

    const blank = await send('POST', '/api/admin/estimates', {})
    expect(blank.status).toBe(201)
    expect(blank.json.estimate.customer.name).toBe('')
    expect(Number(blank.json.number.slice(2))).toBe(Number(created.json.number.slice(2)) + 1)

    const del = await send('DELETE', `/api/admin/estimates?id=${blank.json.id}`)
    expect(del.status).toBe(200)
    expect((await get(`/api/admin/estimates?id=${blank.json.id}`)).status).toBe(404)
  })
})
