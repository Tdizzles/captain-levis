// Estimates: list, builder (autosaves; totals always come back from the server), version history, print view.
import { api, debounce, esc, fmtWhen, h, money, raw, toast, uid } from './util.js'
import { renderEstimateHtml } from './print/estimate-print.js'
import { mountLevi } from './levi.js'

const STATUS = { draft: 'Draft', sent: 'Sent', approved: 'Approved', declined: 'Declined' }
const view = () => document.getElementById('view')

// ---------- list ----------
export async function renderEstimates(status) {
  view().innerHTML = h`<div class="qd-head"><h1>Estimates</h1><div class="spacer"></div>
    <div class="qd-tabs" role="group" aria-label="Filter">${raw(['', 'draft', 'sent', 'approved', 'declined'].map((s) => `<button type="button" data-status="${s}" aria-pressed="${s === status}">${s ? STATUS[s] : 'All'}</button>`).join(''))}</div>
    <a class="qd-btn navy" href="#/estimates/new">+ New estimate</a></div><div id="list"><div class="qd-empty">Loading…</div></div>`
  for (const b of view().querySelectorAll('[data-status]')) b.addEventListener('click', () => { location.hash = b.dataset.status ? `#/estimates?status=${b.dataset.status}` : '#/estimates' })
  const list = document.getElementById('list')
  try {
    const r = await api(`/api/admin/estimates${status ? `?status=${status}` : ''}`)
    if (!r.items.length) { list.innerHTML = '<div class="qd-empty">No estimates yet. Start one from an inquiry, or click “New estimate”.</div>'; return }
    list.innerHTML = h`<table class="qd-table"><thead><tr><th>Number</th><th>Customer</th><th>Vessel</th><th>Total</th><th>Updated</th><th>Status</th></tr></thead><tbody>${raw(r.items.map((e) => `
      <tr class="row" data-id="${esc(e.id)}"><td class="ref">${esc(e.number)}</td><td>${esc(e.customer_name || '—')}</td><td>${esc(e.vessel_label || '—')}</td><td>${esc(money(e.total_cents))}</td><td>${esc(fmtWhen(e.updated_at))}</td><td><span class="badge ${esc(e.status)}">${esc(STATUS[e.status] || e.status)}</span></td></tr>`).join(''))}</tbody></table>`
    for (const tr of list.querySelectorAll('tr.row')) tr.addEventListener('click', () => { location.hash = `#/estimates/${tr.dataset.id}` })
  } catch (ex) { list.innerHTML = h`<div class="qd-empty">${ex.message}</div>` }
}

export async function renderEstimateNew(params) {
  view().innerHTML = '<div class="qd-empty">Creating estimate…</div>'
  try {
    const r = await api('/api/admin/estimates', { body: params.get('inquiry') ? { inquiry_id: params.get('inquiry') } : {} })
    location.replace(`#/estimates/${r.id}`)
  } catch (ex) { view().innerHTML = h`<div class="qd-empty">${ex.message}</div>` }
}

// ---------- editor ----------
const num = (v) => { const n = Number(String(v).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
const field = (label, path, value, type = 'text', extra = '') => `<label class="qd-field"><span>${esc(label)}</span><input type="${type}" data-path="${esc(path)}" value="${esc(value ?? '')}" ${extra}></label>`

export async function renderEstimateEditor(id) {
  view().innerHTML = '<div class="qd-empty">Loading…</div>'
  let r
  try { r = await api(`/api/admin/estimates?id=${encodeURIComponent(id)}`) } catch (ex) { view().innerHTML = h`<div class="qd-empty">${ex.message}</div>`; return }
  const state = { id, doc: r.estimate, totals: r.totals, layout: r.layout, versions: r.versions, business: r.business, number: r.number, dirty: false, saving: false }
  const lineCalc = (lid) => state.totals.lines.find((l) => l.id === lid) || { laborCents: 0, materialsCents: 0, lineTotalCents: 0 }
  const lineNo = (lid) => { const p = state.layout.all.find((x) => x.line.id === lid); return p ? p.number : '' }

  const save = debounce(async (reason) => {
    state.saving = true; setSaveState('Saving…')
    try {
      const out = await api(`/api/admin/estimates?id=${encodeURIComponent(id)}`, { method: 'PUT', body: { estimate: state.doc, reason } })
      state.totals = out.totals; state.layout = out.layout; state.doc.updatedAt = out.estimate.updatedAt; state.dirty = false
      paintTotals(); setSaveState(`Saved ${fmtWhen(out.updated_at)}`)
      state.versions = (await api(`/api/admin/estimates?id=${encodeURIComponent(id)}`)).versions; paintVersions()
    } catch (ex) { setSaveState(`Not saved: ${ex.message}`) } finally { state.saving = false }
  }, 700)
  const touch = (reason = 'edited') => { state.dirty = true; setSaveState('Unsaved changes'); save(reason) }
  const setSaveState = (t) => { const el = document.getElementById('save-state'); if (el) el.textContent = t }

  const linesHtml = () => {
    const d = state.doc
    const rows = []
    const lineRow = (l) => {
      const c = lineCalc(l.id)
      return `<tr class="line" data-line="${esc(l.id)}">
        <td class="n">${esc(lineNo(l.id))}</td>
        <td><textarea data-path="lines.${esc(l.id)}.description" rows="2" placeholder="Title on the first line, details below">${esc(l.description)}</textarea></td>
        <td><input class="num" type="number" step="0.25" min="0" data-path="lines.${esc(l.id)}.hours" value="${l.hours}" ${l.materialsOnly ? 'disabled' : ''}></td>
        <td><input class="num" type="number" step="1" min="0" data-path="lines.${esc(l.id)}.rate" value="${l.rate}" ${l.materialsOnly ? 'disabled' : ''}></td>
        <td class="money">${esc(l.materialsOnly ? '—' : money(c.laborCents))}</td>
        <td><input class="num" type="number" step="0.01" min="0" data-path="lines.${esc(l.id)}.materials" value="${l.materials}"></td>
        <td class="money total">${esc(money(c.lineTotalCents))}</td>
        <td class="tools"><label title="Materials only (no labor)"><input type="checkbox" data-path="lines.${esc(l.id)}.materialsOnly" ${l.materialsOnly ? 'checked' : ''}> M</label>
          <button type="button" class="icon" data-act="up" title="Move up">↑</button><button type="button" class="icon" data-act="down" title="Move down">↓</button><button type="button" class="icon danger" data-act="del" title="Remove line">✕</button></td></tr>`
    }
    const unsectioned = d.lines.filter((l) => !l.sectionId || !d.sections.some((s) => s.id === l.sectionId))
    for (const l of unsectioned) rows.push(lineRow(l))
    d.sections.forEach((s, i) => {
      const letter = state.layout.sections.find((x) => x.section.id === s.id)?.letter || String.fromCharCode(65 + i)
      rows.push(`<tr class="section" data-section="${esc(s.id)}"><td class="n">${esc(letter)}</td><td colspan="6"><input data-path="sections.${esc(s.id)}.title" value="${esc(s.title)}" placeholder="Section title"></td>
        <td class="tools"><button type="button" class="icon" data-act="sec-up" title="Move section up">↑</button><button type="button" class="icon" data-act="sec-down" title="Move section down">↓</button><button type="button" class="icon danger" data-act="sec-del" title="Remove section (lines move up)">✕</button></td></tr>`)
      for (const l of d.lines.filter((x) => x.sectionId === s.id)) rows.push(lineRow(l))
      rows.push(`<tr class="add"><td></td><td colspan="7"><button type="button" class="qd-btn ghost small" data-act="add-line" data-section="${esc(s.id)}">+ Line in ${esc(letter)}</button></td></tr>`)
    })
    return rows.join('')
  }

  const paintTotals = () => {
    const t = state.totals, d = state.doc
    const el = document.getElementById('totals')
    if (!el) return
    el.innerHTML = `<dl class="tot">
      <dt>Labor (${esc(t.laborHours)} hrs${t.uniformRateCents != null ? ` @ ${esc(money(t.uniformRateCents))}` : ''})</dt><dd>${esc(money(t.laborCents))}</dd>
      <dt>Materials</dt><dd>${esc(money(t.materialsCents))}</dd>
      <dt>Subtotal</dt><dd>${esc(money(t.subtotalCents))}</dd>
      <dt>Sales tax ${esc(t.taxRate)}%</dt><dd>${esc(money(t.taxCents))}</dd>
      <dt class="grand">Total</dt><dd class="grand">${esc(money(t.totalCents))}</dd>
      ${t.depositPct > 0 ? `<dt>Deposit ${esc(t.depositPct)}%</dt><dd>${esc(money(t.depositCents))}</dd><dt>Balance</dt><dd>${esc(money(t.remainingCents))}</dd>` : ''}</dl>
      <p class="muted">${esc(`Labor rate $${d.pricing.laborRate}/hr · tax ${d.pricing.taxRate}% (${d.pricing.taxNote})`)}</p>`
    // refresh per-line money + numbers without re-rendering inputs
    for (const tr of view().querySelectorAll('tr.line')) {
      const c = lineCalc(tr.dataset.line); const l = d.lines.find((x) => x.id === tr.dataset.line)
      tr.querySelector('.n').textContent = lineNo(tr.dataset.line)
      tr.querySelectorAll('.money')[0].textContent = l && l.materialsOnly ? '—' : money(c.laborCents)
      tr.querySelector('.total').textContent = money(c.lineTotalCents)
    }
  }
  const paintVersions = () => {
    const el = document.getElementById('versions'); if (!el) return
    el.innerHTML = state.versions.slice(0, 12).map((v) => `<li><span>v${v.version} · ${esc(v.reason || 'edited')} · ${esc(v.actor)}</span><span class="muted">${esc(fmtWhen(v.created_at))}</span>${v.version !== state.versions[0].version ? `<button type="button" class="qd-btn ghost small" data-restore="${v.version}">Restore</button>` : '<span class="badge quoted">current</span>'}</li>`).join('')
    for (const b of el.querySelectorAll('[data-restore]')) b.addEventListener('click', async () => {
      try { await api(`/api/admin/estimates?id=${encodeURIComponent(id)}&restore=${b.dataset.restore}`, { method: 'POST', body: {} }); toast(`Restored v${b.dataset.restore}`); renderEstimateEditor(id) } catch (ex) { toast(ex.message) }
    })
  }

  const draw = () => {
    const d = state.doc
    view().innerHTML = h`
    <div class="qd-head"><a href="#/estimates" class="qd-btn ghost small">← Estimates</a><h1>${state.number} <span class="muted">${d.customer.name || 'New estimate'}</span></h1>
      <span class="muted" id="save-state">Saved</span><div class="spacer"></div>
      <label class="qd-field" style="margin:0"><span>Status</span><select data-path="status">${raw(Object.entries(STATUS).map(([v, l]) => `<option value="${v}" ${v === d.status ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <a class="qd-btn" href="#/estimates/${id}/print" target="_blank" rel="noopener">Print / PDF</a>
      <button type="button" class="qd-btn navy" id="levi-toggle">Ask Captain Levi</button></div>
    <div class="est-layout">
    <div class="est-main">
      <section class="card"><h2>Document</h2><div class="cols4">
        <label class="qd-field"><span>Kind</span><select data-path="docKind"><option value="estimate" ${d.docKind === 'estimate' ? 'selected' : ''}>Repair estimate</option><option value="supplement" ${d.docKind === 'supplement' ? 'selected' : ''}>Supplement request</option></select></label>
        ${raw(field('Revision', 'revision', d.revision, 'number', 'min="0" step="1"'))}${raw(field('Estimate date', 'estimateDate', d.estimateDate, 'date'))}
        <label class="qd-field"><span>Direction to Pay page</span><select data-path="directionToPay"><option value="true" ${d.directionToPay ? 'selected' : ''}>Print (insurance)</option><option value="false" ${!d.directionToPay ? 'selected' : ''}>Don't print</option></select></label></div></section>
      <section class="card"><h2>${d.insurance.enabled ? 'Owner / Insured' : 'Customer'}</h2><div class="cols2">
        ${raw(field('Name', 'customer.name', d.customer.name))}${raw(field('Company', 'customer.company', d.customer.company))}${raw(field('Email', 'customer.email', d.customer.email, 'email'))}${raw(field('Phone', 'customer.phone', d.customer.phone, 'tel'))}
        ${raw(field('Address line 1', 'customer.addressLines.0', d.customer.addressLines[0] || ''))}${raw(field('Address line 2', 'customer.addressLines.1', d.customer.addressLines[1] || ''))}</div></section>
      <section class="card"><h2>Vessel</h2><div class="cols4">
        ${raw(field('Year', 'vessel.year', d.vessel.year))}${raw(field('Make', 'vessel.make', d.vessel.make))}${raw(field('Model', 'vessel.model', d.vessel.model))}${raw(field('Boat name', 'vessel.name', d.vessel.name))}
        ${raw(field('HIN', 'vessel.hin', d.vessel.hin))}${raw(field('FL Reg.', 'vessel.registration', d.vessel.registration))}${raw(field('Location', 'vessel.location', d.vessel.location))}</div></section>
      <section class="card"><h2>Insurance <label class="switch"><input type="checkbox" data-path="insurance.enabled" ${d.insurance.enabled ? 'checked' : ''}> claim</label></h2>
        <div class="cols4" ${d.insurance.enabled ? '' : 'hidden'}>
        ${raw(field('Carrier', 'insurance.carrier', d.insurance.carrier))}${raw(field('Claim #', 'insurance.claimNumber', d.insurance.claimNumber))}${raw(field('Date of loss', 'insurance.dateOfLoss', d.insurance.dateOfLoss, 'date'))}${raw(field('Reported', 'insurance.reportedDate', d.insurance.reportedDate, 'date'))}
        ${raw(field('Adjuster', 'insurance.adjusterName', d.insurance.adjusterName))}${raw(field('Adjuster phone', 'insurance.adjusterPhone', d.insurance.adjusterPhone, 'tel'))}${raw(field('Adjuster email', 'insurance.adjusterEmail', d.insurance.adjusterEmail, 'email'))}${raw(field('Carrier est. #', 'insurance.carrierEstimateNumber', d.insurance.carrierEstimateNumber))}
        ${raw(field('Appraiser', 'insurance.appraiserName', d.insurance.appraiserName))}${raw(field('Appraiser phone', 'insurance.appraiserPhone', d.insurance.appraiserPhone, 'tel'))}${raw(field('Appraiser email', 'insurance.appraiserEmail', d.insurance.appraiserEmail, 'email'))}${raw(field('Carrier est. date', 'insurance.carrierEstimateDate', d.insurance.carrierEstimateDate, 'date'))}</div></section>
      <section class="card lines-card"><h2>Line items</h2>
        <table class="lines"><thead><tr><th>#</th><th>Description</th><th>Hrs</th><th>Rate</th><th>Labor</th><th>Materials</th><th>Total</th><th></th></tr></thead><tbody id="lines">${raw(linesHtml())}</tbody></table>
        <div class="actions"><button type="button" class="qd-btn ghost small" data-act="add-section">+ Section</button><button type="button" class="qd-btn ghost small" data-act="add-line" data-section="">+ Line (no section)</button></div></section>
      <section class="card"><h2>Notes & terms</h2>
        <label class="qd-field"><span>Notes (printed under the lines)</span><textarea data-path="notes" rows="4">${d.notes}</textarea></label>
        <label class="qd-field"><span>Terms</span><textarea data-path="terms" rows="4">${d.terms}</textarea></label></section>
      <section class="card"><h2>Photos <span class="muted">${d.photos.length}</span></h2>
        ${d.photos.length ? raw(`<div class="photos">${d.photos.map((p, n) => `<figure><a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="" loading="lazy"></a><figcaption>Photo ${n + 1}<input data-path="photos.${esc(p.id)}.caption" value="${esc(p.caption)}" placeholder="Caption"></figcaption></figure>`).join('')}</div>`) : raw('<p class="muted">No photos on this estimate. Write “Photo 1” in a line to cross-reference the appendix.</p>')}</section>
    </div>
    <aside class="est-side">
      <section class="card"><h2>Totals</h2><div id="totals"></div>
        <div class="cols2">${raw(field('Labor rate $/hr', 'pricing.laborRate', d.pricing.laborRate, 'number', 'step="1" min="0"'))}${raw(field('Tax %', 'pricing.taxRate', d.pricing.taxRate, 'number', 'step="0.01" min="0"'))}
        ${raw(field('Tax note', 'pricing.taxNote', d.pricing.taxNote))}${raw(field('Deposit %', 'pricing.depositPct', d.pricing.depositPct, 'number', 'step="1" min="0" max="100"'))}</div></section>
      <section class="card levi" id="levi" hidden><h2>Captain Levi</h2><div id="levi-log" class="levi-log"></div>
        <form id="levi-form" class="levi-form"><textarea id="levi-input" rows="2" placeholder="Tell Captain Levi what to do with this estimate…"></textarea><button type="submit" class="qd-btn navy small">Send</button></form>
        <p class="muted" id="levi-note">Captain Levi can add, change and remove lines and fill in fields. Every change is saved as a version you can restore below.</p></section>
      <section class="card"><h2>History</h2><ul class="versions" id="versions"></ul></section>
      <section class="card"><button type="button" class="qd-btn ghost small danger" id="delete">Delete estimate</button></section>
    </aside></div>`
    paintTotals(); paintVersions(); bind()
  }

  // ----- mutations -----
  const setPath = (path, value) => {
    const parts = path.split('.')
    let obj = state.doc
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i]
      if (Array.isArray(obj) && !/^\d+$/.test(k)) { obj = obj.find((x) => x.id === k); if (!obj) return }
      else { if (obj[k] === undefined) obj[k] = /^\d+$/.test(parts[i + 1]) ? [] : {}; obj = obj[k] }
    }
    const last = parts[parts.length - 1]
    obj[last] = value
  }
  const bind = () => {
    const root = view()
    root.addEventListener('input', (e) => {
      const el = e.target; const path = el.dataset.path; if (!path) return
      let v = el.type === 'checkbox' ? el.checked : el.value
      if (el.type === 'number') v = num(el.value)
      if (path === 'directionToPay') v = el.value === 'true'
      if (path === 'revision') v = Math.max(0, Math.round(num(el.value)))
      setPath(path, v)
      if (path.startsWith('customer.addressLines')) state.doc.customer.addressLines = state.doc.customer.addressLines.map((x) => x || '')
      if (path === 'insurance.enabled' || path.endsWith('.materialsOnly')) { save.flush?.(); touch('edited'); draw(); return }
      if (path === 'status') touch(`status → ${v}`); else touch('edited')
      if (el.tagName === 'TEXTAREA') autogrow(el)
    })
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return
      const d = state.doc, act = b.dataset.act
      const tr = b.closest('tr'); const lid = tr?.dataset.line; const sid = tr?.dataset.section
      if (act === 'add-line') { d.lines.push({ id: uid(), sectionId: b.dataset.section || null, description: '', qty: 1, unit: '', hours: 0, rate: d.pricing.laborRate, materials: 0, materialsOnly: false, taxable: true }); touch('added line'); draw(); focusLast(); return }
      if (act === 'add-section') { d.sections.push({ id: uid(), title: `Section ${String.fromCharCode(65 + d.sections.length)}` }); touch('added section'); draw(); return }
      if (act === 'del' && lid) { d.lines = d.lines.filter((l) => l.id !== lid); touch('removed line'); draw(); return }
      if ((act === 'up' || act === 'down') && lid) { const l = d.lines.find((x) => x.id === lid); const sib = d.lines.filter((x) => (x.sectionId || null) === (l.sectionId || null)); const i = sib.indexOf(l); const j = act === 'up' ? i - 1 : i + 1; if (j < 0 || j >= sib.length) return; const a = d.lines.indexOf(sib[i]), bI = d.lines.indexOf(sib[j]); [d.lines[a], d.lines[bI]] = [d.lines[bI], d.lines[a]]; touch('reordered'); draw(); return }
      if (act === 'sec-del' && sid) { const i = d.sections.findIndex((s) => s.id === sid); const prev = d.sections[i - 1]?.id || null; d.lines.forEach((l) => { if (l.sectionId === sid) l.sectionId = prev }); d.sections.splice(i, 1); touch('removed section'); draw(); return }
      if ((act === 'sec-up' || act === 'sec-down') && sid) { const i = d.sections.findIndex((s) => s.id === sid); const j = act === 'sec-up' ? i - 1 : i + 1; if (j < 0 || j >= d.sections.length) return; [d.sections[i], d.sections[j]] = [d.sections[j], d.sections[i]]; touch('reordered'); draw(); return }
    })
    for (const ta of root.querySelectorAll('textarea')) autogrow(ta)
    document.getElementById('delete').addEventListener('click', async () => {
      if (!window.confirm) return
      // eslint-disable-next-line no-alert
      if (!confirm(`Delete ${state.number}? This cannot be undone.`)) return
      try { await api(`/api/admin/estimates?id=${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Deleted'); location.hash = '#/estimates' } catch (ex) { toast(ex.message) }
    })
    document.getElementById('levi-toggle').addEventListener('click', () => { const p = document.getElementById('levi'); p.hidden = !p.hidden; if (!p.hidden) { document.getElementById('levi-input').focus(); mountLevi(state, { draw, refresh: async () => { const out = await api(`/api/admin/estimates?id=${encodeURIComponent(id)}`); state.doc = out.estimate; state.totals = out.totals; state.layout = out.layout; state.versions = out.versions; draw(); document.getElementById('levi').hidden = false } }) } })
  }
  const focusLast = () => { const tas = view().querySelectorAll('tr.line textarea'); tas[tas.length - 1]?.focus() }
  const autogrow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight, 40)}px` }
  draw()
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = '' } }, { once: true })
}

// ---------- print ----------
export async function renderEstimatePrint(id) {
  if (!document.getElementById('print-css')) { const l = document.createElement('link'); l.id = 'print-css'; l.rel = 'stylesheet'; l.href = '/app/print/estimate-print.css'; document.head.appendChild(l) }
  document.body.classList.add('printing')
  view().innerHTML = '<div class="qd-empty">Loading…</div>'
  try {
    const r = await api(`/api/admin/estimates?id=${encodeURIComponent(id)}`)
    document.title = `${r.number} · ${r.estimate.customer.name || 'Estimate'}`
    view().innerHTML = `<div class="print-bar"><a class="qd-btn ghost small" href="#/estimates/${esc(id)}">← Back to editor</a><button type="button" class="qd-btn navy small" id="print-now">Print / Save as PDF</button><span class="muted">Use your browser's print dialog and choose “Save as PDF”.</span></div><div class="doc-stage">${renderEstimateHtml(r.estimate, r.business, r.totals, r.layout)}</div>`
    document.getElementById('print-now').addEventListener('click', () => window.print())
  } catch (ex) { view().innerHTML = h`<div class="qd-empty">${ex.message}</div>` }
}

export function leavePrint() { document.body.classList.remove('printing') }
