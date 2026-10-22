// Branded quote-request email: table layout, inline CSS, ≤600px, dark-mode safe, plus a plain-text part.
// Every customer-supplied string goes through esc(); newlines become <br>.
import { appUrl, business, serviceLabel, siteUrl } from '../business.js'
import { describeBoat } from '../boat.js'
import { env } from '../env.js'
import type { InquiryRow } from '../inquiries.js'
import { signPhotoUrl, type PhotoRow } from '../photos.js'
import type { TemplatedReply } from '../quote/reply.js'

export const NAVY = '#00264B'
export const CYAN = '#5ECDFA'
const FONT = "'Plus Jakarta Sans', Inter, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export const esc = (s: unknown): string => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
export const nl2br = (s: unknown): string => esc(s).replace(/\r?\n/g, '<br>')

export interface ChatSummary { turns: number; started: Date | string; excerpt: { role: 'user' | 'assistant'; text: string }[] }

export interface RenderInput {
  inquiry: InquiryRow
  photos: PhotoRow[]
  chat?: ChatSummary | null
  draftReply?: string | null
  reply?: TemplatedReply | null
  now?: Date
}

export function formatWhen(d: Date | string, tz = business().hours.timezone || 'America/New_York'): string {
  const date = d instanceof Date ? d : new Date(d)
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(date)
}

export function subjectFor(i: InquiryRow): string {
  const boat = describeBoat({ make: i.boat_make, model: i.boat_model, year: i.boat_year, raw: i.boat_raw })
  return `[Quote Request ${i.ref}] ${serviceLabel(i.service)} — ${boat || 'boat not given'} — ${i.name}`
}

function row(label: string, valueHtml: string): string {
  return `<tr>
  <td style="padding:6px 0;font:600 13px/1.4 ${FONT};color:#5a6b7d;vertical-align:top;width:120px;">${esc(label)}</td>
  <td style="padding:6px 0;font:400 15px/1.5 ${FONT};color:#1a2633;vertical-align:top;">${valueHtml || '<span style="color:#8a99a8;">—</span>'}</td>
</tr>`
}

function section(title: string, inner: string): string {
  return `<tr><td style="padding:0 28px 22px 28px;">
  <p style="margin:0 0 8px 0;font:700 12px/1.3 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:${NAVY};border-bottom:2px solid ${CYAN};padding-bottom:6px;">${esc(title)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${inner}</table>
</td></tr>`
}

function button(href: string, label: string, bg: string, color: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="display:inline-table;margin:4px 8px 4px 0;"><tr>
  <td bgcolor="${bg}" style="border-radius:8px;background:${bg};">
    <a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font:700 14px/1 ${FONT};color:${color};text-decoration:none;border-radius:8px;">${esc(label)}</a>
  </td></tr></table>`
}

export function renderInquiryEmail(input: RenderInput): { html: string; text: string; subject: string } {
  const { inquiry: i, photos, chat, draftReply, reply } = input
  const biz = business()
  const when = formatWhen(i.created_at)
  const boat = describeBoat({ make: i.boat_make, model: i.boat_model, year: i.boat_year, raw: i.boat_raw })
  const adminUrl = `${appUrl()}/#/inquiries/${i.id}`
  const telHref = `tel:${i.phone.replace(/[^\d+]/g, '')}`
  const replySubject = encodeURIComponent(reply?.subject || `Re: your quote request ${i.ref} — ${biz.name}`)
  const mailto = `mailto:${encodeURIComponent(i.email)}?subject=${replySubject}`
  const base = siteUrl()
  const photoUrls = photos.map((p) => ({ p, url: signPhotoUrl(p.id, 7 * 24 * 3600, base) }))

  const photosHtml = photoUrls.length
    ? `<tr><td style="padding:4px 0;">${photoUrls.map(({ p, url }) =>
      `<a href="${esc(url)}" style="display:inline-block;margin:0 8px 8px 0;"><img src="${esc(url)}" width="140" alt="Customer photo ${esc(p.filename)}" style="display:block;width:140px;max-width:100%;height:auto;border-radius:8px;border:1px solid #d6e0ea;"></a>`).join('')}
      <p style="margin:6px 0 0 0;font:400 12px/1.4 ${FONT};color:#5a6b7d;">Links work for 7 days. Open the inquiry in the quote builder for permanent access.</p></td></tr>`
    : row('Photos', '<span style="color:#8a99a8;">No photos attached</span>')

  const chatHtml = chat
    ? `<tr><td style="padding:4px 0;font:400 14px/1.5 ${FONT};color:#1a2633;">
        Collected through the website chat (${chat.turns} turn${chat.turns === 1 ? '' : 's'}, started ${esc(formatWhen(chat.started))}).
        ${chat.excerpt.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${chat.excerpt.map((m) =>
          `<tr><td style="padding:3px 0;font:400 13px/1.45 ${FONT};color:${m.role === 'user' ? '#1a2633' : '#5a6b7d'};"><strong>${m.role === 'user' ? 'Customer' : 'Captain Levi'}:</strong> ${nl2br(m.text)}</td></tr>`).join('')}</table>` : ''}
        <p style="margin:8px 0 0 0;"><a href="${esc(adminUrl)}" style="color:${NAVY};font:600 13px/1.4 ${FONT};">Full transcript in the quote builder</a></p>
      </td></tr>`
    : ''

  const gaps = reply?.assessment.gaps || []
  const needHtml = reply ? section(gaps.length ? 'What we still need to quote' : 'Ready to quote', gaps.length
    ? `<tr><td style="padding:4px 0;"><ul style="margin:0;padding-left:18px;font:400 14px/1.6 ${FONT};color:#1a2633;">${gaps.map((g) => `<li><strong>${esc(g.label)}</strong> <span class="muted" style="color:#5a6b7d;">— ${esc(g.why)}</span></li>`).join('')}</ul>
      <p class="muted" style="margin:8px 0 0 0;font:400 12px/1.4 ${FONT};color:#5a6b7d;">Readiness: ${esc(reply.assessment.readiness.replace('_', ' '))}${reply.assessment.insurance ? ' · insurance claim' : ''}</p></td></tr>`
    : `<tr><td style="padding:4px 0;font:400 14px/1.5 ${FONT};color:#1a2633;">The customer gave everything the crew needs for a first estimate.${reply.assessment.insurance ? ' Insurance claim: write it as a supplement.' : ''}</td></tr>`) : ''
  const replyHtml = reply
    ? `<tr><td style="padding:0 28px 22px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #b8c7d6;border-radius:10px;background:#f4f9fd;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0 0 6px 0;font:700 12px/1.3 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:${NAVY};">Reply to send (Captain Levi’s words — edit as you like)</p>
        <p style="margin:0;font:400 14px/1.55 ${FONT};color:#1a2633;">${nl2br(reply.body)}</p>
        <p class="muted" style="margin:10px 0 0 0;font:400 12px/1.4 ${FONT};color:#5a6b7d;">Written by the site from fixed rules, not AI. Asks only for what is missing; no prices, dates or promises. Hit “Reply to customer” and paste it.</p>
      </td></tr>
    </table></td></tr>`
    : ''
  const draftHtml = draftReply
    ? `<tr><td style="padding:0 28px 22px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px dashed #b8c7d6;border-radius:10px;background:#f4f9fd;">
      <tr><td style="padding:14px 16px;">
        <p style="margin:0 0 6px 0;font:700 12px/1.3 ${FONT};letter-spacing:.12em;text-transform:uppercase;color:#8a5a00;">Suggested reply (DRAFT — review before sending)</p>
        <p style="margin:0;font:400 14px/1.55 ${FONT};color:#1a2633;">${nl2br(draftReply)}</p>
        <p style="margin:8px 0 0 0;font:400 12px/1.4 ${FONT};color:#5a6b7d;">Written by the website assistant from the inquiry only. It has not been sent and contains no prices, dates or promises.</p>
      </td></tr>
    </table></td></tr>`
    : ''

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(subjectFor(i))}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  body { margin:0; padding:0; background:#eef3f8; -webkit-text-size-adjust:100%; }
  .card { background:#ffffff; }
  @media (prefers-color-scheme: dark) {
    body, .bg { background:#0b1622 !important; }
    .card { background:#13202e !important; }
    .txt, .txt td, .txt p { color:#e6edf3 !important; }
    .muted { color:#9fb0c0 !important; }
    .draft { background:#1a2838 !important; }
  }
  @media only screen and (max-width:620px) { .wrap { width:100% !important; } .pad { padding-left:16px !important; padding-right:16px !important; } }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#eef3f8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(i.name)} · ${esc(serviceLabel(i.service))} · ${esc(boat || 'boat not given')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#eef3f8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="wrap card txt" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">
  <tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:22px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="font:800 22px/1.2 ${FONT};color:#ffffff;letter-spacing:-.01em;">Captain Levi&#8217;s <span style="color:${CYAN};">·</span> <span style="font-weight:600;font-size:14px;color:${CYAN};">Quote Request</span></td>
      <td align="right" style="font:700 14px/1.2 ${FONT};color:${CYAN};white-space:nowrap;">${esc(i.ref)}</td>
    </tr></table>
  </td></tr>
  <tr><td class="pad" style="padding:22px 28px 10px 28px;">
    <p style="margin:0 0 4px 0;font:800 20px/1.3 ${FONT};color:${NAVY};">${esc(i.name)} needs ${esc(serviceLabel(i.service))}</p>
    <p class="muted" style="margin:0 0 14px 0;font:400 13px/1.4 ${FONT};color:#5a6b7d;">Received ${esc(when)} · via ${i.source === 'chat' ? 'website chat' : 'website form'}${i.page ? ` · page: ${esc(i.page)}` : ''}</p>
    ${button(adminUrl, 'Open in Quote Builder', NAVY, '#ffffff')}${button(mailto, 'Reply to customer', CYAN, NAVY)}
  </td></tr>
  <tr><td style="padding:8px 0 0 0;"></td></tr>
  ${section('Customer', row('Name', esc(i.name)) + row('Email', `<a href="mailto:${esc(i.email)}" style="color:${NAVY};">${esc(i.email)}</a>`) + row('Phone', `<a href="${esc(telHref)}" style="color:${NAVY};">${esc(i.phone)}</a>`))}
  ${section('Boat', row('Boat', esc(boat || '')) + row('Make / model', esc([i.boat_make, i.boat_model].filter(Boolean).join(' ') || '')) + row('Year', i.boat_year ? esc(i.boat_year) : '') + row('Where it is', esc(i.boat_location || '')))}
  ${section('Request', row('Service', esc(serviceLabel(i.service))) + row('Damage area', esc(i.damage_location || '')) + row('Damage type', esc(i.damage_type || '')) + `<tr><td colspan="2" style="padding:8px 0 0 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:4px solid ${CYAN};padding:8px 14px;font:400 15px/1.55 ${FONT};color:#1a2633;background:#f4f9fd;border-radius:0 8px 8px 0;" class="draft">${nl2br(i.message)}</td></tr></table></td></tr>`)}
  ${section('Photos', photosHtml)}
  ${chat ? section('Chat', chatHtml) : ''}
  ${needHtml}
  ${replyHtml}
  ${draftHtml}
  <tr><td class="pad" style="padding:6px 28px 24px 28px;border-top:1px solid #e3eaf1;">
    <p class="muted" style="margin:14px 0 0 0;font:400 12px/1.5 ${FONT};color:#5a6b7d;">Sent by the ${esc(biz.name)} website to ${esc(env.emailTo)}. Reply to this email to answer the customer directly (Reply-To is set to them). ${esc(biz.legalName)} · ${esc(biz.address.street)}, ${esc(biz.address.city)}, ${esc(biz.address.state)} ${esc(biz.address.zip)} · ${esc(biz.phone)}</p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`

  const text = [
    `CAPTAIN LEVI'S — QUOTE REQUEST ${i.ref}`,
    `Received ${when} via ${i.source === 'chat' ? 'website chat' : 'website form'}${i.page ? ` (page: ${i.page})` : ''}`,
    '',
    'CUSTOMER',
    `  Name:  ${i.name}`,
    `  Email: ${i.email}`,
    `  Phone: ${i.phone}`,
    '',
    'BOAT',
    `  Boat:        ${boat || '—'}`,
    `  Year:        ${i.boat_year || '—'}`,
    `  Where it is: ${i.boat_location || '—'}`,
    '',
    'REQUEST',
    `  Service:     ${serviceLabel(i.service)}`,
    `  Damage area: ${i.damage_location || '—'}`,
    `  Damage type: ${i.damage_type || '—'}`,
    '  Message:',
    ...i.message.split(/\r?\n/).map((l) => `    > ${l}`),
    '',
    'PHOTOS',
    ...(photoUrls.length ? photoUrls.map(({ url }) => `  ${url}`) : ['  No photos attached']),
    ...(chat ? ['', 'CHAT', `  Collected through the website chat (${chat.turns} turns). Transcript: ${adminUrl}`] : []),
    ...(reply ? ['', gaps.length ? 'WHAT WE STILL NEED TO QUOTE' : 'READY TO QUOTE', ...(gaps.length ? gaps.map((g) => `  - ${g.label}: ${g.why}`) : ['  The customer gave everything the crew needs for a first estimate.']), '', 'REPLY TO SEND (Captain Levi\'s words — edit as you like)', ...reply.body.split(/\r?\n/).map((l) => `  ${l}`)] : []),
    ...(draftReply ? ['', 'AI SUGGESTED REPLY (DRAFT — review before sending)', ...draftReply.split(/\r?\n/).map((l) => `  ${l}`)] : []),
    '',
    `Open in Quote Builder: ${adminUrl}`,
    `Reply to customer: ${i.email}`,
  ].join('\n')

  return { html, text, subject: subjectFor(i) }
}
