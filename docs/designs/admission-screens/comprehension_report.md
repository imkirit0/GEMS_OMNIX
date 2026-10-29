# EGM Stage 6: Comprehension report (admission screens)

- **Target:** `docs/designs/admission-screens/admission-screens.md` (commit `a129d34`, after step 5).
- **Reviewer:** `egm-comprehension` (fresh context, naive reader). Also read `people.ts`, `page-read.ts`, `auth/http.ts`, `rate-limit.ts`, `numbering.ts`, `action.ts`, `tickets/engine.ts`, `app/tickets/new`, `app/centres`, `app/error.tsx`, migrations 0011–0012, `tests/fixtures.ts`, the tests' Request builders, Next's `action-handler.js`, the person-core design.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 13 Major, 8 Nit** (C1–C21); 1 OWNER (C4). Verdict: well argued, but not buildable without guessing the contracts; none needs a redesign.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Major | `submitAdmission(session, formData)` has no headers for the origin check | Signature `submitAdmission(session, h: Headers, formData)`; the action passes `await headers()` |
| C2 | Major | A header-only `sameOrigin` would refuse every existing route test (no `host` header) | `sameOriginHeaders(h, fallbackHost?)`; `sameOrigin(req)` passes `new URL(req.url).host`; scheme not compared. Verified in `auth/http.ts:12-15` |
| C3 | Major | Check order in `admit()` contradicted the code | "Order of Checks" section: validation, authorise, `admissionId` lookup, year, courses, duplicates, numbering |
| C4 | Major, OWNER | Concurrent loser cannot read the winner's person; RLS hides another centre's admission | **Owner: neutral message (DD-11).** `personDb` maps `admission_pkey` 23505 to `AdmissionExists(null)`; one fresh scoped read decides redirect or neutral message |
| C5 | Major | `PersonError("notfound")` from a stale `existingId` would become a 404 | `submitAdmission` catches it as a form message; only reads reach `pageRead`'s mapping |
| C6 | Major | Form-state contract missing | `AdmitFormState` type, initial state, input-name keys |
| C7 | Major | User-facing text of `PersonError` messages unspecified | Split at the first `": "`; field part to the input via the row map, rest to `formError` |
| C8 | Major | Redirect owner ambiguous | The thin action calls `redirect()`; `submitAdmission` returns `{ redirect }` |
| C9 | Major | How duplicate buttons re-submit undefined | Buttons inside the same form (`name="existingId"`, `name="confirmNew" value="1"`); identity ignored with `existingId` |
| C10 | Major | Where `admissionId` is generated, and whether it survives round trips | `page.tsx` generates it; the state echoes it; empty refused |
| C11 | Major | Mapping of non-text fields (`Number("")`, empty rows, `confirmNew`) | Rules stated |
| C12 | Major | No mechanism for the 404s of `/students/new` and `/students` | `admitOptions` / `listAdmissions` throw `Forbidden` on an empty scope; signatures given |
| C13 | Major | Origin-failure response unstated; no-cookie post redirects to login first | Refused origin gives 404; T-ADM-005 uses a valid session in every case |
| C14 | Nit | List search semantics vague | `q` normalisation, case-insensitive numbers, order, row shape stated |
| C15 | Nit | New `getPerson` fields unnamed | `centreCode`, `courseName` |
| C16 | Nit | `SeriesMissing` listed as a field error in G3 | G3 reworded |
| C17 | Nit | 303 only before hydration; E-035 reference | Both reworded |
| C18 | Nit | DD-9 test target unclear | Every role after migrations and fixtures |
| C19 | Nit | Undefined ids; T-ADM tests not described | Terms rows added; Tests table T-ADM-001…006 |
| C20 | Nit | `pageRead` mapping style vs person-core's base class | Mapped directly; base class deferred |
| C21 | Nit | Session expiry mid-form unmentioned | Accepted, in Risks |

## Resolution

**Status: resolved (2026-10-29).** Owner decision: C4 → DD-11. All 21 applied.
