# EGM Stage 8: Intermediate zoom-out report (catalogue masters)

- **Target:** `docs/designs/catalogue-masters/catalogue-masters.md` (commit `3f65424`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context). Read the design, the brief, the step 5–7 reports and the zoom-out standard. In the code: `catalogue.ts`, `people.ts`, `centres.ts`, `admin-http.ts`, `rbac.ts`, `safe-route.ts`, `page-read.ts`, migrations 0002 and 0012, the course pages, `app/page.tsx`, and the catalogue, fixtures, foundation and sec tests.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 1 Major, 5 Nit** (I1–I6); no OWNER items. Verdict: still the simplest design that meets G1–G3. Steps 6 and 7 added a Contracts section that restated the Server section instead of replacing it.
- **Held up:**
  - The grant and update policy are the smallest write path.
  - Every helper is reused.
  - The D2 reasoning matches `admit()`, and D1 matches the centre list.
  - The fixtures are as the tests describe, and the quoted test lines are accurate.
  - Nothing added is unneeded.
  - DD-1…DD-10 are consistent with each other.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Major | `setCentreClass` stated twice, the Server text still with `for update` and no code source | One contract in Server: scalar-subquery lock, `no key update`, `liveRef` code, result, audit target |
| I2 | Nit | Reads, `AdminErrors`, the T-SEC-007 title and the smoke markers stated twice | Technical Plan rewritten as one text; Contracts section removed |
| I3 | Nit | "Other centre columns stay closed" tested three times | Kept in T-SEC-007 only; T-CAT-003's centre statement dropped; `set name` dropped from T-MS-002; the Risks row points to T-SEC-007 |
| I4 | Nit | Policy name `catalogue_update` breaks 0012's `setup_update` | `setup_update` |
| I5 | Nit | The D1 filter's SQL form differs from `listCentres` | `in (select unnest(…))` |
| I6 | Nit | "Centre classes" and "Centres' classes" side by side | "Class per centre" |

## Resolution

**Status: resolved (2026-10-29).** All six applied. The Technical Plan was rewritten as one text; no owner decision was needed.
