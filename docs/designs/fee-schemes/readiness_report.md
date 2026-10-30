# Schemes and concessions: EGM step 9 implementation readiness report

**Reviewed:** commit 90fd860, 2026-10-30, in parallel with step 8.

**Verdict:** ready with fixes. One blocker (R1) would make every assignment fail. All fixes are wording changes; none needs a redesign.

**Claims checked and found correct:** the 0031 `fee_due_balance` body can be replaced with `create or replace view` (same names, order and types; new columns at the end only); the 0025 `to_jsonb` diff and `for share`; `session_step_up_fresh(int)` is a definer granted to `gems_app`; `admission.admitted_on` is a NOT NULL date and `registration.course_code` is text; the `(id, centre_id)` key exists (0026:25); a BEFORE INSERT trigger returning NULL skips the row and the INSERT … SELECT count covers only inserted rows; the part guard's update of `fee_scheme` fires `fee_scheme_guard` once with no recursion; the server patterns in fees.ts, rbac.ts, receipts.ts, holds.ts and dues.ts; role ids 34–36 and the three user ids are free; only T-FD-001 does a full `toEqual` on the registration shape; rounding of the seed lines is half away from zero.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Blocker | The assignment guard reads the scheme `for share`. Under RLS, `FOR SHARE` must pass the UPDATE policy (`scheme.manage`/`scheme.approve`), so a `fee.concession` user sees no row and every assignment fails as "not LIVE" (the trap recorded at 0009:488–496). | Add definer `app.fee_scheme_lock(p_id int)` as `ticket_type_lock` does; grant to `gems_app`; add to the T-RLS-005 definer list. |
| R2 | Major | The part guard cannot set `updated_*` itself (no column grant; the diff refuses it). | Part guard runs `update app.fee_scheme set name = name`; `fee_scheme_guard` stamps `updated_*`; the diff excludes `name`, `valid_*`, `updated_*` and is taken before the stamp. |
| R3 | Major | Approval and retirement have no "nothing else changes" rule. | `to_jsonb` diff on both transitions (0028:40–43 pattern). |
| R4 | Major | Branch constraint names and the permission errcode are missing. | Name each branch; a missing permission raises 42501 (Forbidden, audited DENIED). |
| R5 | Major | `assignScheme` has no audit action, target type or id. | `fee.concession.assign`, `fee_scheme_assignment`, reserved id; add to `AUDIT_CATALOGUE` and the T-AUD-009 scans. |
| R6 | Major | The assignment id is not reserved by the app. | Reserve with `nextval` in the pre-flight; the guard never sets `id`. |
| R7 | Major | Part FK delete rule unstated; CASCADE would make the part guard raise. | ON DELETE RESTRICT; `deleteScheme` deletes the parts first. |
| R8 | Minor | The deferred "given" check raises at COMMIT. | Map errors inside and around `scopedAction`. |
| R9 | Minor | Register and `schemesFor` authorization unstated. | Register needs `student.view`; `concessionCentres` = `fee.concession` ∩ `student.view`; `schemesFor` needs `student.view`. |
| R10 | Nit | View casts. | Keep `::numeric(14,2)`; add `concession` as the last outer column. |
| R11 | Nit | "Amount stamped regardless" is untestable as the app. | Assert 42501 as the app, or supply it as admin. |
| R12 | Nit | T-RLS-002 wording and sorted list. | Reword; insert the new tables in sort order. |
| R13 | Nit | Fixture ids abbreviated. | Full UUIDs; step up both scheme sessions. |
