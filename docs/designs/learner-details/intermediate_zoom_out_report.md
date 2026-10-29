# EGM Stage 8: Intermediate zoom-out report (learner details)

- **Target:** `docs/designs/learner-details/learner-details.md` (commit `493c448`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context). Read the design, the three reports, `people.ts`, `admission-form.ts`, `action.ts`, `etl/canonical.ts`, `etl/run.ts`, the rule imports, `app/students/**`, migration 0011, `AUTH_ENC_KEY` use in `auth/index.ts`.
- **Date:** 2026-10-29
- **Result:** **1 Blocker, 3 Major, 6 Nit** (I1–I10); OWNER on I1 and I2. Verdict: right size; the authorisation layering (`authorize` for DENIED rows, `assertAdmittedAt` binding the audited centre, RLS against direct SQL) is justified; three rounds added mechanism that does not earn its keep.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Blocker, OWNER | DD-13's refusal fires on every re-admission of a learner with details: "Admit this person" resends the filled form (required fields passed, nationality defaulted) | **Owner: save if none, otherwise ignore, with a visible note in the duplicate list (DD-13 revised)** |
| I2 | Major, OWNER | Fingerprints of low-entropy values are reversible with the key, so the log still holds recoverable data; nothing reads them; first src→etl import | **Owner: field names only (DD-14 revised);** fingerprints, HKDF and their risk row removed |
| I3 | Major | Detail code and PMC lists in the hashed set would bump the rules on every list edit (undoing Z3); `PERSON_POLICY` and `CODE_RULE` are imported by no rule | `person-rules.ts` = exactly what the rules import; detail code unhashed until a rule maps details |
| I4 | Major | `DETAIL_KEYS` placed in two files; a client component importing `people.ts` would pull Prisma into the bundle | One `src/server/details.ts`, importing only `person-rules.ts`; `details-fields.tsx` imports only it |
| I5 | Nit | The `existingId` insert did not take the person lock | Same `for no key update` lock |
| I6 | Nit | T-LD-002 cases and expectations did not line up; the D4 check was masked by DD-11 | Case → expected pairs; D4 tested through `detailsFrom` in T-LD-001 |
| I7 | Nit | A `details` field error from `admit()` would show with its prefix | `submitAdmission` maps it to `formError` |
| I8 | Nit | D16's "echo `\"\"` too" conflicts with the existing echo | Render only from the state; an absent value is empty |
| I9 | Nit | Stale wording (G2, DD-11 title, Risks row) | Reworded |
| I10 | Nit | The admit audit's detail field unnamed and untested | `detailFields`, asserted in T-LD-001 |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: I1 → DD-13 revised, I2 → DD-14 revised. All ten applied.
