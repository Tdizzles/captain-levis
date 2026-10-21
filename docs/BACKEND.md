# Backend — Vercel functions for the Captain Levi's site

Serverless TypeScript functions in `api/` (Node runtime, ESM) with shared code in `lib/`, SQL migrations in
`db/migrations/`, tests in `test/`. The static pages are untouched; `script.js` talks to these endpoints.

Everything runs locally with **zero credentials** and degrades honestly: an inquiry is reported `ok` only once it is
in the database, emails without a provider key are stored as `pending_config` (never claimed sent), and the chat
runs the same state machine in scripted mode when there is no Anthropic key.

## Architecture

```
browser (script.js) ──▶ /api/chat        state machine (lib/chat/*) · Claude only phrases, never routes
                    ──▶ /api/uploads     busboy → file-type (magic bytes) → sharp re-encode → photos.bytes
                    ──▶ /api/inquiries   rate limit → honeypot → zod → Turnstile → idempotency/dupe → DB → email → audit
                    ──▶ /api/events      consent-gated first-party analytics (allow-list, hashed session, no IP)
email / admin       ──▶ /api/photo       HMAC-signed, time-limited image reads
estimater           ──▶ /api/admin/*     Bearer ADMIN_API_TOKEN (stopgap until real auth)
```

- **Database** (`lib/db.ts`): one tiny `query/exec/transaction` interface over `pg` (Neon/Vercel Postgres, SSL) or
  `@electric-sql/pglite` (embedded Postgres for dev/tests). Same SQL on both. Migrations in `db/migrations/NNN_*.sql`,
  listed in `db/migrations/index.ts` (so Vercel's file tracer bundles them), tracked in `schema_migrations`,
  applied on first use per process (`AUTO_MIGRATE`, default on) and by `npm run migrate`.
- **Photos** are stored as `bytea` after re-encoding (≤1600 px, metadata stripped, JPEG q82 or WebP), random
  server filenames, and only ever served through `/api/photo?id&exp&sig`.
- **Rate limits** (`lib/ratelimit.ts`) are fixed windows in the `rate_limits` table: chat 20/min per session +
  120/h per IP, inquiries 5/h per IP, uploads 12/h per session, events 120/min per IP → `429` + `Retry-After`.
  IPs are HMAC-hashed with a daily salt and never stored raw.
- **Session** (`lib/session.ts`): `cl_session=<uuid>.<hmac>` cookie (HttpOnly, SameSite=Lax, Secure in production,
  30 days). The cookie is authoritative; a `sessionId` in a request body is honored only when it matches. Chat state
  and uploaded photos hang off it, so one visitor can never read another's session.
- **AI** (`lib/ai.ts`, `lib/pricing.ts`): `@anthropic-ai/sdk`, structured outputs (`messages.parse` + zod), system
  prompt cached (`cache_control`), 25 s timeout, every call logged to `ai_usage` with tokens and USD. Before each call
  the month's spend is summed against `AI_MONTHLY_BUDGET_USD`; over budget → scripted mode and the chat says so.
- **Email** (`lib/email/*`): branded table-layout HTML + plain text, Resend with a 10 s timeout and 3 attempts;
  every send has an `email_deliveries` row (`pending` → `sent` | `failed`, or `pending_config` without a key).
  Optional Claude "Suggested reply (DRAFT)" block, only with a key and only for inquiries with substance.

## Endpoints

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/chat` | JSON `{sessionId, message, page, pageTitle, context, photoIds?, note?}` | `{sessionId, reply, chips[], links?, card?, draft?, navigate?, event?, done?}` |
| POST | `/api/uploads` | multipart `sessionId, photos[]` | `{ok, sessionId, files:[{id,name,size,width,height}], warnings?}` |
| POST | `/api/inquiries` | multipart form fields + `photos[]` | `200 {ok:true, ref}` · `400 {ok:false, error, fields}` · `413` · `429` · `503` |
| POST | `/api/events` | JSON `{name, props, page, ref, ts, sid}` | `204` (unknown names dropped) · `429` |
| GET | `/api/health` | — | `{ok, configured:{…}, missing[], database, migrations, email:{unsent}, ai:{monthSpendUsd}}` |
| GET | `/api/photo?id&exp&sig` | — | image or `404` |
| GET | `/api/admin/inquiries?status&limit&offset` | Bearer | `{ok, total, items[]}` with signed photo URLs (24 h) |
| GET | `/api/admin/inquiries?id=` or `/api/admin/inquiries/<id>` | Bearer | `{ok, inquiry, deliveries, chat}` |
| PATCH | `/api/admin/inquiries?id=` | Bearer, JSON `{status}` | audited status change |
| GET/POST | `/api/admin/retry-email?status=` / `?id=<delivery>` | Bearer | list unsent · resend one |

### Chat state machine (`lib/chat/machine.ts`)

`start` → (`quote` slot filling: boat → damage → damageLocation → damageKind → where → photos → name → email →
phone → review) → submit → `done`. `hours` answers from `site/business.json`; free questions are answered from
`site/knowledge.json` (built by `npm run build:knowledge`; keyword retrieval without a key, Claude with page excerpts
when a key exists). Damage topics (transom/stringer/bulkhead/hull/deck/gelcoat/structural) get an answer first and
one `links` entry to the matching page, never the page the visitor is on. Every state returns contextual chips; the
"fill out the form myself" chip carries a `draft` of the collected slots to `contact.html#quote`. Chat-created
inquiries use `source='chat'`, link the session's photos, and send the same email. Prompt-injection text never changes
state; the model only sees the visitor's words in user turns and only ever returns `{fields, reply}` or `{answer, page_slug}`.

## Environment variables

| Variable | Purpose | When unset |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://…` (pg, SSL) or `pglite://<dir>` | PGlite in memory outside production; production reports `database:false` and writes return 503 |
| `AUTO_MIGRATE` | apply migrations on cold start (default `true`) | — |
| `SESSION_SECRET` | HMAC for cookies, photo URLs, IP hashes | insecure fixed dev key; health shows `session_secret:false` — **set before launch** |
| `ADMIN_API_TOKEN` | Bearer for `/api/admin/*` | admin endpoints return 503 |
| `TURNSTILE_SECRET_KEY` | server CAPTCHA verify | production: inquiries 503 "call us" (unless `ALLOW_UNVERIFIED_FORMS=true`); dev: accepted |
| `ALLOW_UNVERIFIED_FORMS` | accept forms in production without Turnstile | `false` |
| `RESEND_API_KEY` | send the quote email | inquiry still stored; delivery row `pending_config`; retry later via admin |
| `EMAIL_FROM` / `EMAIL_TO` | sender (verified domain) / recipient | `Captain Levi's Website <inquiries@captainlevis.com>` / `captainlevis@yahoo.com` |
| `ADMIN_BASE_URL` | "Open in Estimater" link | `https://captain-levis-estimater.vercel.app` |
| `ANTHROPIC_API_KEY` | chat language + reply drafts | scripted chat, no drafts |
| `ANTHROPIC_MODEL` | model id | `claude-sonnet-5-5` |
| `AI_MONTHLY_BUDGET_USD` | hard monthly AI ceiling | `25` |
| `MAX_PHOTOS` / `MAX_PHOTO_MB` | upload limits | `5` / `10` (30 MB per request/session) |
| `SITE_URL` | public origin for absolute links in emails | `siteUrl` from `site/business.json` |
| `VERCEL_ENV` | set by Vercel; `production` turns on Secure cookies + Turnstile requirement | `development` |

## Run locally

```bash
npm install
npm run dev            # http://localhost:8787 — static site + /api/*, PGlite at ./.data/dev, no credentials needed
npm test               # vitest on in-memory PGlite (real HTTP through the same adapter Vercel-style)
npm run typecheck      # tsc --noEmit
npm run migrate        # apply db/migrations to DATABASE_URL (default pglite://./.data/dev)
npm run build:knowledge  # regenerate site/knowledge.json after page content changes (commit the result)
```

Put real values in `.env.local` (git-ignored) to light features up one at a time; `/api/health` lists what is
still missing. Cloudflare's always-pass test secret `1x0000000000000000000000000000000AA` pairs with the test site key
already in `site/business.json`.

## Deploy

```bash
vercel link                                     # once: links this folder to the Vercel project
vercel env add DATABASE_URL production          # Neon/Vercel Postgres connection string (also preview if wanted)
vercel env add SESSION_SECRET production        # openssl rand -hex 32
vercel env add TURNSTILE_SECRET_KEY production
vercel env add RESEND_API_KEY production
vercel env add EMAIL_FROM production
vercel env add ANTHROPIC_API_KEY production
vercel env add ADMIN_API_TOKEN production
vercel deploy --prod
```

Then `curl https://<domain>/api/health` — `configured` should be all `true` and `migrations.pending` empty (migrations
run on the first request; or run `DATABASE_URL=postgres://… npm run migrate` from your machine first). `vercel.json`
already sets `api/**/*.ts` to 30 s / 1024 MB (sharp needs the memory) and `Cache-Control: no-store` on `/api/*`.

**First-deploy checks:** (1) `knowledge.pages` in health > 0 proves `site/knowledge.json` and `site/business.json` were
bundled (they are read via `new URL(…, import.meta.url)`, which the Vercel file tracer follows); (2) send a test
inquiry and confirm `email_deliveries.status = 'sent'`; (3) Resend needs SPF/DKIM records on `captainlevis.com` for
`EMAIL_FROM`'s domain.

## What each missing credential disables

- No `DATABASE_URL` in production → inquiries/chat/uploads answer 503 and tell the visitor to call; nothing is faked.
- No `TURNSTILE_SECRET_KEY` in production → form refuses with 503 "call us" (set `ALLOW_UNVERIFIED_FORMS=true` to
  accept without CAPTCHA, at your own spam risk). Chat intake is unaffected (cookie session + rate limits).
- No `RESEND_API_KEY` → inquiries are stored, no email; `/api/health` shows `email.unsent`; `POST /api/admin/retry-email?id=` resends.
- No `ANTHROPIC_API_KEY` or budget exhausted → chat is fully scripted (same flow, canned phrasing); no reply drafts.
- No `SESSION_SECRET` → everything works but with a public dev key: cookies, photo links and IP hashes are forgeable.
- No `ADMIN_API_TOKEN` → admin endpoints off.

## Turnstile key swap

The **site key** is `turnstileSiteKey` in `site/business.json` (stamped into every page's form by `scripts/build.mjs`).
It currently holds Cloudflare's public always-pass test key `1x00000000000000000000AA`. Before launch: create a
Turnstile widget for `captainlevis.com`, put the real site key in `site/business.json`, rebuild the pages, and set the
matching secret as `TURNSTILE_SECRET_KEY`. Tokens are single-use; a resubmit needs a fresh token (`script.js` resets the widget on error).

## Retention and deletion

Suggested policy: inquiries/photos as long as the business needs them, chat sessions 90 days, analytics 13 months,
rate-limit windows 1 day, AI usage 13 months. Handy queries:

```sql
-- chat sessions that never became an inquiry, idle 90+ days (photos cascade-null, delete them too)
DELETE FROM photos WHERE inquiry_id IS NULL AND chat_session_id IN (SELECT id FROM chat_sessions WHERE inquiry_id IS NULL AND last_seen_at < now() - interval '90 days');
DELETE FROM chat_sessions WHERE inquiry_id IS NULL AND last_seen_at < now() - interval '90 days';
-- orphan photos (never linked) older than 7 days
DELETE FROM photos WHERE inquiry_id IS NULL AND created_at < now() - interval '7 days';
-- analytics and rate-limit windows
DELETE FROM analytics_events WHERE created_at < now() - interval '13 months';
DELETE FROM rate_limits WHERE window_start < now() - interval '1 day';
-- a customer's deletion request (photos and deliveries cascade)
DELETE FROM inquiries WHERE email = lower('person@example.com');
-- what we hold for an email address
SELECT ref, created_at, status FROM inquiries WHERE email = lower('person@example.com');
```

Raw IPs are never stored (`inquiries.ip_hash` is a daily-salted HMAC); analytics stores a hashed session id only.

## Tests (`npm test`)

Migrations from scratch + index completeness · inquiry happy path (real JPEG) → row, photo, `pending_config` delivery,
audit · honeypot · field errors · idempotent resubmit · duplicate detection · Turnstile: production 503 without secret,
`ALLOW_UNVERIFIED_FORMS`, missing/invalid/valid token against a mocked `siteverify` with the test secret · 6th inquiry
per IP → 429 · non-image renamed `.jpg` rejected · uploads: `.exe` as `.jpg`, 11 MB, 6th file, metadata stripped and
≤1600 px, declared-type mismatch · chat: full quote without a key (photo linked, inquiry `source=chat`, no double
submit), transom link on index but not on transom-replacement, hours from business.json, prompt-injection keeps state,
foreign sessionId ignored, knowledge answer, 20/min session limit · events allow-list · health · admin auth/list/patch/
retry · signed photo URLs (valid / tampered / expired).
