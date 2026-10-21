// Site knowledge for the chat's question state: pages generated into site/knowledge.json by
// scripts/build-knowledge.mjs, keyword retrieval (no key) and the damage-topic routing table.
import { readFileSync } from 'node:fs'
import type { DamageLocation, Link } from './types.js'

export interface KnowledgePage { slug: string; title: string; description: string; h1: string; h2s: string[]; text: string }

let cache: KnowledgePage[] | null = null

export function knowledgePages(): KnowledgePage[] {
  if (cache) return cache
  try {
    const data = JSON.parse(readFileSync(new URL('../../site/knowledge.json', import.meta.url), 'utf8')) as { pages?: KnowledgePage[] }
    cache = Array.isArray(data.pages) ? data.pages : []
  } catch { cache = [] }
  return cache
}

export function pageBySlug(slug: string): KnowledgePage | undefined {
  return knowledgePages().find((p) => p.slug === slug)
}

/** Damage topics → the page to offer. Order matters: first match wins. */
export const TOPIC_ROUTES: { topic: DamageLocation | 'structural'; re: RegExp; slug: string; label: string }[] = [
  { topic: 'transom', re: /\btransoms?\b/i, slug: 'transom-replacement', label: 'Transom replacement' },
  { topic: 'stringers', re: /\bstringers?\b/i, slug: 'stringer-repairs', label: 'Stringer repairs' },
  { topic: 'bulkheads', re: /\bbulkheads?\b/i, slug: 'bulkhead-repairs', label: 'Bulkhead repairs' },
  { topic: 'gelcoat', re: /\bgel ?coat\b|\bgelcote\b|\bspider ?cracks?\b|\bcrazing\b|\boxidi[sz]/i, slug: 'gelcoat-repair', label: 'Gelcoat repair' },
  { topic: 'deck', re: /\bdecks?\b|\bfloor\b|\bcockpit sole\b|\bsole\b/i, slug: 'deck-repairs', label: 'Deck repairs' },
  { topic: 'hull', re: /\bhulls?\b|\bkeel\b|\bchine\b|\bblisters?\b|\bosmosis\b/i, slug: 'hull-repairs', label: 'Hull repairs' },
  { topic: 'structural', re: /\bstructural\b|\bsoft spots?\b|\bdelaminat|\brotten core\b|\bcore rot\b|\bwet core\b/i, slug: 'structural-fiberglass-repair', label: 'Structural fiberglass repair' },
]

export function routeFor(text: string): { topic: string; link: Link; slug: string } | null {
  for (const r of TOPIC_ROUTES) if (r.re.test(text)) return { topic: r.topic, slug: r.slug, link: { label: r.label, href: `${r.slug}.html` } }
  return null
}

/** Honest, non-committal first answers used when no model is available (and as the fallback). */
export const TOPIC_ANSWERS: Record<string, string> = {
  transom: 'A soft or flexing transom usually means water has gotten into the core, and it is one of the more common repairs we do: the old core comes out, a new one goes in and it is glassed back solid. The crew will want to see the boat before saying what yours needs.',
  stringers: 'Soft spots in the floor or stringers that have gone spongy point to water in the core. Stringers carry the load of the whole boat, so the crew checks how far it has spread before recommending a repair.',
  bulkheads: 'Bulkheads tie the hull together, so a cracked or rotten bulkhead is worth getting looked at sooner rather than later. It is a repair we do regularly, and the crew will want eyes on the boat first.',
  gelcoat: 'Chips, scratches, spider cracks and oxidation are gelcoat work: the damaged area is ground back, refilled, color-matched and buffed so the repair disappears. The crew matches color by eye on the boat itself.',
  deck: 'Deck damage ranges from cosmetic to a soft core underneath, and the fix depends on which one you have. Walking it and tapping it tells the crew a lot, so a look at the boat comes first.',
  hull: 'Hull repairs are our bread and butter, from gouges and cracks to blisters and impact damage below the waterline. The crew will want to see the boat (photos help) before saying what it needs.',
  structural: 'Soft spots, flexing and delamination are structural, meaning the fiberglass has separated from its core. The crew checks how far it has spread before recommending anything, so a look at the boat comes first.',
}

const STOP = new Set('the a an and or of to in on for with is are be your you we our it its this that at by from as can how what do does i my me boat boats repair repairs fiberglass'.split(' '))

export function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).map((w) => w.replace(/s$/, '')).filter((w) => w.length > 2 && !STOP.has(w))
}

/** Simple weighted keyword retrieval over title/h1/h2s/description/text. */
export function searchPages(query: string, limit = 3): { page: KnowledgePage; score: number }[] {
  const terms = [...new Set(tokenize(query))]
  if (!terms.length) return []
  const scored = knowledgePages().map((page) => {
    const head = tokenize([page.title, page.h1, page.description].join(' '))
    const subs = tokenize(page.h2s.join(' '))
    const body = tokenize(page.text)
    let score = 0
    for (const t of terms) {
      if (head.includes(t)) score += 5
      if (subs.includes(t)) score += 2
      const n = body.filter((w) => w === t).length
      score += Math.min(n, 4) * 0.5
      if (page.slug.includes(t)) score += 3
    }
    return { page, score }
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}
