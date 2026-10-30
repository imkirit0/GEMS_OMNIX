# Fee receipts: EGM step 5 zoom-out report

Commit 5cdd0ad was reviewed on 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** approve with changes. The scope is right, and nothing in the structure blocks F4 or ad-hoc dues: cancelled receipts drop out through the ACTIVE filter, and the single `fee_due` table is kept. The risks lie in drift and in the gate's conditions.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | "Outstanding" is computed in four places. | Define it once, in `app.due_outstanding`, and use that everywhere. |
| Z2 | Major | The tax split is written twice in SQL, once in the insert and once in the guard. | Have the guard stamp the rate, HSN and split, and leave them out of the insert grant. |
| Z3 | Major | A missing series row is created at 0. A centre left out of the legacy seeding would silently restart at 1. The `current` insert grant is also too wide. | Create the row only when the previous financial year's row exists, otherwise refuse. Do not grant `current`. |
| Z4 | Major | The gate could open before the ledger exists. | Add the ledger to DD-5: it posts in the same transaction, or Accounts accepts a backfill rule. |
| Z5 | Minor | IGST goes beyond the brief, and a taxed centre may have a null `gst_supply`. | Record IGST as a deliberate change from the brief, and refuse a taxed centre whose `gst_supply` is null. |
| Z6 | Minor | The design does not say whether FEEREC is also the tax invoice number. | State that it is, pending the tax advisor. |
| Z7 | Minor | The receipt format is an inline lambda. | Add `formatReceiptNumber` to `numbering.ts` and map its `RangeError`. |
| Z8 | Nit | Fee-dues DD-7's ALTERs are moving to the ad-hoc dues piece. | Say so. |
| Z9 | Nit | A replay with a different amount returns the original receipt. | Note that this is intended, and show the recorded total. |
