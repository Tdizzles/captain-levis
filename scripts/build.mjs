#!/usr/bin/env node
// Stamps the shared page chrome (header, breadcrumb, pager, quote form, footer, chat widget,
// consent banner, head metadata) into every *.html page in the repo root, in place.
// Idempotent: rendered blocks are wrapped in <!-- build:x --> markers; legacy copies of the
// blocks (pages built before this script existed) are detected by their root element.
//
//   node scripts/build.mjs            # build all pages + sitemap.xml + sitemap.html + robots.txt
//   node scripts/build.mjs page.html  # one page
//   node scripts/build.mjs --check    # exit 1 if any page would change (CI)
//
// No dependencies. Page-specific data lives in site/pages.json, business facts in site/business.json.

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const CHECK = args.includes('--check')
const only = args.filter((a) => a.endsWith('.html')).map((a) => path.basename(a))

const biz = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/business.json'), 'utf8'))
const regPath = path.join(ROOT, 'site/pages.json')
const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'))
const PAGES = reg.pages

const partial = (name) => fs.readFileSync(path.join(ROOT, 'partials', name + '.html'), 'utf8').replace(/\r\n/g, '\n').trimEnd()
const tpl = (s, vars) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ''))
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s) => String(s).replace(/&rsquo;/g, '’').replace(/&lsquo;/g, '‘').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&hellip;/g, '…').replace(/&nbsp;/g, ' ')
const hashOf = (file) => {
  const p = path.join(ROOT, file)
  if (!fs.existsSync(p)) return null
  return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex').slice(0, 10)
}
const mark = (name, html) => `<!-- build:${name} -->\n${html}\n<!-- /build:${name} -->`
const markedRe = (name) => new RegExp(`<!-- build:${name} -->[\\s\\S]*?<!-- /build:${name} -->\\n?`)

const UPLOAD = { maxPhotos: 5, maxPhotoMb: 10 }
const SITE = biz.siteUrl.replace(/\/$/, '')

const base = {
  phone: biz.phone,
  phoneHref: biz.phoneHref,
  email: biz.email,
  street: biz.address.street,
  city: biz.address.city,
  state: biz.address.state,
  zip: biz.address.zip,
  mapsUrl: biz.address.mapsUrl,
  mapsEmbed: biz.address.mapsEmbed,
  hours: biz.hours.display.replace(/–/g, '&ndash;'),
  hoursNote: biz.hours.note,
  year: String(new Date().getFullYear()),
  legalName: biz.legalName,
  turnstileSiteKey: biz.turnstileSiteKey,
  maxPhotos: String(UPLOAD.maxPhotos),
  maxPhotoMb: String(UPLOAD.maxPhotoMb),
}

// ---------- registry helpers ----------
const labelFromTitle = (title) => unesc(title.split('|')[0]).trim()
const chain = (slug) => {
  const out = []
  let cur = slug
  const seen = new Set()
  while (cur && PAGES[cur] && !seen.has(cur)) {
    seen.add(cur)
    out.unshift(cur)
    cur = PAGES[cur].parent
  }
  return out
}
const topAncestor = (slug) => {
  const c = chain(slug)
  // first element under the services hub, or the page itself
  const i = c.indexOf('fiberglass-boat-repair')
  return i >= 0 && c[i + 1] ? c[i + 1] : c[0]
}
const siblings = (slug) => {
  const parent = PAGES[slug]?.parent
  if (!parent) return []
  return Object.entries(PAGES)
    .filter(([s, m]) => m.parent === parent && fs.existsSync(path.join(ROOT, s + '.html')))
    .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99))
    .map(([s]) => s)
}
const cleanUrl = (slug) => (slug === 'index' ? `${SITE}/` : `${SITE}/${slug}`)

// ---------- block builders ----------
function renderHeader(slug, vars) {
  let html = tpl(partial('header'), vars)
  // mark the current page in the nav
  html = html.replace(new RegExp(`<a href="${slug}\\.html"(?![^>]*aria-current)`, 'g'), `<a href="${slug}.html" aria-current="page"`)
  const top = topAncestor(slug)
  if (top && top !== slug) html = html.replace(new RegExp(`<a href="${top}\\.html"(?![^>]*aria-current)`), `<a href="${top}.html" class="is-ancestor"`)
  return html
}

function renderBreadcrumb(slug) {
  if (slug === 'index') return ''
  const trail = chain(slug)
  const items = ['index', ...trail.filter((s) => s !== 'index')]
  const lis = items.map((s, i) => {
    const label = esc(PAGES[s]?.label || labelFromTitle(titleOf(s)))
    const last = i === items.length - 1
    return last
      ? `<li aria-current="page">${label}</li>`
      : `<li><a href="${s}.html">${label}</a></li>`
  })
  return `<nav class="breadcrumb" aria-label="Breadcrumb"><div class="container"><ol>${lis.join('')}</ol></div></nav>`
}

function renderPager(slug) {
  const sibs = siblings(slug)
  if (sibs.length < 2) return ''
  const i = sibs.indexOf(slug)
  if (i < 0) return ''
  const parent = PAGES[slug].parent
  const prev = sibs[(i - 1 + sibs.length) % sibs.length]
  const next = sibs[(i + 1) % sibs.length]
  const L = (s) => esc(PAGES[s]?.label || s)
  return `<nav class="pager" aria-label="More ${esc(PAGES[parent]?.label || 'services')}">
  <div class="container pager-inner">
    <a class="pager-link pager-prev" href="${prev}.html" rel="prev"><span class="pager-arrow" aria-hidden="true">&lsaquo;</span><span class="pager-text"><small>Previous</small>${L(prev)}</span></a>
    <a class="pager-all" href="${parent}.html">All ${L(parent)}<span class="pager-count">${i + 1} of ${sibs.length}</span></a>
    <a class="pager-link pager-next" href="${next}.html" rel="next"><span class="pager-text"><small>Next</small>${L(next)}</span><span class="pager-arrow" aria-hidden="true">&rsaquo;</span></a>
  </div>
</nav>`
}

function renderContact(slug, meta, vars) {
  const options = reg.services.map((o) => {
    const sel = o.value === (meta.service || '') ? ' selected' : ''
    const dis = o.value === '' ? ' disabled' : ''
    return `<option value="${o.value}"${dis}${sel}>${esc(o.label)}</option>`
  }).join('\n                ')
  const full = meta.variant === 'full'
  const strip = full ? `
  <div class="contact-strip">
    <div class="container contact-strip-inner">
      <div class="strip-brand">
        <svg width="54" height="26" viewBox="0 0 54 26" fill="none" aria-hidden="true"><path d="M2 17h44l-5 6H9z" fill="#fff"/><path d="M12 17l4-6h17l5 6" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M20 11l3-5h7l2 5" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M1 25c5-2 9 0 13-1s8-2 13-1 9 1 13 0 9-1 13 0" stroke="#fff" stroke-width="1.2" stroke-linecap="round" opacity=".7"/></svg>
        <span><strong>Expert Marine Repairs</strong><small>ON THE WATER. FOR THE WATER.</small></span>
      </div>
      <i class="strip-rule" aria-hidden="true"></i>
      <p class="strip-meta">TAMPA BAY <span>|</span> LARGO, FL <span>|</span> <a href="${vars.phoneHref}">${vars.phone}</a></p>
    </div>
  </div>` : ''
  return tpl(partial('contact'), {
    ...vars,
    slug,
    lead: meta.lead || 'Have a question, need a quote, or ready to schedule a repair? Fill out the form or give us a call &mdash; we&rsquo;ll get back to you as soon as possible. Your boat deserves the best, and we&rsquo;re here to make it happen.',
    serviceOptions: options,
    formKind: meta.formKind || 'quote',
    infoCard: full ? tpl(partial('contact-info'), vars) : '',
    strip,
  })
}

function renderHead(slug, meta, title, desc) {
  const url = cleanUrl(slug)
  const robots = meta.noindex ? '<meta name="robots" content="noindex, nofollow">' : ''
  const trail = chain(slug)
  const items = ['index', ...trail.filter((s) => s !== 'index')]
  const ld = []
  if (slug === 'index') {
    const oh = biz.hours.schema.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: h.days, opens: h.opens, closes: h.closes }))
    ld.push({
      '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': `${SITE}/#business`,
      name: biz.name, legalName: biz.legalName, url: `${SITE}/`, telephone: '+1-' + biz.phone, email: biz.email,
      image: `${SITE}/assets/logo.png`,
      address: { '@type': 'PostalAddress', streetAddress: biz.address.street, addressLocality: biz.address.city, addressRegion: biz.address.state, postalCode: biz.address.zip, addressCountry: 'US' },
      geo: { '@type': 'GeoCoordinates', latitude: biz.address.lat, longitude: biz.address.lng },
      openingHoursSpecification: oh,
      areaServed: biz.serviceArea.map((n) => ({ '@type': 'City', name: n })),
      priceRange: '$$',
    })
  } else if (items.length > 1) {
    ld.push({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: items.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: PAGES[s]?.label || labelFromTitle(titleOf(s)), item: cleanUrl(s) })),
    })
  }
  const ldTags = ld.map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`).join('\n')
  return [
    `<link rel="stylesheet" href="chrome.css?v=${hashOf('chrome.css')}">`,
    `<link rel="canonical" href="${url}">`,
    robots,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(biz.name)}">`,
    `<meta property="og:title" content="${esc(unesc(title))}">`,
    `<meta property="og:description" content="${esc(unesc(desc))}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${SITE}/assets/og-default.jpg">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">`,
    `<link rel="apple-touch-icon" href="assets/apple-touch-icon.png">`,
    `<script>try{var s=localStorage.getItem('cl-text-scale');if(s)document.documentElement.style.setProperty('--text-scale',s)}catch(e){}</script>`,
    ldTags,
  ].filter(Boolean).join('\n')
}

const titleCache = {}
function titleOf(slug) {
  if (titleCache[slug]) return titleCache[slug]
  const p = path.join(ROOT, slug + '.html')
  if (!fs.existsSync(p)) return slug
  const m = fs.readFileSync(p, 'utf8').match(/<title>([\s\S]*?)<\/title>/)
  return (titleCache[slug] = m ? m[1].trim() : slug)
}

// ---------- block replacement ----------
function replaceBlock(src, name, legacyRe, html, insertAt) {
  const marked = markedRe(name)
  const block = html ? mark(name, html) + '\n' : ''
  if (marked.test(src)) return src.replace(marked, () => block)
  if (legacyRe && legacyRe.test(src)) return src.replace(legacyRe, () => block)
  if (insertAt) return insertAt(src, block)
  return src
}

function buildPage(file) {
  const slug = path.basename(file, '.html')
  let src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const original = src
  let meta = PAGES[slug]
  let registryChanged = false
  if (!meta) {
    meta = PAGES[slug] = { label: labelFromTitle((src.match(/<title>([\s\S]*?)<\/title>/) || [, slug])[1]), parent: null, service: 'other' }
    registryChanged = true
    console.log(`  registered new page "${slug}" in site/pages.json (set its parent/order/service there)`)
  }
  // auto-fill the contact lead from the page's existing copy
  if (!meta.lead) {
    const m = src.match(/<p class="contact-lead">([\s\S]*?)<\/p>/)
    if (m) { meta.lead = m[1].trim(); registryChanged = true }
  }
  if (!meta.service && meta.service !== '') {
    const m = src.match(/<option value="([^"]*)" selected>/)
    if (m && reg.services.some((o) => o.value === m[1])) { meta.service = m[1]; registryChanged = true }
  }

  const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [, slug])[1].trim()
  const desc = (src.match(/<meta name="description" content="([^"]*)"/) || [, ''])[1]
  const hasForm = !meta.legal
  const vars = { ...base, slug, pageTitle: esc(unesc(title)), context: topAncestor(slug), quoteHref: hasForm ? '#quote' : 'contact.html#quote' }

  // 1. head block (before </head>)
  src = replaceBlock(src, 'head', null, renderHead(slug, meta, title, desc), (s, b) => s.replace(/\n?<\/head>/, `\n${b}</head>`))
  // cache-bust stylesheets and script
  src = src.replace(/href="([a-z0-9-]+\.css)(\?v=[^"]*)?"/g, (m, f) => { const h = hashOf(f); return h ? `href="${f}?v=${h}"` : m })
  src = src.replace(/src="script\.js(\?v=[^"]*)?"/g, () => `src="script.js?v=${hashOf('script.js')}"`)

  // 2. header (+ skip link)
  src = replaceBlock(src, 'header', /(<a class="skip-link"[^>]*>[^<]*<\/a>\n)?<header class="site-header">[\s\S]*?<\/header>\n?/, renderHeader(slug, vars), (s, b) => s.replace(/<body>\n?/, `<body>\n${b}`))

  // 3. main landmark + breadcrumb
  src = src.replace(/<main id="main" data-build>\n?/g, '').replace(/<\/main><!-- \/build:main -->\n?/g, '')
  src = replaceBlock(src, 'breadcrumb', null, renderBreadcrumb(slug) || null, (s, b) => s.replace(/(<!-- \/build:header -->\n)/, `$1${b}`))
  if (!markedRe('breadcrumb').test(src) && renderBreadcrumb(slug)) {
    src = src.replace(/(<!-- \/build:header -->\n)/, `$1${mark('breadcrumb', renderBreadcrumb(slug))}\n`)
  }
  src = src.replace(/(<!-- \/build:header -->\n)(<!-- build:breadcrumb -->[\s\S]*?<!-- \/build:breadcrumb -->\n)?/, (m, h, bc = '') => `${h}<main id="main" data-build>\n${bc}`)

  // 4. pager (before the contact section)
  src = replaceBlock(src, 'pager', null, renderPager(slug) || null, (s, b) => b ? s.replace(/(<!-- build:contact -->|<section class="contact" id="quote">)/, `${b}$1`) : s)

  // 5. contact section
  if (hasForm) {
    src = replaceBlock(src, 'contact', /<section class="contact" id="quote">[\s\S]*?\n<\/section>\n?/, renderContact(slug, meta, vars), (s, b) => s.replace(/(<!-- build:footer -->|<footer class="site-footer">|<!-- build:chat -->|<div class="chat-widget"|<script src="script\.js)/, `${b}$1`))
  }

  // 6. footer, closing main before it
  src = replaceBlock(src, 'footer', /<footer class="site-footer">[\s\S]*?<\/footer>\n?/, tpl(partial('footer'), vars), (s, b) => s.replace(/(<!-- build:chat -->|<div class="chat-widget"|<script src="script\.js)/, `${b}$1`))
  src = src.replace(/<!-- build:footer -->/, '</main><!-- /build:main -->\n<!-- build:footer -->')

  // 7. chat widget + consent banner
  src = replaceBlock(src, 'chat', /<div class="chat-widget"[\s\S]*?<\/button>\n<\/div>\n?/, tpl(partial('chat'), vars), (s, b) => s.replace(/(<script src="script\.js)/, `${b}$1`))
  src = replaceBlock(src, 'consent', null, tpl(partial('consent'), vars), (s, b) => s.replace(/(<!-- \/build:chat -->\n)/, `$1${b}`))

  // 8. page-level attributes
  src = src.replace(/<html lang="en"[^>]*>/, `<html lang="en" data-page="${slug}">`)

  if (src !== original) {
    if (CHECK) { console.log(`  would change: ${path.basename(file)}`); return { changed: true, registryChanged } }
    fs.writeFileSync(file, src)
  }
  return { changed: src !== original, registryChanged }
}

function writeSitemaps(slugs) {
  const indexable = slugs.filter((s) => !PAGES[s]?.noindex && !PAGES[s]?.legal || ['privacy-policy', 'terms', 'cookie-policy'].includes(s))
  const today = new Date().toISOString().slice(0, 10)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexable.map((s) => `  <url><loc>${cleanUrl(s)}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`
  const robots = `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`
  const groups = {}
  for (const s of indexable) {
    const top = topAncestor(s)
    const key = PAGES[s]?.parent ? top : (PAGES[s]?.legal ? '_legal' : '_company')
    ;(groups[key] ||= []).push(s)
  }
  const section = (key, list) => {
    const title = key === '_company' ? 'Company' : key === '_legal' ? 'Legal' : esc(PAGES[key]?.label || key)
    const sorted = [...list].sort((a, b) => chain(a).length - chain(b).length || (PAGES[a]?.order ?? 99) - (PAGES[b]?.order ?? 99))
    return `<section class="sm-group"><h2>${title}</h2><ul>${sorted.map((s) => `<li style="--d:${chain(s).length - 1}"><a href="${s}.html">${esc(PAGES[s]?.label || s)}</a></li>`).join('')}</ul></section>`
  }
  const order = ['_company', 'fiberglass-boat-repair', ...Object.keys(groups).filter((k) => !['_company', '_legal', 'fiberglass-boat-repair'].includes(k)).sort(), '_legal']
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="description" content="Every page on captainlevis.com: fiberglass, gelcoat, structural and detailing services, the boat yard, company and legal pages.">
<meta name="theme-color" content="#00264B">
<title>Sitemap | Captain Levi's</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Caveat:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<section class="page-plain">
  <div class="container">
    <div class="eyebrow eyebrow-dark eyebrow-left"><i></i><span>SITEMAP</span></div>
    <h1>Every page on the site</h1>
    <div class="sm-grid">${order.filter((k) => groups[k]).map((k) => section(k, groups[k])).join('\n')}</div>
  </div>
</section>
<script src="script.js"></script>
</body>
</html>
`
  if (!CHECK) {
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml)
    fs.writeFileSync(path.join(ROOT, 'robots.txt'), robots)
    fs.writeFileSync(path.join(ROOT, 'sitemap.html'), html)
  }
}

// ---------- main ----------
const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html') && (only.length === 0 || only.includes(f))).sort()
let changed = 0, regChanged = false
for (const f of files) {
  const r = buildPage(path.join(ROOT, f))
  if (r.changed) changed++
  if (r.registryChanged) regChanged = true
}
if (only.length === 0) {
  writeSitemaps(fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => path.basename(f, '.html')))
  // sitemap.html is written fresh each time and then stamped like any other page
  if (!CHECK) { const r = buildPage(path.join(ROOT, 'sitemap.html')); if (r.changed) changed++ }
}
if (regChanged && !CHECK) fs.writeFileSync(regPath, JSON.stringify(reg, null, 2) + '\n')
console.log(`${CHECK ? 'check' : 'build'}: ${files.length} pages, ${changed} ${CHECK ? 'would change' : 'written'}`)
if (CHECK && changed) process.exit(1)
