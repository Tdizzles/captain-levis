#!/usr/bin/env node
// Converts px values inside `font-size:` declarations to rem (16px base) in every *.css file,
// so the site-wide text-size control (html { font-size: calc(100% * var(--text-scale)) }) scales
// all type. Layout units (padding, widths) are left in px on purpose. Idempotent.
//   node scripts/px-to-rem.mjs           # all css files in the repo root
//   node scripts/px-to-rem.mjs a.css b.css
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(ROOT).filter((f) => f.endsWith('.css') && f !== 'chrome.css')

const rem = (px) => {
  const n = Number(px)
  if (n === 0) return '0'
  return (n / 16).toFixed(4).replace(/\.?0+$/, '') + 'rem'
}
let total = 0
for (const f of files) {
  const p = path.join(ROOT, f)
  const src = fs.readFileSync(p, 'utf8')
  let count = 0
  const out = src.replace(/(font-size\s*:\s*)([^;}]+)/g, (m, head, value) => {
    const v = value.replace(/(-?\d*\.?\d+)px\b/g, (mm, n) => { count++; return rem(n) })
    return head + v
  })
  if (count) { fs.writeFileSync(p, out); total += count }
  console.log(`${f}: ${count} px font-size values converted`)
}
console.log(`done: ${total} conversions in ${files.length} files`)
