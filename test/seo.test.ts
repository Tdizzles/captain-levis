// Guards for the 2026-11-04 SEO audit fixes: title/description limits, one valid JSON-LD @graph per page,
// extensionless internal links, and a sitemap that lists every indexable page with a real lastmod.
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '..')
const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'seo-meta.json'), 'utf8')) as Record<string, [string, string]>
const biz = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'business.json'), 'utf8'))
const SITE = biz.siteUrl.replace(/\/$/, '')

describe('search titles and descriptions', () => {
  for (const [slug, pair] of Object.entries(meta)) {
    if (slug.startsWith('_')) continue
    it(`${slug}: title <= 60, description <= 155, and the page uses them`, () => {
      expect(pair[0].length).toBeLessThanOrEqual(60)
      expect(pair[1].length).toBeLessThanOrEqual(155)
      const html = read(`${slug}.html`)
      const dec = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      expect(dec(html.match(/<title>([\s\S]*?)<\/title>/)![1])).toBe(pair[0])
      expect(dec(html.match(/<meta name="description" content="([^"]*)"/)![1])).toBe(pair[1])
    })
  }
})

describe('structured data', () => {
  for (const f of pages) {
    it(`${f}: exactly one JSON-LD @graph, defining #business and #website`, () => {
      // page-specific extras (boat-detailing's FAQPage for its visible Q&A) may sit in their own block
      const blocks = [...read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].filter((b) => b[1].includes('"@graph"'))
      expect(blocks).toHaveLength(1)
      const ld = JSON.parse(blocks[0][1])
      const graph = ld['@graph'] as Record<string, unknown>[]
      const ids = graph.map((n) => n['@id'])
      expect(ids).toContain(`${SITE}/#business`)
      expect(ids).toContain(`${SITE}/#website`)
      const business = graph.find((n) => n['@id'] === `${SITE}/#business`) as Record<string, unknown>
      expect(business.priceRange).toBe('$$')
      expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|"Review"|HowTo/)
      // every @id that is referenced is also defined on the page
      const refs = [...blocks[0][1].matchAll(/\{"@id":"([^"]+)"\}/g)].map((m) => m[1])
      for (const r of refs) expect(ids, `${f} references ${r}`).toContain(r)
    })
  }
  it('service pages carry a Service node with the business as provider', () => {
    const ld = JSON.parse(read('transom-replacement.html').match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1])
    const svc = ld['@graph'].find((n: Record<string, unknown>) => n['@type'] === 'Service')
    expect(svc.provider['@id']).toBe(`${SITE}/#business`)
  })
  it('contact is a ContactPage', () => {
    expect(read('contact.html')).toContain('"@type":"ContactPage"')
  })
})

describe('internal links', () => {
  for (const f of pages) {
    it(`${f}: no .html hrefs to our own pages (each one costs a 308)`, () => {
      const own = [...read(f).matchAll(/href="([a-z0-9-]+)\.html/g)].map((m) => m[1]).filter((s) => fs.existsSync(path.join(ROOT, `${s}.html`)))
      expect(own).toEqual([])
    })
  }
})

describe('sitemap', () => {
  it('lists every indexable page on the canonical host with a lastmod from site/lastmod.json', () => {
    const xml = read('sitemap.xml')
    const lastmod = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'lastmod.json'), 'utf8'))
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)]
    expect(locs.length).toBeGreaterThan(50)
    for (const [, loc, date] of locs) {
      expect(loc.startsWith(`${SITE}/`)).toBe(true)
      const slug = loc === `${SITE}/` ? 'index' : loc.slice(SITE.length + 1)
      expect(date).toBe(lastmod[slug].date)
    }
  })
  it('llms.txt exists and names the phone number', () => {
    expect(read('llms.txt')).toContain(biz.phone)
  })
})
