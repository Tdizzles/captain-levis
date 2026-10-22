# lib/estimates — the estimate document, ported from ESTIMATER

Ported 2026-10-22 from the retired React app (`captain-levis-estimater`, HANDOVER §10b "Rev. 5 parity"):

| New file | Ported from (old app, `src/`) |
| --- | --- |
| `lib/estimates/types.ts` — types, zod `estimateSchema`, `normalizeEstimate`, `newEstimate`, `newLine` | `lib/types.ts` (DocumentContent/Estimate/LineItem/…), `data/docs.ts` (normalize*, blankInsurance, DEFAULT_TAX_NOTE) |
| `lib/estimates/calc.ts` — `calcLine`, `calcTotals`, `laborLabel`, `layoutLines`, `lineNumberOf`, `sectionLetter`, `splitDescription`, `documentTitle`, `estimateNumberLabel`, `pricingNote`, `formatMoney`, `formatDateNumeric`, `formatDate`, `formatHours` | `lib/pricing.ts`, `lib/money.ts`, `lib/sections.ts`, `lib/util.ts`, `data/docs.ts#pricingNote` |
| `app/print/estimate-print.js` (+ `.d.ts`) — `renderEstimateHtml(estimate, business, totals, layout)` | `components/document/Paper.tsx` (+ `docProps.ts#businessContactLine`, `runningFooter`) |
| `app/print/estimate-print.css` | `styles/document.css` |
| `test/estimates-calc.test.ts` | `lib/pricing.test.ts` worked example + new layout/render checks |

## Math (unchanged numbers)
Document money is stored in **dollars**; `calc.ts` converts to integer cents (`Math.round(x*100)`) and does all
arithmetic in cents with BigInt, rounding half away from zero exactly where the old engine did: labor per line =
hours (0.001 h) × rate; tax = taxable base × rate (0.0001 %); deposit = total × pct. Tax base is always the total
repair charge (labor + materials — old `taxBase: 'subtotal'`); a line with `taxable: false` is left out of that base.
A `materialsOnly` line has no labor however many hours it carries. **`qty` multiplies nothing** — the old app had no
line quantity (only catalog materials had one, and the catalog is dropped), so `qty`/`unit` are informational.

## Deliberately dropped
Invoices, payments, approvals/signature capture (`Approval`, `DirectionToPaySignature`), revision chains
(`revisionOf`/`supersededBy`), repair templates, supplier/materials catalog and per-material pricing/markup/
verification, events/audit, internal notes, attachments, `assessedBy`, `validUntil`, blank filler rows, the
APPROVED/PAID stamps, the measured JS pagination (`PagedPaper`, per-page "Page X of Y" footers) and the logo
wordmark. Pagination is now CSS (`break-inside: avoid`, `break-before: page`), with one footer at the end.

## Field mapping (old → new)
`DocumentContent.date` → `estimateDate` · `depositPct` (root) → `pricing.depositPct` · `pricing.laborRateCents` →
`pricing.laborRate` ($) · `pricing.taxRatePct` → `pricing.taxRate` · `pricing.taxBase`/`defaultMarkupPct` → dropped ·
`customer.address` (string) → `customer.addressLines[]` (+ new `company`) · `vessel.yearMake` → `vessel.year` +
`vessel.make` · `vessel.boatName` → `vessel.name` · `insurance.adjuster` → `adjusterName` · `insurance.carrierEstimate`
→ `carrierEstimateNumber` · `insurance.contact` → dropped · `LineItem.rateCents` → `rate` ($) ·
`LineItem.materialsLumpCents` + itemized `materials[]` → single `materials` ($) · `LineItem.photos[]` → document-level
`photos[]` cross-referenced by writing "Photo N" in a line · `sectionId?` → `sectionId: string | null` ·
`payableTo` → passed in as `business.payableTo` (defaults to `legalName`, then `name`) · `number` keeps the base
number; `estimateNumberLabel()` prints `E-1001-R2` for revision 2. `normalizeEstimate` still accepts every old key above.
