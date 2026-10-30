# Schemes and concessions: EGM step 8 intermediate zoom-out report

**Reviewed:** commit 90fd860, 2026-10-30.

**Verdict:** approve once two text fixes are made. There are no blockers. C8 and C12 are only partly resolved, and the latest-first spread is not explained. The five candidate complications are all justified.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z8-1 | Major | The part guard's update of `updated_*` fails: the columns are not granted, and the edit breaks the scheme guard's diff. | Use a no-op `set name = name` and let `fee_scheme_guard` stamp the edit. Delete the parts first in `deleteScheme`. |
| Z8-2 | Major | Several refusals have no constraint names. | Name one constraint per branch, and use those names in both error maps. |
| Z8-3 | Nit | It is unclear whether the guard keeps or replaces a supplied id. | Keep the supplied id (the createPlan pattern). |
| Z8-4 | Nit | "One per registration" can be a unique index. | Make `registration_id` unique and map 23505. Switch to a guard when reversal ships. |
| Z8-5 | Nit | The page and the database use different rules for "paid". | Use one rule: nothing paid on any PLAN due of the registration. |
| Z8-6 | Nit | The latest-first spread is not explained. | Explain it in DD-2 (PMC). |
| Z8-7 | Nit | Drafts are visible to everyone. | Hide drafts from users without a scheme permission. |
