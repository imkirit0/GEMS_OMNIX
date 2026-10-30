# Fee receipts: EGM step 8 intermediate zoom-out report

**Reviewed:** commit f35a8c9, 2026-10-30.

**Verdict:** approve with changes. There are no blockers. Of the 38 earlier findings, 37 are resolved and C8 is resolved in part.

**Kept as justified:**
* the `fee_due_balance` view;
* tax stamped by the guard;
* the replay check inside the lock;
* `app.financial_year`.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z8-1 | Major | Rule (a) needs the row for the year just before. An idle year therefore blocks the centre, and the tests break after 2028-03-31. | Create the row when the centre has **any** earlier FEEREC row. Add this as an `allocate()` option, reusing `SeriesMissing`. Name the remedy (the NP-8 seed in the cutover runbook). |
| Z8-2 | Minor | If a legacy centre is activated before the NP-8 seed runs, its row is created at 0. A plain insert in the seed would then be skipped. | State that the NP-8 seed is an upsert, `greatest(current, legacy)`. |
| Z8-3 | Minor | The 23505 backstop re-read can never replay. | Map it straight to `mismatch`. |
| Z8-4 | Minor | The app-side GST check repeats the activation rules. | Drop it, and keep the guard. |
| Z8-5 | Minor | `receipt_number_guard` maps to `noseries`, which is misleading. | Map it to `mismatch`, or give it its own name. |
| Z8-6 | Nit | `app.receipt_no` is a single concatenation, and its unique index is redundant. The example is misleading. | Inline it in the guard. Fix the example. Test that SQL and TS agree on the financial year. |
| Z8-7 | Nit | The replay runs after the trading gate. | Order the steps as: authorize, lock, replay, gate. |
