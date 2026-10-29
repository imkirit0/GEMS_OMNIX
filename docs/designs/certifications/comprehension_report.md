# EGM Stage 6: Comprehension report (certifications)

- **Target:** `certifications.md` (commit `1f1043e`; run in parallel with steps 5 and 7).
- **Reviewer:** `egm-comprehension` (fresh context, naive implementer). It read the design, the brief, `catalogue.ts`, `people.ts`, `course-offer.ts`, the admit form, the catalogue pages and routes, `admin-http.ts`, `rbac.ts`, migrations 0012, 0016 and 0017, the fixtures, and the course-master, foundation and audit tests.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 9 Major, 2 Nit** (C1–C11); no OWNER items. Verdict: revise; all gaps are contract text.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Major | `offeredCourses`' early return contradicts the new rule | Exact new function; `OfferCourse.centreIds` required |
| C2 | Major | `centreIds` SQL, order and scope unstated | Correlated subquery, ordered, scoped to `student.admit` |
| C3 | Major | `getCourse` shape unstated | Exact shape; non-managers get empty picklists |
| C4 | Major | Adding fields to the course columns would break T-CM-001 | Columns unchanged; the tests that stay green are listed |
| C5 | Major | The RLS-filtered centre list for non-managers | Stated, with `hiddenCentres` |
| C6 | Major | Certifications route mapping | Fields and mapping per `op` |
| C7 | Major | Course `op=certifications` mapping (ids as strings) | Exact mapping with `Number` |
| C8 | Major | Check names, control set, message order | Stated |
| C9 | Major | T-CC-003 setup and "both branches" | Exact fixture and expected counts |
| C10 | Nit | Invalid item shapes; return shapes | Stated |
| C11 | Nit | Label maps, 404 parity, centre locking, RLS expectations | Stated |

**Status: resolved (2026-10-29).**
