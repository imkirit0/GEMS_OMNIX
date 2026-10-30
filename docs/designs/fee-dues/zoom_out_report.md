# Fee dues: EGM step 5 zoom-out report

**Reviewed:** commit 16859ed, 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** approve with changes. Immutable, gross-only dues created explicitly is the right core design. The design revision records how each finding below is resolved.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | F3 cannot row-lock dues. `FOR UPDATE` needs UPDATE privilege and the update policy, and dues have neither. | Name the advisory lock `fee-dues:<registrationId>` as the lock F3 takes. |
| Z2 | Major | Ad-hoc dues (D-FEE-1) have no plan line, but every plan column is NOT NULL and the guard assumes a plan. | Decide now how ad-hoc dues will be held. |
| Z3 | Major | The currency check can never fail, because every side is INR. | Drop `centre.currency` for now. Keep `fee_due.currency`. |
| Z4 | Major | The six `canCreate` reasons are computed on every view. | Show the button when the caller holds `fee.dues` and no dues exist. Keep only the `no-plan` reason. |
| Z5 | Nit | The guard pins the year, but not that the plan is this registration's. | Drop `academic_year` and check 6. Say plainly that the server chooses the plan. |
| Z6 | Nit | Outstanding is not defined. | Concession, fine and hold become separate rows; outstanding is computed in F3. Update audit 07 §1. |
| Z7 | Nit | F3 and bulk creation will want the creation logic without its wrapper. | Add `createDuesTx(tx, registrationId)`. |
| Z8 | OK | The permission, the explicit creation, the `bigserial` id, the composite key and the immutability pattern. | Keep. |
