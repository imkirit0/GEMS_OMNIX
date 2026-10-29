# EGM Stage 5: Zoom-out report (certifications)

- **Target:** `certifications.md` (commit `1f1043e`). Steps 5, 6 and 7 ran in parallel on this commit; their resolutions are merged in the design's "Contracts (steps 5–7)".
- **Reviewer:** `egm-zoom-out` (fresh context). It read the design, the brief, WF p. 3, SPEC p. 35, `catalogue.ts`, `people.ts`, `course-offer.ts`, `enquiry.ts`, `details.ts`, migration 0002 and the fixtures.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 2 Major, 4 Nit** (Z1–Z6); no OWNER items. Verdict: approve with changes. The scope is right and the existing patterns are reused.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | Non-managers see a centre list cut by RLS that reads as "class rule" | `specialCase` and `hiddenCentres` from `course_centre`; the page says so |
| Z2 | Major | DD-3 silently changes course-master DD-7 | DD-3 records the amendment; course-master DD-7 marked; comments updated |
| Z3 | Nit | A third copy of the multiline text check | One `text-rules.ts` shared with `enquiry.ts` |
| Z4 | Nit | `setCertificationActive` repeats `setMasterActive` | Kept as its own function (`createMaster` cannot fill `type`) |
| Z5 | Nit | Explicit truncates of cascaded tables | Only `certification` added |
| Z6 | Nit | `specialCase` untested | Asserted in T-CC-003 |

**Status: resolved (2026-10-29).**
