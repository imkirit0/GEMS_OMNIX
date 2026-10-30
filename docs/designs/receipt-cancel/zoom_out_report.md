# Receipt cancellation: EGM step 5 zoom-out report

**Reviewed:** commit 6a6de00, 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** pass with minor changes. There are no blockers. The scope is close to minimal. Nothing in the design blocks the ticket path, the F1 reversing journal or holds.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | The Risks section names the wrong gate. F3 DD-5 also allows collection under an Accounts backfill rule, and that rule covers receipts only. | Correct the Risks section. Add to F3 DD-5 that the backfill rule must also cover cancellations. |
| Z2 | Nit | `cancelDb` duplicates `receiptDb`. | Add the two name branches to `receiptDb` and drop `cancelDb`. |
| Z3 | Nit | The app's re-check of status and date duplicates the guard. Also, an update that touches 0 rows would be audited as SUCCESS. | Let the guard decide. Require exactly 1 updated row; otherwise the receipt is not found. |
| Z4 | Nit | The design does not say why it avoids `adminWrite`. | Explain that `adminWrite`'s `db()` hides the guard names. |
| Z5 | Nit | The design departs from D11 (the `cancel_reason` grant) and from audit 07 F6 (an ACTIVE filter instead of reversed allocations) without naming either change. | Name both departures. |
| Z6 | Nit | The point where the ticket path joins is not written down. | State that the ticket piece replaces guard step 3. |
| Z7 | Nit | The ledger and holds fit the design. | No change. |
