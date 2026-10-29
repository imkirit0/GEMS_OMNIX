# EGM Stage 8: Intermediate zoom-out report (admission screens)

- **Target:** `docs/designs/admission-screens/admission-screens.md` (commit `0b339d9`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context). Also read the three earlier reports, `people.ts`, `action.ts`, `db.ts`, `page-read.ts`, `auth/http.ts`, `rate-limit.ts`, `tickets/engine.ts`, `tickets/handlers.ts`, `app/centres`, `app/tickets/new`, migration 0011, Next's `action-handler.js`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 5 Major, 7 Nit** (I1–I12); OWNER on I2, I5, I10. Verdict: architecture still fits G1–G6; review rounds left overlapping resubmit and lost-connection mechanisms; the fixes make the design smaller. Both server actions are needed (DD-13 rules out a GET search).

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Major | Two scoped lookups for one job; nullable `AdmissionExists` payload | `admit()` checks existence only; one `student.view`-scoped read in `submitAdmission`; `AdmissionExists` without payload |
| I2 | Major, OWNER | Lost-connection recheck repeats the guard and its "Not saved" can be false (only COMMIT-time losses reach it) | **Owner: drop the recheck (DD-14 revised):** "Submit again; this form cannot admit twice"; DOB/mobile stay required |
| I3 | Major | Our host comparison repeats Next's and can disagree behind a proxy | `hasOrigin(h)` (Origin present and not `null`) only; Risks row fixed |
| I4 | Major | `shownIds` check had no owner (`confirmNew` is a boolean) | `AdmitInput.confirmNew: string[]` (dismissed ids) carried by the button; `admit()` checks it |
| I5 | Major, OWNER | After a reload, "Admit this person" re-admits the learner just saved at the same centre and year | **Owner: one admission per person, centre and year (DD-16):** unique key (migration 0014), form message, ETL rule v3 rejects such rows |
| I6 | Nit | Two-integer lock namespaces force a change to tested code | `hashtext('admit-form:' || id)`, match-key lock unchanged, `ponytail:` note |
| I7 | Nit | Search action carried an origin check and wrapper a read does not need | `pageRead((s) => listAdmissions(...))` only |
| I8 | Nit | Two centre filters (GET and form) | Form field only; GET page takes no parameters |
| I9 | Nit | `admissionId` validated twice, one error on a hidden input | `admit()` validates; field `admissionId` → form message |
| I10 | Nit, OWNER | `?saved=again` brings back a URL flag | **Owner: message on the form (DD-11/DD-12 merged)** with a link when visible |
| I11 | Nit | Required DOB/mobile on the `existingId` path? | Only without `existingId` |
| I12 | Nit | Stale text (Alternative D, G6 wording, Risks row 1) | Reworded |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: I2 → DD-14 revised, I5 → DD-16, I10 → DD-11/DD-12 revised. All twelve applied.
