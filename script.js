/* Captain Levi's — shared site script (loaded by every page).
   Sections: nav · carousel · before/after sliders · text size · consent · quote form · chat.
   Backend endpoints (Vercel functions in /api): /api/chat, /api/uploads, /api/inquiries, /api/events.
   When the API is unreachable (static preview, GitHub Pages) the form and chat degrade honestly:
   they never claim a message was sent. */
(() => {
  'use strict'
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s))
  const API = (window.CL_API_BASE || '') + '/api'
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v) } catch { return fallback } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } },
    sget(k, fallback) { try { const v = sessionStorage.getItem(k); return v == null ? fallback : JSON.parse(v) } catch { return fallback } },
    sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } },
    sdel(k) { try { sessionStorage.removeItem(k) } catch { /* ignore */ } },
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x'.repeat(32).replace(/x/g, () => (Math.random() * 16 | 0).toString(16)))
  const page = document.documentElement.dataset.page || 'index'
  const UPLOAD = { maxFiles: 5, maxBytes: 10 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'] }

  document.addEventListener('DOMContentLoaded', () => {
    initNav(); initCarousel(); initSliders(); initMore(); initTextSize(); initConsent(); initQuoteForm(); initChat(); initEvents()
  })

  // ---------------------------------------------------------------- nav
  function initNav() {
    const navToggle = $('#nav-toggle')
    const mainNav = $('#main-nav')
    navToggle?.addEventListener('click', () => {
      const isOpen = mainNav.classList.toggle('open')
      navToggle.setAttribute('aria-expanded', String(isOpen))
      navToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu')
    })
    const navItems = $$('.nav-item')
    navItems.forEach((item) => {
      const trigger = item.querySelector('.nav-dropdown')
      if (!trigger) return
      trigger.addEventListener('click', (e) => {
        const isStacked = window.matchMedia('(max-width:1024px)').matches
        if (!isStacked && !item.classList.contains('open')) return
        e.preventDefault()
        const isOpen = item.classList.toggle('open')
        trigger.setAttribute('aria-expanded', String(isOpen))
      })
      trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); item.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); item.querySelector('.nav-menu a')?.focus() }
      })
    })
    const closeNavMenus = () => navItems.forEach((item) => { item.classList.remove('open'); item.querySelector('.nav-dropdown')?.setAttribute('aria-expanded', 'false') })
    document.addEventListener('click', (e) => { if (!e.target.closest('.nav-item')) closeNavMenus() })
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      closeNavMenus()
      if (mainNav?.classList.contains('open')) { mainNav.classList.remove('open'); navToggle?.setAttribute('aria-expanded', 'false'); navToggle?.focus() }
    })
  }

  // ---------------------------------------------------------------- testimonial carousel
  function initCarousel() {
    const dots = $$('.carousel-dots .dot')
    if (!dots.length) return
    const prev = $('.carousel-arrow[aria-label="Previous testimonial"]')
    const next = $('.carousel-arrow[aria-label="Next testimonial"]')
    let active = 0
    const setActive = (i) => { active = (i + dots.length) % dots.length; dots.forEach((d, idx) => d.classList.toggle('active', idx === active)) }
    dots.forEach((dot, i) => dot.addEventListener('click', () => setActive(i)))
    prev?.addEventListener('click', () => setActive(active - 1))
    next?.addEventListener('click', () => setActive(active + 1))
  }

  // ---------------------------------------------------------------- before / after sliders
  function initSliders() {
    const roots = [...$$('.sfr-ba'), ...[$('#before-after')].filter(Boolean)]
    roots.forEach((root) => {
      const isHome = root.id === 'before-after'
      const after = root.querySelector(isHome ? '.ba-after' : '.sfr-ba-after')
      const line = root.querySelector(isHome ? '.ba-line' : '.sfr-ba-line')
      const handle = root.querySelector(isHome ? '.ba-handle' : '.sfr-ba-handle')
      if (!after || !line || !handle) return
      let dragging = false
      let pos = 50
      const setPos = (percent) => {
        pos = Math.min(100, Math.max(0, percent))
        after.style.clipPath = `inset(0 0 0 ${pos}%)`
        line.style.left = pos + '%'
        handle.style.left = pos + '%'
        root.setAttribute('aria-valuenow', String(Math.round(pos)))
      }
      const percentFromEvent = (e) => {
        const rect = root.getBoundingClientRect()
        const clientX = e.touches ? e.touches[0].clientX : e.clientX
        return ((clientX - rect.left) / rect.width) * 100
      }
      const onDown = (e) => { dragging = true; setPos(percentFromEvent(e)); e.preventDefault() }
      const onMove = (e) => { if (dragging) setPos(percentFromEvent(e)) }
      const onUp = () => { dragging = false }
      root.addEventListener('mousedown', onDown)
      root.addEventListener('touchstart', onDown, { passive: false })
      window.addEventListener('mousemove', onMove)
      window.addEventListener('touchmove', onMove, { passive: false })
      window.addEventListener('mouseup', onUp)
      window.addEventListener('touchend', onUp)
      root.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { setPos(pos - 5); e.preventDefault() }
        if (e.key === 'ArrowRight') { setPos(pos + 5); e.preventDefault() }
      })
      setPos(50)
    })
  }

  // ---------------------------------------------------------------- service card dropdowns
  // Cards for services without their own page yet ([data-more]) open a short description in place.
  // A link to page.html#card-id from elsewhere on the site lands with that card already open.
  // While a card is open its neighbours keep their closed height, so only the opened card grows.
  function initMore() {
    const cards = $$('[data-more]')
    if (!cards.length) return
    const setOpen = (card, open) => {
      const grid = card.parentElement
      if (open && !grid.querySelector(':scope > .more-open')) {
        Array.from(grid.children).forEach((c) => { c.style.minHeight = c.offsetHeight + 'px'; c.style.alignSelf = 'start' })
      }
      card.classList.toggle('more-open', open)
      card.querySelector('.more-toggle')?.setAttribute('aria-expanded', String(open))
      if (!open) {
        setTimeout(() => {
          if (grid.querySelector(':scope > .more-open')) return
          Array.from(grid.children).forEach((c) => { c.style.minHeight = ''; c.style.alignSelf = '' })
        }, 500)
      }
    }
    cards.forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('a, .more-panel')) return
        setOpen(card, !card.classList.contains('more-open'))
      })
    })
    const openFromHash = () => {
      const id = decodeURIComponent(location.hash.slice(1))
      const card = id && document.getElementById(id)
      if (card && card.hasAttribute('data-more')) setOpen(card, true)
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
  }

  // ---------------------------------------------------------------- text size
  const SCALES = [0.875, 1, 1.125, 1.25, 1.375]
  function initTextSize() {
    const smaller = $('#text-smaller'), larger = $('#text-larger'), status = $('#text-size-status')
    const root = document.documentElement
    let scale = Number(store.get('cl-text-scale', 1)) || 1
    if (!SCALES.includes(scale)) scale = 1
    const apply = (announce) => {
      root.style.setProperty('--text-scale', String(scale))
      root.dataset.textScale = String(scale)
      store.set('cl-text-scale', scale)
      const i = SCALES.indexOf(scale)
      if (smaller) smaller.disabled = i <= 0
      if (larger) larger.disabled = i >= SCALES.length - 1
      if (announce && status) status.textContent = `Text size ${Math.round(scale * 100)}%`
      if (announce) track('text_size', { scale })
    }
    smaller?.addEventListener('click', () => { const i = SCALES.indexOf(scale); if (i > 0) { scale = SCALES[i - 1]; apply(true) } })
    larger?.addEventListener('click', () => { const i = SCALES.indexOf(scale); if (i < SCALES.length - 1) { scale = SCALES[i + 1]; apply(true) } })
    apply(false)
  }

  // ---------------------------------------------------------------- consent
  const consent = {
    get() { return store.get('cl-consent', null) },
    allows(cat) { const c = consent.get(); return !!(c && c[cat]) },
  }
  function initConsent() {
    const box = $('#consent')
    if (!box) return
    const form = $('#consent-options', box)
    const customize = $('[data-consent-customize]', box)
    const save = (choice) => {
      store.set('cl-consent', { analytics: !!choice.analytics, embeds: !!choice.embeds, ts: Date.now(), v: 1 })
      box.hidden = true
      applyConsent()
      track('consent', { analytics: !!choice.analytics, embeds: !!choice.embeds })
    }
    $('[data-consent-accept]', box)?.addEventListener('click', () => save({ analytics: true, embeds: true }))
    $('[data-consent-reject]', box)?.addEventListener('click', () => save({ analytics: false, embeds: false }))
    customize?.addEventListener('click', () => {
      const open = form.hidden
      form.hidden = !open
      customize.setAttribute('aria-expanded', String(open))
      if (open) {
        const c = consent.get() || {}
        form.elements.analytics.checked = !!c.analytics
        form.elements.embeds.checked = !!c.embeds
      }
    })
    form?.addEventListener('submit', (e) => { e.preventDefault(); save({ analytics: form.elements.analytics.checked, embeds: form.elements.embeds.checked }) })
    $$('[data-consent-open]').forEach((b) => b.addEventListener('click', () => { box.hidden = false; form.hidden = false; customize?.setAttribute('aria-expanded', 'true'); const c = consent.get() || {}; form.elements.analytics.checked = !!c.analytics; form.elements.embeds.checked = !!c.embeds; box.querySelector('button')?.focus() }))
    $$('[data-consent-allow]').forEach((b) => b.addEventListener('click', () => { const c = consent.get() || {}; c[b.dataset.consentAllow] = true; c.ts = Date.now(); c.v = 1; store.set('cl-consent', c); applyConsent() }))
    if (!consent.get()) box.hidden = false
    applyConsent()
  }
  function applyConsent() {
    if (consent.allows('embeds')) {
      $$('[data-consent-embed]').forEach((wrap) => {
        const t = wrap.querySelector('template')
        if (!t) return
        wrap.replaceChildren(t.content.cloneNode(true))
      })
    }
  }

  // ---------------------------------------------------------------- analytics (first-party, consent-gated)
  const queue = []
  function track(name, props) {
    if (!consent.allows('analytics')) return
    const body = JSON.stringify({ name, props: props || {}, page, ref: document.referrer ? new URL(document.referrer).hostname : '', ts: Date.now(), sid: sessionId() })
    try {
      if (navigator.sendBeacon) navigator.sendBeacon(API + '/events', new Blob([body], { type: 'application/json' }))
      else fetch(API + '/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
    } catch { queue.push(body) }
  }
  function sessionId() {
    let s = store.sget('cl-sid', null)
    if (!s) { s = uuid(); store.sset('cl-sid', s) }
    return s
  }
  function initEvents() {
    track('page_view', { title: document.title })
    $$('a[href^="tel:"]').forEach((a) => a.addEventListener('click', () => track('call_click', { where: a.closest('header') ? 'header' : a.closest('footer') ? 'footer' : 'body' })))
  }

  // ---------------------------------------------------------------- quote form
  let turnstileLoading = null
  function loadTurnstile() {
    if (window.turnstile) return Promise.resolve(window.turnstile)
    if (turnstileLoading) return turnstileLoading
    turnstileLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      s.async = true; s.defer = true
      s.onload = () => resolve(window.turnstile)
      s.onerror = () => reject(new Error('turnstile_load_failed'))
      document.head.appendChild(s)
    })
    return turnstileLoading
  }
  function validateFiles(files, existingCount = 0) {
    const ok = [], errors = []
    for (const f of files) {
      if (!UPLOAD.types.includes(f.type)) { errors.push(`${f.name}: only JPEG, PNG or WebP photos`); continue }
      if (f.size > UPLOAD.maxBytes) { errors.push(`${f.name}: larger than ${UPLOAD.maxBytes / 1024 / 1024} MB`); continue }
      if (ok.length + existingCount >= UPLOAD.maxFiles) { errors.push(`${f.name}: maximum ${UPLOAD.maxFiles} photos`); continue }
      ok.push(f)
    }
    return { ok, errors }
  }
  function initQuoteForm() {
    const form = $('#contact-form')
    if (!form) return
    const status = $('.form-status', form)
    const success = $('.form-success', form)
    const submit = $('.contact-submit', form)
    const photoInput = $('#contact-photos', form)
    const photoList = $('.photo-list', form)
    const tsBox = $('.cf-turnstile', form)
    let photos = []
    let widgetId = null
    let busy = false
    form.elements.idempotency_key.value = uuid()

    // carry over anything typed into the chat
    const draft = store.sget('cl-quote-draft', null)
    if (draft) {
      const map = { name: 'name', email: 'email', phone: 'phone', service: 'service', boat: 'boat', boatLocation: 'boat_location', message: 'message' }
      for (const [k, field] of Object.entries(map)) if (draft[k] && form.elements[field]) form.elements[field].value = draft[k]
      if (draft.message || draft.name) setStatus('We brought over what you told Captain Levi. Check it, add photos if you like, and send.', 'info')
      store.sdel('cl-quote-draft')
      if (location.hash !== '#quote') form.scrollIntoView({ block: 'center' })
    }

    const renderPhotos = () => {
      photoList.replaceChildren(...photos.map((p, i) => {
        const li = document.createElement('li')
        const img = document.createElement('img'); img.alt = ''; img.src = p.url
        const name = document.createElement('span'); name.textContent = `${p.file.name} (${(p.file.size / 1024 / 1024).toFixed(1)} MB)`
        const rm = document.createElement('button'); rm.type = 'button'; rm.setAttribute('aria-label', `Remove ${p.file.name}`); rm.textContent = '×'
        rm.addEventListener('click', () => { URL.revokeObjectURL(p.url); photos.splice(i, 1); renderPhotos() })
        li.append(img, name, rm)
        return li
      }))
    }
    photoInput?.addEventListener('change', () => {
      const { ok, errors } = validateFiles(Array.from(photoInput.files || []), photos.length)
      ok.forEach((file) => photos.push({ file, url: URL.createObjectURL(file) }))
      photoInput.value = ''
      renderPhotos()
      setStatus(errors.length ? errors.join(' · ') : '', errors.length ? 'error' : '')
    })

    function setStatus(msg, kind) {
      status.textContent = msg
      status.className = 'form-status' + (kind ? ` is-${kind}` : '')
    }
    const ensureTurnstile = () => {
      if (!tsBox || !tsBox.dataset.sitekey) return Promise.resolve(null)
      if (widgetId != null) return Promise.resolve(widgetId)
      return loadTurnstile().then((ts) => {
        widgetId = ts.render(tsBox, { sitekey: tsBox.dataset.sitekey, action: 'quote', appearance: 'interaction-only', 'error-callback': () => setStatus('The security check could not load. You can still call us at the number below.', 'error') })
        return widgetId
      }).catch(() => null)
    }
    // load the CAPTCHA lazily: when the form is near the viewport or gets focus
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { ensureTurnstile(); io.disconnect() } }, { rootMargin: '300px' }) : null
    io ? io.observe(form) : ensureTurnstile()
    form.addEventListener('focusin', () => ensureTurnstile(), { once: true })

    const fieldError = (el, msg) => {
      const wrap = el.closest('.field') || el.parentElement
      wrap.classList.toggle('is-invalid', !!msg)
      let err = wrap.querySelector('.field-error')
      if (!err && msg) { err = document.createElement('span'); err.className = 'field-error'; wrap.insertAdjacentElement('afterend', err) }
      if (err) err.textContent = msg || ''
      if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid')
    }
    const validate = () => {
      let first = null
      const req = (name, msg, test) => {
        const el = form.elements[name]
        const v = (el.value || '').trim()
        const bad = !v || (test && !test(v))
        fieldError(el, bad ? msg : '')
        if (bad && !first) first = el
      }
      req('name', 'Please enter your name.')
      req('email', 'Please enter a valid email address.', (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))
      req('phone', 'Please enter a phone number we can reach you on.', (v) => v.replace(/\D/g, '').length >= 10)
      req('service', 'Please pick the closest service.')
      req('message', 'Tell us a little about the boat and the damage.', (v) => v.length >= 10)
      if (first) { first.focus(); setStatus('Please fix the highlighted fields.', 'error') }
      return !first
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      if (busy) return
      if (!validate()) return
      busy = true
      submit.setAttribute('aria-busy', 'true'); submit.disabled = true
      setStatus('Sending your request…', 'info')
      try {
        let token = ''
        if (tsBox && tsBox.dataset.sitekey) {
          await ensureTurnstile()
          token = (window.turnstile && widgetId != null) ? (window.turnstile.getResponse(widgetId) || '') : ''
          if (!token && window.turnstile && widgetId != null) {
            token = await new Promise((resolve) => {
              let done = false
              const t = setTimeout(() => { if (!done) { done = true; resolve('') } }, 12000)
              window.turnstile.execute(widgetId, { callback: (tok) => { if (!done) { done = true; clearTimeout(t); resolve(tok) } } })
            })
          }
        }
        const fd = new FormData()
        for (const name of ['name', 'email', 'phone', 'service', 'boat', 'boat_location', 'message', 'company', 'idempotency_key', 'page']) fd.append(name, form.elements[name]?.value || '')
        fd.append('kind', form.dataset.kind || 'quote')
        fd.append('turnstile_token', token)
        fd.append('chat_session', store.sget('cl-chat', {})?.sessionId || '')
        photos.forEach((p) => fd.append('photos', p.file, p.file.name))
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 45000)
        let res
        try { res = await fetch(API + '/inquiries', { method: 'POST', body: fd, signal: ctrl.signal }) } finally { clearTimeout(timer) }
        let data = null
        try { data = await res.json() } catch { data = null }
        if (res.ok && data && data.ok) {
          form.querySelectorAll('input, select, textarea, button').forEach((el) => { el.disabled = true })
          success.querySelector('.form-success-ref').textContent = data.ref || ''
          success.hidden = false
          setStatus('')
          success.scrollIntoView({ block: 'center' })
          track('quote_submit', { kind: form.dataset.kind || 'quote', photos: photos.length })
          store.sset('cl-last-inquiry', { ref: data.ref, ts: Date.now() })
          return
        }
        const msg = (data && data.error) || (res.status === 429 ? 'Too many requests from this connection. Please wait a minute and try again.' : res.status === 413 ? 'Those photos are too large. Please remove some and try again.' : 'We could not send your request.')
        if (data && data.fields) for (const [k, m] of Object.entries(data.fields)) if (form.elements[k]) fieldError(form.elements[k], m)
        setStatus(`${msg} You can also call or text us at ${phoneText()}.`, 'error')
        if (window.turnstile && widgetId != null) window.turnstile.reset(widgetId)
      } catch (err) {
        setStatus(`We could not reach our server, so nothing was sent. Please try again in a moment or call ${phoneText()}.`, 'error')
      } finally {
        busy = false
        submit.removeAttribute('aria-busy'); submit.disabled = form.querySelector('.form-success:not([hidden])') ? true : false
      }
    })
  }
  const phoneText = () => ($('.site-header .phone span')?.textContent || '727-391-7639').trim()

  // ---------------------------------------------------------------- chat
  function initChat() {
    const widget = $('#chat-widget')
    if (!widget) return
    const toggle = $('#chat-toggle'), panel = $('#chat-panel'), closeBtn = $('#chat-close')
    const messages = $('#chat-messages'), chipsBox = $('#chat-quick-replies'), form = $('#chat-form'), input = $('#chat-input'), upload = $('#chat-upload')
    const pageCtx = { page: widget.dataset.page, title: widget.dataset.pageTitle, context: widget.dataset.pageContext }
    let state = store.sget('cl-chat', null) || { sessionId: uuid(), log: [], chips: null, started: false, open: false }
    let sending = false
    let bizCache = null
    const persist = () => store.sset('cl-chat', state)

    const GREETING = 'Ahoy! I’m Captain Levi. Ask me about fiberglass repairs, hull and deck damage, transoms, stringers, and more. Need a hand with your boat? I can help you get started with a quote, too.'
    const START_CHIPS = [
      { label: 'I Need a Quote', send: 'I need a quote', primary: true },
      { label: 'Hours & Location', send: 'Hours and location' },
      { label: 'I Have Another Question', send: 'I have another question' },
    ]

    // ---- rendering
    const renderText = (text) => {
      // minimal safe markup: paragraphs, **bold**, [label](same-origin or relative link)
      const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const safeHref = (h) => { try { const u = new URL(h, location.href); return (u.origin === location.origin || /^(tel|mailto):/.test(h) || /^https:\/\/(www\.)?google\.com\/maps/.test(u.href)) ? u.href : null } catch { return null } }
      return String(text).split(/\n{2,}/).map((p) => {
        let html = escapeHtml(p).replace(/\n/g, '<br>')
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => { const h = safeHref(href); return h ? `<a href="${h}"${/^https?:/.test(h) && !h.startsWith(location.origin) ? ' target="_blank" rel="noopener"' : ''}>${label}</a>` : label })
        return `<p>${html}</p>`
      }).join('')
    }
    const addMsg = (entry, save = true) => {
      let el
      if (entry.type === 'links') {
        el = document.createElement('div'); el.className = 'chat-links'
        entry.links.forEach((l) => { const a = document.createElement('a'); a.className = 'chat-link'; a.href = l.href; a.textContent = l.label; el.appendChild(a) })
      } else if (entry.type === 'photos') {
        el = document.createElement('div'); el.className = 'chat-photos'
        entry.urls.forEach((u) => { const img = document.createElement('img'); img.src = u; img.alt = 'Photo you added'; el.appendChild(img) })
      } else if (entry.type === 'card') {
        el = document.createElement('div'); el.className = 'chat-card'
        const dl = document.createElement('dl')
        entry.rows.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd) })
        el.appendChild(dl)
      } else {
        el = document.createElement('div')
        el.className = `chat-msg chat-msg-${entry.from}`
        if (entry.from === 'bot' || entry.from === 'error') el.innerHTML = renderText(entry.text); else el.textContent = entry.text
      }
      messages.appendChild(el)
      messages.scrollTop = messages.scrollHeight
      if (save) { state.log.push(entry); if (state.log.length > 80) state.log = state.log.slice(-80); persist() }
    }
    const setChips = (chips) => {
      state.chips = chips || []
      persist()
      chipsBox.replaceChildren(...state.chips.map((c) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'chat-chip' + (c.primary ? ' chat-chip-primary' : ''); b.textContent = c.label
        b.addEventListener('click', () => { if (c.href) { if (c.draft) store.sset('cl-quote-draft', c.draft); location.href = c.href; return } send(c.send || c.label) })
        return b
      }))
    }
    let typingEl = null
    const showTyping = () => { typingEl = document.createElement('div'); typingEl.className = 'chat-msg-typing'; typingEl.innerHTML = '<span></span><span></span><span></span>'; messages.appendChild(typingEl); messages.scrollTop = messages.scrollHeight }
    const hideTyping = () => { typingEl?.remove(); typingEl = null }

    const restore = () => {
      messages.replaceChildren()
      state.log.forEach((e) => addMsg(e, false))
      setChips(state.chips || START_CHIPS)
    }
    const start = () => {
      if (state.started) return
      state.started = true
      addMsg({ from: 'bot', text: GREETING })
      setChips(START_CHIPS)
      track('chat_open', {})
    }

    // ---- open / close
    const open = () => {
      panel.hidden = false
      widget.classList.add('open')
      toggle.setAttribute('aria-expanded', 'true')
      state.open = true; persist()
      restore(); start()
      setTimeout(() => input?.focus({ preventScroll: true }), 50)
      messages.scrollTop = messages.scrollHeight
    }
    const close = () => {
      panel.hidden = true
      widget.classList.remove('open')
      toggle.setAttribute('aria-expanded', 'false')
      state.open = false; persist()
      toggle.focus()
    }
    toggle.addEventListener('click', () => (panel.hidden ? open() : close()))
    $$('[data-open-chat]').forEach((b) => b.addEventListener('click', () => open()))
    closeBtn?.addEventListener('click', close)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close() })
    if (state.open && state.log.length) open()
    // keep the input visible above the mobile keyboard
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => { if (!panel.hidden) messages.scrollTop = messages.scrollHeight })

    // ---- sending
    const business = async () => {
      if (bizCache) return bizCache
      try { bizCache = await (await fetch('site/business.json', { cache: 'force-cache' })).json() } catch { bizCache = null }
      return bizCache
    }
    const offlineReply = async (text) => {
      const q = text.toLowerCase()
      const b = await business()
      const hours = b ? `We’re open **${b.hours.display}** (${b.hours.note.toLowerCase()}). The yard is at [${b.address.street}, ${b.address.city}, ${b.address.state} ${b.address.zip}](${b.address.mapsUrl}) and you can call or text [${b.phone}](${b.phoneHref}).` : `Call or text [${phoneText()}](tel:${phoneText().replace(/\D/g, '')}) for hours and directions.`
      if (/(hour|open|close|location|address|where|direction|map)/.test(q)) return { reply: hours, chips: START_CHIPS }
      if (/(quote|estimate|price|cost|repair|damage|fix)/.test(q)) return { reply: 'I can’t take quote details through chat right now, but the quote form works and goes straight to the crew. Tell us the boat, where she is and what happened, and add photos if you have them.', chips: [{ label: 'Open the quote form', href: 'contact.html#quote' }, { label: 'Hours & Location', send: 'Hours and location' }] }
      return { reply: `Good question. Chat is in limited mode at the moment, so the quickest answer is a call or text to [${phoneText()}](tel:${phoneText().replace(/\D/g, '')}), or send the quote form and we’ll reply by email.`, chips: [{ label: 'Open the quote form', href: 'contact.html#quote' }, { label: 'Hours & Location', send: 'Hours and location' }] }
    }
    const send = async (text, extra = {}) => {
      text = (text || '').trim()
      if ((!text && !extra.photoIds) || sending) return
      sending = true
      if (text) addMsg({ from: 'user', text })
      input.value = ''
      input.disabled = true
      setChips([])
      showTyping()
      const started = Date.now()
      let data = null, offline = false
      try {
        const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 30000)
        const res = await fetch(API + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal, body: JSON.stringify({ sessionId: state.sessionId, message: text, page: pageCtx.page, pageTitle: pageCtx.title, context: pageCtx.context, ...extra }) })
        clearTimeout(timer)
        if (res.status === 404 || res.status === 405 || res.status === 501 || !(res.headers.get('content-type') || '').includes('json')) offline = true
        else data = await res.json().catch(() => ({ error: 'bad_response' }))
        if (!res.ok && !offline) data = { error: data?.error || 'server_error', reply: data?.reply, status: res.status }
      } catch { offline = true }
      // keep the typing indicator visible for at least a beat so replies don't flash
      await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started))))
      hideTyping()
      if (offline) {
        const r = await offlineReply(text)
        addMsg({ from: 'bot', text: r.reply }); setChips(r.chips)
      } else if (data?.error && !data.reply) {
        const msg = data.status === 429 ? 'Easy there, matey — too many messages at once. Give it a minute and try again, or call us.' : 'I hit a snag on my end and couldn’t answer that. Try again in a moment, or use the quote form and the crew will follow up.'
        addMsg({ from: 'error', text: msg }); setChips([{ label: 'Try again', send: text }, { label: 'Open the quote form', href: 'contact.html#quote' }])
      } else {
        if (data.sessionId) state.sessionId = data.sessionId
        if (data.reply) addMsg({ from: 'bot', text: data.reply })
        if (data.card) addMsg({ type: 'card', rows: data.card })
        if (data.links && data.links.length) addMsg({ type: 'links', links: data.links })
        if (data.draft) store.sset('cl-quote-draft', data.draft)
        if (data.event) track('chat_' + data.event, {})
        setChips(data.chips || START_CHIPS)
        if (data.navigate) setTimeout(() => { location.href = data.navigate }, 600)
      }
      input.disabled = false
      sending = false
      if (!panel.hidden) input.focus({ preventScroll: true })
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); send(input.value) })
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value) } })

    // ---- photo upload from chat
    upload?.addEventListener('change', async () => {
      const files = Array.from(upload.files || [])
      upload.value = ''
      const { ok, errors } = validateFiles(files, 0)
      if (errors.length) addMsg({ from: 'error', text: errors.join('\n') })
      if (!ok.length) return
      addMsg({ type: 'photos', urls: ok.map((f) => URL.createObjectURL(f)) })
      const fd = new FormData()
      fd.append('sessionId', state.sessionId)
      ok.forEach((f) => fd.append('photos', f, f.name))
      showTyping()
      try {
        const res = await fetch(API + '/uploads', { method: 'POST', body: fd })
        const data = await res.json().catch(() => null)
        hideTyping()
        if (!res.ok || !data?.ok) { addMsg({ from: 'error', text: data?.error || 'I couldn’t save those photos. You can attach them on the quote form instead.' }); setChips([{ label: 'Open the quote form', href: 'contact.html#quote' }]); return }
        await send('', { photoIds: data.files.map((f) => f.id), note: `${data.files.length} photo(s) added` })
      } catch {
        hideTyping()
        addMsg({ from: 'error', text: 'Photo uploads need our server, which isn’t reachable right now. Attach them on the quote form instead.' })
        setChips([{ label: 'Open the quote form', href: 'contact.html#quote' }])
      }
    })
  }
})()
