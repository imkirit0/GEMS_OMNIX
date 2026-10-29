# EGM Stage 5: Zoom-Out report (admission screens)

- **Target:** `docs/designs/admission-screens/admission-screens.md`, full file (commit `3e15dc4`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Also read the brief, `people.ts`, `admin-http.ts`, `page-read.ts`, `safe-route.ts`, `auth/http.ts`, `centres.ts`, `rate-limit.ts`, `catalogue.ts`, `tickets/engine.ts`, `csp.ts`, `proxy.ts`, `app/centres`, `app/tickets/new`, `app/page.tsx`, `app/error.tsx`, migration 0011, the person-core design, and Next 16.4.2 (`dist/server/app-render/action-handler.js`; docs `serverActions.md`, `data-security.md`, `forms.md`, `redirect.md`).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 5 Major, 9 Nit** (Z1–Z14); 2 OWNER (Z3, Z12). Verdict: approve after the Majors; no redesign needed. DD-4 (Server Action) judged the right choice over Alternatives B and C.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | `pageRead()` maps only `Forbidden` and `TicketNotFound`; `getPerson()`'s `PersonError("notfound")` would give 500, not 404 (G4 fails) | `pageRead()` maps `PersonError` notfound to `notFound()` (A2). Verified in `page-read.ts` |
| Z2 | Major | `sameOrigin(req)` needs a `Request` the action does not have; Next lets an Origin-less action through | `sameOriginHeaders(h)` rejects a missing Origin; `sameOrigin(req)` delegates; design text on Next corrected |
| Z3 | Major, OWNER | Redirect target needs `student.view`, which an admit-only role lacks | **Owner: admit implies view (DD-9),** PMC under D-SEC-1, asserted on seeded roles |
| Z4 | Major | Action plumbing re-invented `pageRead()`; action logic untestable without a server | Thin action `pageRead((s) => submitAdmission(s, formData))`; `submitAdmission()` in `src/server/admission-form.ts`, covered by vitest |
| Z5 | Major | Next ignores URL-encoded action posts, so a naive cross-origin test passes vacuously | T-ADM-005: multipart with the real action id, foreign and missing Origin, plus a same-origin control |
| Z6 | Nit | "Renders without client script" is wrong: `useActionState` needs a client component | Reworded: one small client component, works before hydration, no new CSP source |
| Z7 | Nit | Form-to-input mapping unnamed (`""` refused; dropped rows shift `courses[i]`) | Two mapping rules stated |
| Z8 | Nit | SeriesMissing message covered only the Admission series | One neutral message |
| Z9 | Nit | View needs centre code and course name that `getPerson()` does not return | Two fields added to the existing query |
| Z10 | Nit | `?admitted=` redundant and spoofable | Dropped |
| Z11 | Nit | Conditional home link costs a permission query | Unconditional link, as Tickets |
| Z12 | Nit, OWNER | No-JS double submit can admit twice | **Owner: add the guard (DD-10):** hidden `admissionId` as primary key, `AdmissionExists` |
| Z13 | Nit | Name existing helpers (`limitSearch`, `istToday`, `raiseOptions` pattern); `academicYear` filter in no goal | Named; `istToday()` exported; filter dropped |
| Z14 | Nit | Custom unexpected-error mapping duplicates `app/error.tsx` | Unexpected errors thrown; smoke check that only the digest shows |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: Z3 → DD-9, Z12 → DD-10. All fourteen applied; new goal G5 and test T-ADM-006; Alternative D (result in action state) recorded.
