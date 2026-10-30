# Fee holds: EGM step 9 implementation readiness report

**Reviewed:** commit c70ace7, 2026-10-30.

**Verdict:** ready with fixes.

**Checked and holding:**
* `new.id := nextval` in a BEFORE trigger needs no grant on `id`, only USAGE on the sequence.
* The view can gain columns at the end.
* The guard step fits under its lock.
* The D6 RLS reasoning holds.
* Role 33 and user `…00fd` are free.
* Existing expectations are unchanged when nothing is held.
* `scopedAction` writes `meta.reason`.
* The race test can be built: two clients, with `pg_stat_activity` showing the wait.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Major | `collectable > 0` in the open-dues query drops the owed totals. | Keep `owed > 0` and compute both totals. Only the allocation window uses `collectable`. |
| R2 | Major | A receipt with only ad-hoc items would be refused when every due is held. | Gate that refusal on a plan amount above 0, and add a test. |
| R3 | Major | The message carries a value, and some keys and labels are missing. | Use fixed text, add the `ADMIN_MESSAGES` entries, and add the `reason` label. |
| R4 | Major | The T-AUD-009 scan list lacks `holds.ts`. | Add it. |
| R5 | Major | The ETL reset's truncate of `fee_due` fails because of the new FK. | Add `fee_hold_event` to the truncate, with its triggers lifted. |
| R6 | Minor | `create or replace view` drops `security_invoker` unless it is repeated. | Repeat `with (security_invoker = true)`. |
| R7 | Minor | Guard details are left open. | Copy the 0029 conventions. |
| R8 | Major | `holdCentres` is undefined. | Define it as `fee.hold ∩ student.view`, using the Day Book pattern. |
| R9 | Minor | The row types, ordering, authorisation, IST handling, defaults and error texts are undefined. | Define them. |
| R10 | Minor | The exact `duesForPerson` changes and the T-FD-001 shape are missing. | Give them. |
| R11 | Minor | The error wrapper is unspecified. | Use a `receiptDb`-like `holdDb`. |
| R12 | Nit | The pre-flight query is missing. | Give it. |
| R13 | Nit | The key for the ad-hoc refusal is missing. | `fee.hold.mismatch`. |
| R14 | Nit | The Prisma relation names, the T-RLS-002 position, and ENABLE+FORCE are missing. | State them. |
