# Schemes and concessions: EGM step 7 design critic report

**Reviewed:** commit 6713404, 2026-10-30, in parallel with steps 5 and 6.

**Verdict:** revise. There are no blockers and 6 majors.

The core model is sound:
* concessions are subtracted inside `fee_due_balance`, so every reader follows them;
* the lock is consistent;
* GST stays consistent at receipt.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Major | The cap at owed depends on payment order. A cancelled receipt loses the discount for good. | Refuse assignment when a ruled due has `paid > 0` (the scheme is chosen at admission). Cap at gross. |
| D2 | Major | AMOUNT is applied per instalment. | Make AMOUNT a total per fee type, spread deterministically. Or get PMC sign-off for per-instalment. |
| D3 | Major | Approval and step-up are not enforced in the database. | The guard requires `scheme.approve` plus step-up for LIVE and RETIRED, and `scheme.manage` for drafts. |
| D4 | Major | An approver can approve their own edits. | Stamp `updated_by` on every edit. The approver must differ from both creator and editor. |
| D5 | Major | Concessions can be inserted later, outside the assignment's transaction. The guard does not take the lock. | Require `assignment.created_at = now()`. The guard takes the lock. |
| D6 | Major | Concessions cannot be reported. | Add a read-only concession register and index. Add a reconciliation test: gross = paid + concession + owed. |
| D7 | Nit | There are two copies of the amount formula. | Let the guard stamp the amount. |
| D8 | Nit | GST consistency is not documented, and receipts show only the paid lines. | Document it. Show gross, concession and net. |
| D9 | Nit | Assignment can race with retirement. | Read the scheme `for share`. |
| D10 | Nit | The view's join can multiply rows, and `collectable` would be subtracted twice. | Use a scalar subquery inside the inner query only. |
| D11 | Nit | `unique(due_id)` blocks the future ticket. | Use `unique(assignment_id, due_id)`. |
| D12 | Nit | Status changes and held zero-owed dues are not covered in Risks. | Add them. |
| D13 | Nit | A drafting fragment is left in the fixtures. | Clean it up. |
