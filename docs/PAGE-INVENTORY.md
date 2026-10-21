# Live URL inventory → redesign action (2026-10-21)

Source: `https://www.captainlevis.com/sitemap.xml` (30 URLs, all HTTP 200) plus `/pages/cookie-policy` (linked from
every page). Word counts are body copy after stripping the repeated nav/footer. "Keep URL" means the new site must
answer at exactly that path (needs clean-URL hosting; GitHub Pages serves `name.html`, not `/name`). "301" needs a
host that can redirect (Vercel `vercel.json`), which GitHub Pages cannot do.

## Core service pages (the "approximately four" the brief expects, plus the ones the audit supports)

| Live URL | Words | Unique value | Action | New destination | SEO notes |
| --- | --- | --- | --- | --- | --- |
| `/fiberglass-boat-repair` | 256 | Umbrella page; process list (grind, biaxial/roving/mat, epoxy/VE, vacuum bag, fairing, spray gelcoat, AQUABUFF) | **Keep URL** as the Services hub (replaces the missing `services.html` / "View All Services") | `/fiberglass-boat-repair` → hub linking all 9 service families | Highest-value head term; keep title "Fiberglass Boat Repair \| Largo & St. Pete" shape; add LocalBusiness JSON-LD |
| `/boat-transom-repair` | 386 | Transom replacement process (remove core, fit, bond, relaminate); 33' Formula case | **301** | `transom-replacement.html` (exists) | Merge process copy + case study; title keeps "Transom Repair & Replacement" |
| `/boat-stringer-repair` | 450 | Tap-test inspection method; core materials (plywood, Tuff-Stuff, Arjay 6011) | **301** | `stringer-repairs.html` (exists) | Add "how to tell if a stringer is bad" section (strong long-tail) |
| `/boat-bulkhead-repair` | 857 | Why 4 watertight bulkheads; tabbing-in method (8–12" strips, 24 oz roving); Bruno/Stillman 2003 case | **301** | `bulkhead-repairs.html` (exists; nav page) | Keep the explanatory depth; link to `bulkheads-structural-fabrication.html` |
| `/gel-coat-repair` | 294 | Color drift from catalyst %, temp, humidity; factory match tweaking | **301** | `gelcoat-repair.html` (exists, has 15 sub-pages) | Keep "Gelcoat Repair & Color Matching" title; remove stale "Bay Pines, St. Petersburg" office line |
| `/boat-osmosis-repair` | 326 | Hydrolysis explanation; VE vs epoxy below waterline; barrier coat | **301** | `hull-blister-osmosis-repair.html` (exists) | Title "Osmosis & Blister Repair" |
| `/boat-hull-step-repair` | 1,263 | High-performance step-hull delamination (Outerlimits, Donzi, Fountain); epoxy repair | **Retain as sub-page** | new `hull-step-repair.html` under Hull Repairs; **301** old URL | Niche term with no competitor on the new site; rewrite the long builder digressions |
| `/boat-restoration` | 3,191 | Classic-boat restoration philosophy; full municipality list; restoration scope | **301** | `full-boat-restoration.html` (exists) | Longest legacy page; keep ~600 words of the useful parts; drop the "ships nationwide materials" claim unless confirmed |
| `/boat-detailing` | 264 | Compound/AQUABUFF/UV wax/non-skid/brightwork/interior list; mobile detailing | **Build** (linked from all 45 pages, missing) and **keep URL** | new `detailing.html` served at `/boat-detailing` | Nav currently points to `detailing.html`; pick one slug and redirect the other |
| `/boat-yard` | 550 | Yard vs. mobile; outside storage; gelcoat 20–25 mil note | **Build** (linked from all 45 pages, missing) and **keep URL** | new `boat-yard.html` | Confirm storage offer before publishing |
| `/sea-doo-repair` | 312 | PWC issues/methods list; "insurance claims welcome" | **Consolidate (decision)** | new `jet-ski-pwc-repair.html` with Sea-Doo + WaveRunner sections; 301 both | ~70% boilerplate overlap between the two; one strong page beats two thin ones. Alternative: keep both URLs with differentiated copy |
| `/wave-runner-yamaha-repair` | 409 | 2011 Yamaha VX Sport insurance case; P-77 filler | **Consolidate (decision)** | as above | |
| `/kayak-repair` | 239 | Kayak-specific issues/methods | **Retain** as a small page | new `kayak-repair.html`, keep URL | Cheap; unique niche term |

## Company / contact / legal

| Live URL | Words | Action | New destination | Notes |
| --- | --- | --- | --- | --- |
| `/` | 420 | Keep | `index.html` | Already rebuilt; fix hours/email/years facts |
| `/contact` | 272 | **Keep URL**; becomes the dedicated quote page (brief §9) | new `contact.html` at `/contact` | Hours Mon–Sat 7:30–3:30, address, phone, `captainlevis@yahoo.com` |
| `/about` | 679 | **Build**; keep URL | new `about.html` | Merge company history + the six blog posts |
| `/blog/setting-sail`, `/blog/a-crew-like-no-other`, `/blog/navigating-challenges`, `/blog/structural-repairs-you-can-trust`, `/blog/comprehensive-repair-solutions`, `/blog/cosmetic-repairs-that-shine` | ~360 each | **Merge + 301** → `/about` | Generic "Our Story" copy; no unique technical content |
| `/pages/cookie-policy` | — | **Rewrite**; 301 → `/cookie-policy` | new `cookie-policy.html` | Current text is a Strikingly boilerplate that mentions ecommerce the site doesn't have |
| (none) | — | **Build** | `privacy-policy.html`, `terms.html`, `sitemap.xml`, `robots.txt`, `404.html` | Footer links are `#` today |

## Legacy pages recommended for removal

| Live URL | Words | Why | Action |
| --- | --- | --- | --- |
| `/resources`, `/resources-boat-building`, `/resources-boat-repair`, `/resources-boating-resources`, `/resources-diving-and-scuba`, `/resources-fishing`, `/resources-internet-resources` | 357–563 | Seven link-directory pages sharing one title and one meta description; no service content | **410 Gone** (or 301 → `/about` only if Search Console shows traffic) — decision after GSC check |
| `/boatfueltankreplacement` | 433 | Generic article; fuel-tank replacement is not in the service list | **Decision**: keep as a guide page only if the yard does this work; otherwise 410 |

## New-site pages with no legacy counterpart (keep, already built)

Structural fiberglass repair, hull repairs (+ hull crack, keel/bottom, impact/collision, soft spots), deck repairs,
custom fabrication (+ consoles, hatches, storage, livewell, seating, engine access, one-off parts, bulkheads &
structural fabrication), gelcoat family (chip, scratch/gouge, crack, oxidation, dock/trailer, color restoration,
waterline, edge/rub-rail, blended, moderate/small/multiple chips, surface scratch, deep gouge, impact mark,
dock-rash/scuff, stress crack, trailer bunk), full boat restoration, structural hull rebuilds.

## Cross-link map required by the brief (§2 "contextual pathways")

- Stringers ↔ Transom ↔ Bulkheads ↔ Deck (wet core) ↔ Structural fiberglass hub ↔ Quote.
- Hull family: crack ↔ impact/collision ↔ soft spots ↔ blister/osmosis ↔ hull step ↔ keel/bottom.
- Gelcoat family ↔ Detailing (oxidation/color restoration overlap) ↔ Full restoration.
- Every service page → `/contact` quote form and the chatbot "I Need a Quote" with the service preselected.
