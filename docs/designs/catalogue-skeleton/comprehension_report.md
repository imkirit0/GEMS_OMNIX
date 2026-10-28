# EGM Stage 6: Comprehension Test report (catalogue skeleton)

- **Target:** `docs/designs/catalogue-skeleton/catalogue-skeleton.md` (238 lines, commit `bd9f059`).
- **Reviewer:** `egm-comprehension` (fresh context), standard `re-implementation-standard.md`. Checked against `schema.prisma`, migrations 0002/0009/0011, `rbac.ts`, `action.ts`, `tickets/setup.ts`, `people.ts`, fixtures, the people, ETL and audit tests, the ETL runner, rules, fixture and setup scripts, `ci.sh`.
- **Date:** 2026-10-28
- **Result:** **1 Blocker, 10 Major, 4 Nit** (C1–C15); OWNER items in C1, C4, C7.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | **Blocker** | `catalogue.ts` functions were signatures only (returns, validation, not-found, empty patch, no-op, reason, inactive references, `kind` selection) | Contract table and common rules; `kind` from a fixed map of `Prisma.sql` fragments. **Owner:** reason required (DD-9); no course in an inactive category or division (DD-10) |
| C2 | Major | Audit `targetId` for creates and before/after shapes undefined; computed action names would escape T-AUD-009 | Per-function action, target and before/after; literal action names, one `adminWrite` call each |
| C3 | Major | Four or five actions | Four, named; scan entry given |
| C4 | Major | Normalisation not exact; JS and Postgres differ on Unicode | Exact `normCode()` body; **Owner: ASCII-only codes (DD-8)** by check constraint; "agree" defined with NBSP and `É` samples |
| C5 | Major | A second `normCode` already in `etl/rules/centre.ts` | Removed; the rules and `checks.ts` import `people.ts`'s; centre outcomes unchanged |
| C6 | Major | `admit()` change under-specified | Four-step order; messages; normalised code stored and returned; failures not audited |
| C7 | Major | ETL `ctx` fields and rule checks under-specified | `Set<string>` of all codes; **Owner: existence only (DD-11)**; check placement and error order |
| C8 | Major | `XYZ` defect placement and the test changes | Appended at the end of the fixture; `etl.test.ts` (ctx, v2 message, new assertion) and `people.test.ts` (`X` → `DCA`) listed |
| C9 | Major | Seed rows and fixture user under-specified | Seeds (codes, names, years and dates, all open) and `CA` user given |
| C10 | Major | Types, nullability, constraint names, Prisma shape, guard placement | Prisma models; all not null except `centre_class_id`; named checks; guard SQL before the generated drop |
| C11 | Major | How T-CAT-004 and database refusals are tested | `withScope(T.uA, …)`; session-less out of scope; `ST_TOKEN.sa` denied; refusal on all four code tables |
| C12 | Nit | RLS/grant details | ENABLE and FORCE, policy names, sequence names, `on conflict do nothing` |
| C13 | Nit | Duplicate message | `"a record with that code already exists"`, key `catalogue.duplicate` |
| C14 | Nit | No `catalogue.manage` holder after deploy | Risk row |
| C15 | Nit | Matrix format, evidence id | Like T-PER rows; E-034 |

## Resolution

**Status: resolved (2026-10-28).** Owner decisions: DD-8 ASCII-only codes, DD-9 reason required, DD-10 no inactive references for courses, DD-11 the migration checks existence only. All 15 applied; the Technical Plan and implementation plan were rewritten.
