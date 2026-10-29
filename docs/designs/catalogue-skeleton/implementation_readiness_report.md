# EGM Stage 9: Implementation readiness report (catalogue skeleton)

- **Target:** `docs/designs/catalogue-skeleton/catalogue-skeleton.md` (404 lines, commit `00adf4c`), DetailedRange 329..404 with the feature lines it depends on.
- **Reviewers** (fresh context, in parallel): `egm-implementation-readiness` (could C1–C4 be built with CI green?) and `egm-codebase-details` (every claim checked against the code).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 7 Major, 15 Nit** (R1–R11, K1–K11). R4 = K1; R6 ≈ K2; R8 ≈ K8; K3 within R1.

The readiness reviewer found the plan buildable and the phase order sound (C2 stays green: existing callers use upper-case codes and seeded years; the year check still fires before the new foreign key). The findings were tests that could pass vacuously and edge cases left to the implementer.

## Readiness (R)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | Major | Agreement condition 2 could never fail; condition 1 did not say how the database's answer is obtained | Database side = admin insert into `course_category` in a rolled-back transaction; condition 2 rewritten so it can fail |
| R2 | Major | No centre class seeded, so T-CAT-004 and the class foreign key were untested | `METRO` seeded; exact code lists asserted; `centre_class_id = 999` → 23503 |
| R3 | Major | The year-master rule check, DD-11 and the admission year foreign key untested | P8 defect `2030-31`; inactive-course unit row maps IMPORTED; direct admission insert → 23503 |
| R4 | Major | `isoDate()` throws `PersonError` inside an `RbacError` module | Caught and rethrown as `RbacError` |
| R5 | Major | Edge cases open (nothing to change, division message, non-integer ids, non-boolean flags) | Each decided in Common Rules |
| R6 | Nit | Empty-catalogue check placed in step 4 | Step-0 query; exact reason and test (`truncate … cascade`) |
| R7 | Nit | Unit-test `ctx` values | `courses: {"DCA"}`, `academicYears: {"2026-27"}` |
| R8 | Nit | `checks.ts` has `norm`, not `normCode` | Replaced |
| R9 | Nit | `people.test.ts` edit came one phase late | Moved to C2 with the constraint name asserted |
| R10 | Nit | Assertions not pinned | Constraint names; 42501 for insert, 0 rows for update; kind check proved with no session |
| R11 | Nit | Item 8 vague | E-034 row per mutation; STATUS changes named |

## Codebase (K)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| K1 | Major | = R4 | = R4 |
| K2 | Major | A step-4 refusal ends FAILED, not `RunRefused` | Step-0 check |
| K3 | Nit | "three conditions" left over | Fixed |
| K4 | Nit | T-AUD-009 reads `action:` up to `permission:`; actions must appear in a test | Stated |
| K5 | Nit | G6 test rejects `gems_etl` anywhere in a migration | Stated |
| K6 | Nit | "The action" described backwards | Fixed |
| K7 | Nit | Reuse `ACADEMIC_YEAR_RULE` and `invalid()` | Named |
| K8 | Nit | `checks.ts` `norm`; centre rule description | Replaced; description updated |
| K9 | Nit | Moving `normCode` closes a hash gap | Added as a reason |
| K10 | Nit | Fixture permission row and the bootstrap test | Row given; dependency noted |
| K11 | Nit | `normCode` would turn an NBSP-only code from `required` into `no such course` | Blank check stays on `String.trim()` |

## Resolution

**Status: resolved (2026-10-29).** All 22 applied under the owner's standing instruction "apply all fixes when the reviews are done"; none reverses an owner decision.
