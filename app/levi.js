// Captain Levi panel inside the estimate editor: chat with the assistant; it edits the document server-side.
import { api, esc, toast } from './util.js'

export function mountLevi(state, hooks) {
  const log = document.getElementById('levi-log'), form = document.getElementById('levi-form'), input = document.getElementById('levi-input'), note = document.getElementById('levi-note')
  if (!log || form.dataset.mounted) return
  form.dataset.mounted = '1'
  const paint = (messages) => {
    log.innerHTML = messages.map((m) => `<div class="m ${esc(m.role)}">${esc(m.text)}</div>${m.changes && m.changes.length ? `<div class="m changes">✔ ${m.changes.map(esc).join('<br>✔ ')}</div>` : ''}`).join('') || '<p class="muted">Ask for anything: “add a section for rigging with three lines”, “fill the insurance box from the notes”, “size the transom core replacement for a 24-foot Whaler”.</p>'
    log.scrollTop = log.scrollHeight
  }
  api(`/api/admin/assistant?estimate_id=${encodeURIComponent(state.id)}`).then((r) => {
    paint(r.messages)
    if (!r.configured) note.textContent = 'Captain Levi is not connected yet: the Anthropic API key has not been added to Vercel. Everything on this page still works by hand.'
    else note.textContent = `Captain Levi runs on ${r.model}. Every change he makes is saved as a version you can restore under History.`
  }).catch((ex) => { log.innerHTML = `<div class="m err">${esc(ex.message)}</div>` })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = input.value.trim(); if (!text) return
    input.value = ''
    log.insertAdjacentHTML('beforeend', `<div class="m user">${esc(text)}</div><div class="m assistant" id="levi-thinking">Captain Levi is working on it…</div>`)
    log.scrollTop = log.scrollHeight
    form.querySelector('button').disabled = true
    try {
      const r = await fetch('/api/admin/assistant', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimate_id: state.id, message: text }) })
      const j = await r.json()
      if (r.status === 401) { location.hash = '#/login'; return }
      if (!r.ok && !j.reply) throw new Error(j.error || `Request failed (${r.status})`)
      document.getElementById('levi-thinking')?.remove()
      paint(j.messages || [])
      if (j.changes && j.changes.length && j.estimate) { toast(`Captain Levi made ${j.changes.length} change${j.changes.length === 1 ? '' : 's'}`); await hooks.refresh() }
    } catch (ex) { document.getElementById('levi-thinking')?.remove(); log.insertAdjacentHTML('beforeend', `<div class="m err">${esc(ex.message)}</div>`) } finally { form.querySelector('button').disabled = false; input.focus() }
  })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit() } })
}
