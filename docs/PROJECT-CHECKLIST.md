# Project checklist — Captain Levi's website, chatbot, inquiries, estimates

Status key: ☐ not started · ◐ partial · ☑ done · ⛔ blocked (see note). Update this file at the end of every
session. Brief section numbers refer to the owner's implementation brief (2026-10-21).

## Phase 1 — Audit (§18.1)
- ☑ Inspect repos (site + estimater), live site, hosting accounts — `docs/AUDIT-2026-10-21.md`
- ☑ Live URL inventory with actions and redirects — `docs/PAGE-INVENTORY.md`
- ☑ Estimate PDF (Rev5 McKinney) read; gaps vs. estimater listed
- ☑ Implementation plan and blockers — `docs/IMPLEMENTATION-PLAN.md`
- ⛔ Chatbot screenshot not found (owner to supply)

## Phase 2 — Structure, content, mobile, accessibility, legal (§2–§6)
- ☑ Partials + build script for shared chrome — partials/*, scripts/build.mjs, chrome.css; idempotent, stamps all pages
- ☑ Nav: real links (logo, Boat Yard, Detailing, About, Reviews, Contact), services hub, footer legal links
- ☑ Breadcrumbs on interior pages; prev/next pager within families; aria-current on active page
- ☑ Build missing pages: about, contact, fiberglass-boat-repair hub, 404, boat-yard, boat-detailing, hull-step-repair, kayak-repair, jet-ski-pwc-repair, sitemap (all stamped, 1 h1, no overflow at 390)
- ☑ Merge legacy content per inventory (transom, stringer tap-test, bulkheads, gelcoat matching, osmosis resins, restoration; 11 legacy photos pulled from the old site)
- ☑ Facts pass: hours Mon–Sat 7:30–3:30, captainlevis@yahoo.com, 50+ Years confirmed by owner 2026-10-21 and applied via site/business.json + partials
- ◐ Mobile/tablet/desktop pass: 390px overflow sweep clean on 22 pages incl. all new ones; desktop chrome verified at 1920; tablet + landscape + remaining sub-pages pending
- ☑ Known bugs: `<ol>` numbering fixed globally (chrome.css `ol[class]{list-style:none}`); trust-strip edge fix still per-page
- ☑ Accessibility: `<main>`, skip link, focus-visible, reduced motion, form error messaging (headings/alt pass still per-page)
- ☑ Text-size − / + controls above chat avatar (5 steps 87.5–137.5%, persisted, header capped at 112.5%) — screenshot still not supplied; placed above the avatar per brief
- ☑ px→rem conversion (2,632 font-size values in 40 sheets via scripts/px-to-rem.mjs)
- ☑ SEO: canonical, Open Graph, LocalBusiness + BreadcrumbList JSON-LD, sitemap.xml/html, robots.txt, 301 map in vercel.json (live and verified on captain-levis.vercel.app 2026-10-21)
- ☑ Legal drafts: privacy-policy.html, cookie-policy.html, terms.html (attorney-review assumptions in HTML comments); consent banner + footer "Cookie Preferences"; map embed consent-gated
- ◐ Images: captain-chat avatar shrunk 1.2 MB → 82 KB; favicon/touch icon/OG image generated; WebP/srcset pass not done

## Phase 3 — Chatbot (§7, §8, §10, §11)
- ☑ Vercel project `captain-levis` created and linked 2026-10-21 (prj_a3q1YKeo5FfTW8OE1IxJi0IOviW3); **live** at captain-levis.vercel.app from `c29486e` (clean URLs, 301s, headers, API verified)
- ◐ Vercel configuration (Tyler ran `scripts/vercel-setup.sh` 2026-10-21 23:15): ☑ SESSION_SECRET (prod+preview) + ADMIN_API_TOKEN (copy in `.vercel/admin-token.local`); ☑ Git connected to Tdizzles/captain-levis (pushes auto-deploy); ☑ captainlevis.com + www attached to the project (production alias = https://captainlevis.com), DNS still at Network Solutions → Strikingly so the alias is dormant until cutover (records needed: `A @ 64.29.17.1`, `CNAME www cname.vercel-dns.com.`); live `892b66b` health: session_secret+admin_token true. ☐ DATABASE_URL (dashboard Storage → Neon, then re-run the script to migrate); ⛔ Turnstile/Resend/Anthropic keys → pass as env vars to the script.
- ⛔ Anthropic key + budget cap (decision 5); Turnstile keys (decision 4); Blob store
- ☐ `api/chat` with sessions, rate limits, length caps, timeouts, cost log, injection hardening
- ☐ Persona + greeting + three actions; context-aware suggested replies
- ☐ Quote intake state machine with validation and review step; hand-off to `/contact` keeping entered data
- ☐ Service routing (answer first, then offer page; no redirect when already there)
- ☐ Hours & Location from shared `business.json`; tel: and map links
- ☐ Photo upload endpoint: magic-byte validation, 10 MB/image, 5/submission, 30 MB/conversation, resize, private storage, clear errors, env-configurable
- ☐ Widget UI: fits mobile viewport, keyboard does not hide input, chips prominent

## Phase 4 — Inquiries and email (§9, §12)
- ⛔ Postgres (decision 2); Resend + DNS (decision 3)
- ☐ Migrations for inquiries, contacts, boats, repair requests, photos, chat sessions, deliveries, rate limits, audit, analytics
- ☐ `api/inquiries`: Turnstile server verify (reject missing/invalid/expired/reused), validate, persist first, idempotency, duplicate detection
- ☐ Real form submit on site: loading, errors, double-submit guard, success only after 2xx
- ☐ Branded HTML + text email to captainlevis@yahoo.com with reference number, photo links, Open/Reply actions
- ☐ Delivery status, retries, failed-send visibility in dashboard
- ☐ Optional AI draft reply, labelled, never auto-sent

## Phase 5 — Estimate editor (§13, §14) — estimater repo
- ☑ Rev5 parity: sections, document kind, Owner/Insured, FL Reg + Location, Reported + Appraiser, material-only lines, photo appendix, notes, Direction to Pay, footer, signature labels (estimater 5722158, 72 tests, deployed)
- ⛔ Store → API on Postgres; server-side `calcTotals()` on save
- ☐ Server-rendered PDF validated against Rev5
- ☐ Revisions keep history; statuses + timestamps; approval only on explicit action
- ◐ AI panel: section/doc-kind ops, side-by-side desktop + phone toggle done; "summarize inquiry" needs the inquiries backend
- ☐ Tax 7% (6% FL + 1% Pinellas) confirmed → flip "confirmed" in Settings ⛔ owner/accountant

## Phase 6 — Admin dashboard and analytics (§15) — estimater repo
- ⛔ Staff list (decision 10)
- ☐ Magic-link auth, sessions, roles, lockout, audit of admin actions
- ☐ Inquiries list/detail/photos/status; "Start estimate" from inquiry
- ☐ Overview cards; failed emails surfaced
- ☐ First-party consent-gated analytics with defined metrics; GA4 only if owner reconnects

## Phase 7 — Testing and launch (§18.7, §19)
- ☐ Device matrix, history/back, all chat paths, CAPTCHA matrix, upload abuse, rate limits, duplicates, email failure, estimate math/PDF, auth, keyboard/SR, states, SEO/redirects/perf
- ☐ Outstanding configuration documented (`docs/CONFIGURATION.md`)
- ⛔ DNS cutover captainlevis.com Strikingly → Vercel; cancel Strikingly + LiveChat

## Owner decisions log
| Date | Decision | Answer |
| --- | --- | --- |
| 2026-10-21 | Decisions 1–10 in `IMPLEMENTATION-PLAN.md` §3 | Owner: "do it all now, I approve" — Vercel move, recommended stack and admin-in-estimater approved; hours Mon–Sat 7:30am–3:30pm, email captainlevis@yahoo.com, "50+ Years" confirmed. Keys/DNS/GSC/staff list still to be supplied. |
