# Ad-hoc fees: EGM step 5 zoom-out report

**Reviewed:** commit d35e2c3, 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** approve with changes. The scope is right and follows fee-dues DD-7. The weak point is how "owed" is defined: as written, every reader must apply its own filter.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | "Owed = PLAN" is filtered separately in each reader, which undoes the single definition. R-061 will later add ADHOC dues that really are owed. | Add an `owed` column to `fee_due_balance`, and have readers use `owed > 0`. |
| Z2 | Major | `createDuesTx` and `canCreate` refuse when any `fee_due` exists. An extras-only receipt would therefore block "Create dues". | Make both checks PLAN-only, and test this order. |
| Z3 | Major | Only the app enforces "never collected again". A later allocation against a void ADHOC due still passes the guard. | In the allocation guard, allow an ADHOC due only when `created_at = now()`. |
| Z4 | Nit | F5 concessions and ADHOC dues. | Add to Non-Goals: no concession on ADHOC. |
| Z5 | Nit | The misc price master, the misc list and the ledger are not blocked. | None. |
| Z6 | Nit | The server allows 5 extras but the form shows 3 rows. | Use one number. |
| Z7 | Nit | Too much code-level detail. | Fine for this repo. |
