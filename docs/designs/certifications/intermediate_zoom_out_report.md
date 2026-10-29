# EGM Stage 8: Intermediate zoom-out report (certifications)

- **Target:** `certifications.md` (commit `dc2f307`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context). It read the design, the step 5–7 reports, `catalogue.ts`, `people.ts`, `course-offer.ts`, `enquiry.ts`, `person-rules.ts`, the catalogue pages, the course-master tests, the fixtures, and migrations 0002, 0012, 0015, 0016 and 0018.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 1 Major, 3 Minor, 4 Nit** (I1–I8); no OWNER items. Verdict: still the simplest design. One contract could not be built as written, and the base text and contracts overlapped.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Major | The shared text helper "imports nothing" yet throws `invalid()`; the stated order differs from `ownText`'s | `ownText` moves unchanged to `details.ts` (imports only `person-rules.ts`). The reviewer proposed `person-rules.ts` itself, but that file's contents are hashed by the ETL rules, so changing it would force a rules-version change. The order is `ownText`'s |
| I2 | Minor | `btrim` description check differs from the app's trim | 0018-style multiline check (`ws`, `ctl_address`) |
| I3 | Minor | Stale truncate text | Only `certification` added |
| I4 | Minor | Base text and contracts duplicated | Technical Plan replaced by one merged text |
| I5 | Nit | Rest of the `admitOptions` query unstated | Stated (no `group by`) |
| I6 | Nit | T-CC-003 user unnamed | `ST_TOKEN.sa`; PYTHON `[A]`, `hiddenCentres: 0` |
| I7 | Nit | Redundant description mappings | Pass through; `ownText` maps blank to `null` |
| I8 | Nit | Certification cap unsized | 100 against 57 legacy certifications |

**Status: resolved (2026-10-29).**
