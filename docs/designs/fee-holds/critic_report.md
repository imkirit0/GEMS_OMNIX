# Fee holds: EGM step 7 design critic report

**Reviewed:** commit b58ba35, 2026-10-30, in parallel with steps 5 and 6.

**Verdict:** approve with changes. There are no blockers and 4 majors.

**Checked and sound:**
* A hold and a collection take the same lock, and the re-read happens after it.
* Receipts already made are untouched.
* Cancelling still restores outstanding on a held due, which means "still owed".
* Holds post no journals.
* Ad-hoc dues are safely excluded.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Major | "Latest event" orders by a bigserial id that is taken before the lock, so under concurrent raw SQL the state can be wrong. | Assign `new.id := nextval(...)` in the guard, after taking the lock. Test it. |
| D2 | Major | "Held" is worked out separately by each reader. | Add `held` and `collectable` to `fee_due_balance`. |
| D3 | Major | The lock key needs the registration, but the code never fetches it. Note that `hashtext(null)` takes no lock. | Read the due first. The pre-flight returns the registration. |
| D4 | Major | The collection messages mislead when dues are held. | Show a collectable figure. Give `fee.receipt.held` when holds explain the refusal. |
| D5 | Nit | A due with nothing owed can be held. | Refuse HOLD when owed is 0. RELEASE is always allowed. |
| D6 | Nit | The hold check depends on RLS coupling: a hidden event would read as not held. | Document the dependency. |
| D7 | Nit | The view's DISTINCT ON cannot push down inside joins. | Read the latest event with `limit 1` or a lateral join. |
| D8 | Nit | The truncate trigger is not named. | Name both triggers. |
| D9 | Nit | The gate and the audit payload are unclear. The mapping order is not stated. | Name the gate, define the payload, and map the hold refusal before the generic 23514 branch. |
