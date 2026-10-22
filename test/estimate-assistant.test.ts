import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Jar, postJson, startServer, type TestServer } from './helpers.js'
import { hashPassword } from '../lib/staff.js'
import { applyTool, describeEstimate, persona, TOOLS } from '../lib/estimates/assistant.js'
import { calcTotals, layoutLines } from '../lib/estimates/calc.js'
import { newEstimate, newId } from '../lib/estimates/types.js'

function doc() {
  const e = newEstimate({ number: 'E-1001', customer: { name: 'Dan Whitaker' }, vessel: { year: '2004', make: 'Boston Whaler', model: 'Outrage 24' } })
  const a = { id: newId(), title: 'Transom repair' }
  e.sections = [a]
  e.lines = [{ id: newId(), sectionId: a.id, description: 'Inspect and grind', qty: 1, unit: '', hours: 2, rate: 125, materials: 0, materialsOnly: false, taxable: true }]
  return e
}

describe('Captain Levi tool executor', () => {
  it('adds sections and lines by letter/title, numbers continuously, and updates/removes by printed number', () => {
    const e = doc()
    expect(applyTool(e, 'add_section', { title: 'Finish' }).change).toContain('B. Finish')
    expect(applyTool(e, 'add_line', { section: 'A', description: 'Cut out wet core\n18 in × 14 in starboard', hours: 6.5, materials: 340.5 }).change).toMatch(/^added line 2/)
    expect(applyTool(e, 'add_line', { section: 'finish', description: 'Gelcoat kit', materials: 89, materialsOnly: true }).change).toMatch(/^added line 3/)
    expect(applyTool(e, 'add_line', { description: 'Haul-out', materials: 150, materialsOnly: true }).change).toMatch(/^added line 1/) // unsectioned prints first
    const lay = layoutLines(e)
    expect(lay.all.map((p) => p.number)).toEqual([1, 2, 3, 4])
    expect(lay.sections.map((s) => s.letter)).toEqual(['A', 'B'])
    expect(applyTool(e, 'update_line', { line: 3, hours: 8, materials: 400 }).change).toContain('hours 8')
    expect(applyTool(e, 'update_line', { line: 4, section: 'A' }).change).toContain('moved to Transom repair')
    expect(layoutLines(e).sections[0].lines.length).toBe(3)
    expect(applyTool(e, 'remove_line', { line: 1 }).ok).toBe(true)
    expect(applyTool(e, 'remove_line', { line: 99 }).ok).toBe(false)
    const t = calcTotals(e)
    expect(t.laborCents).toBe(125000) // (2 + 8) h × $125
    expect(t.materialsCents).toBe(48900)
    expect(applyTool(e, 'remove_section', { section: 'B' }).ok).toBe(true)
    expect(e.sections.length).toBe(1)
    expect(e.lines.every((l) => l.sectionId === e.sections[0].id)).toBe(true)
  })

  it('sets only allowed fields and coerces types', () => {
    const e = doc()
    expect(applyTool(e, 'set_field', { path: 'insurance.enabled', value: 'true' }).ok).toBe(true)
    expect(e.insurance.enabled).toBe(true)
    expect(e.directionToPay).toBe(true)
    expect(applyTool(e, 'set_field', { path: 'insurance.claimNumber', value: '26-918740453' }).ok).toBe(true)
    expect(applyTool(e, 'set_field', { path: 'revision', value: '2' }).ok).toBe(true)
    expect(e.revision).toBe(2)
    expect(applyTool(e, 'set_field', { path: 'docKind', value: 'invoice' }).ok).toBe(false)
    expect(applyTool(e, 'set_field', { path: 'number', value: 'E-9' }).ok).toBe(false)
    expect(applyTool(e, 'set_field', { path: 'status', value: 'approved' }).ok).toBe(false)
    expect(applyTool(e, 'set_field', { path: 'customer.addressLines.1', value: 'Largo, FL 33773' }).ok).toBe(true)
    expect(e.customer.addressLines).toEqual(['', 'Largo, FL 33773'])
    expect(applyTool(e, 'nope', {}).ok).toBe(false)
  })

  it('describes the document with printed numbers and totals, and the persona carries the shop knowledge', () => {
    const e = doc()
    const d = describeEstimate(e)
    expect(d).toContain('A. Transom repair')
    expect(d).toContain('1. Inspect and grind — 2 h @ $125')
    expect(d).toContain('TOTAL $267.50')
    const p = persona()
    expect(p).toContain("Captain Levi")
    expect(p).toContain('SUPPLEMENT REQUEST')
    expect(p).toContain('Never change pricing')
    expect(TOOLS.map((t) => t.name)).toEqual(['set_field', 'add_section', 'rename_section', 'remove_section', 'add_line', 'update_line', 'remove_line'])
  })
})

describe('/api/admin/assistant', () => {
  let srv: TestServer
  const jar = new Jar()
  beforeAll(async () => {
    srv = await startServer()
    process.env.STAFF_PASSWORD_HASH = hashPassword('test-password-123')
    await postJson(`${srv.url}/api/auth/login`, { email: 'tyler.salta@icloud.com', password: 'test-password-123' }, { jar })
  })
  afterAll(async () => { delete process.env.STAFF_PASSWORD_HASH; await srv.close() })

  it('answers honestly without an API key and records the exchange', async () => {
    const created = await postJson(`${srv.url}/api/admin/estimates`, {}, { jar })
    expect(created.status).toBe(201)
    const r = await postJson(`${srv.url}/api/admin/assistant`, { estimate_id: created.json.id, message: 'Add a line for haul-out' }, { jar })
    expect(r.status).toBe(503)
    expect(r.json.reply).toContain('Anthropic API key')
    expect(r.json.changes).toEqual([])
    const hist = await fetch(`${srv.url}/api/admin/assistant?estimate_id=${created.json.id}`, { headers: { cookie: jar.header() } }).then((x) => x.json() as Promise<any>)
    expect(hist.configured).toBe(false)
    expect(hist.messages.length).toBe(2)
    expect(hist.messages[0].text).toBe('Add a line for haul-out')
    const bad = await postJson(`${srv.url}/api/admin/assistant`, { estimate_id: created.json.id, message: '' }, { jar })
    expect(bad.status).toBe(400)
  })
})
