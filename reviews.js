/* Reviews page: featured pager, "read full review" toggles, and the rotating
   grid that cycles through every five-star Google review in site/reviews.json.
   Only real reviews from that file are ever rendered; nothing is generated. */
(function () {
  'use strict'
  const $ = (s, r) => (r || document).querySelector(s)
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const STAR = 'M12 2l3.1 6.6 7.2.9-5.3 5 1.5 7.2L12 18l-6.5 3.7L7 14.5 1.7 9.5l7.2-.9z'
  const G = [
    ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
  ]
  const NS = 'http://www.w3.org/2000/svg'

  // "Firstname L." for display; business names (4+ words) stay whole.
  function shortName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return 'Google user'
    if (parts.length === 1 || parts.length >= 4) return parts.join(' ')
    const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    const last = parts[parts.length - 1].replace(/\.$/, '')
    return first + ' ' + last.charAt(0).toUpperCase() + '.'
  }
  const cleanDate = (d) => String(d || '').replace(/^Edited\s+/i, '')

  function svg(viewBox, cls) {
    const el = document.createElementNS(NS, 'svg')
    el.setAttribute('viewBox', viewBox)
    if (cls) el.setAttribute('class', cls)
    return el
  }
  function stars(n) {
    const wrap = document.createElement('span')
    wrap.className = 'rv-stars rv-stars--sm'
    wrap.setAttribute('role', 'img')
    wrap.setAttribute('aria-label', n + ' out of 5 stars')
    for (let i = 0; i < 5; i++) {
      const s = svg('0 0 24 24')
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('d', STAR)
      if (i >= n) p.setAttribute('fill', '#D5DEE7')
      s.appendChild(p)
      wrap.appendChild(s)
    }
    return wrap
  }
  function gLogo() {
    const s = svg('0 0 48 48', 'rv-g')
    s.setAttribute('role', 'img')
    s.setAttribute('aria-label', 'Google review')
    G.forEach(([fill, d]) => {
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('fill', fill)
      p.setAttribute('d', d)
      s.appendChild(p)
    })
    return s
  }

  // Build a card from a review record. Text goes in as textContent, never HTML.
  function renderCard(r, card) {
    card = card || document.createElement('article')
    card.className = 'rv-card'
    card.dataset.name = r.name
    card.textContent = ''
    const top = document.createElement('div')
    top.className = 'rv-card-top'
    top.appendChild(stars(r.rating))
    top.appendChild(gLogo())
    const who = document.createElement('span')
    who.className = 'rv-who'
    const strong = document.createElement('strong')
    strong.textContent = shortName(r.name)
    const small = document.createElement('small')
    small.textContent = cleanDate(r.date)
    who.appendChild(strong)
    who.appendChild(small)
    top.appendChild(who)
    card.appendChild(top)
    const bq = document.createElement('blockquote')
    bq.className = 'rv-quote'
    const p = document.createElement('p')
    p.textContent = r.text
    bq.appendChild(p)
    card.appendChild(bq)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'rv-more'
    btn.hidden = true
    btn.setAttribute('aria-expanded', 'false')
    btn.textContent = 'Read full review'
    card.appendChild(btn)
    wireMore(card)
    return card
  }

  // ---------------------------------------------------------------- read more
  function wireMore(card) {
    const q = $('.rv-quote', card)
    const p = q && $('p', q)
    const btn = $('.rv-more', card)
    if (!q || !p || !btn) return
    const check = () => {
      if (q.classList.contains('is-open')) return
      btn.hidden = p.scrollHeight <= p.clientHeight + 2
    }
    btn.onclick = () => {
      const open = q.classList.toggle('is-open')
      btn.setAttribute('aria-expanded', String(open))
      btn.textContent = open ? 'Show less' : 'Read full review'
    }
    check()
    return check
  }
  const checks = $$('.rv-card').map(wireMore).filter(Boolean)
  let rt
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => checks.forEach((c) => c()), 150) })
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => checks.forEach((c) => c()))

  // ---------------------------------------------------------------- featured pager
  const pages = $$('.rv-page')
  const prev = $('#rv-prev')
  const next = $('#rv-next')
  if (pages.length > 1 && prev && next) {
    let i = pages.findIndex((p) => !p.hidden)
    if (i < 0) i = 0
    const show = (n) => {
      i = (n + pages.length) % pages.length
      pages.forEach((p, k) => { p.hidden = k !== i })
      $$('.rv-card', pages[i]).forEach((c) => { const chk = wireMore(c); if (chk) chk() })
    }
    prev.addEventListener('click', () => show(i - 1))
    next.addEventListener('click', () => show(i + 1))
  } else if (prev && next) {
    prev.disabled = next.disabled = true
  }

  // ---------------------------------------------------------------- rotating grid
  const rotor = $('#rv-rotor')
  if (!rotor) return
  const slots = $$('.rv-card', rotor)
  const featuredNames = new Set($$('.rv-featured .rv-card').map((c) => c.dataset.name))
  const note = $('#rv-live-note')

  fetch('site/reviews.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .then((data) => {
      const pool = (data.reviews || []).filter((r) =>
        r && r.rating === 5 && typeof r.text === 'string' && r.text.trim().length > 0 && !r.hide && !featuredNames.has(r.name)
      )
      if (pool.length <= slots.length) return
      startRotor(pool)
    })
    .catch(() => { /* static six stay put; nothing is invented when the file is unreachable */ })

  function startRotor(pool) {
    // shuffle once, then walk the deck; a card never reappears until the deck is spent
    const deck = pool.slice()
    for (let k = deck.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [deck[k], deck[j]] = [deck[j], deck[k]] }
    const showing = new Set(slots.map((s) => s.dataset.name))
    let cursor = 0
    const nextReview = () => {
      for (let tries = 0; tries < deck.length; tries++) {
        const r = deck[cursor]
        cursor = (cursor + 1) % deck.length
        if (!showing.has(r.name)) return r
      }
      return null
    }
    let slot = Math.floor(Math.random() * slots.length)
    let paused = false
    let timer = null
    const period = reduced ? 6500 : 2600
    const swap = () => {
      if (paused || document.hidden) return
      const card = slots[slot]
      slot = (slot + 1) % slots.length
      const r = nextReview()
      if (!r) return
      if (card.matches(':hover') || card.contains(document.activeElement) || $('.rv-quote.is-open', card)) return
      const apply = () => {
        showing.delete(card.dataset.name)
        renderCard(r, card)
        showing.add(r.name)
        card.classList.remove('is-out')
      }
      if (reduced) { apply(); return }
      card.classList.add('is-out')
      setTimeout(apply, 460)
    }
    const run = () => { clearInterval(timer); timer = setInterval(swap, period) }
    rotor.addEventListener('mouseenter', () => { paused = true })
    rotor.addEventListener('mouseleave', () => { paused = false })
    rotor.addEventListener('focusin', () => { paused = true })
    rotor.addEventListener('focusout', () => { paused = rotor.contains(document.activeElement) })
    document.addEventListener('visibilitychange', () => { if (!document.hidden) run() })
    run()
    if (note) note.textContent = 'Rotating through ' + pool.length + ' more five-star Google reviews — hover to pause'
  }
})()
