/* home.js — homepage only (2026-11-04): scroll reveals, count-ups, and the live Google reviews
   (the two-row marquee and the rotating "Trusted by Boaters" card).
   Every review shown comes from site/reviews.json, the verbatim pull of the Google listing; only
   five-star reviews with text are used, shuffled on every visit. Nothing is written or edited here. */
(function () {
  'use strict'
  const $ = (s, r) => (r || document).querySelector(s)
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
  const reduced = () => mq.matches
  const hasIO = 'IntersectionObserver' in window

  const ROTATE_MS = 6000
  const G_PATHS = [
    ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
  ]
  const AVATAR_COLORS = ['#1A73E8', '#D93025', '#188038', '#E37400', '#9334E6', '#007B83', '#C5221F', '#1967D2', '#B06000', '#0B8043']
  const NS = 'http://www.w3.org/2000/svg'

  let started = false
  function init() {
    if (started) return
    started = true
    initReveal()
    initCounts()
    loadReviews()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // ---------------------------------------------------------------- scroll reveal
  function initReveal() {
    if (reduced() || !hasIO) return
    // [selector, stagger step in ms, items per row (stagger restarts each row)]
    const groups = [
      ['.fg-head-main, .fg-kicker, .fg-head-script', 120],
      ['.fg-card', 90, 3],
      ['.fg-feature-photo, .fg-feature-copy', 150],
      ['.stats-bar .stat-item', 100, 4],
      ['.g-reviews-copy, .g-score', 150],
      ['.areas-copy > *', 90],
      ['.areas-mini-stat', 90, 4],
      ['.results-copy, .results-soon, .testimonial-card', 150],
    ]
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return
        const el = e.target
        io.unobserve(el)
        el.classList.add('hm-in')
        // hand the element back to its own styles (hover lifts, transitions) once it has arrived
        const delay = parseInt(el.style.getPropertyValue('--hm-d'), 10) || 0
        const done = () => { el.classList.remove('hm-reveal', 'hm-in'); el.style.removeProperty('--hm-d') }
        setTimeout(done, 800 + delay + 100)
      })
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 })
    const fold = window.innerHeight
    groups.forEach(([sel, step, per]) => {
      let n = 0
      $$(sel).forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.height === 0 || r.top < fold * 0.95) return // hidden, or already on screen: leave it alone
        el.style.setProperty('--hm-d', ((per ? n % per : n) * step) + 'ms')
        n++
        el.classList.add('hm-reveal')
        io.observe(el)
      })
    })
  }

  // ---------------------------------------------------------------- count-ups
  function countUp(el, to, decimals, ms) {
    if (reduced()) { el.textContent = to.toFixed(decimals); return }
    const t0 = performance.now()
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms)
      const eased = 1 - Math.pow(1 - p, 3)
      el.textContent = (to * eased).toFixed(decimals)
      if (p < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  function whenVisible(el, fn) {
    if (!hasIO) { fn(); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn() }
    }, { threshold: 0.4 })
    io.observe(el)
  }
  // "50+ Years Experience" in the stat bars: the number counts up the first time it scrolls into view
  function initCounts() {
    if (reduced()) return
    $$('.stat-text strong').forEach((strong) => {
      const node = strong.firstChild
      if (!node || node.nodeType !== 3) return
      const m = node.nodeValue.match(/^(\d+)(\+?)(.*)$/)
      if (!m) return
      const to = parseInt(m[1], 10)
      const sr = document.createElement('span')
      sr.className = 'sr-only'
      sr.textContent = m[1]
      const num = document.createElement('span')
      num.className = 'hm-num'
      num.setAttribute('aria-hidden', 'true')
      num.textContent = '0'
      strong.replaceChild(document.createTextNode(m[2] + m[3]), node)
      strong.insertBefore(num, strong.firstChild)
      strong.insertBefore(sr, num)
      whenVisible(strong, () => countUp(num, to, 0, 1400))
    })
  }

  // ---------------------------------------------------------------- reviews data
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const t = a[i]; a[i] = a[j]; a[j] = t
    }
    return a
  }
  // "Firstname L." for display; business names (4+ words) stay whole. Same rule as reviews.js.
  function shortName(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) return 'Google user'
    if (parts.length === 1 || parts.length >= 4) return parts.join(' ')
    const first = parts[0].charAt(0).toUpperCase() + parts[0].slice(1)
    const last = parts[parts.length - 1].replace(/\.$/, '')
    return first + ' ' + last.charAt(0).toUpperCase() + '.'
  }
  function colorFor(name) {
    let h = 0
    for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return AVATAR_COLORS[h % AVATAR_COLORS.length]
  }
  function gLogo(cls) {
    const s = document.createElementNS(NS, 'svg')
    s.setAttribute('viewBox', '0 0 48 48')
    s.setAttribute('class', cls)
    s.setAttribute('aria-hidden', 'true')
    G_PATHS.forEach(([fill, d]) => {
      const p = document.createElementNS(NS, 'path')
      p.setAttribute('fill', fill)
      p.setAttribute('d', d)
      s.appendChild(p)
    })
    return s
  }

  function loadReviews() {
    const marquee = $('[data-g-marquee]')
    const rotator = $('[data-g-rotator]')
    if (!marquee && !rotator) return
    fetch('site/reviews.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('reviews ' + r.status))))
      .then((data) => {
        const all = (data.reviews || []).filter((r) => r.rating === 5 && r.text && r.text.trim() && !r.hide)
        if (!all.length) return
        all.forEach((r) => { r.text = r.text.trim() })
        shuffle(all)
        fillScore(data)
        const used = buildMarquee(all)
        buildRotator(all, used)
      })
      .catch(() => { /* the static fallback (one real review, no controls) stays in place */ })
  }

  function fillScore(data) {
    const rating = Number(data.rating)
    const count = Number(data.count)
    const score = $('.g-score')
    if (!score || !rating) return
    const num = $('[data-g-rating]', score)
    const cnt = $('[data-g-count]', score)
    if (cnt && count) cnt.textContent = String(count)
    score.setAttribute('aria-label', `Rated ${rating.toFixed(1)} out of 5 from ${count} Google reviews. Read all reviews`)
    if (num) {
      if (reduced()) num.textContent = rating.toFixed(1)
      else { num.textContent = '0.0'; whenVisible(score, () => countUp(num, rating, 1, 1300)) }
    }
  }

  // ---------------------------------------------------------------- marquee
  function reviewCard(r) {
    const card = document.createElement('div')
    card.className = 'g-card'
    card.setAttribute('role', 'listitem')
    const top = document.createElement('div')
    top.className = 'g-card-top'
    const av = document.createElement('span')
    av.className = 'g-avatar'
    av.setAttribute('aria-hidden', 'true')
    av.style.background = colorFor(r.name)
    av.textContent = (String(r.name || '?').trim().charAt(0) || '?').toUpperCase()
    const who = document.createElement('span')
    who.className = 'g-who'
    const strong = document.createElement('strong')
    strong.textContent = shortName(r.name)
    const small = document.createElement('small')
    small.textContent = 'Google review'
    who.append(strong, small)
    top.append(av, who, gLogo('g-mini'))
    const stars = document.createElement('span')
    stars.className = 'g-stars'
    stars.setAttribute('role', 'img')
    stars.setAttribute('aria-label', '5 out of 5 stars')
    stars.textContent = '★★★★★'
    const text = document.createElement('p')
    text.className = 'g-text'
    text.textContent = r.text
    card.append(top, stars, text)
    return card
  }

  function buildMarquee(all) {
    const used = new Set()
    const wrap = $('[data-g-marquee]')
    if (!wrap) return used
    const tracks = $$('.g-track', wrap)
    const picks = all.filter((r) => r.text.length >= 50 && r.text.length <= 520).slice(0, 24)
    if (picks.length < 4) return used
    picks.forEach((r) => used.add(r))
    const half = Math.ceil(picks.length / 2)
    const sets = [picks.slice(0, half), picks.slice(half)]
    tracks.forEach((track, i) => {
      sets[i].forEach((r) => track.appendChild(reviewCard(r)))
      // a second, hidden copy makes the loop seamless (the track slides exactly half its width)
      if (!reduced()) {
        sets[i].forEach((r) => {
          const c = reviewCard(r)
          c.setAttribute('aria-hidden', 'true')
          c.removeAttribute('role')
          track.appendChild(c)
        })
      }
    })
    wrap.hidden = false

    const setSpeed = () => tracks.forEach((t) => t.style.setProperty('--g-dur', Math.max(30, t.scrollWidth / 2 / 38).toFixed(1) + 's'))
    requestAnimationFrame(setSpeed)
    let rt
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(setSpeed, 200) })

    if (!reduced()) {
      if (hasIO) {
        new IntersectionObserver((entries) => entries.forEach((e) => wrap.classList.toggle('is-off', !e.isIntersecting))).observe(wrap)
      }
      const btn = $('[data-g-pause]')
      if (btn) {
        btn.hidden = false
        const label = $('span', btn)
        btn.addEventListener('click', () => {
          const paused = wrap.classList.toggle('is-paused')
          btn.setAttribute('aria-pressed', String(paused))
          if (label) label.textContent = paused ? 'Play reviews' : 'Pause reviews'
        })
      }
    }
    return used
  }

  // ---------------------------------------------------------------- rotating testimonial card
  function buildRotator(all, used) {
    const card = $('[data-g-rotator]')
    if (!card) return
    const quote = $('[data-g-quote]', card)
    const bq = quote && $('blockquote', quote)
    const nameEl = $('[data-g-name]', card)
    const controls = $('[data-g-controls]', card)
    const bar = $('.tc-progress', card)
    const toggle = $('[data-g-toggle]', card)
    if (!quote || !bq || !nameEl || !controls) return
    const fits = (r) => r.text.length >= 40 && r.text.length <= 260
    let pool = all.filter((r) => fits(r) && !used.has(r))
    if (pool.length < 12) pool = all.filter(fits)
    if (pool.length < 2) return

    let idx = 0
    let swapTimer = 0
    const render = (r) => {
      bq.textContent = '“' + r.text + '”'
      nameEl.textContent = shortName(r.name)
    }

    // hold the card at the height of its longest review so the section never jumps
    const fit = () => {
      const probe = bq.cloneNode(false)
      probe.removeAttribute('style')
      probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;min-height:0;width:' + bq.clientWidth + 'px'
      quote.appendChild(probe)
      let max = 0
      pool.forEach((r) => { probe.textContent = '“' + r.text + '”'; max = Math.max(max, probe.offsetHeight) })
      probe.remove()
      if (max) bq.style.minHeight = max + 'px'
    }

    const runBar = () => {
      if (!bar) return
      bar.classList.remove('run')
      void bar.offsetWidth // restart the CSS animation
      if (!reduced() && !card.classList.contains('is-paused')) bar.classList.add('run')
    }

    const show = (i, byUser) => {
      idx = (i + pool.length) % pool.length
      quote.setAttribute('aria-live', byUser ? 'polite' : 'off')
      clearTimeout(swapTimer)
      if (reduced()) { render(pool[idx]); runBar(); return }
      quote.classList.add('is-out')
      swapTimer = setTimeout(() => {
        render(pool[idx])
        quote.classList.remove('is-out')
      }, 280)
      runBar()
    }

    render(pool[0])
    controls.hidden = false
    fit()
    let rt
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(fit, 200) })
    $$('.text-size-btn').forEach((b) => b.addEventListener('click', () => setTimeout(fit, 60)))

    $('[data-g-prev]', card)?.addEventListener('click', () => show(idx - 1, true))
    $('[data-g-next]', card)?.addEventListener('click', () => show(idx + 1, true))

    if (reduced() || !bar) {
      // no auto-advance: arrows only
      if (bar) bar.hidden = true
      if (toggle) toggle.hidden = true
      return
    }
    card.style.setProperty('--tc-dur', ROTATE_MS + 'ms')
    // the progress bar IS the timer: when its fill animation ends, the next review comes in.
    // Hover, keyboard focus, the pause button and scrolling away all pause that animation.
    bar.addEventListener('animationend', (e) => { if (e.target === bar.firstElementChild) show(idx + 1, false) })
    toggle?.addEventListener('click', () => {
      const paused = card.classList.toggle('is-paused')
      toggle.setAttribute('aria-pressed', String(paused))
      toggle.setAttribute('aria-label', paused ? 'Play reviews' : 'Pause reviews')
      if (!paused) bar.classList.add('run')
    })
    if (hasIO) new IntersectionObserver((entries) => entries.forEach((e) => card.classList.toggle('is-off', !e.isIntersecting))).observe(card)
    runBar()
  }
})()
