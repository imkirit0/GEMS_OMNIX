# Fee receipts: EGM step 7 design critic report

**Reviewed:** commit 5cdd0ad, 2026-10-30, in parallel with steps 5 and 6.

**Verdict:** revise. There is 1 blocker and 5 majors. The lock order (advisory lock, then the series row) has no cycle. The composite foreign keys, RLS and immutability follow 0026.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Blocker | Idempotency race: the replay read happens before the lock. A second submit then sees nothing outstanding and fails, so G3 fails in the default flow. | Re-read the key after taking the lock. Keep the 23505 check as a backstop. Make the test assert the replay and the same id. |
| D2 | Major | The tax guard fails open for a taxed centre whose `gst_supply` or `gstin` is null. | Raise `receipt_tax_guard`. Mirror the check in the app. |
| D3 | Major | Creating a series row automatically at 0 contradicts DD-5/NP-8. | Refuse a missing series, or create one only where there are no legacy numbers. |
| D4 | Major | The insert grant on `number_series` lets the app set any value of `current`. | Do not grant `current`, or refuse non-zero values. |
| D5 | Major | `receipt_no` is free text that nothing proves. | Build it in the guard, or check it, and make it unique. |
| D6 | Major | The 16-character cap stops collection mid-year once a number reaches 5 digits. | Check the worst-case length at gate opening, or shorten the format. |
| D7 | Major | The ETL reset breaks once receipts exist. | Give the reset a rule for receipts. |
| D8 | Minor | Commit-time errors skip `receiptDb`. The over-guard returns 23514, so the error must be matched on its name first. | Wrap the whole action, and match on the name first. |
| D9 | Minor | The period comes from the app clock while the date comes from the database clock. | Compute the period in SQL. |
| D10 | Minor | There is no index on `receipt_allocation(due_id)`. | Add one. |
| D11 | Minor | The F4 extension is underspecified. | Write the F4 invariants down now: only ACTIVE→CANCELLED, every other column unchanged, under the lock, granted `update(status)` only, allocations immutable forever. |
| D12 | Minor | GST per allocation depends on how a due is split into payments. | Add this to the tax-advisor PMC list and to the worked examples. |
| D13 | Minor | Post-dated cheques are refused. | Make that a deliberate non-goal. |
| D14 | Nit | A replay does not check the payload, and an invisible re-read gives no answer. | Require the same registration. Handle the invisible case. |
| D15 | Nit | The total check fires n+1 times. | Fire it only on `receipt`, and keep allocations to the same transaction. |
