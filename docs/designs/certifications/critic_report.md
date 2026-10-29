# EGM Stage 7: Critic report (certifications)

- **Target:** `certifications.md` (commit `1f1043e`; run in parallel with steps 5 and 6; the first run stalled and was restarted).
- **Reviewer:** `egm-design` (fresh context, adversarial). It read the design, the brief, `catalogue.ts`, `people.ts`, `course-offer.ts`, `rbac.ts`, migrations 0002, 0012, 0016 and 0017, the ETL setup and reset, and the foundation, fixtures and course-master tests.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 1 Major, 2 Minor, 4 Nit** (D1–D7); no OWNER items.
- **Held up:**
  - **Permissions and grants:**
    - the scope check is ALL-scope;
    - the `course_centre` update policy is unreachable;
    - `code` is immutable.
  - **Locking and consistency:**
    - the course lock serialises the three link writers;
    - `for share` holds against deactivation;
    - the availability SQL is correct, and one statement sees one snapshot.
  - **Reset and ETL:** the fixtures cascade, and ETL is untouched.
  - **Audit:** audited by sorted codes.
  - **Migration:** the drift-gate pattern is followed.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major | "The same rule in code" is false against `offeredCourses`' early return | Same as C1; DD-7 amendment recorded |
| D2 | Minor | Non-manager centre list silently short | `specialCase`, `hiddenCentres`; leak check in T-CC-003 |
| D3 | Minor | `admitOptions` sends named centres outside the caller's scope | Intersected with `student.admit` scope; empty stays `[]` |
| D4 | Nit | Aggregation fan-out | Correlated subqueries |
| D5 | Nit | `using (true)` select policy undocumented | Comments in 0019 and T-RLS-002 |
| D6 | Nit | Form ids as strings; Mandatory without Carries | `Number`; ignored |
| D7 | Nit | Caps unsized | 500 against 386 legacy centres |

**Status: resolved (2026-10-29).**
