# EGM Stage 5: Zoom-Out report (learner details)

- **Target:** `docs/designs/learner-details/learner-details.md` (commit `fbbf5af`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Also read the brief, `people.ts`, `admission-form.ts`, `action.ts`, `page-read.ts`, `app/students/**`, migration 0011, `schema.prisma`, `etl/canonical.ts`, `etl/run.ts`, `etl/rules/*`, `tests/admission-screens.test.ts`, `tests/audit-catalogue.ts`, `tests/audit.test.ts`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major, 6 Nit** (Z1–Z10); 1 OWNER (Z7). Verdict: right size, reuses the existing patterns, no YAGNI excess.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | The edit centre was resolved inside the action, but `scopedAction` authorises the centre before the callback (`action.ts:46`) | `getPerson()` returns `editCentreId`; the form carries it; `updateDetails` passes it as `meta.centreId` and calls `assertAdmittedAt` |
| Z2 | Major | Nationality: database checks the format only, yet the design claimed app and database agree | Stated as format-only in the database; excluded from the agreement test; names from `Intl.DisplayNames` |
| Z3 | Major | All of `people.ts` is hashed into every ETL rule, forcing a version bump on every Stage 3 change | Rule helpers move to `person-rules.ts`, hashed instead; one last bump to v4 |
| Z4 | Major | ~22 detail inputs and their mapping would be written twice | `DETAIL_NAMES`, `detailsFrom(fd)`, one `<DetailsFields>` component for both forms |
| Z5 | Nit | Two first edits of a person without a row collide on the primary key; version of a missing row undefined | Lock `person` first; a missing row is version 0 |
| Z6 | Nit | `person.details.update` missing from the audit catalogue in the plan | Added to D2 |
| Z7 | Nit, OWNER | Column list differs from the legacy R-150.02 fields | **Owner: keep the draft list;** SMS mobiles and "contact no" recorded as Non-Goals |
| Z8 | Nit | DD-6's reason ("admit() keeps them optional for the migration") is wrong: the ETL never calls `admit()` | Reason restated: checked by the form layer |
| Z9 | Nit | `updated_at` had no writer or reader | Dropped (the audit row records when) |
| Z10 | Nit | Stale error built differently from the others | Both via `invalid("details", …)`, shown as a form message |

## Resolution

**Status: resolved (2026-10-29).** Owner decision: Z7 (columns as drafted). All ten applied.
