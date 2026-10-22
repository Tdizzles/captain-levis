# Quote Desk (`/app`) — the simpler quote backend, built 2026-10-22

Replaces the retired estimater. Lives in this repo, deploys with the site, uses the same Neon database. Spec and
owner decisions: `QUOTE-BACKEND-V2-SPEC.md`. Backend reference: `BACKEND.md` ("Quote Desk" section).

## What exists (all pushed, 60 tests green, verified in Chrome on `npm run dev`)

| Piece | Where | Status |
| --- | --- | --- |
| Staff sign-in (email + shared password, 12 h cookie, 10 tries / 15 min) | `lib/staff.ts`, `api/auth/*`, `app/app.js` | done; **needs `STAFF_PASSWORD_HASH` on Vercel** |
| Inquiries inbox (list with readiness, detail with photos, status, email retry) | `app/app.js`, `api/admin/inquiries.ts` | done |
| Missing-info rules + Captain Levi's templated first reply (no AI) | `lib/quote/missing.ts`, `lib/quote/reply.ts` | done; in the inbox and in the shop email |
| Inquiry email: "What we still need", "Reply to send", "Open in Quote Builder" | `lib/email/render.ts` | done; sends once Resend is set |
| Estimate model, cents-exact math, Rev5 print layout (ported from the old app) | `lib/estimates/{types,calc}.ts`, `app/print/` | done |
| Estimates API: create blank / from inquiry, autosave with versions, restore, delete | `api/admin/estimates.ts`, `lib/estimates/store.ts`, migration 002 | done |
| Builder UI: document, owner/insured, vessel, insurance, lettered sections + lines, notes, photos, totals, history | `app/estimates.js` | done |
| Print / Save as PDF view | `app/estimates.js` → `app/print/estimate-print.js` | done (browser print dialog) |
| Captain Levi assistant (Opus 5.5, tools that edit the estimate, versioned, chat kept) | `lib/estimates/assistant.ts`, `api/admin/assistant.ts`, `app/levi.js` | done; **live model loop not yet exercised (needs `ANTHROPIC_API_KEY`)** |
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
   auto-sent to customers.
3. "Start estimate" creates E-NNNN pre-filled (customer, boat, insurance flag, photos, notes) and marks the inquiry
   quoted. Edit by hand (autosaves, totals from the server) or ask Captain Levi; every save is a restorable version.
4. "Print / PDF" renders the Rev5 layout; use the browser's Save as PDF. Status: draft → sent → approved/declined.

## Not built yet / known limits
- No customer-facing approval link or e-signature (the old app's approval flow was dropped on purpose).
- No PDF generation server-side; the browser print dialog is the PDF.
- Captain Levi cannot see photos yet (captions only) and cannot change pricing without being told.
- Estimates have no search; the list is newest-first with a status filter.
- Analytics dashboard: not part of v2.
- Delete uses a browser confirm dialog.
