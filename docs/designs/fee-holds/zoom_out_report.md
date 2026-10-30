# Fee holds: EGM step 5 zoom-out report

**Reviewed:** commit b58ba35 on 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** approve with changes. The event table plus a latest-event view is the minimum that the immutability of `fee_due` allows. Nothing blocks reminders, F5 or reports.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | "Held" is worked out in three places, and every reader must join for it. | Define it once in `fee_due_balance` as `held` plus `collectible`. |
| Z2 | Major | The matrix says hold flags are imported. The legacy granularity and the import mapping are not stated. | State the import mapping. Offer "hold all open dues of this registration". |
| Z3 | Nit | The SPEC filters by AY and course. | Add both filters. |
| Z4 | Nit | The composite FK and its new unique key are not needed. | Use a plain FK and check the centre in the guard. |
| Z5 | Nit | Whether a due with `owed = 0` can be held is undecided. | Decide and state it. |
| Z6 | Nit | A held due inside outstanding confuses cashiers. | Show a "collectible now" figure. |
| Z7 | Nit | The matrix lists T-FEE-011 for R-067. | Map T-FH tests to R-067 in the matrix. |
