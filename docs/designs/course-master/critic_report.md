# EGM Stage 7: Critic report (course master)

- **Target:** `docs/designs/course-master/course-master.md` (commit `77dd994`, after steps 5–6).
- **Reviewer:** `egm-design` (fresh context, adversarial). Read the design, `catalogue.ts`, `people.ts` (admitOptions, admit), `rbac.ts`, `admin-http.ts`, `db.ts`, migrations 0002, 0007, 0012, `tests/catalogue.test.ts`, `tests/foundation.test.ts`, the admission-screens tests, `app/students/new/*`, the admin pages' error rendering, `scripts/smoke-security.mjs`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 7 Major, 7 Nit** (D1–D14); OWNER on D7. Verdict: structure sound; the share protection holds at the database.
- **Held up:** `visible` defaulting to true keeps existing tests and the ETL green; test SQL as `gems_app` names its columns; the share function leaks nothing (unknown id = non-manager = null; not granted to other roles); the Keltron cross-field check matches the database; the app's text rules are at least as strict as the checks.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major | The stated reason for `volatile` was wrong; reading the share inside `select … for update` risks a lost update after a lock wait | The share is read in a second statement after the lock; reason corrected; concurrent test |
| D2 | Major | A float two-decimal check refuses 1.1 and 1.15; `Number()` accepts `1e2` | String patterns before conversion; tolerance for numbers from code; test values |
| D3 | Major | No upper bounds: values above int range give a 500 | Bounds in app and checks |
| D4 | Major | The availability rule duplicated in `admit()` and `admitOptions()` | One SQL function `app.centre_course_codes()` |
| D5 | Major | Form payload courses × centres; pre-hydration and centre-change behaviour undefined | Classes per course and per centre; client filtering rules; server stays the gate |
| D6 | Major | Future course columns silently unreadable; Prisma model calls fail at runtime | Column-privilege test; grep test against Prisma `.course.` calls |
| D7 | Major, OWNER | Audit rows expose the share once an audit viewer exists | **Owner: viewer redacts it for non-managers (DD-18)** |
| D8 | Nit | The list computes the share per row needlessly | Share only in `getCourse` |
| D9 | Nit | T-CM-005 misses probes | `select *`, `where`, `order by`, `returning *`; `count`/`exists` still work |
| D10 | Nit | The availability check takes no lock, unstated | Stated, accepted as catalogue DD-13 |
| D11 | Nit | A failing test could leave the gate on | Reset in `afterEach` |
| D12 | Nit | The detail regex broader than needed | Bracket part dropped |
| D13 | Nit | List order undefined | `sort_order, code` |
| D14 | Nit | Later costs unrecorded (share in Stage 4 fees; department master) | Risks rows |

## Resolution

**Status: resolved (2026-10-29).** Owner decision: D7 → DD-18. All fourteen applied.
