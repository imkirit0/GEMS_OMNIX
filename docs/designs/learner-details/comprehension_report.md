# EGM Stage 6: Comprehension report (learner details)

- **Target:** `docs/designs/learner-details/learner-details.md` (commit `2863b32`, after step 5).
- **Reviewer:** `egm-comprehension` (fresh context, naive reader). Checked against `people.ts`, `admission-form.ts`, `action.ts`, `page-read.ts`, `app/students/**`, `etl/canonical.ts`, `etl/run.ts`, `etl/rules/*`, migration 0011, `tests/admission-screens.test.ts`, `tests/audit-catalogue.ts`, the admission-screens design.
- **Date:** 2026-10-29
- **Result:** **3 Blocker, 10 Major, 5 Nit** (C1–C18); 1 OWNER (C12), plus owner calls on C4 and C13. Verdict: sound approach, not buildable without the missing contracts.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Blocker | `Details` and `detailField` undefined | `DETAIL_KEYS`, `DetailKey`, `Details`, `detailField` signature |
| C2 | Blocker | Return shapes of `getPerson()` / `updateDetails()` missing; where `version` comes from | `PersonView.details`, `detailsVersion`, `editCentreId`; `updateDetails` returns `{ version, before, after }`; meta and audit detail stated |
| C3 | Blocker | Partial updates vs clearing; comparing before or after normalising | Absent = unchanged, `null` = clear; compared after `detailField` normalising |
| C4 | Major, OWNER | Required fields on the edit form? | **Owner: required once set (DD-11)** |
| C5 | Major | Validation order; a forged non-numeric `centreId` would reach SQL | Id, centre and version checked before the action (404) |
| C6 | Major | `existingId` with typed details | Neither validated nor written; required checks skipped |
| C7 | Major | The details insert vs RLS | Plain insert after the admission, no `returning`, version 1 |
| C8 | Major | The upsert | Insert with version 1, or update guarded by `version`; 0 rows = stale |
| C9 | Major | Edit form state, messages, error mapping | `DetailsFormState`, `submitDetails` signature; `Forbidden`/`notfound` not caught (404) |
| C10 | Major | Who may edit; ordering of "earliest" | `editCentreId` query stated; link iff not null; edit page 404 otherwise; needs view and admit |
| C11 | Major | `person-rules.ts` move incomplete; rule imports; hash list | Move list completed (`invalid`, `optText`, `istToday`…); rules import the new module; `HASHED_WITH_EVERY_RULE` named; v4 in the test |
| C12 | Major, OWNER | Contradicts admission-screens DD-5 (contact fields via ticket) | **Owner: supersede (DD-10);** admission-screens DD-5 and the page comment amended |
| C13 | Major, OWNER | Nationality list source and default | **Owner: all ISO codes, default IN (DD-12);** codes written out; `Intl` names tested |
| C14 | Nit | Z-ids and other references unexplained | Pointer to the step reports |
| C15 | Nit | Check predicates and rule strings imprecise | SQL predicates and the rule-string table |
| C16 | Nit | `permanentSame` behaviour | Unchecked on load; overwrites the permanent fields |
| C17 | Nit | Test and catalogue changes loosely named | T-ADM-006 expected list; T-AUD-009 catalogue entry |
| C18 | Nit | Unaudited `notfound` from `assertAdmittedAt` | Stated |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: C12 → DD-10, C4 → DD-11, C13 → DD-12. All 18 applied; the Technical Plan was rewritten with the contracts.
