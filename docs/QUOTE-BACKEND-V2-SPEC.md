# Quote backend v2 — owner spec (captured 2026-10-22, not yet started)

Tyler's direction, in his words first, then what it means against what already exists. **The current estimater
(`captain-levis-estimater`, Vercel) is to be retired** and replaced by a simpler product. Nothing has been deleted
yet; the old app stays reachable until the replacement does the job.

## Owner's words (2026-10-22)

> i built this and want to terminate it. i want a simpler version. i need to see incoming quotes via backend or
> email. email finds out it's missing info that we need to properly quote so it already drafts a response, non-AI,
> in Captain Levi's accent, and then also redirects you to the quote builder. you then can enter fields manually or
> chat with Opus 5.5, which I'll call Captain Levi, and it has logs of knowledge of how to quote, real things to do
> legally with insurance etc etc. it auto updates and edits the quote builder however it wants. that's the backend
> project.

## What that means, piece by piece

1. **Inbox for incoming quotes** — two ways to see them, both from the same database rows the website already writes:
   - **Email** to captainlevis@yahoo.com per inquiry (exists; sends once Resend is configured).
   - **Backend list** ("Inquiries"): the simple staff screen of the new app. New → contacted → quoted → won/lost.
2. **Missing-info check + drafted reply, no AI**: a rules table decides what a proper quote still needs (photos,
   boat make/model/year, where the boat is, in or out of the water, damage location/size, insurance claim yes/no +
   carrier/claim number, best contact time). The email (and the inbox) shows the gaps and a **templated reply in
   Captain Levi's voice** (deterministic text, picks the paragraphs that match the gaps). Staff copy/send it or
   click "Reply" (mailto) — never auto-sent. The existing Claude "suggested reply" (`lib/email/draft.ts`) becomes
   optional/off; the template is the default.
3. **"Open in quote builder" link** in the email and inbox opens the new builder with the inquiry pre-filled
   (customer, boat, damage, photos, source inquiry ref).
4. **Quote builder, simpler than today's estimater**: one estimate document — customer, vessel, line sections
   (labor / materials / sublet), totals with FL tax rule, notes, photos, PDF, send-for-approval link. Keep the Rev5
   insurance-supplement layout that already exists (it was the one thing the old app got right), drop the rest
   (invoices/payments, supplier catalogs, templates, reports, 31k-item supplies) unless asked for later.
5. **"Captain Levi" assistant = Claude Opus 5.5** (`claude-opus-5-5`) in a chat panel beside the builder, with
   **tool access to the estimate**: it can add/edit/remove lines, set quantities and rates, write notes, restructure
   sections, fill customer/vessel fields — "edits the quote builder however it wants", with every change shown as a
   diff the user can undo. Knowledge base ("logs of knowledge"): how the yard quotes (labor rates, typical hours by
   job, materials and markups, what is included), insurance-claim practice (supplement requests, direction-to-pay,
   appraiser workflow, what to document, what not to promise), Florida legal/consumer points to get right. Stored
   as versioned markdown the owner can edit, plus past estimates as examples. The assistant cites which rule it used.
6. **Simple staff sign-in**: magic link by email, allow-list of staff addresses. No passwords.
7. **Analytics**: not part of v2. The website keeps collecting consent-gated events; a dashboard comes later.

## What already exists and carries over (site repo, live on Vercel + Neon)

- `POST /api/inquiries` → stored inquiry + photos + email delivery row (Turnstile verified). Proven 2026-10-22.
- `GET/PATCH /api/admin/inquiries` with bearer token — becomes the inbox's data source once auth exists.
- Email render (`lib/email/render.ts`) already has "Open in Estimater" (`ADMIN_BASE_URL`) and "Reply to customer"
  buttons; the AI draft slot becomes the templated draft.
- Rev5 estimate layout, `calcTotals()`, photo appendix, pagination in the old estimater — port, don't rewrite.

## Decisions still needed from the owner

- Keep the old estimater reachable until v2 ships (recommended), or take it down now?
- Which staff emails get the magic-link allow-list?
- Where does the "how we quote" knowledge start: a sit-down with Captain Dave/Levi, or past estimates + the Rev5
  supplement as the seed?
- Does v2 live in the site repo (`/app`, same Vercel project, same DB) or its own repo? Recommended: same repo/DB.

## Not started. Build order when approved

inbox + templated missing-info reply (reuses the live backend) → magic-link auth → builder with Rev5 PDF →
Captain Levi assistant with estimate tools → knowledge base editing.
