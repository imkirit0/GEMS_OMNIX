# EGM Stage 5: Zoom-Out report (catalogue skeleton)

- **Target:** `docs/designs/catalogue-skeleton/catalogue-skeleton.md`, full file (237 lines, commit `f7d4e83`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Also read the brief, `schema.prisma`, migrations 0002/0009/0011, `rbac.ts`, `tickets/setup.ts`, `people.ts`, `numbering.ts`, `tests/fixtures.ts`, the ETL runner, rules, fixture and setup, `app/centres`.
- **Date:** 2026-10-28
- **Result:** **0 Blocker, 3 Major, 4 Nit** (Z1–Z7); 2 OWNER (Z1, Z3).

The reviewer found the design mostly the simplest that meets the need, reusing `adminWrite`/`db()`, the 0009 setup-table RLS and the ETL's pure-function `ctx`; DD-1…DD-5 not challenged.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major, OWNER | `setCentreClass` cannot work (no update grant or policy on `app.centre`) and nothing in Stage 2 reads the class | **Owner: drop it (DD-7).** Column and foreign key stay; Stage 3 form or class-revision ticket sets it |
| Z2 | Major | Code normalisation in three copies; a normaliser outside the rule hash would bypass migration-framework DD-10 | One `normCode()` in `people.ts` (already hashed), imported by `admit()`, `catalogue.ts` and the registration rule; T-CAT-001 checks it against the SQL check |
| Z3 | Major, OWNER | Year dates stored but never used; a `people.ts` comment awaited this design | **Owner: reference data only (DD-6);** comment updated; pre-admissions for next year stay possible |
| Z4 | Nit | `gems_etl` grant listed under the Prisma migration (G6 test forbids it) | Grant stated to live in `scripts/etl/setup.sql` |
| Z5 | Nit | The registration rule must write the normalised code, or the foreign key aborts the write | Stated |
| Z6 | Nit | `people.ts` is hashed with every rule, so all three rules change hash | All three rules move to version 2 |
| Z7 | Nit | "Expand" heading, but the class column is drop-and-add | Heading fixed; migration guard fails if any value is non-null |

## Resolution

**Status: resolved (2026-10-28).** Owner decisions: Z1 → DD-7 (no Stage 2 class setter), Z3 → DD-6 (dates are reference data). All seven applied.
