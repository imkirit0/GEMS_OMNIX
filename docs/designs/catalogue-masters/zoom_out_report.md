# EGM Stage 5: Zoom-out report (catalogue masters)

- **Target:** `docs/designs/catalogue-masters/catalogue-masters.md` (commit after the owner accepted DD-5…DD-10).
- **Reviewer:** `egm-zoom-out` (fresh context). Read the design and brief; in the code `catalogue.ts`, `admin-http.ts`, `rbac.ts`, `page-read.ts`, migrations 0002, 0012, 0016, the course pages, `app/page.tsx`, `tests/catalogue.test.ts`, `tests/course-master.test.ts`, `tests/foundation.test.ts`, `tests/fixtures.ts`, the course-master and catalogue-skeleton designs.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 1 Major, 3 Nit** (Z1–Z4); no OWNER items. Verdict: the simplest design that meets G1–G3; one migration (a column grant and one policy), three reads and one write, every other write reused.
- **Held up:** the grant plus an update policy is the smallest change under FORCE RLS; the foreign key exists and the column is nullable (DD-6 needs nothing); DD-7 matches `setCourseClasses`; DD-8 reuses `table()`/`TABLES`; field details flow through `adminPost` already; DD-10 changes only `ADMIN_MESSAGES`; `select … for update` works under the column grant; a centre user's update hits 0 rows.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | T-CAT-003 expects the class write to fail (42501); the T-RLS-002 comment, catalogue DD-7 and a course-master non-goal say the opposite | "What this changes elsewhere": T-CAT-003 tests another column instead, the comment updated, superseded notes in both designs at build |
| Z2 | Nit | Reuse implied, not stated (`liveRef`, `id`, `reasonOf`; a second error component) | Helpers named; one shared `AdminErrors` with a label map |
| Z3 | Nit | A "Kind" label can never show | Dropped |
| Z4 | Nit | T-MS-004 repeats T-CM-003 | Dropped; one `admit()` folded into T-MS-002 |

## Resolution

**Status: resolved (2026-10-29).** All four applied; no owner decision needed.
