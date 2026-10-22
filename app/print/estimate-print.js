// The printed estimate ("Rev. 5" paper) as an HTML string. Plain ES module, no dependencies, no DOM
// access — it only builds markup. Ported from the retired ESTIMATER's Paper.tsx; pagination is left
// to CSS (estimate-print.css: break-inside / break-before), not measured in JS.
//
// renderEstimateHtml(estimate, business, totals, layout)
//   estimate — a normalized document (lib/estimates/types.ts `Estimate`)
//   business — { name, legalName?, phone, email, website?, address: {street,city,state,zip} | string,
//                payableTo?, logoUrl? }  (never hard-coded here)
//   totals   — calcTotals(estimate) from lib/estimates/calc.ts (integer cents)
//   layout   — layoutLines(estimate): section letters + continuous line numbers
//
// Every string that reaches the markup goes through esc(). Money arrives as integer cents and is only
// formatted here; nothing in this file does pricing arithmetic.

const DASH = '—'

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Formatting (mirrors lib/estimates/calc.ts) ────────────────────────────────

export function formatMoney(cents) {
  const n = Math.round(Number.isFinite(cents) ? cents : 0)
  const abs = Math.abs(n)
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n < 0 ? '-' : ''}$${whole}.${String(abs % 100).padStart(2, '0')}`
}

export function formatHours(hours) {
  return Number.isInteger(hours) ? hours.toFixed(1) : String(Math.round(hours * 100) / 100)
}

export function formatDateNumeric(value) {
  if (!value) return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return String(value)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (Number.isNaN(d.getTime())) return String(value)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(value) {
  if (!value) return ''
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

export function splitDescription(description) {
  const [first = '', ...rest] = String(description ?? '').split('\n')
  return { title: first.trim(), body: rest.join('\n').trim() }
}

export function laborLabel(t) {
  const hrs = Math.round(t.laborHours * 100) / 100
  if (t.uniformRateCents == null) return t.laborHours > 0 ? `Labor (${hrs} hrs, mixed rates)` : 'Labor'
  return `Labor (${hrs} hrs @ $${(t.uniformRateCents / 100).toFixed(2)})`
}

export function pricingNote(estimate) {
  const p = estimate.pricing
  const rate = `Labor rate: $${(Math.round(p.laborRate * 100) / 100).toFixed(2)}/hr`
  const pct = `${Math.round(p.taxRate * 1000) / 1000}%`
  const breakdown = p.taxNote && p.taxNote.trim() ? ` (${p.taxNote.trim()})` : ''
  return `${rate}  ·  Sales tax: ${pct}${breakdown} on the total repair charge.`
}

export function documentTitle(estimate) {
  if (estimate.docKind === 'supplement') {
    return { title: 'REPAIR ESTIMATE', subtitle: estimate.revision > 0 ? `SUPPLEMENT REQUEST — REV. ${estimate.revision}` : 'SUPPLEMENT REQUEST' }
  }
  return { title: 'REPAIR ESTIMATE' }
}

export function estimateNumberLabel(estimate) {
  return estimate.revision > 0 ? `${estimate.number}-R${estimate.revision}` : estimate.number
}

// ─── Business helpers ──────────────────────────────────────────────────────────

/** "11600 66th St N, Largo, FL 33773" — blank parts left out */
export function formatAddress(address) {
  if (!address) return ''
  if (typeof address === 'string') return address.trim()
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  return [address.street, cityLine].filter(Boolean).join(', ')
}

/** "12 Dock St, Tampa, FL 33602  ·  (813) 555-0100  ·  …" */
export function businessContactLine(business) {
  return [formatAddress(business.address), business.phone, business.website, business.email]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('  ·  ')
}

function payableTo(business) {
  return business.payableTo || business.legalName || business.name || ''
}

function businessState(business) {
  const a = business.address
  return (a && typeof a === 'object' && a.state && String(a.state).trim()) || 'FL'
}

/** "Claim # … · Owner · Year Model" on insurance documents, else "Shop · phone" */
export function runningFooter(estimate, business) {
  if (estimate.insurance.enabled) {
    const vessel = vesselLine(estimate)
    return [estimate.insurance.claimNumber ? `Claim # ${estimate.insurance.claimNumber}` : '', estimate.customer.name, vessel].filter(Boolean).join(' · ')
  }
  return [business.name, business.phone].filter(Boolean).join(' · ')
}

function vesselLine(estimate) {
  const v = estimate.vessel
  return [v.year, v.make, v.model].map((s) => String(s ?? '').trim()).filter(Boolean).join(' ')
}

// ─── Markup helpers ────────────────────────────────────────────────────────────

const field = (k, v) => `<span class="k">${esc(k)}</span><span class="v">${v}</span>`
const text = (v) => esc(v)
const multiline = (v) => esc(v).replace(/\r?\n/g, '<br>')

/** Link "Photo 3" / "Photos 2 and 4" mentions in a line to the appendix figures that exist. */
function linkPhotoRefs(escaped, photoCount) {
  if (!photoCount) return escaped
  return escaped.replace(/\bPhoto\s+(\d+)\b/g, (m, n) => {
    const i = Number(n)
    return i >= 1 && i <= photoCount ? `<a class="doc-photo-ref" href="#photo-${i}">${m}</a>` : m
  })
}

/** Lines that mention "Photo N" for each N, so the appendix can point back. */
function photoBackRefs(layout) {
  const refs = new Map()
  for (const p of layout.all) {
    for (const m of String(p.line.description).matchAll(/\bPhoto\s+(\d+)\b/g)) {
      const n = Number(m[1])
      if (!refs.has(n)) refs.set(n, [])
      if (!refs.get(n).includes(p.number)) refs.get(n).push(p.number)
    }
  }
  return refs
}

function contact(name, phone, email) {
  const first = [name, phone].map((s) => String(s ?? '').trim()).filter(Boolean).join('  ')
  return `<span>${esc(first)}</span>${email ? `<span class="doc-sub">${esc(email)}</span>` : ''}`
}

// ─── The document ──────────────────────────────────────────────────────────────

export function renderEstimateHtml(estimate, business, totals, layout) {
  const ins = estimate.insurance
  const insured = Boolean(ins.enabled)
  const dtp = insured && Boolean(estimate.directionToPay)
  const title = documentTitle(estimate)
  const photos = Array.isArray(estimate.photos) ? estimate.photos : []
  const byId = new Map(totals.lines.map((c) => [c.id, c]))
  const vessel = vesselLine(estimate)
  const stateReg = `${businessState(business)} Reg.`
  const payable = payableTo(business)
  const bizAddress = formatAddress(business.address)

  const row = (p) => {
    const line = p.line
    const c = byId.get(line.id) || { laborHours: 0, rateCents: 0, laborCents: 0, materialsCents: 0, lineTotalCents: 0 }
    const { title: lineTitle, body } = splitDescription(line.description)
    const hours = line.materialsOnly ? 0 : line.hours
    return `<tr id="line-${esc(line.id)}">
<td class="idx">${p.number}</td>
<td class="l"><div class="doc-line-title">${lineTitle ? linkPhotoRefs(esc(lineTitle), photos.length) : body ? '' : '<span class="doc-dim">(no description)</span>'}</div>${
      body ? `<div class="doc-line-body">${linkPhotoRefs(multiline(body), photos.length)}</div>` : ''
    }</td>
<td>${hours ? esc(formatHours(hours)) : DASH}</td>
<td>${hours ? esc(formatMoney(c.rateCents)) : DASH}</td>
<td>${hours ? esc(formatMoney(c.laborCents)) : DASH}</td>
<td>${c.materialsCents ? esc(formatMoney(c.materialsCents)) : DASH}</td>
<td class="total">${esc(formatMoney(c.lineTotalCents))}</td>
</tr>`
  }

  const rows = []
  for (const p of layout.unsectioned) rows.push(row(p))
  for (const s of layout.sections) {
    if (!s.lines.length) continue
    rows.push(`<tr class="doc-sec"><td colspan="7">${esc(s.heading)}</td></tr>`)
    for (const p of s.lines) rows.push(row(p))
  }

  const head = `<header class="doc-head">
${business.logoUrl ? `<img class="doc-logo" src="${esc(business.logoUrl)}" alt="">` : ''}
<div class="doc-biz">${text(business.name)}</div>
<div class="doc-contact">${text(businessContactLine(business))}</div>
</header>
<div class="doc-rule"></div>
<div class="doc-titlebar">
<div><div class="doc-title">${esc(title.title)}</div>${title.subtitle ? `<div class="doc-subtitle">${esc(title.subtitle)}</div>` : ''}</div>
<div class="doc-meta">
<span>Estimate No.</span><span class="v">${text(estimateNumberLabel(estimate))}</span>
<span>Date</span><span class="v">${text(formatDate(estimate.estimateDate))}</span>
</div>
</div>`

  const cust = estimate.customer
  const customerBox = `<section class="doc-box">
<div class="doc-box-title">${insured ? 'Owner / Insured' : 'Customer'}</div>
<div class="doc-fields">
${field('Name', text(cust.name))}
${cust.company ? field('Company', text(cust.company)) : ''}
${field('Phone', text(cust.phone))}
${field('Address', (cust.addressLines || []).map(esc).join('<br>'))}
${field('Email', text(cust.email))}
</div>
</section>`

  const v = estimate.vessel
  const vesselBox = `<section class="doc-box">
<div class="doc-box-title">Vessel</div>
<div class="doc-fields">
${field('Year / Model', text(vessel))}
${v.name ? field('Boat Name', text(v.name)) : ''}
${field('HIN', text(v.hin))}
${field(stateReg, text(v.registration))}
${field('Location', text(v.location))}
</div>
</section>`

  const insuranceBox = insured
    ? `<section class="doc-insurance">
<div class="doc-box-title">Insurance Claim Information</div>
<div class="cols">
<div class="doc-fields">
${field('Carrier', text(ins.carrier))}
${field('Claim #', text(ins.claimNumber))}
${field('Date of Loss', text(formatDateNumeric(ins.dateOfLoss)))}
${field('Reported', text(formatDateNumeric(ins.reportedDate)))}
</div>
<div class="doc-fields">
${field('Adjuster', contact(ins.adjusterName, ins.adjusterPhone, ins.adjusterEmail))}
${field('Appraiser', contact(ins.appraiserName, ins.appraiserPhone, ins.appraiserEmail))}
${field('Carrier Est.', text([ins.carrierEstimateNumber, ins.carrierEstimateDate ? `(Original, ${formatDateNumeric(ins.carrierEstimateDate)})` : ''].filter(Boolean).join(' ')))}
</div>
</div>
</section>`
    : `<section class="doc-insurance">
<div class="doc-box-title">Insurance Claim Information (If Applicable)</div>
<div class="cols">
<div class="doc-fields">${field('Carrier', 'N/A')}${field('Claim #', 'N/A')}${field('Date of Loss', 'N/A')}</div>
<div class="doc-fields">${field('Adjuster', 'N/A')}${field('Contact', 'N/A')}${field('Carrier Est.', 'N/A')}</div>
</div>
</section>`

  const table = `<table class="doc-table">
<colgroup><col style="width:26px"><col><col style="width:44px"><col style="width:66px"><col style="width:74px"><col style="width:84px"><col style="width:84px"></colgroup>
<thead><tr><th class="l">#</th><th class="l">Description of Work</th><th>Hrs</th><th>Rate</th><th>Labor</th><th>Materials</th><th>Line Total</th></tr></thead>
<tbody>
${rows.join('\n')}
</tbody>
</table>`

  const trow = (k, val, cls = '') => `<div class="t-row${cls ? ` ${cls}` : ''}"><span>${esc(k)}</span><span class="v">${esc(val)}</span></div>`
  const depositPct = Number(totals.depositPct) || 0
  const bottom = `<div class="doc-bottom">
<div>
<div class="doc-notes-title">NOTES</div>
<div class="doc-notes${estimate.notes.trim() ? '' : ' empty-lines'}">${multiline(estimate.notes)}</div>
<div class="doc-pricing-note">${esc(pricingNote(estimate))}</div>
<div class="doc-payable">${
    dtp ? `Payment: by check payable to <strong>${esc(payable)}</strong>. See the Direction to Pay page.` : `Make payment payable to <strong>${esc(payable)}</strong>.`
  }</div>
</div>
<div class="doc-totals">
${trow(laborLabel(totals), formatMoney(totals.laborCents))}
${trow('Materials', formatMoney(totals.materialsCents))}
${trow('Subtotal', formatMoney(totals.subtotalCents))}
${trow(`Sales Tax (${Math.round(totals.taxRate * 1000) / 1000}%)`, formatMoney(totals.taxCents))}
<div class="t-row t-total"><span>ESTIMATE TOTAL</span><span class="v">${esc(formatMoney(totals.totalCents))}</span></div>
${depositPct > 0 ? trow(`Deposit Due (${Math.round(depositPct * 100) / 100}%)`, formatMoney(totals.depositCents), 't-bold') + trow('Remaining Balance', formatMoney(totals.remainingCents)) : ''}
</div>
</div>`

  const terms = `<div class="doc-terms"><strong>Terms:</strong> ${multiline(estimate.terms)}</div>`

  const sigs = `<div class="doc-sigs">
<div class="doc-sig"><div class="line"><span>${insured ? 'Owner / Insured signature (authorizes work)' : 'Customer signature (authorizes work)'}</span><span>Date</span></div></div>
<div class="doc-sig"><div class="line"><span>${esc(business.name)} representative</span><span>Date</span></div></div>
</div>`

  let dtpPage = ''
  if (dtp) {
    const dtpVessel = [vessel, v.hin ? `HIN ${v.hin}` : '', v.registration].filter(Boolean).join('  ·  ')
    const facility = [bizAddress, business.phone].filter(Boolean)
    const dtpRow = (k, val) => `<div class="doc-dtp-row"><span class="k">${esc(k)}</span><span class="v">${val}</span></div>`
    dtpPage = `<section class="doc-dtp" aria-label="Direction to Pay">
<h2 class="doc-page-title">Direction to Pay</h2>
<div class="doc-dtp-rows">
${dtpRow('Insured / Owner', `<strong>${esc(cust.name)}</strong>`)}
${dtpRow('Carrier', esc(ins.carrier))}
${dtpRow('Claim #', `<strong>${esc(ins.claimNumber)}</strong>`)}
${dtpRow('Vessel', esc(dtpVessel))}
${dtpRow('Repair Facility', `<strong>${esc(business.name)}</strong>${facility.map((part, i) => esc(i === 0 ? `, ${part}` : `  ·  ${part}`)).join('')}`)}
${dtpRow('Amount (this estimate)', `<strong>${esc(formatMoney(totals.totalCents))}</strong>`)}
</div>
<p class="doc-dtp-text">I, the undersigned insured, authorize and direct ${esc(ins.carrier || 'the carrier')} to issue payment for repairs to the above vessel under Claim # ${esc(ins.claimNumber || '________')} directly to the repair facility named above.</p>
<div class="doc-dtp-box">
<div><strong>Payment method: Check</strong></div>
<div>Payable to: <strong>${esc(payable)}</strong></div>
<div>Mail to: ${esc([business.name, bizAddress].filter(Boolean).join(', '))}</div>
</div>
<p class="doc-dtp-text">If the carrier's policy requires the check to be issued jointly to the insured and the repair facility, I agree to endorse it to ${esc(payable)} upon receipt. This direction applies only to amounts paid for repairs to the above vessel under this claim.</p>
<div class="doc-sigs doc-dtp-sigs">
<div class="doc-sig"><div class="line"><span>Insured signature${cust.name ? ` — ${esc(cust.name)}` : ''}</span><span>Date</span></div></div>
<div class="doc-sig"><div class="line"><span>Printed name</span></div></div>
</div>
</section>`
  }

  let appendix = ''
  if (photos.length) {
    const backRefs = photoBackRefs(layout)
    const figures = photos.map((photo, i) => {
      const n = i + 1
      const lines = backRefs.get(n) || []
      return `<figure class="doc-fig" id="photo-${n}">
<figcaption class="doc-fig-title">Photo ${n}${photo.caption ? ` — ${esc(photo.caption)}` : ''}</figcaption>
<div class="doc-fig-img"><img src="${esc(photo.url)}" alt="${esc(photo.caption || `Photo ${n}`)}" loading="lazy"></div>
${lines.length ? `<div class="doc-fig-back">${lines.map((ln) => `<a href="#line-${esc(layout.all.find((p) => p.number === ln).line.id)}">↑ Line ${ln}</a>`).join('  ·  ')}</div>` : ''}
</figure>`
    })
    appendix = `<section class="doc-appendix" aria-label="Photo Appendix">
<h2 class="doc-page-title">Photo Appendix</h2>
${figures.join('\n')}
</section>`
  }

  const footer = `<footer class="doc-foot"><span>${esc(runningFooter(estimate, business))}</span><span>${esc(estimateNumberLabel(estimate))}</span></footer>`

  return `<article class="paper doc-estimate" data-estimate="${esc(estimate.id)}">
${head}
<div class="doc-boxes">${customerBox}${vesselBox}</div>
${insuranceBox}
${table}
${bottom}
${terms}
${sigs}
${dtpPage}
${appendix}
${footer}
</article>`
}
