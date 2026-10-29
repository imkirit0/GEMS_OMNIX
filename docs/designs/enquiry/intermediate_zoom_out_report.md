# EGM Stage 8: Intermediate zoom-out report (enquiry)

- **Target:** `docs/designs/enquiry/enquiry.md` (commit `a26d0b6`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context). It read the design, the brief, the step 5–7 reports and the zoom-out standard. In the code it read:
  - `action.ts`, `people.ts`, `admission-form.ts`, `catalogue.ts`, `admin-http.ts`, `rate-limit.ts`, `details.ts`, `rbac.ts`, `exports.ts` and the ticket engine;
  - migrations 0009–0012;
  - the foundation, audit, fixtures and admission-screens tests, the admit page and `ci.sh`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major, 8 Nit** (I1–I12); no OWNER items; DD-1…DD-15 stand. Verdict: still the simplest design. Three step-7 resolutions could not be built as written, one broke DD-6, one was half applied, and about a dozen statements were superseded.
- **Held up:**
  - Enroll reuses `admit()`.
  - The composite FKs exist (0011).
  - The resubmit order holds.
  - The definer and immutable patterns are reused from 0009, the masters from 0012.
  - The T-RLS-002, T-RLS-005 and T-AUD-009 gates are understood correctly.
  - The lock order adds no deadlock.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Major | `onFailure` cannot call `rate_take`; a rate hit inside the action is rolled back; C5 and D3 contradicted | Pre-flight `withScope` with `limitSearch`; the duplicate throw audited FAILED via `onFailure`, as admit's `PossibleDuplicate` |
| I2 | Nit | `nextval` inside the action cannot set the audit `targetId` | `nextval` in the pre-flight; explicit id on insert |
| I3 | Major | The D5 status trigger forbade renaming the Enrolled row (DD-6) and blocked re-seeding | One check constraint `kind <> 'ENROLLED' or (code = 'ENROLLED' and active)`; no trigger |
| I4 | Major | D16 half applied (functions, list and home link still needed `view`) | Back to C1: `view` everywhere, and a test asserts every `manage` role holds `view` |
| I5 | Major | About a dozen superseded or duplicated statements | Technical Plan replaced by one merged text |
| I6 | Nit | The P0001 mapper is dead code once every write locks first | Dropped; guards tested by direct SQL |
| I7 | Nit | The DENIED row named `student.admit` | `Forbidden.permission`, set by `authorize()` |
| I8 | Nit | Two rules for finding a write's centre | Every write takes `centreId`; the lock filters on it |
| I9 | Nit | Only courses kept an unchanged inactive reference | One rule for every reference |
| I10 | Nit | `(centre_id, id)` index redundant | Dropped |
| I11 | Nit | Two status refusals indistinguishable; no reason on (de)activate | `enquiry.setup.keep` key; reason required; literal actions |
| I12 | Nit | Inconsistent own-field messages; nationality pre-fill | `detailField` texts; `DEFAULT_NATIONALITY` |

## Resolution

**Status: resolved (2026-10-29).** The Technical Plan was replaced by the reviewer's merged text, which applies all of steps 5–8. No owner decision was needed.
