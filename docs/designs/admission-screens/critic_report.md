# EGM Stage 7: Critic report (admission screens)

- **Target:** `docs/designs/admission-screens/admission-screens.md` (commit `b00d041`, after steps 5–6).
- **Reviewer:** `egm-design` (fresh context, adversarial). Also read `people.ts`, `action.ts`, `db.ts`, `page-read.ts`, `auth/http.ts`, `rate-limit.ts`, `numbering.ts`, `csp.ts`, `proxy.ts`, `next.config.ts`, `app/tickets/new/*`, `app/error.tsx`, migrations 0002, 0008, 0010, 0011, `scripts/smoke-security.mjs`, `tests/people.test.ts`, Next's `action-handler.js`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 8 Major, 7 Nit** (D1–D15); OWNER on D4, D7, D8, D12. Verdict: not ready before revision; D1–D3 contradicted by code, tests or Next.
- **Held up:** a `withScope` retry with the same `admissionId` is safe; lock order has no inversion; with a null match key a concurrent submit does end at `admission_pkey`; `notFound()`/`redirect()` from an action work for fetch and MPA posts; unexpected errors reach the client as a digest only; no personal data in audit detail or logs.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major | A concurrent double submit meets the match-key lock and ends as `PossibleDuplicate` of its own learner, not at `admission_pkey` (`tests/people.test.ts:74-78`, verified) | Form lock `pg_advisory_xact_lock(ADMIT_FORM, hashtext(admissionId))` before the lookup; match-key lock moves to its own namespace; lock order stated |
| D2 | Major | Next aborts a foreign-Origin action itself (error response), so T-ADM-005 case 1 cannot be 404 (`action-handler.js`, verified) | Case 1 expects no 2xx/3xx and no rows; design says Next owns it and our check closes the missing-Origin gap; `sameOrigin(req)` for routes left unchanged (also D11) |
| D3 | Major | The lookups ran under `visible_centre_ids()` (any permission), not `student.view` | Both lookups add `centre_id = any(scoped_centre_ids('student.view'))`; tickets-only case in T-ADM-006 |
| D4 | Major, OWNER | Back button + a new learner silently redirected to the old learner | **Owner: say so (DD-12):** `?saved=again` message and "Admit another" link |
| D5 | Major | "None of these" dismissed matches never shown after an edit | Hidden `shownIds`; `confirmNew` only when current matches ⊆ shown |
| D6 | Major | Enter could submit a candidate button first | Main submit button first; candidates after; tested |
| D7 | Major, OWNER | GET search puts names and mobiles in URLs | **Owner: POST search (DD-13)** via a search action; GET shows newest 100 with centre filter |
| D8 | Major, OWNER | Unknown commit outcome + reload + null match key = silent double admission | **Owner: recheck + required DOB/mobile on the form (DD-14)** |
| D9 | Nit | Hidden id must come from the state, not the re-rendered prop | Stated; MPA case in T-ADM-006 |
| D10 | Nit | `values` echoed every posted field | Known input names only |
| D11 | Nit | New rule dropped the scheme; `x-forwarded-host` may be a list | Routes keep `sameOrigin(req)` unchanged; first `x-forwarded-host` element |
| D12 | Nit, OWNER | Duplicate and already-submitted paths unaudited | **Owner: audit them (DD-15)** as `person.admit` FAILED via `onFailure`; views wait for T-AUD-010 |
| D13 | Nit | LIKE metacharacters unescaped; no indexes | Escaped; scan accepted with a 1 s ceiling (`ponytail:` note), indexes then |
| D14 | Nit | Field routing by parsing message strings | `PersonError` gains `field` and `rule` |
| D15 | Nit | Every `"use server"` export is an endpoint; closures encrypt captures | Only the two action exports; no inline closures; tested |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: D4 → DD-12, D7 → DD-13, D8 → DD-14, D12 → DD-15. All fifteen applied; goal G6 added.
