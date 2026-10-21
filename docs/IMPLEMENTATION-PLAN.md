# Implementation plan (2026-10-21)

Companion to `AUDIT-2026-10-21.md` and `PAGE-INVENTORY.md`. Running status lives in `PROJECT-CHECKLIST.md`.

## 0. The one architecture change, and why

Today nothing runs on a server: the site is static files on GitHub Pages, the estimater keeps data in one
browser, and the form, CAPTCHA and chatbot are decorative. The brief needs a backend for quote intake, email,
uploads, rate limiting, server-side CAPTCHA, chat state, auth and audit. GitHub Pages cannot do any of that and
cannot even issue the 301 redirects the SEO migration needs.

**Recommendation: one Vercel project for the public site + API, and point the estimater at the same database.**

- Vercel is already the account the estimater deploys to (`tdizzles-projects`); the CLI is logged in. No new
  hosting vendor.
- The site stays plain HTML/CSS/JS. Serverless functions live in `api/` in this repo (TypeScript, Node runtime);
  `vercel.json` carries clean URLs, legacy 301s, security headers.
- **Database:** Postgres via Vercel Marketplace (Neon) so it is on the same dashboard/bill; Supabase is the
  alternative (Tyler already uses it, but free projects pause and that has bitten before). Decision needed.
- **Email:** Resend (transactional, simple API, inbound-safe templates). Needs SPF/DKIM DNS records on
  captainlevis.com for a sending address such as `inquiries@captainlevis.com`; recipient stays
  `captainlevis@yahoo.com`. Reply-To is set to the customer.
- **CAPTCHA:** Cloudflare Turnstile (free, invisible/managed, server-verified with `siteverify`, token single-use).
  hCaptcha is the fallback if the owner prefers it.
- **Uploads:** Vercel Blob (private store), server-side magic-byte validation and resize (`sharp`), signed
  short-lived read URLs for the admin and the email.
- **AI:** Anthropic API server-side only (never in the browser). Chat intake is a server state machine with the
  model doing language, not control flow. Per-key budget cap + per-session/IP quotas logged in Postgres.
- **Rate limiting:** Postgres-backed sliding windows (no extra service); Vercel WAF rate rules if the plan allows.
- **Admin/estimates:** extend the estimater (`captain-levis-estimater`) — it already has the editor, paper
  preview, AI side panel, statuses, revisions and approvals. Replace its localStorage store with the same API +
  Postgres, add passwordless (magic-link) auth + sessions, and add Inquiries + Analytics screens. Building a
  second admin UI in the site repo would duplicate ~38k lines.
- **Shared page chrome:** add a tiny build step (one script, no framework) that stamps header/footer/form/chat
  partials into the 45 pages, so a chatbot or nav change is one edit. The static output and the comps-based
  page workflow are unchanged; parallel page-building sessions keep working.

Cost signal (list prices, Oct 2026): Vercel Hobby is free but Blob/Functions limits are tight for uploads; Pro is
$20/mo. Neon free tier is adequate to start. Resend free tier covers ~3k emails/mo. Turnstile is free. Anthropic
usage is metered; cap it.

## 1. Phases, in order

### Phase 1 — Audit and planning  ✅ done 2026-10-21
Deliverables: `docs/AUDIT-2026-10-21.md`, `docs/PAGE-INVENTORY.md`, this plan, `docs/PROJECT-CHECKLIST.md`.

### Phase 2 — Site structure, content, mobile, accessibility, legal
No credentials needed; can start immediately. Work items, roughly in order:
1. Partials + build script (`scripts/build.mjs` → `dist/` or in-place stamping) for header, footer, quote form,
   chat widget, consent banner, legal links. Keep the per-page `<title>`/description/greeting as front-matter.
2. Navigation: Services dropdown → hub at `/fiberglass-boat-repair`; real links for Boat Yard, Detailing, About,
   Reviews, logo; footer legal links; breadcrumbs on every interior page; prev/next controls inside each service
   family (e.g. gelcoat sub-pages), with accessible names and real `href`s so Back works.
3. Missing pages: `boat-yard`, `detailing` (served at `/boat-detailing`), `about`, `contact` (dedicated quote
   page), `hull-step-repair`, `kayak-repair`, PWC page (pending decision), `404`, `sitemap.xml`, `robots.txt`.
4. Legacy content merge into existing pages per `PAGE-INVENTORY.md` (rewrite, keep facts, no invented claims).
5. Facts pass across all pages: hours, email, years, service-area list (once the owner confirms).
6. Mobile pass at 390/768/1024/1536 (portrait + landscape on phones) for every page; fix overflow, tap targets,
   stacking order, the known `<ol>` numbering and trust-strip edge bugs.
7. Accessibility: `<main>`, skip link, heading order, alt text pass, focus styles, reduced-motion, form error
   messaging; **text-size − / + controls** above the chat avatar (root-scale via `html{font-size}` after a
   px→rem conversion of `styles.css` and page sheets; persisted in `localStorage`; min 87.5%, max 137.5%).
8. SEO: canonical, Open Graph, LocalBusiness JSON-LD, sitemap, `vercel.json` 301 map from the inventory.
9. Legal drafts (flagged for attorney review): Privacy Policy, Cookie Policy, Website Terms, chatbot/upload
   disclosures, consent banner + "Cookie preferences" footer control (non-essential scripts load only after
   consent; GA4 only if the owner wants it back).
10. Performance: convert hero/card images to WebP with `srcset`; shrink `captain-chat.png`; lazy-load below the fold.

### Phase 3 — Chatbot (needs: Vercel project, Anthropic key, Turnstile keys, Blob)
1. `api/chat` with session cookie, per-session + per-IP limits, message length cap, timeouts, cost logging.
2. Captain Levi persona + greeting + the three actions (I Need a Quote / Hours & Location / Another Question).
3. Quote intake state machine: slot-filling over boat make/model/year/type, contact, location, damage, repair
   type, structural/cosmetic, in-water/trailer/yard, photos; review-before-submit; "fill out the form instead"
   hand-off that carries entered fields to `/contact` via sessionStorage.
4. Service routing: answer first, then offer the page; suppress when already on that page.
5. Hours & Location from one `business.json` (hours, address, phone, map link) shared with the site/footers.
6. Photo upload endpoint: JPEG/PNG/WebP by magic bytes, 10 MB/image, 5 images/submission, 30 MB/conversation,
   resize to 1600 px, safe names, private Blob, configurable via env.
7. Prompt-injection hardening: system prompt isolation, no tool that reads customer records, output filters.

### Phase 4 — Inquiry handling and email (needs: Postgres, Resend + DNS)
1. Migrations: inquiries, contacts, boats, repair_requests, photos, chat_sessions, email_deliveries, rate_limits,
   audit_events, analytics_events.
2. `api/inquiries`: Turnstile verify → validate → persist → enqueue email → respond. Idempotency key per form
   render; duplicate detection (same email+message within 10 min).
3. Branded responsive HTML email (navy/cyan, sections, photo links, reference number, "Open in Estimater" and
   "Reply to customer" actions) + plain-text part; delivery status recorded; retry on provider failure; failed
   sends visible in the dashboard.
4. Optional AI-drafted reply, labelled DRAFT, omitted when it adds nothing; never auto-sent.
5. Replace the fake form handler on the site with real submit/loading/error/success states.

### Phase 5 — Estimate editor and AI assistant (estimater repo; needs: Postgres, auth)
1. Store → API: implement the existing store actions against Postgres; keep `calcTotals()` as the single
   calculation layer and re-run it server-side on save.
2. Rev5 template parity: line sections, document kind/revision title, Owner/Insured label, FL Reg + Location,
   Reported date + Appraiser, material-only lines, photo appendix with cross-links, notes block, Direction to Pay
   page, running footer, signature labels.
3. Server PDF (Playwright/Chromium on a function, or `@react-pdf`) so a PDF exists without the print dialog;
   validate it against the Rev5 layout.
4. Revisions keep prior versions; statuses Draft → Ready → Sent → Approved/Declined/Revised with timestamps;
   approval events recorded only on explicit customer action.
5. AI side panel: keep the proposal/apply model; add "summarize inquiry" and "draft scope from inspection notes";
   prices only from the approved catalog, flagged otherwise.

### Phase 6 — Admin dashboard and analytics (estimater repo)
1. Magic-link auth (Resend), server sessions, role-based (owner/staff/viewer), brute-force lockout, audit log.
2. Inquiries screen: list, detail, photos, status, "Start estimate" prefilled from the inquiry.
3. Overview: new inquiries, estimates in progress/awaiting approval, recent activity, failed emails.
4. Analytics: first-party, consent-gated events (page views, quote-page views, form starts/submits, chat opens,
   quote-start/completion) with explicit definitions; GA4 referral data only if the owner reconnects it.

### Phase 7 — Testing and production readiness
Device matrix, history/back behaviour, every chat path, CAPTCHA valid/invalid/expired/reused, upload limits and
malicious files, rate limits, duplicate submissions, email failure recovery, estimate math and PDFs, auth and
access control, keyboard/screen-reader pass, loading/error/empty states, SEO/redirect/perf checks, then the
Strikingly → Vercel DNS cutover with the 301 map live.

## 2. What can run in parallel

- Phase 2 items 1–10 need no owner input beyond the facts pass (item 5) and can start now.
- Infra setup (Vercel project, Neon, Resend DNS, Turnstile, Anthropic key) is owner-gated and unblocks 3–6.
- Estimater Rev5 parity (Phase 5 item 2) is UI work on the existing local-first app and can proceed before the
  backend exists.

## 3. Decisions required from the owner (blocking the marked phases)

| # | Decision | Blocks |
| --- | --- | --- |
| 1 | Move the public site to Vercel (keep GitHub repo; GitHub Pages retired) | 3, 4, 7 (redirects) |
| 2 | Postgres provider: Neon via Vercel (recommended) or Supabase | 4, 5, 6 |
| 3 | Email provider Resend + DNS records on captainlevis.com; sending address | 4, 6 |
| 4 | CAPTCHA: Turnstile (recommended) or hCaptcha; create keys | 3, 4 |
| 5 | Anthropic API key + monthly cap | 3, 4, 5 |
| 6 | Admin lives in the estimater (recommended) | 5, 6 |
| 7 | Confirm facts: hours, email, years, storage, materials catalog, fuel tanks, PWC consolidation, Resources removal | 2 |
| 8 | Supply the chatbot screenshot (text-size controls) | 2 item 7 |
| 9 | Search Console / GA4 access; whether GA4 returns | 2 (removals), 6 |
| 10 | Staff emails and roles | 6 |
