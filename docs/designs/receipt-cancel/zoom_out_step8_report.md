# Receipt cancellation: EGM step 8 intermediate zoom-out report

**Reviewed:** commit 9db2f57, 2026-10-30.

**Verdict:** pass with nits. There are no blockers and no majors. All 27 earlier findings are addressed, and none of the five candidate additions adds complexity the design does not need.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z8-1 | Nit | The app runs the step-up check in the same transaction, so the guard's own step-up check can never fire for app calls. | Keep the check in the database and drop the one in the app, or keep both deliberately and say so. |
| Z8-2 | Nit | The app-side lock needs a `registration_id` that the pre-flight does not read. | Drop the app-side lock, since guard step 1 already takes it. |
| Z8-3 | Nit | The `today` value read in step 4.4 is never used. | Remove it. |
| Z8-4 | Nit | The check lets an ACTIVE row carry some of the cancel fields. | Use `num_nonnulls(...) = case when CANCELLED then 3 else 0 end`. |
| Z8-5 | Nit | The other four candidates are needed and small. | No change. |
| Z8-6 | Nit | D9's "reason kind" was neither adopted nor declined. | Decline it in DD-4. |
