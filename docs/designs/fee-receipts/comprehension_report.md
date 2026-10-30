# Fee receipts: EGM step 6 comprehension report

**Reviewed:** commit 5cdd0ad, 2026-10-30, in parallel with steps 5 and 7.

**Verdict:** revise. There are 0 blockers, 3 majors, 6 minors and 5 nits.

**Confirmed:**
* the registration `(id, centre_id)` key;
* the lock key matches `dues.ts`;
* `allocate()` throws when the series row is missing;
* `financialYear` returns `2026-27`;
* the `number_series` insert policy exists, but gems_app has no insert grant;
* the guards can read `fee_type` and `centre`;
* role 30 and user `…00f8` are free.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Major | The replay is read before the lock. A concurrent double submit fails with nothing/over instead of returning the original. | Check the key again after taking the lock. Keep the 23505 backstop. |
| C2 | Major | A taxed centre with a null `gst_supply` is not covered. | Refuse it in both the guard and the app, and test it. |
| C3 | Major | gems_app cannot supply `status` or `received_on`, so the non-ACTIVE and past-date tests cannot run as written. | Default `status` to `'ACTIVE'`. Test those cases as the owner, and test the stamp after a normal insert. |
| C4 | Minor | `receipt_over_guard` also raises 23514, so mapping by code first gives the wrong result. | Match the constraint name first. Let 23505 on the idempotency key pass through. |
| C5 | Minor | The period comes from the Node clock while the guard uses the database clock, so they can disagree at the year boundary. | Compute the period once, in SQL. |
| C6 | Minor | "Outstanding" is defined twice. | Use one definition: ACTIVE receipts only. "Open" means outstanding > 0. |
| C7 | Minor | The source of the receipt currency is unstated. | The currency comes from the dues. |
| C8 | Minor | The tests break after 2027-03-31 because `PERIOD` is fixed. The create-row path is never exercised. | Pin the period or the clock, and add a missing-row test. |
| C9 | Minor | A replay ignores the posted registration and amount, and an invisible key yields an empty re-read. | Compare the registration and refuse a mismatch. Treat an invisible key as a mismatch. |
| C10 | Nit | The `"field: rule"` format and the labels are not stated, and one message is "…". | List them. |
| C11 | Nit | `{yyyy short}` is vague. | Point to the code. |
| C12 | Nit | The `GapRule` enum needs a cast. | Mention it. |
| C13 | Nit | The replay return value is incomplete. | Return the full tuple. |
| C14 | Nit | The `seedFeePlan` path is not given. | Add `tests/fee-seed.ts`. |
