#!/usr/bin/env node
// Writes the search title + meta description from site/seo-meta.json into each page's <title> and
// <meta name="description">. Run it before scripts/build.mjs (the build copies both into og:title/og:description
// and the JSON-LD). Limits: title <= 60 characters, description <= 155 (as rendered, entities decoded).
//   node scripts/apply-seo-meta.mjs           # write
//   node scripts/apply-seo-meta.mjs --check   # exit 1 if any page differs or a limit is broken
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
export const TITLE_MAX = 60
export const DESC_MAX = 155

const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'seo-meta.json'), 'utf8'))
const enc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

let bad = 0
let changed = 0
for (const [slug, pair] of Object.entries(meta)) {
  if (slug.startsWith('_')) continue
  const [title, desc] = pair
  if (title.length > TITLE_MAX) { console.error(`  ${slug}: title is ${title.length} chars (max ${TITLE_MAX})`); bad++ }
  if (desc.length > DESC_MAX) { console.error(`  ${slug}: description is ${desc.length} chars (max ${DESC_MAX})`); bad++ }
  const file = path.join(ROOT, slug + '.html')
  if (!fs.existsSync(file)) { console.error(`  ${slug}: no ${slug}.html`); bad++; continue }
  const src = fs.readFileSync(file, 'utf8')
  const out = src
    .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${enc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, () => `<meta name="description" content="${enc(desc)}">`)
  if (out !== src) {
    changed++
    if (CHECK) console.log(`  would change: ${slug}.html`)
    else fs.writeFileSync(file, out)
  }
}
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5))
for (const p of pages) if (!meta[p] && p !== '404') { console.error(`  ${p}.html has no entry in site/seo-meta.json`); bad++ }
console.log(`${CHECK ? 'checked' : 'applied'}: ${changed} page(s) ${CHECK ? 'differ' : 'updated'}${bad ? `, ${bad} problem(s)` : ''}`)
if (bad || (CHECK && changed)) process.exit(1)
