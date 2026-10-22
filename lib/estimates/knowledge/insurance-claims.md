# Insurance claim estimates (SEED — practice the shop has used; confirm specifics with the owner)

## When the job is a claim
- Set docKind to "supplement" when the carrier already has an estimate and we are asking for more (the Rev. 5
  document was "SUPPLEMENT REQUEST — REV. 5"). A first estimate for a claim stays "estimate" unless the staff
  member says the carrier already wrote one.
- insurance.enabled = true turns the customer box into OWNER / INSURED and prints the claim box and the Direction
  to Pay page. Fill carrier, claim number, date of loss, reported date, adjuster (name, phone, email), appraiser if
  one is assigned, and the carrier's original estimate number and date when a supplement responds to it.
- Revision: each resubmission to the carrier bumps `revision` by one. Keep the number the same.

## How a supplement is written so adjusters accept it
- Every line must be tied to the loss: say what the impact / water intrusion / failure caused, then the repair.
  Lines that read like upgrades get cut.
- Reference photos by number ("see Photo 3") for anything hidden or structural; the photo appendix prints them.
- Separate access work (removing hardware, decks, rigging to reach the damage) from the repair itself.
- Materials as real items where possible (resin, fabric, core, gelcoat) rather than one lump "materials".
- Note any prior damage that is NOT part of the claim so it is not disputed later.
- The NOTES block should state what was found on inspection that the original estimate did not include.

## Direction to Pay
- Printed only for insurance jobs. The owner / insured authorizes the carrier to pay the shop directly; checks are
  payable to the legal name (Boat Yard Captain Levi's LLC). If a check names both the owner and the shop, the
  owner's endorsement is needed (the page says so).
- The amount on that page is the estimate total; it updates automatically.

## What the assistant must not do
- Do not state what the carrier will or will not pay.
- Do not add "betterment", depreciation, or deductible math unless the staff member asks; those are the carrier's.
- Do not invent a claim number, adjuster, or date. Leave the field empty and ask.
