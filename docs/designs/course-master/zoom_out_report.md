# EGM Stage 5: Zoom-Out report (course master)

- **Target:** `docs/designs/course-master/course-master.md` (commit `e507d8c`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Read the design, the brief, `catalogue.ts`, the catalogue-skeleton design, migrations 0009 and 0012, `schema.prisma`, `people.ts`, `tickets/policy.ts`, `tickets/setup.ts`, `rbac.ts`, `admin-http.ts`, `page-read.ts`, `app/admin/ticket-types/**`, `app/page.tsx`, `tests/catalogue.test.ts`, `tests/audit*.ts`, `tests/fixtures.ts`, `scripts/ci.sh`, `scripts/etl/setup.sql`, `etl/rules/registration.ts`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major, 8 Nit** (Z1–Z12); OWNER on Z7, Z8, Z9. Verdict: the simplest design meeting G1–G4; scope right; approve once Z1–Z4 are fixed. The GET filter form is fine (no personal data).

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | No update grant for the new course columns (0012 grants four columns only; verified) | Column update grant in 0016 |
| Z2 | Major | The design said "changed keys" while the code audits the whole row (T-CAT-003 checks it) | Keep the whole row; expected rows gain the defaults |
| Z3 | Major | Saving classes breaks after an assigned class is deactivated | Refuse inactive classes only when newly added; shown "(inactive)" |
| Z4 | Major | Field errors reach the page as a generic text; `catalogue.duplicate` has no message | Field prefix as `detail`, fixed label list; message added; neutral generic text |
| Z5 | Nit | Pages need picklists and a manage check | `listCourses`/`getCourse` return them and `canManage` |
| Z6 | Nit | Delete policy has a precedent; link table needs no update | `setup_delete` as 0009; select, insert, delete only; course row locked |
| Z7 | Nit, OWNER | Prisma model changes; Decimal from raw queries | **Owner: two decimals (DD-11);** `::float8` on read; Prisma model in the plan |
| Z8 | Nit, OWNER | Flags without readers; `visible` undefined | **Owner: invisible = not offered, refused by admit (DD-12);** other flags stored only |
| Z9 | Nit, OWNER | The share readable by every signed-in user | **Owner: managers only (DD-13):** column grant and a definer function |
| Z10 | Nit | A new file for one boolean | `CATALOGUE_GATES` in `people.ts` |
| Z11 | Nit | Reuse the ticket-types route shape | `create` and `[id]/save` with `op` |
| Z12 | Nit | Audit catalogue entry; ETL unaffected | Listed in M2; one line on the migration |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: Z7 → DD-11, Z8 → DD-12, Z9 → DD-13. All twelve applied.
