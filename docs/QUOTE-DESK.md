# Quote Desk (`/app`) — the simpler quote backend, built 2026-10-22

Replaces the retired estimater. Lives in this repo, deploys with the site, uses the same Neon database. Spec and
owner decisions: `QUOTE-BACKEND-V2-SPEC.md`. Backend reference: `BACKEND.md` ("Quote Desk" section).

## What exists (all pushed, 61 tests green, verified in Chrome locally and live at https://captain-levis.vercel.app/app)

| Piece | Where | Status |
| --- | --- | --- |
| Staff sign-in (email + shared password, 12 h cookie, 10 tries / 15 min) | `lib/staff.ts`, `api/auth/*`, `app/app.js` | done; `STAFF_PASSWORD_HASH` set on Vercel 2026-10-23 (owner ran the script) |
| Inquiries inbox (list with readiness, detail with photos, status, email retry) | `app/app.js`, `api/admin/inquiries.ts` | done |
| Missing-info rules + Captain Levi's templated first reply (no AI) | `lib/quote/missing.ts`, `lib/quote/reply.ts` | done; in the inbox and in the shop email |
| Inquiry email: "What we still need", "Reply to send", "Open in Quote Builder" | `lib/email/render.ts` | done; sends once Resend is set |
| Estimate model, cents-exact math, Rev5 print layout (ported from the old app) | `lib/estimates/{types,calc}.ts`, `app/print/` | done |
| Estimates API: create blank / from inquiry, autosave with versions, restore, delete | `api/admin/estimates.ts`, `lib/estimates/store.ts`, migration 002 | done |
| Builder UI: document, owner/insured, vessel, insurance, lettered sections + lines, notes, photos, totals, history | `app/estimates.js` | done |
| Print / Save as PDF view | `app/estimates.js` → `app/print/estimate-print.js` | done (browser print dialog) |
| Captain Levi assistant (Opus 5.5, tools that edit the estimate, versioned, chat kept) | `lib/estimates/assistant.ts`, `api/admin/assistant.ts`, `app/levi.js` | done; `ANTHROPIC_API_KEY` set on Vercel 2026-10-23 (owner ran the script) |
| Seed knowledge for Captain Levi | `lib/estimates/knowledge/*.md` | seed only; **owner's rules replace it** |

## Turning it on in production (owner, from Git Bash)

```bash
cd /c/Users/1234/captain-levis
STAFF_PASSWORD='<the staff password>' bash scripts/vercel-setup.sh        # hashes locally, stores only the hash
ANTHROPIC_API_KEY=sk-ant-... bash scripts/vercel-setup.sh                 # Captain Levi + chatbot phrasing
```
Then https://captain-levis.vercel.app/app (or https://www.captainlevis.com/app after DNS) → sign in with
tyler.salta@icloud.com or captainlevis@yahoo.com. `STAFF_EMAILS` on Vercel changes the allow-list.

## How the flow works
1. Website form/chat → `POST /api/inquiries` → row + photos → email to captainlevis@yahoo.com with the gaps and
   the drafted reply → the inbox shows it with a readiness badge.
2. Staff opens the inquiry, edits/copies the reply, "Open in email" (mailto) sends it from their own mail. Nothing is
   auto-sent to customers. The reply is deliberately SHORT (~50–65 words) and asks only for the basics: photos, the
   boat (make/model/length) and the city it's in (priority-1 gaps). Owner, 2026-10-23: a long email full of questions
   loses the customer; year, size, insurance claim details, HIN and the rest get collected later. Don't grow it back.
3. "Start estimate" creates E-NNNN pre-filled (customer, boat, insurance flag, photos, notes) and marks the inquiry
   quoted. Edit by hand (autosaves, totals from the server) or ask Captain Levi; every save is a restorable version.
4. "Print / PDF" renders the Rev5 layout; use the browser's Save as PDF. Status: draft → sent → approved/declined.

## Website chat quote flow (built 2026-10-23)
The public Captain Levi chat ("I Need a Quote") is a guided, tap-first intake. Questions: `lib/chat/quoteflow.ts`
(data + pure functions); driver: `lib/chat/machine.ts`; widgets: `script.js` (`WIDGETS`) + `chrome.css` (`.cq-*`).
- **Order:** job tiles (12 job types) → boat card (type, length, make with typeahead, year) → the job's own follow-ups
  (collision: how / insurance / taking on water; transom: power / symptoms; gelcoat: depth / spots / color; ...) →
  tap-the-boat diagram (only for jobs where location varies) → size picker (coin … bigger than 2 ft) → photos
  (Take photos on phones, Choose photos) → where she is + city (+ "can you bring her in?" for trailer boats) →
  timing → anything else → one contact card (phone autofill) → review card → send. Progress bar on top.
- **Dynamic:** the plan is recomputed from the answers every turn, so anything already known (typed in the first
  message, or answered out of order) is skipped, and changing the job swaps the follow-ups.
- **Typing always works:** every step also accepts free text (matched to the options; a real question gets answered
  and the same step is asked again). With the Anthropic key the model adds the wording and any extra fields.
- **Tapped answers never call the model** (`{answer: {step, value}}` on `/api/chat`, validated against the options).
- **On send:** inquiry with `details` (migration 003: job, follow-up answers, zones, size, where, timing, in-water,
  insurance) → shop email → **a draft estimate is created automatically** (`lib/quote/skeleton.ts`: sections and named
  line items per job, hours/materials 0, nothing priced) by "Captain Levi (website chat)". The inquiry stays `new`;
  its page shows "Answers from the chat" and an "Open E-NNNN (drafted from the chat)" button. Pricing it is the crew's
  (or the Quote Desk Captain Levi's) job; once the owner's rates exist, auto-pricing can be added there.
- The contact form path is unchanged; form inquiries have `details = {}` and keep the one-line draft.

## Deploy gotchas (both hit on 2026-10-22, both fixed)
- **12-function cap.** Vercel Hobby rejects a deployment with more than 12 files under `api/`
  (`exceeded_serverless_functions_per_deployment`). Milestones 2–3 took it to 14, so every deploy from 71a1711 to
  85893d8 failed while the site kept serving 7f66188. Fixed in f3edf0f (now 11); `test/function-budget.test.ts` guards it.
  New endpoints go in as actions on an existing function.
- **Trailing slash.** `trailingSlash:false` turns `/app/` into `/app`, so relative asset URLs resolved at the site
  root and the app was blank in production only. Fixed in a61275c: `app/index.html` uses `/app/...` paths.

## Not built yet / known limits
- No customer-facing approval link or e-signature (the old app's approval flow was dropped on purpose).
- No PDF generation server-side; the browser print dialog is the PDF.
- Captain Levi cannot see photos yet (captions only) and cannot change pricing without being told.
- Estimates have no search; the list is newest-first with a status filter.
- Analytics dashboard: not part of v2.
- Delete uses a browser confirm dialog.
