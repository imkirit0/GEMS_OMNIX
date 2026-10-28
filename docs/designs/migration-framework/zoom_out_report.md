# EGM Stage 5: Zoom-Out report (migration framework)

- **Target:** `docs/designs/migration-framework/migration-framework.md`, full file (310 lines, commit `b64b371`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Also read the brief, audit 08, v1.1 C-03, migrations 0002/0008/0011, `docker/initdb`, `scripts/ci.sh`, `tests/fixtures.ts`, `numbering.ts`, `people.ts`, `tests/foundation.test.ts`, `tests/audit.test.ts`, `person-core.md`.
- **Date:** 2026-10-28
- **Result:** **0 Blocker, 7 Major, 10 Nit** (Z1–Z17). The shape (same database, TypeScript rules, direct insert, UUIDv5 on `node:crypto`, K7/K8 deferred) was judged right and proportionate; DD-1…DD-4 hold. The Majors were integration defects against existing code.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | A person could be IMPORTED while all its admissions are REJECTED: an RLS-invisible, undeletable row every check accepts | Admission and person decided in one pass; a person is written only with an importable admission; K4 asserts every person has one; new defect and mutation |
| Z2 | Major | The merge rule needs `app.person_match_key`, a SQL function, but rules do no I/O | The runner computes all match keys in one query and passes them in `ctx`; never reimplemented |
| Z3 | Major | Validation re-specified apart from `people.ts`; un-normalised mobiles would never match | Rules call the exported `identity()` and `academicYearOk()`; `+91` mobile defect added |
| Z4 | Major | Seeding every year from the highest *migrated* number reopens past years, can reissue numbers on excluded rows, and silently skips existing series | **OWNER (NP-8): DD-6.** `REGISTER` and only the NP-8 years (default the year in progress), from the highest number on any raw row (or the legacy counter if larger); an existing series fails the run; P8 removes the fixture seeds |
| Z5 | Major | K9 compares two runs' rows, but each run starts on a fresh database; a per-run salt makes fingerprints differ | Run digest stored per run and in the artifact; K9 compares digests; salt derived from the input hash and an environment secret |
| Z6 | Major | A role that owns the schemas cannot be dropped at go-live without dropping the evidence; "production never runs it" contradicted the definition | The migration owner owns everything; `gems_etl` has privileges only; production runs setup before go-live, then drops the role; the existing T-RLS-015 query is reused |
| Z7 | Major | Putting `entity` in the key re-reads C-03.1's SPLIT example | **OWNER: DD-7**, per-entity dispositions as a stated reading of C-03.1; SPLIT unit-tested only |
| Z8 | Nit | Dry mode required approvals for EXCLUDED rules | Dry lists unapproved rules; cutover refuses them |
| Z9 | Nit | K6 re-checked enforced FKs; K3 could not fail | K6 = source orphans REJECTED + FKs validated; K3 over whole target tables; K3 mutation added |
| Z10 | Nit | ARCHIVED accepted but nothing archived | Refused until D-MIG-1 (DD-8); no `archive` schema |
| Z11 | Nit | `key_map.approved_*` never written | Null in Stage 2, reserved for per-record approvals |
| Z12 | Nit | `approve-rule.mjs` adds nothing over SQL | Dropped; the statement is documented |
| Z13 | Nit | Missing files: catalogue/scan, `ETL_DATABASE_URL`, how setup runs, audit sequence grant, raw table creation | All listed (items 2, 3, 7, 8) |
| Z14 | Nit | `if not exists` hides an old table shape | Plain `create` on a fresh database; "if missing" only for the role |
| Z15 | Nit | Duplicate Admission No and unknown status fail the run; bulk rows share `created_at` | Both REJECTED by rules (defects added, status map); `created_at` from legacy dates |
| Z16 | Nit | K1/K2 scope lacked year | Per entity, centre and academic year |
| Z17 | Nit | "SQL behind the same rule interface" impossible | Reworded (DD-5) |

## Resolution

**Status: resolved (2026-10-28).** Owner decisions: Z4 → DD-6 (REGISTER plus the NP-8 years, from the highest number on any raw row), Z7 → DD-7 (per-entity dispositions). All 17 applied; the design was rewritten in place, adding DD-5…DD-8, G7 and Alternatives G and H.
