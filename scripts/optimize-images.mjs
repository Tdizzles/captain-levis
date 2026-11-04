#!/usr/bin/env node
// Responsive WebP for every page image (audit 2026-11-04: 0 srcset on 1,297 <img>, 563 JPEGs, ~13 MB to save).
// For each <img src="assets/x.jpg|png"> in a root page whose file is >= MIN_BYTES, writes
//   assets/opt/<name>.<contenthash>-<w>.webp   at 480 / 960 / 1600 px plus the natural width (max 2000, never upscaled)
// and lists them in site/image-variants.json; scripts/build.mjs then sets srcset + sizes on the tags. src stays the
// original JPEG/PNG as the fallback, so the markup shape (and every CSS selector) is unchanged. File names carry
// the source hash, so a replaced photo gets new URLs.
//   node scripts/optimize-images.mjs && node scripts/build.mjs
//   node scripts/optimize-images.mjs --check   # exit 1 if the manifest or a variant file is out of date
// Add data-no-opt to an <img> (or give it a hand-written srcset that is not assets/opt) to leave it alone. Re-run after adding or replacing images.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const OUT = path.join(ROOT, 'assets', 'opt')
const WIDTHS = [480, 960, 1600]
const MIN_BYTES = 40_000
const QUALITY = 72

fs.mkdirSync(OUT, { recursive: true })
const cache = new Map()

async function variants(rel) {
  if (cache.has(rel)) return cache.get(rel)
  const abs = path.join(ROOT, rel)
  let result = null
  if (fs.existsSync(abs) && fs.statSync(abs).size >= MIN_BYTES) {
    const buf = fs.readFileSync(abs)
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 8)
    const { width } = await sharp(buf).metadata()
    const base = path.basename(rel).replace(/\.(jpe?g|png)$/i, '')
    // steps below the natural width, plus the natural width (capped), skipping a step within 25% of the next one
    const top = Math.min(width, 2000)
    const steps = WIDTHS.filter((w) => w < top * 0.9)
    const ws = [...steps, top].filter((w, i, a) => i === a.length - 1 || a[i + 1] > w * 1.25)
    const list = []
    for (const w of ws) {
      const name = `${base}.${hash}-${w}.webp`
      const file = path.join(OUT, name)
      if (!fs.existsSync(file)) {
        if (CHECK) { console.log(`  missing ${name}`); missing++ } else await sharp(buf).resize({ width: w, withoutEnlargement: true }).webp({ quality: QUALITY, effort: 5 }).toFile(file)
      }
      list.push(`assets/opt/${name} ${w}w`)
    }
    result = list.length ? list.join(', ') : null
  }
  cache.set(rel, result)
  return result
}

let missing = 0
// collect every page image, generate its variants, and record the srcset in site/image-variants.json;
// scripts/build.mjs stamps srcset/sizes onto the <img> tags from that file (so rebuilt blocks keep them)
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
const manifest = {}
for (const page of pages) {
  const src = fs.readFileSync(path.join(ROOT, page), 'utf8')
  for (const m of src.matchAll(/<img\s[^>]*>/g)) {
    const s = m[0].match(/\ssrc="(assets\/[^"?]+\.(?:jpe?g|png))(?:\?[^"]*)?"/i)
    if (!s || /data-no-opt/.test(m[0]) || /srcset="(?!assets\/opt\/)/.test(m[0])) continue
    const set = await variants(s[1])
    if (set) manifest[s[1]] = set
  }
}
const manifestPath = path.join(ROOT, 'site', 'image-variants.json')
const json = JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1) + '\n'
const manifestChanged = !fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== json
if (!CHECK && manifestChanged) fs.writeFileSync(manifestPath, json)
const changedPages = manifestChanged ? 1 : 0
const tags = Object.keys(manifest).length
// drop variants nothing references any more (an image was replaced or removed)
const used = new Set([...cache.values()].filter(Boolean).flatMap((v) => v.split(', ').map((x) => path.basename(x.split(' ')[0]))))
let removed = 0
for (const f of fs.readdirSync(OUT)) if (!used.has(f)) { if (!CHECK) fs.unlinkSync(path.join(OUT, f)); removed++ }
console.log(`${CHECK ? 'check' : 'optimize'}: ${tags} images with variants, manifest ${manifestChanged ? (CHECK ? 'out of date' : 'updated (now run node scripts/build.mjs)') : 'current'}, ${missing} missing, ${removed} stale variant(s) ${CHECK ? 'found' : 'removed'}`)
if (CHECK && (missing || changedPages || removed)) process.exit(1)
