# EGM Stage 9: Implementation readiness report (migration framework)

- **Target:** `docs/designs/migration-framework/migration-framework.md` (601 lines, commit `24269de`), DetailedRange 522..601 with the feature lines it depends on.
- **Reviewers** (fresh context, in parallel): `egm-implementation-readiness` (standard `implementation-readiness-standard.md`; could M1–M4 be built with CI green?), `egm-codebase-details` (every claim checked against the code).
- **Date:** 2026-10-28
- **Result:** **5 Blocker, 14 Major, 20 Nit** (R1–R22, K1–K17). R1 = K1; R6 = K2; R14 = K4; R18 ≈ K9.

Readiness verdict before fixes: M2 would have failed CI (no CONNECT for `gems_etl`, grants before the role existed, an untyped `format()` parameter), and M3 had tests that could not be written against the `run()` API. Every fix was local.

## Readiness (R)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | **Blocker** | `gems_etl` has no CONNECT (Docker revokes it from public) | `grant connect on database %I` in setup; `drop owned by gems_etl` at go-live |
| R2 | **Blocker** | `setup.sql` granted to the role before `setup.mjs` created it | `setup.mjs` order: create role → check attributes → password → `setup.sql` → CONNECT |
| R3 | **Blocker** | `format(…, $1)` cannot type an untyped parameter | `$1::text` |
| R4 | **Blocker** | No way to inject a SPLIT or a bad rule into `run()` | Pure functions `validateResults()` and `k5()` in `etl/checks.ts`, unit-tested; no injection API |
| R5 | Major | Strictness failure path undefined, outside the status function | Fatal path = the constraint-error path, before writing; artifact `errors`; `runStatus()` takes `fatal` |
| R6 | Major | `identity()` stops at the first bad field; unclear whether later checks run | `identityField()` per field; every check runs and every failure is collected |
| R7 | Major | Rule rows persisted across tests and local reruns | `resetEtl()` also truncates `migration.rule` (tests only); refusal set-ups spelled out |
| R8 | Major | P8 sequence underspecified | Five numbered steps (dry → approve → assert → reset → dry → digest → `admit()`) |
| R9 | Major | No code-hash function or path form | `codeHash(file)`, `RULES` registry, repo-relative POSIX paths from the repository root |
| R10 | Major | `uuidv5` could not reach the RFC vector | `uuidv5(name, namespace = ETL_NAMESPACE)`; the vector stated |
| R11 | Major | "Skip a person batch" fails on a foreign key before K3 runs | Mutation skips a registration batch instead |
| R12 | Major | "Cutover on the clean fixture" vacuous | Dropped; `runStatus()` unit case with only K7/K8/K10/K11 null |
| R13 | Major | No mechanism for the committed evidence run | `ETL_EVIDENCE=1` makes P8 write to `evidence/` |
| R14 | Major | Item 1 not actionable | Exact 09 edits (new column; T-RLS note); no TSV change |
| R15 | Major | `alter role … nosuperuser` fails for Supabase's non-superuser `postgres` | Role created with defaults and checked, not altered; Supabase setup run at the first rehearsal (risk row) |
| R16 | Nit | CI's second database had no ETL setup | `setup.mjs` after both `migrate deploy` calls |
| R17 | Nit | Test titles and status function unnamed | Ids first in titles; `runStatus()` named |
| R18 | Nit | CI values not literal; `.env.local` ignored | Literals given; local-only noted |
| R19 | Nit | Scan finds only double-quoted names | Action names passed as TypeScript strings |
| R20 | Nit | `key_map` grant wording | Explicit insert column list |
| R21 | Nit | Fixture key format and years open | Six-digit keys; years 2025-26, 2026-27 (+ 2027-28 defect); date ranges |
| R22 | Nit | Item 9 files vague | Files and STATUS sections named |

## Codebase (K)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| K1 | **Blocker** | = R1 | = R1 |
| K2 | Major | = R6 | = R6 (`identityField()` exported) |
| K3 | Major | 50-character course-code limit is migration-only | Dropped; same rule as `admit()` |
| K4 | Major | 09 has no T-RLS-015 row; T-MIG table has two columns | = R14 |
| K5 | Nit | `isoDate()` also says `not a date` | Added to reasons |
| K6 | Nit | The `match_key` trigger never refuses; real refusers missing | Refusers listed |
| K7 | Nit | Relies on PUBLIC execute for two functions | Explicit grants |
| K8 | Nit | Bundle scan does not know the new secrets | `SECRET_ENV` extended |
| K9 | Nit | `.env.local` ignored; no documentation | `ci.sh` header lists the variables |
| K10 | Nit | `setup.mjs` env loading | Follows `prisma7.config.ts` / `bootstrap-admin.mjs` |
| K11 | Nit | Tests act as schema owner how | `asAdmin()`, equal URLs in test environments |
| K12 | Nit | `has_schema_privilege` errors on missing roles; 0002 also revokes tables | POC query shape reused; both revokes |
| K13 | Nit | Test-centre list approval is pending (X14) | Stated |
| K14 | Nit | "Today" ambiguous | Asia/Kolkata |
| K15 | Nit | Roadmap asks for RLS coverage on every new table | Exemption stated (and in audit 09) |
| K16 | Nit | Audit columns omitted | `at`, `reason`, `before`, `after` listed |
| K17 | Nit | Academic-year message would be copied a third time | `ACADEMIC_YEAR_RULE` exported and reused |

## Resolution

**Status: resolved (2026-10-28).** All 39 applied under the owner's standing instruction "apply all fixes when the reviews are done"; none reverses an owner decision. The implementation plan was rewritten (items 1–9).
