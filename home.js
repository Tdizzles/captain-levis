/* home.js — homepage only: the live Google reviews.
   1. "Boaters Say It Best" band: a looping carousel of real five-star Google reviews (shuffled every visit,
      drifting constantly, swipeable, arrows + dots + pause; each card drops down to the full review).
   2. The "Trusted by Boaters" card further down, which rotates through more of them every 6 s.
   Every review shown comes from site/reviews.json, the verbatim pull of the Google listing; nothing is
   written or edited here. The site-wide motion (reveals, count-ups, hero entrance) lives in script.js. */
(function () {
  'use strict'
  const $ = (s, r) => (r || document).querySelector(s)
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s))
  const mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false }
  const reduced = () => mq.matches
  const hasIO = 'IntersectionObserver' in window

  // Hero video (9 MB MP4): only desktop-width screens on a normal connection play it. Phones, Save-Data, 2G and
  // reduced-motion visitors keep the poster photo and never download the file (index.html: preload="none", no
  // autoplay attribute). Audit 2026-11-04: the clip was ~96% of a first mobile visit.
  const hero = $('video[data-hero-video]')
  if (hero) {
    const conn = navigator.connection || {}
    const wide = window.matchMedia ? window.matchMedia('(min-width: 769px)') : null
    const allowed = () => !!(wide && wide.matches) && !conn.saveData && !/(^|-)2g$/.test(conn.effectiveType || '') && !reduced()
    const start = () => {
      if (!allowed() || !hero.paused) return
      hero.preload = 'auto'
      const p = hero.play()
      if (p && p.catch) p.catch(() => {})
    }
    start()
    if (wide && wide.addEventListener) wide.addEventListener('change', start)
    if (mq.addEventListener) mq.addEventListener('change', () => { if (reduced()) hero.pause(); else start() })
  }

  const ROTATE_MS = 6000 // testimonial card
  const G_PATHS = [
    ['#EA4335', 'M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z'],
    ['#4285F4', 'M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z'],
    ['#FBBC05', 'M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z'],
    ['#34A853', 'M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z'],
  ]
  const AVATAR_COLORS = ['#1A73E8', '#9334E6', '#B4530F', '#C77C0E', '#E37400', '#188038', '#D93025', '#007B83', '#1967D2', '#C5221F']
  const NS = 'http://www.w3.org/2000/svg'

  let started = false
  function init() {
    if (started) return
    started = true
    loadReviews()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()

  // ---------------------------------------------------------------- helpers
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
    if (!$('[data-gr-carousel]') && !$('[data-g-rotator]')) return
    fetch('/site/reviews.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('reviews ' + r.status))))
      .then((data) => {
        const all = (data.reviews || []).filter((r) => r.rating === 5 && r.text && r.text.trim() && !r.hide)
        if (!all.length) return
        all.forEach((r) => { r.text = r.text.trim().replace(/\s+/g, ' ') })
        shuffle(all)
        const cnt = $('[data-g-count]')
        if (cnt && data.count) cnt.textContent = String(data.count)
        const used = buildCarousel(all)
        buildRotator(all, used)
      })
      .catch(() => { /* the static real reviews in the HTML stay in place */ })
  }

  // ---------------------------------------------------------------- reviews carousel
  // Drifts constantly to the left (pauses on hover, focus, an open review, the Pause button, or off screen).
  // Click a card, or its "Read full review" button, and it drops down to show the whole review.
  let uid = 0
  const CHEVRON = 'M6 9l6 6 6-6'
  function reviewCard(r, i, total, clone) {
    const card = document.createElement('div')
    card.className = 'gr-card'
    if (!clone) {
      card.setAttribute('role', 'group')
      card.setAttribute('aria-roledescription', 'slide')
      card.setAttribute('aria-label', `Review ${i + 1} of ${total}`)
    }
    const top = document.createElement('div')
    top.className = 'gr-card-top'
    const av = document.createElement('span')
    av.className = 'gr-avatar'
    av.setAttribute('aria-hidden', 'true')
    av.style.setProperty('--a', colorFor(r.name))
    av.textContent = (String(r.name || '?').trim().charAt(0) || '?').toUpperCase()
    const who = document.createElement('span')
    who.className = 'gr-who'
    const strong = document.createElement('strong')
    strong.textContent = shortName(r.name)
    const small = document.createElement('small')
    small.textContent = 'Google Review'
    who.append(strong, small)
    top.append(av, who, gLogo('gr-g'))
    const meta = document.createElement('div')
    meta.className = 'gr-meta'
    const stars = document.createElement('span')
    stars.className = 'gr-stars'
    stars.setAttribute('role', 'img')
    stars.setAttribute('aria-label', '5 out of 5 stars')
    stars.textContent = '★★★★★'
    const text = document.createElement('p')
    text.className = 'gr-text'
    text.textContent = r.text
    const more = document.createElement('button')
    more.type = 'button'
    more.className = 'gr-more'
    more.hidden = true
    more.setAttribute('aria-expanded', 'false')
    if (clone) more.tabIndex = -1
    else { text.id = 'gr-text-' + (++uid); more.setAttribute('aria-controls', text.id) }
    const label = document.createElement('span')
    label.textContent = 'Read full review'
    const chev = document.createElementNS(NS, 'svg')
    chev.setAttribute('viewBox', '0 0 24 24')
    chev.setAttribute('width', '12')
    chev.setAttribute('height', '12')
    chev.setAttribute('aria-hidden', 'true')
    const cp = document.createElementNS(NS, 'path')
    cp.setAttribute('d', CHEVRON)
    cp.setAttribute('fill', 'none')
    cp.setAttribute('stroke', 'currentColor')
    cp.setAttribute('stroke-width', '2.4')
    cp.setAttribute('stroke-linecap', 'round')
    cp.setAttribute('stroke-linejoin', 'round')
    chev.appendChild(cp)
    more.append(label, chev)
    meta.append(stars, more)
    card.append(top, meta, text)
    return card
  }

  function buildCarousel(all) {
    const used = new Set()
    const root = $('[data-gr-carousel]')
    if (!root) return used
    const track = $('[data-gr-track]', root)
    const viewport = track && track.parentElement
    const nav = $('[data-gr-nav]')
    const dotsWrap = $('[data-gr-dots]')
    const pauseBtn = $('[data-gr-pause]')
    const prevBtn = $('[data-gr-prev]', root)
    const nextBtn = $('[data-gr-next]', root)
    if (!track || !viewport) return used

    const picks = all.filter((r) => r.text.length <= 1400).slice(0, 25)
    if (picks.length < 6) return used
    picks.forEach((r) => used.add(r))
    const n = picks.length
    const CLONES = 6 // copies of the first cards at the end make the loop seamless
    track.textContent = ''
    picks.forEach((r, i) => track.appendChild(reviewCard(r, i, n, false)))
    for (let i = 0; i < CLONES; i++) {
      const c = reviewCard(picks[i % n], i, n, true)
      c.classList.add('is-clone')
      c.setAttribute('aria-hidden', 'true')
      track.appendChild(c)
    }
    const cards = Array.from(track.children)

    // five dots, each one a group of reviews (25 reviews = 5 per dot, as in the design)
    const groups = Math.min(5, n)
    const per = Math.ceil(n / groups)
    const dots = []
    for (let g = 0; g < groups; g++) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'gr-dot'
      b.setAttribute('aria-label', `Reviews ${g * per + 1} to ${Math.min(n, (g + 1) * per)}`)
      b.addEventListener('click', () => glideTo(g * per * step))
      dotsWrap.appendChild(b)
      dots.push(b)
    }

    let x = 0 // how far the track has moved left, in px
    let step = 0
    let loopW = 0
    let tween = null
    let openCard = null
    let hover = false
    let focus = false
    let offscreen = false
    let userPaused = false
    let dragging = false
    let moved = 0
    const gapPx = () => parseFloat(getComputedStyle(track).columnGap) || 11

    function apply() { track.style.transform = `translate3d(${(-x).toFixed(2)}px,0,0)` }
    function paintDots() {
      const real = ((Math.round(x / step) % n) + n) % n
      const g = Math.min(groups - 1, Math.floor(real / per))
      dots.forEach((d, k) => d.setAttribute('aria-current', k === g ? 'true' : 'false'))
    }
    // keep x inside one loop; an open card hands over to its twin so it stays where the reader is looking
    function wrap() {
      let shift = 0
      if (x >= loopW) shift = -n
      else if (x < 0) shift = n
      if (!shift) return 0
      x += shift * step
      if (tween) { tween.from += shift * step; tween.to += shift * step }
      if (openCard) {
        const twin = cards[cards.indexOf(openCard) + shift]
        if (twin) { setOpen(openCard, false, true); setOpen(twin, true, true) }
      }
      return shift * step
    }
    function layout() {
      const w = viewport.clientWidth
      const count = w >= 1180 ? 5 : w >= 920 ? 4 : w >= 680 ? 3 : w >= 440 ? 2 : 1
      const gap = gapPx()
      const peek = count === 1 ? Math.min(56, w * 0.14) : 0 // phones: the next card peeks in
      const cardW = (w - gap * (count - 1) - peek) / count
      const ratio = step ? x / step : 0
      track.style.setProperty('--gr-card', cardW.toFixed(2) + 'px')
      step = cardW + gap
      loopW = n * step
      x = ratio * step
      wrap()
      apply()
      paintDots()
      requestAnimationFrame(markOverflow)
    }
    // only reviews that don't fit in two lines get the "Read full review" button
    function markOverflow() {
      cards.forEach((c) => {
        if (c.classList.contains('is-open')) return
        const t = $('.gr-text', c)
        $('.gr-more', c).hidden = !(t.scrollHeight > t.clientHeight + 2)
      })
    }

    // smooth moves for the arrows, the dots, and opening a card that is half out of view
    function glideTo(target) {
      if (reduced()) { x = target; wrap(); apply(); paintDots(); return }
      tween = { from: x, to: target, t0: performance.now(), dur: 520 }
      ensureLoop()
    }
    const nextCard = () => glideTo((Math.floor(x / step + 1e-3) + 1) * step)
    const prevCard = () => {
      let t = (Math.ceil(x / step - 1e-3) - 1) * step
      if (t < 0) { x += loopW; t += loopW }
      glideTo(t)
    }

    // the drift itself
    const SPEED = 32 // px per second
    const drifting = () => !reduced() && !userPaused && !hover && !focus && !dragging && !openCard && !document.hidden
    let raf = 0
    let last = 0
    function frame(t) {
      raf = 0
      const dt = last ? Math.min(64, t - last) : 16
      last = t
      if (tween) {
        const p = Math.min(1, (t - tween.t0) / tween.dur)
        const e = 1 - Math.pow(1 - p, 3)
        x = tween.from + (tween.to - tween.from) * e
        if (p >= 1) tween = null
      } else if (drifting()) {
        x += SPEED * dt / 1000
      }
      wrap()
      apply()
      paintDots()
      ensureLoop()
    }
    function ensureLoop() {
      if (raf || offscreen) return
      if (!tween && !drifting()) { last = 0; return }
      raf = requestAnimationFrame(frame)
    }

    // the drop-down
    function setOpen(card, open, silent) {
      const btn = $('.gr-more', card)
      const label = btn && btn.firstChild
      card.classList.toggle('is-open', open)
      if (btn) {
        btn.setAttribute('aria-expanded', String(open))
        if (label) label.textContent = open ? 'Show less' : 'Read full review'
        if (open) btn.hidden = false
      }
      if (!open) { const t = $('.gr-text', card); if (t) t.scrollTop = 0 }
      if (silent) { if (open) openCard = card; return }
      openCard = open ? card : null
      if (!open) { markOverflow(); ensureLoop() }
    }
    function openReview(card) {
      if (openCard && openCard !== card) setOpen(openCard, false)
      setOpen(card, true)
      // slide it fully into view if it was half off the edge
      const vr = viewport.getBoundingClientRect()
      const cr = card.getBoundingClientRect()
      if (cr.left < vr.left) glideTo(x - (vr.left - cr.left))
      else if (cr.right > vr.right) glideTo(x + (cr.right - vr.right))
    }
    track.addEventListener('click', (e) => {
      if (moved > 6) return // that was a drag, not a click
      const card = e.target.closest('.gr-card')
      if (!card) return
      const btn = e.target.closest('.gr-more')
      if (btn) {
        if (card.classList.contains('is-open')) setOpen(card, false)
        else openReview(card)
        return
      }
      if (!card.classList.contains('is-open') && !$('.gr-more', card).hidden) openReview(card)
    })
    document.addEventListener('click', (e) => { if (openCard && !track.contains(e.target)) setOpen(openCard, false) })
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openCard) {
        const c = openCard
        setOpen(c, false)
        const b = $('.gr-more', c)
        if (b) b.focus()
        return
      }
      if (e.target.closest('.gr-text')) return
      if (e.key === 'ArrowRight') { e.preventDefault(); nextCard() }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevCard() }
    })

    // pausing
    root.addEventListener('mouseenter', () => { hover = true })
    root.addEventListener('mouseleave', () => { hover = false; ensureLoop() })
    root.addEventListener('focusin', (e) => {
      focus = true
      const card = e.target.closest('.gr-card')
      if (card && !card.classList.contains('is-clone')) {
        const vr = viewport.getBoundingClientRect()
        const cr = card.getBoundingClientRect()
        if (cr.left < vr.left || cr.right > vr.right) glideTo(cards.indexOf(card) * step)
      }
    })
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) { focus = false; ensureLoop() } })
    document.addEventListener('visibilitychange', ensureLoop)
    if (hasIO) {
      new IntersectionObserver((es) => es.forEach((e) => {
        offscreen = !e.isIntersecting
        if (offscreen && raf) { cancelAnimationFrame(raf); raf = 0 }
        last = 0
        ensureLoop()
      })).observe(root)
    }
    if (prevBtn) prevBtn.addEventListener('click', prevCard)
    if (nextBtn) nextBtn.addEventListener('click', nextCard)
    if (pauseBtn) {
      if (reduced()) pauseBtn.hidden = true
      pauseBtn.addEventListener('click', () => {
        userPaused = !userPaused
        pauseBtn.setAttribute('aria-pressed', String(userPaused))
        pauseBtn.setAttribute('aria-label', userPaused ? 'Play reviews' : 'Pause reviews')
        last = 0
        ensureLoop()
      })
    }

    // swipe / drag
    let x0 = 0
    let y0 = 0
    let startX = 0
    let pid = null
    let horizontal = null
    viewport.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (e.target.closest('.gr-card.is-open .gr-text')) return // let people scroll and select inside an open review
      pid = e.pointerId
      x0 = e.clientX
      y0 = e.clientY
      startX = x
      moved = 0
      horizontal = null
    })
    viewport.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return
      const mx = e.clientX - x0
      const my = e.clientY - y0
      if (horizontal === null && (Math.abs(mx) > 6 || Math.abs(my) > 6)) {
        horizontal = Math.abs(mx) > Math.abs(my)
        if (horizontal) {
          dragging = true
          tween = null
          track.classList.add('is-dragging')
          viewport.setPointerCapture(pid)
        }
      }
      if (!horizontal) return
      moved = Math.abs(mx)
      x = startX - mx
      startX += wrap() // follow a wrap so the drag stays continuous
      apply()
      paintDots()
    })
    const endDrag = (e) => {
      if (e.pointerId !== pid) return
      pid = null
      if (!horizontal) { moved = 0; return }
      track.classList.remove('is-dragging')
      dragging = false
      last = 0
      ensureLoop()
      setTimeout(() => { moved = 0 }, 0) // the click that ends a drag is ignored above, then reset
    }
    viewport.addEventListener('pointerup', endDrag)
    viewport.addEventListener('pointercancel', endDrag)

    let rt
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 150) })
    $$('.text-size-btn').forEach((b) => b.addEventListener('click', () => setTimeout(layout, 60)))
    layout()
    if (prevBtn) prevBtn.hidden = false
    if (nextBtn) nextBtn.hidden = false
    if (nav) nav.hidden = false
    ensureLoop()
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
