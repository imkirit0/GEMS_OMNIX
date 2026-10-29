# EGM Stage 5: Zoom-out report (enquiry)

- **Target:** `docs/designs/enquiry/enquiry.md` (commit `9dcac04`).
- **Reviewer:** `egm-zoom-out` (fresh context). It read the design and brief, and in the code:
  - `people.ts`, `person-rules.ts`, `details.ts`, `admission-form.ts`, the admit form;
  - `action.ts`, `rbac.ts`, `rate-limit.ts`, `catalogue.ts`, the catalogue masters pages;
  - migrations 0002, 0009, 0011, 0012, 0013, 0015, 0017;
  - the foundation and audit tests.

  It did not check the SPEC/WF page citations against the PDFs.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 7 Major, 5 Nit** (Z1–Z12); no OWNER items; DD-1…DD-14 not reopened.
- **Held up:**
  - Enroll reuses `admit()` and the admit form.
  - The enquiry lock plus a unique `admission_id` handles races.
  - Duplicates are warned, not blocked, with the existing show-then-confirm pattern.
  - The row id serves as the Enquiry No.
  - No person is created at enquiry time.
  - Validation and audit-by-field-names are reused.
  - The append-only follow-up log keeps its latest values on the enquiry.
  - Non-goals are tightly cut.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | "No delete policies" fails T-RLS-002, which requires all four on every `centre_id` table | The 0002/0009 scope loop; no delete grant; follow-ups immutable through `app.ticket_immutable()` |
| Z2 | Major | Counsellor checks and names need definer functions (`gems_app` cannot read users or assignments) | `enquiry_may_receive`, `enquiry_counsellors`, `enquiry_people`, added to T-RLS-005 |
| Z3 | Major | A column grant cannot tell code paths apart; status and `admission_id` are not tied in the database | `admission_id` granted, written only by `admit()`; the `enquiry_guard` trigger enforces DD-6 |
| Z4 | Major | A separate preferences table is too much for three courses | `course_code_1..3` columns with a check |
| Z5 | Major | GET `q` puts a mobile number in the URL; every list call was rate-limited | `q` by POST only; the limit counts only searches |
| Z6 | Major | New contact rules and an unclear pre-fill mapping | Columns named after detail keys and validated with `detailField`; parent maps to guardian |
| Z7 | Major | The masters re-implement catalogue code | Master registry with a per-kind permission; paths and types reuse it; statuses only add kind, colour and order |
| Z8 | Nit | "Last active ENROLLED" equals "the ENROLLED status" | One seeded row; no second, never deactivated |
| Z9 | Nit | `for share` on masters would hide rows from writers | Plain reads that refuse inactive rows |
| Z10 | Nit | `updateEnquiry` and status and version were blurred | Status out of `updateEnquiry`; only it bumps `version` |
| Z11 | Nit | Enroll shown to users who cannot enrol | Shown only with both permissions |
| Z12 | Nit | `enquiryId` in the form state; the audit actions unnamed | Both stated |

## Resolution

**Status: resolved (2026-10-29).** All twelve applied; the Technical Plan was rewritten as one text.
