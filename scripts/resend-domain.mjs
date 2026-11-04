#!/usr/bin/env node
// Resend sending domain for the quote emails, end to end:
//   1. make sure captainlevis.com exists in the Resend account (creates it in us-east-1 if not)
//   2. put its SPF / DKIM records (plus a monitoring-only DMARC record) into Vercel DNS, where the domain's
//      nameservers now live (ns1/ns2.vercel-dns.com since the 2026-11-04 cutover)
//   3. ask Resend to verify and wait until it says "verified"
//   4. optionally send one test email from EMAIL_FROM
//
// Usage (owner runs it; the key needs "Full access" so it can create the domain):
//   RESEND_API_KEY=re_... node scripts/resend-domain.mjs              # show what would be added, change nothing
//   RESEND_API_KEY=re_... node scripts/resend-domain.mjs --apply      # add DNS records + verify
//   RESEND_API_KEY=re_... node scripts/resend-domain.mjs --apply --test-to you@example.com
//
// Safe to re-run: records that already resolve with the right value are skipped, and the domain is reused.
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resend } from 'resend'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const testIdx = args.indexOf('--test-to')
const TEST_TO = testIdx >= 0 ? args[testIdx + 1] : ''

const key = process.env.RESEND_API_KEY || ''
if (!/^re_/.test(key)) { console.error('Set RESEND_API_KEY=re_... (a Full access key from resend.com → API Keys).'); process.exit(2) }

const biz = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'business.json'), 'utf8'))
const DOMAIN = new URL(biz.siteUrl).hostname.replace(/^www\./, '')
const FROM = process.env.EMAIL_FROM || `Captain Levi's Website <inquiries@${DOMAIN}>`
const DMARC = 'v=DMARC1; p=none;'

const resend = new Resend(key)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const must = (r, what) => { if (r.error) { console.error(`${what} failed: ${r.error.name || ''} ${r.error.message}`); if (/restricted|permission|not allowed/i.test(r.error.message || '')) console.error('That key is "Sending access" only. Make a Full access key for this script (you can delete it afterwards).'); process.exit(1) } return r.data }

// What the public DNS answers right now (Google DoH), so we never add a record twice.
async function resolve(name, type) {
  const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } })
  const j = await r.json()
  return (j.Answer || []).filter((a) => a.type === { TXT: 16, MX: 15, CNAME: 5 }[type]).map((a) => String(a.data).replace(/^"|"$/g, '').replace(/"\s*"/g, ''))
}
const same = (a, b) => a.replace(/\.$/, '').replace(/\s+/g, '').toLowerCase() === b.replace(/\.$/, '').replace(/\s+/g, '').toLowerCase()

function vercelDnsAdd(rec) {
  const a = ['vercel', 'dns', 'add', DOMAIN, rec.name, rec.type, rec.value]
  if (rec.type === 'MX') a.push(String(rec.priority ?? 10))
  // DNS names and SPF/DKIM/DMARC values only ever use these; refuse anything else before it reaches a shell
  const bad = a.find((x) => !/^[A-Za-z0-9._=;:+/~ -]+$/.test(x))
  if (bad) { console.error(`   refusing unexpected characters in "${bad}"; add this record by hand in Vercel → Domains → DNS`); process.exit(1) }
  const shown = `npx ${a.map((x) => (/[\s;"~]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)).join(' ')}`
  console.log(`   $ ${shown}`)
  if (!APPLY) return
  // Windows can only spawn npx.cmd through cmd.exe, which does not quote for us; the TXT values have spaces.
  if (process.platform === 'win32') execSync(shown, { stdio: 'inherit', cwd: ROOT })
  else execFileSync('npx', a, { stdio: 'inherit', cwd: ROOT })
}

console.log(`\n== Resend domain ${DOMAIN} (${APPLY ? 'apply' : 'dry run: add --apply to change DNS'})`)
const list = must(await resend.domains.list(), 'List domains')
let dom = (list.data || []).find((d) => d.name === DOMAIN)
if (!dom) {
  if (!APPLY) { console.log(`   ${DOMAIN} is not in this Resend account yet; --apply creates it (region us-east-1).`); process.exit(0) }
  dom = must(await resend.domains.create({ name: DOMAIN, region: 'us-east-1' }), 'Create domain')
  console.log(`   created ${DOMAIN} (id ${dom.id})`)
} else {
  console.log(`   found ${DOMAIN} (id ${dom.id}, status ${dom.status})`)
}
const full = must(await resend.domains.get(dom.id), 'Get domain')

console.log('\n== DNS records (Vercel DNS)')
const wanted = full.records.filter((r) => r.record === 'SPF' || r.record === 'DKIM')
  .map((r) => ({ name: r.name, type: r.type, value: r.value, priority: r.priority }))
wanted.push({ name: '_dmarc', type: 'TXT', value: DMARC })
for (const rec of wanted) {
  const fqdn = `${rec.name}.${DOMAIN}`
  const have = await resolve(fqdn, rec.type)
  const ok = have.some((v) => (rec.type === 'MX' ? same(v.split(/\s+/).pop() || '', rec.value) : same(v, rec.value)))
  if (rec.name === '_dmarc' && have.some((v) => /^v=DMARC1/i.test(v))) { console.log(`   ${fqdn} TXT: a DMARC record already exists, leaving it`); continue }
  if (ok) { console.log(`   ${fqdn} ${rec.type}: already correct`); continue }
  if (have.length && rec.type === 'TXT' && rec.name !== '_dmarc') console.log(`   ${fqdn} TXT has other values (${have.join(' | ')}); adding ours alongside`)
  vercelDnsAdd(rec)
}
if (!APPLY) { console.log('\nDry run only. Re-run with --apply to add the records and verify.'); process.exit(0) }

console.log('\n== Verify (Resend checks DNS; usually 1–5 minutes on Vercel DNS)')
must(await resend.domains.verify(dom.id), 'Start verification')
let status = ''
for (let i = 0; i < 30; i++) {
  const d = must(await resend.domains.get(dom.id), 'Get domain')
  status = d.status
  const parts = d.records.filter((r) => r.record === 'SPF' || r.record === 'DKIM').map((r) => `${r.record}/${r.type} ${r.status}`).join(', ')
  console.log(`   ${new Date().toLocaleTimeString()}  ${status}  (${parts})`)
  if (status === 'verified' || status === 'failed') break
  if (i % 6 === 5) await resend.domains.verify(dom.id)
  await sleep(10_000)
}
if (status !== 'verified') {
  console.log(`\nNot verified yet (${status}). DNS can take a little longer: re-run this same command in a few minutes; it skips what is done.`)
  process.exit(1)
}
console.log(`\n${DOMAIN} is verified for sending as ${FROM}.`)

if (TEST_TO) {
  const r = await resend.emails.send({ from: FROM, to: [TEST_TO], subject: `Resend test from ${DOMAIN}`, text: `This is a one-off test from scripts/resend-domain.mjs. If you can read it, ${DOMAIN} can send the quote emails.`, html: `<p>This is a one-off test from <code>scripts/resend-domain.mjs</code>.</p><p>If you can read it, <strong>${DOMAIN}</strong> can send the quote emails.</p>` })
  must(r, 'Test send')
  console.log(`Test email sent to ${TEST_TO} (Resend id ${r.data.id}). Check spam too the first time.`)
}
console.log('\nNext: put the key on Vercel and redeploy:  RESEND_API_KEY=re_... bash scripts/vercel-setup.sh')
