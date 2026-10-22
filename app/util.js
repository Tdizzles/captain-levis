// Shared helpers for the Quote Desk modules.
export const session = { me: null }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
export const raw = (html) => ({ __html: html })
/** Tagged template: interpolations are escaped unless wrapped with raw(). */
export const h = (strings, ...vals) => strings.reduce((out, str, i) => out + str + (i < vals.length ? (vals[i] && vals[i].__html !== undefined ? vals[i].__html : esc(vals[i])) : ''), '')
export const fmtWhen = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(d))
export const ago = (d) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`; const hrs = Math.round(m / 60); if (hrs < 48) return `${hrs} h ago`; return `${Math.round(hrs / 24)} d ago` }
export const money = (cents) => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

let toastTimer
export function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg; el.hidden = false
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2600)
}

export async function api(path, opts = {}) {
  const method = opts.method || (opts.body !== undefined ? 'POST' : 'GET')
  const res = await fetch(path, { credentials: 'same-origin', method, headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined })
  let json = null
  try { json = await res.json() } catch { /* empty */ }
  if (res.status === 401 && !path.startsWith('/api/auth/')) { session.me = null; location.hash = '#/login'; throw new Error('Signed out') }
  if (!res.ok) throw new Error((json && json.error) || `Request failed (${res.status})`)
  return json
}

export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)
