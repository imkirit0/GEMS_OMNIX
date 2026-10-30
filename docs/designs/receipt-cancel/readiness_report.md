# Receipt cancellation: EGM step 9 implementation readiness report

**Reviewed:** commit 9db2f57, 2026-10-30.

**Verdict:** ready with fixes.

**Checks that passed:**
* **`onFailure`:** it runs for an `RbacError` raised inside the callback, records FAILED with the reason, and is called for StepUpRequired (where it should return null).
* **Migration 0027:** the trigger and policy names to replace match the migration.
* **The `to_jsonb` freeze:** safe to use here.
* **Backdating as the owner:** `session_replication_role = replica` is enough.
* **The T-FR-002 loop expectation:** correct.
* **Fixtures:** they do not clash.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Major | As gems_app, the frozen case fails with 42501 before the guard runs. | Run it as the owner with `app.session_id` set. |
| R2 | Major | `cancelledBy` as a display name returns null to centre admins, because of the `app_user` RLS. | Add a definer function, or drop the name. |
| R3 | Major | The lock is taken before `registration_id` has been read. | Return it from the pre-flight, or drop the app-side lock. |
| R4 | Nit | 0027 grants no update at all, so this is not a widening. | Call it a new grant. |
| R5 | Nit | The constraint name must appear in the message text. | Say so explicitly. |
| R6 | Nit | `adminPost` has no "treat as success" path. | Catch the `cancelled` key in the route. The texts must not start with `word:`. |
| R7 | Nit | The learner page already shows errors and a fresh key. | Only the message entry and `ReceiptRow.status` are needed. |
| R8 | Nit | The TOTP recompute runs when the role is assigned, not when the permission is inserted. | Say so. |
| R9 | Nit | `today` is never used. | Drop it. |
| R10 | Nit | The step-up check is written as a flat `and`. | Nest the ifs. |
