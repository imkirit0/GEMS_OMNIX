# EGM Stage 8: Intermediate zoom-out report (course master)

- **Target:** `docs/designs/course-master/course-master.md` (commit `b5e6458`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context). Read the design and the zoom-out standard; in the code `catalogue.ts`, `people.ts` (admitOptions, admit), `app/students/new/form.tsx`, `admin-http.ts`, migration 0012.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 6 Major, 5 Nit** (I1–I11); OWNER on I3. Verdict: the basic shape is still the simplest (columns on `course`, one link table, a switch off by default, admin pages on `adminWrite`/`adminPost`); review rounds accreted mechanism around the share and the availability function, and left a stale SQL block and a duplicate constraint name.
- **Held up:** the 19-column count; bounds agree between Data Model and Messages; `created_at` exists; `gems_app` cannot read `audit_log`; the checked-queries list covers every `app.course` query in `src/`; DD-1 and the flags agree.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Major | The admit SQL block was the old inline query, contradicting the function above it | One inline query in `admit()`, written correctly |
| I2 | Major | "One rule (D4)" not delivered; the function speculative (R-090.01 deferred) | Function dropped; `admitOptions` uses the same joins; a test asserts `admit()` and the form's filter agree |
| I3 | Major, OWNER | Five mechanisms protect one value; they ban `select *` and need a grant per new column; the share already sits in audit rows protected by the app | **Owner: app-level only (DD-13 revised);** column grant, definer function, lock-order note and both meta-tests removed; DD-14 moot |
| I4 | Nit | The Prisma grep test redundant | Removed with I3 |
| I5 | Major | Two constraints named `course_keltron_share_check` | One combined check |
| I6 | Major | Outline missed the admission form, `admitOptions`, `admin-http` | Added to M2 and M3 |
| I7 | Major | T-CM-003 tested filtering the server no longer does | `offeredCourses()` pure function, unit-tested; agreement test; pre-hydration stated |
| I8 | Nit | Changing `ADMIN_MESSAGES.invalid` reaches other pages | Left unchanged; course pages show their own text |
| I9 | Nit | Duplicate department Risks rows | Merged |
| I10 | Nit | Integers from code not covered | `Number.isSafeInteger` within range |
| I11 | Nit | Too low-level D1 detail; flags without labels | D1 detail gone with I3; flags table with labels |

## Resolution

**Status: resolved (2026-10-29).** Owner decision: I3 → DD-13 revised (DD-14 moot). All eleven applied; the Technical Plan rewritten as one text.
