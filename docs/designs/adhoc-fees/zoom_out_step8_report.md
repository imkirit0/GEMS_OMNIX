# Ad-hoc fees: EGM step 8 intermediate zoom-out report

**Reviewed:** commit 20bebd9, 2026-10-30.

**Verdict:** approve with changes. Every finding is resolved except two. D4 is partly fixed. C2/D6 is fixed in the server but not on the page. The same-transaction rule, the fee-type FK, the plan-type refusal and `owed` are justified.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z8-1 | Major | The plan-type refusal checks only dues that already exist. Extras collected before Create dues can still charge a plan fee type twice, so the Risks section claims too much. | Correct the claim. Optionally, also refuse fee types on the plan that `resolvePlan` would pick, enforced in the app. |
| Z8-2 | Minor | The receipts list and the Collect form sit inside the dues branch of the page. | Render both outside that branch. |
| Z8-3 | Nit | "R-061 changes `owed` alone" is untrue, and the totals query applies `owed` redundantly. | Soften the claim and simplify the query. |
| Z8-4 | Nit | The view refers to its own alias `outstanding`. | Repeat the expression. |
| Z8-5 | Nit | `owing` is redundant with `outstanding`. | Drop it. |
| Z8-6 | Nit | The app can hardly ever reach `fee.receipt.adhoc`. | Map that case to `mismatch` and drop the key. |
| Z8-7 | Nit | The guard checks `due_on` instead of stamping it. | Stamp it to today (IST). |
