// Quote Desk: inquiries inbox + sign-in. Plain ES module, hash routes, no build step.
//   #/login · #/inquiries[?status=new] · #/inquiries/<id> · #/estimates (builder, next milestone)
const view = document.getElementById('view')
const top = document.getElementById('top')
const whoEl = document.getElementById('who')
const toastEl = document.getElementById('toast')
let me = null

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const h = (strings, ...vals) => strings.reduce((out, str, i) => out + str + (i < vals.length ? (vals[i] && vals[i].__html !== undefined ? vals[i].__html : esc(vals[i])) : ''), '')
const raw = (html) => ({ __html: html })
const fmtWhen = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d))
const ago = (d) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); if (m < 60) return `${m} min ago`; const hrs = Math.round(m / 60); if (hrs < 48) return `${hrs} h ago`; return `${Math.round(hrs / 24)} d ago` }
const boatOf = (i) => [i.boat_year, i.boat_make, i.boat_model].filter(Boolean).join(' ') || i.boat_raw || ''
const SERVICE_LABELS = { 'fiberglass-repair': 'Fiberglass Repair', 'structural-fiberglass': 'Structural Fiberglass', 'hull-repairs': 'Hull Repairs', 'deck-repairs': 'Deck Repairs', 'transom-replacement': 'Transom Replacement', 'stringer-repairs': 'Stringer Repairs', 'bulkhead-repairs': 'Bulkhead Repairs', 'custom-fabrication': 'Custom Fabrication', 'gelcoat-repair': 'Gelcoat Repair', 'boat-detailing': 'Boat Detailing', 'boat-restoration': 'Boat Restoration', 'boat-yard': 'Boat Yard', 'pwc-repair': 'Jet Ski / PWC', 'kayak-repair': 'Kayak Repair', 'insurance-claim': 'Insurance Claim', other: 'Other' }
const serviceLabel = (v) => SERVICE_LABELS[v] || v
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', closed: 'Closed' }

let toastTimer
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.hidden = true), 2600) }

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }, method: opts.method || (opts.body ? 'POST' : 'GET'), body: opts.body ? JSON.stringify(opts.body) : undefined })
  let json = null
  try { json = await res.json() } catch { /* empty */ }
  if (res.status === 401 && !path.startsWith('/api/auth/')) { me = null; location.hash = '#/login'; throw new Error('Signed out') }
  if (!res.ok) throw new Error((json && json.error) || `Request failed (${res.status})`)
  return json
}

// ---------- routing ----------
function parseHash() {
  const [path, qs] = (location.hash.replace(/^#/, '') || '/inquiries').split('?')
  const segs = path.split('/').filter(Boolean)
  return { segs, params: new URLSearchParams(qs || '') }
}

async function render() {
  const { segs, params } = parseHash()
  if (!me) { try { me = (await api('/api/auth/me')).staff } catch { me = null } }
  if (!me) { renderLogin(); return }
  top.hidden = false
  whoEl.textContent = me.email
  for (const a of document.querySelectorAll('[data-nav]')) a.toggleAttribute('aria-current', a.dataset.nav === segs[0]) || (a.dataset.nav === segs[0] ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'))
  if (segs[0] === 'login') { location.hash = '#/inquiries'; return }
  if (segs[0] === 'inquiries' && segs[1]) return renderInquiry(segs[1])
  if (segs[0] === 'inquiries') return renderInbox(params.get('status') || '')
  if (segs[0] === 'estimates') return renderComingSoon('Estimates')
  location.hash = '#/inquiries'
}

// ---------- login ----------
function renderLogin() {
  top.hidden = true
  view.innerHTML = h`<form class="qd-login" id="login">
    <h1>Quote Desk</h1><p>Sign in with your staff email.</p>
    <div class="qd-error" id="login-err" hidden></div>
    <label class="qd-field"><span>Email</span><input type="email" name="email" autocomplete="username" required autofocus></label>
    <label class="qd-field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required></label>
    <button class="qd-btn navy" type="submit">Sign in</button>
  </form>`
  const form = document.getElementById('login')
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const err = document.getElementById('login-err'); err.hidden = true
    const btn = form.querySelector('button'); btn.disabled = true
    try {
      const r = await api('/api/auth/login', { body: { email: form.email.value, password: form.password.value } })
      me = r.staff
      location.hash = '#/inquiries'
      render()
    } catch (ex) { err.textContent = ex.message; err.hidden = false } finally { btn.disabled = false }
  })
}

document.getElementById('signout').addEventListener('click', async () => { try { await api('/api/auth/logout', { method: 'POST', body: {} }) } catch { /* ignore */ } me = null; location.hash = '#/login'; render() })

// ---------- inbox ----------
async function renderInbox(status) {
  view.innerHTML = h`<div class="qd-head"><h1>Inquiries</h1><div class="spacer"></div>
    <div class="qd-tabs" role="group" aria-label="Filter">${raw(['', 'new', 'contacted', 'quoted', 'closed'].map((s) => `<button type="button" data-status="${s}" aria-pressed="${s === status}">${s ? STATUS_LABEL[s] : 'All'}</button>`).join(''))}</div></div>
    <div id="list"><div class="qd-empty">Loading…</div></div>`
  for (const b of view.querySelectorAll('[data-status]')) b.addEventListener('click', () => { location.hash = b.dataset.status ? `#/inquiries?status=${b.dataset.status}` : '#/inquiries' })
  const list = document.getElementById('list')
  try {
    const r = await api(`/api/admin/inquiries?limit=100${status ? `&status=${status}` : ''}`)
    if (!r.items.length) { list.innerHTML = '<div class="qd-empty">No inquiries here yet. New quote requests from the website show up within seconds.</div>'; return }
    list.innerHTML = h`<table class="qd-table"><thead><tr><th>Ref</th><th>Customer</th><th>Service · boat</th><th>Ready to quote?</th><th>Photos</th><th>Received</th><th>Status</th></tr></thead><tbody>${raw(r.items.map((i) => `
      <tr class="row" data-id="${esc(i.id)}">
        <td class="ref">${esc(i.ref)}${i.insurance ? ' <span class="badge ins">INS</span>' : ''}</td>
        <td>${esc(i.name)}<span class="sub">${esc(i.email)} · ${esc(i.phone)}</span></td>
        <td>${esc(serviceLabel(i.service))}<span class="sub">${esc(boatOf(i) || 'boat not given')}</span></td>
        <td><span class="badge ${esc(i.readiness)}">${i.readiness === 'ready' ? 'Ready' : i.readiness === 'nearly' ? 'Nearly' : 'Needs info'}</span><span class="sub">${i.gap_count ? `${i.gap_count} missing` : 'all details in'}</span></td>
        <td>${i.photos.length}</td>
        <td>${esc(ago(i.created_at))}<span class="sub">${esc(fmtWhen(i.created_at))}${i.email_status && i.email_status !== 'sent' ? ` · email ${esc(i.email_status.replace('_', ' '))}` : ''}</span></td>
        <td><span class="badge ${esc(i.status)}">${esc(STATUS_LABEL[i.status] || i.status)}</span></td>
      </tr>`).join(''))}</tbody></table>`
    for (const tr of list.querySelectorAll('tr.row')) tr.addEventListener('click', () => { location.hash = `#/inquiries/${tr.dataset.id}` })
  } catch (ex) { list.innerHTML = h`<div class="qd-empty">${ex.message}</div>` }
}

// ---------- inquiry detail ----------
async function renderInquiry(id) {
  view.innerHTML = '<div class="qd-empty">Loading…</div>'
  let r
  try { r = await api(`/api/admin/inquiries?id=${encodeURIComponent(id)}`) } catch (ex) { view.innerHTML = h`<div class="qd-empty">${ex.message}</div>`; return }
  const i = r.inquiry, a = r.assessment, reply = r.reply
  const mailto = `mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent(reply.subject)}&body=${encodeURIComponent(reply.body)}`
  view.innerHTML = h`
    <div class="qd-head"><a href="#/inquiries" class="qd-btn ghost small">← Inquiries</a><h1>${i.ref} · ${i.name}</h1>
      <span class="badge ${a.readiness}">${a.readiness === 'ready' ? 'Ready to quote' : a.readiness === 'nearly' ? 'Nearly ready' : 'Needs info'}</span>${a.insurance ? raw('<span class="badge ins">Insurance claim</span>') : ''}
      <div class="spacer"></div>
      <label class="qd-field" style="margin:0"><span>Status</span><select id="status">${raw(Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${v === i.status ? 'selected' : ''}>${l}</option>`).join(''))}</select></label>
      <a class="qd-btn navy" href="#/estimates/new?inquiry=${i.id}">Start estimate →</a>
    </div>
    <div class="qd-grid">
      <div>
        <section class="card"><h2>Customer</h2><dl class="kv">
          <dt>Name</dt><dd>${i.name}</dd><dt>Email</dt><dd><a href="mailto:${i.email}">${i.email}</a></dd><dt>Phone</dt><dd><a href="tel:${i.phone.replace(/[^\d+]/g, '')}">${i.phone}</a></dd>
          <dt>Received</dt><dd>${fmtWhen(i.created_at)} · via website ${i.source}${i.page ? ` · page ${i.page}` : ''}</dd></dl></section>
        <section class="card"><h2>Boat & request</h2><dl class="kv">
          <dt>Service</dt><dd>${serviceLabel(i.service)}</dd><dt>Boat</dt><dd>${boatOf(i) || '—'}</dd><dt>Where it is</dt><dd>${i.boat_location || '—'}</dd>
          <dt>Damage area</dt><dd>${i.damage_location || a.mentions.area || '—'}</dd><dt>Damage type</dt><dd>${i.damage_type || '—'}</dd></dl>
          <h3 style="margin-top:14px">Message</h3><div class="msg">${i.message}</div></section>
        <section class="card"><h2>Photos <span class="muted">${i.photos.length}</span></h2>
          ${i.photos.length ? raw(`<div class="photos">${i.photos.map((p) => `<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(p.filename)}" loading="lazy"></a>`).join('')}</div>`) : raw('<p class="muted">No photos attached. The reply asks for them first.</p>')}</section>
        ${r.chat ? raw(`<section class="card"><h2>Chat transcript</h2>${(r.chat.messages || []).map((m) => `<p><strong>${m.role === 'user' ? 'Customer' : 'Captain Levi'}:</strong> ${esc(m.text)}</p>`).join('')}</section>`) : ''}
      </div>
      <div>
        <section class="card"><h2>What we still need</h2>
          ${a.gaps.length ? raw(`<ul class="gaps">${a.gaps.map((g) => `<li><span class="dot p${g.priority}"></span><div><strong>${esc(g.label)}</strong><span class="why">${esc(g.why)}</span></div></li>`).join('')}</ul>`) : raw('<p>Everything needed for a first estimate is here. Go straight to the builder.</p>')}
          <p class="muted" style="margin:10px 0 0">Red = cannot quote without it · amber = changes the job · grey = nice to have.</p></section>
        <section class="card"><h2>Reply to send</h2>
          <p class="muted" style="margin-top:-6px">Captain Levi's words, built from the gaps above. Edit anything, then copy or open it in your mail app. Nothing is sent from here.</p>
          <label class="qd-field"><span>Subject</span><input id="reply-subject" value="${reply.subject}"></label>
          <label class="qd-field"><span>Message</span><textarea id="reply-body">${reply.body}</textarea></label>
          <div class="actions"><button type="button" class="qd-btn" id="copy">Copy message</button><a class="qd-btn navy" id="mailto" href="${mailto}">Open in email</a><button type="button" class="qd-btn ghost" id="mark-contacted">Mark contacted</button></div></section>
        <section class="card"><h2>Email to the shop</h2>
          ${r.deliveries.length ? raw(`<ul class="deliv">${r.deliveries.map((d) => `<li><span class="badge ${d.status === 'sent' ? 'quoted' : d.status === 'failed' ? 'needs_info' : 'contacted'}">${esc(d.status.replace('_', ' '))}</span><span>${esc(d.to)}</span>${d.status !== 'sent' ? `<button type="button" class="qd-btn ghost small" data-retry="${esc(d.id)}">Send now</button>` : `<span class="muted">${esc(fmtWhen(d.sent_at))}</span>`}</li>`).join('')}</ul>`) : raw('<p class="muted">No email recorded for this inquiry.</p>')}</section>
      </div>
    </div>`

  const subj = document.getElementById('reply-subject'), body = document.getElementById('reply-body'), mail = document.getElementById('mailto')
  const syncMail = () => { mail.href = `mailto:${encodeURIComponent(i.email)}?subject=${encodeURIComponent(subj.value)}&body=${encodeURIComponent(body.value)}` }
  subj.addEventListener('input', syncMail); body.addEventListener('input', syncMail)
  document.getElementById('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(body.value); toast('Reply copied') } catch { body.select(); toast('Select all and copy') } })
  const setStatus = async (status) => { try { await api(`/api/admin/inquiries?id=${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } }); toast(`Marked ${STATUS_LABEL[status].toLowerCase()}`); document.getElementById('status').value = status } catch (ex) { toast(ex.message) } }
  document.getElementById('status').addEventListener('change', (e) => setStatus(e.target.value))
  document.getElementById('mark-contacted').addEventListener('click', () => setStatus('contacted'))
  for (const b of view.querySelectorAll('[data-retry]')) b.addEventListener('click', async () => {
    b.disabled = true
    try { const out = await api(`/api/admin/retry-email?id=${encodeURIComponent(b.dataset.retry)}`, { method: 'POST', body: {} }); toast(out.ok ? 'Email sent' : `Not sent: ${out.reason || out.delivery.status}`); renderInquiry(id) } catch (ex) { toast(ex.message); b.disabled = false }
  })
}

function renderComingSoon(what) {
  view.innerHTML = h`<div class="coming"><h1>${what}</h1><p>The quote builder is the next piece being built. Inquiries already land in the inbox and can be answered from there.</p><a class="qd-btn navy" href="#/inquiries">Back to inquiries</a></div>`
}

window.addEventListener('hashchange', render)
render()
