# Admission screens (Stage 3, first piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-3 and accepted DD-4…DD-8 on 2026-10-29; DD-9 and DD-10 came from EGM step 5 ([`zoom_out_report.md`](zoom_out_report.md)). Build approval follows the EGM review (steps 5–9).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source), INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its decision owner to sign). Statements in the Technical Plan without a class are PRO. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

Stage 2 built the person core (`admit()`, `getPerson()`, duplicate detection, Admission No and Register No) and the catalogue (courses, academic years), but no page calls them (person-core DD-3). This design adds the first three Stage 3 pages: **admit a learner**, **list admissions**, and **view a learner**. They are deliberately small: the fields `admit()` already takes, unstyled pages, no documents, no fees, no edits after save.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Person core | `person`, `admission`, `registration`; `admit()`, `getPerson()`, `findMatches()` | `docs/designs/person-core/person-core.md`, `src/server/people.ts` |
| Catalogue | `course`, `academic_year` and the masters | `docs/designs/catalogue-skeleton/catalogue-skeleton.md` |
| Likely duplicate | `admit()` throws `PossibleDuplicate(candidates)` when a person with the same match key is admitted at a centre in the caller's `student.admit` scope | person-core DD-1 |
| Server Action | A Next.js server function bound to a `<form action>`; before hydration the browser posts it as a normal multipart form (MPA) and a `redirect()` answers 303 | Next.js 16.4 (`node_modules/next/dist/docs`) |
| 404 parity | A record outside the caller's scope gives the same response as a missing one | T-SEC-001 |
| `pageRead()` | Runs a read with the session from cookies, inside the request context; `Forbidden` and not-found errors become 404 | `src/server/page-read.ts` |

## The Problem

1.  **No way to admit a learner.** Centres cannot use the rebuilt system for their main daily task; `admit()` is reachable only from tests.
2.  **No way to find or view learners.** `getPerson()` exists, but there is no list or search (R-001, R-229).
3.  **The duplicate check needs a choice the user makes.** When `admit()` reports a likely duplicate, the user must decide "this is the same person" (admit them again at this centre) or "this is a new person". Neither the existing POST-and-redirect pattern (which loses typed values, `app/tickets/create/route.ts`) nor putting the values in the URL (which would leak mobile numbers and dates of birth into history and logs) fits.

## Goals

Each goal is met when the tests named in brackets pass in `bash scripts/ci.sh`.

*   **G1: A holder of `student.admit` at a centre admits a learner** with name, gender, date of birth, mobile, email, academic year, admission date and one to three courses, and then sees the Admission No and Register Nos on the learner's page [T-ADM-001].
*   **G2: Likely duplicates are shown before anything is written,** and the user either admits the existing person or confirms a new one, without retyping and without personal data in any URL [T-ADM-002].
*   **G3: Errors reach the user as field messages** (closed year, inactive course, invalid date, missing number series), on the right course row, with the typed values kept [T-ADM-003].
*   **G4: The list and the view show only learners admitted at centres in the caller's `student.view` scope;** another centre's learner gives 404, as a missing one does [T-ADM-004, T-SEC-001].
*   **G5: The admit action refuses a cross-site or Origin-less POST, and a resubmitted form never admits twice** [T-ADM-005, T-ADM-006].

## Non-Goals

*   **Fields beyond `admit()`'s** (DD-1): address, guardian, qualification, previous marks (R-150.02, R-150.04) come in a follow-up; Aadhaar, religion, caste wait for D-SEC-4 (R-150.05).
*   **Styling** (DD-2): unstyled pages, as the ticket screens.
*   **Documents** (DD-3, R-150.06): wait for ADR-002 and D-SEC-5.
*   **Fees, schemes, discounts, batch** (R-150.01): Stage 4 and R-155.
*   **Edits after save** (DD-5): corrections are R-095 tickets, a later piece.
*   **Enquiry conversion** (R-081), a students export, an academic-year filter on the list, and the "Missing Fields" panel as client-side checking.

## Technical Plan (Architecture)

### Pages

| URL | Purpose | Needs | Reads / writes |
|---|---|---|---|
| `/students` | List and search admissions | `student.view` at some centre | `listAdmissions()` (new) |
| `/students/new` | Admit a learner | `student.admit` at some centre | `admitOptions()` (new), the admit action |
| `/students/[personId]` | View a learner: identity, admissions, registrations | `student.view` where the person is admitted | `getPerson()` (two fields added) |

*   All three use `pageRead()`. **`pageRead()` gains one mapping:** `PersonError` with reason `notfound` becomes `notFound()`, as `TicketNotFound` already does. Today it would surface as a 500, so G4 needs this change (person-core assigned it to Stage 3).
*   The home page gets an unconditional "Students" link, as "Tickets" is; `/students` answers 404 to a user without `student.view`.

### Admit Form (`/students/new`)

*   **Options** (`admitOptions(session)`, new in `people.ts`, in the pattern of `raiseOptions()` in `src/server/tickets/engine.ts`): centres where the caller holds `student.admit` (`app.scoped_centre_ids('student.admit')`), open academic years, active courses (code and name, ordered by code). A caller with no such centre gets 404.
*   **Fields:** centre (select, preselected when there is one), academic year (select of open years), admission date (`<input type="date">`, default `istToday()`, exported from `people.ts`), given name (required), family name, gender (select), date of birth (date), mobile, email; **three course rows** (course select, join date, end date); a hidden `admissionId` (a fresh UUID per rendered form, DD-10).
*   **Course picker** (DD-7): a plain `<select>` per row listing every active course as "CODE Name". About 1,200 options is acceptable for a native select, which supports typing to jump.
*   **Client component:** the form is one small `"use client"` component (`useActionState`), like `app/tickets/new/upload.tsx`. Before hydration it still works: the browser posts it as a multipart form and the page re-renders with the returned state. No new CSP source: the existing nonce and `'strict-dynamic'` cover Next's runtime.

### The Admit Action

*   **Thin action.** The `"use server"` function is three lines: `pageRead((s) => submitAdmission(s, formData))`. `pageRead()` already reads the session cookie, sets the request context (request id, client IP) and maps `Forbidden` and not-found to 404.
*   **`submitAdmission(session, formData)`** (new, `src/server/admission-form.ts`) checks the origin, maps the form to `AdmitInput`, calls `admit()` and returns either a redirect path or the form state. It is a plain function, so vitest covers it without a running server.
*   **Form mapping rules:**
    *   an empty string means "absent" (HTML sends `""` for empty fields; `identityField()` and `courses()` would refuse `""`);
    *   empty course rows are dropped, and a row-index map turns `admit()`'s `courses[i]` errors back into the form row's number;
    *   `existingId` or `confirmNew` come from the button pressed in the duplicate list.
*   **Outcomes:**
    *   success: `redirect()` (303) to `/students/<personId>` (post-redirect-get, so a refresh never re-posts);
    *   `PossibleDuplicate`: the state carries the typed values and the candidate list (given name, family name, date of birth, as `findMatches()` returns them), each with "Admit this person" (re-submits with `existingId`), plus "None of these: admit as a new person" (re-submits with `confirmNew`);
    *   `PersonError`: the state carries the values and the field message, on its form row;
    *   `SeriesMissing` (Admission or Register series): one neutral message, "Numbering is not set up for this; contact the head office";
    *   `AdmissionExists` (DD-10): redirect to the person who already has that admission;
    *   anything else is thrown and shown by `app/error.tsx` with its reference digest only (T-SEC-012).
*   The values travel only in the POST body and the action's returned state, never in a URL (G2).

### Origin Check

*   Next 16.4 checks a Server Action's Origin host against `x-forwarded-host` or `host`, but **lets a request with no Origin header through** with a warning (`dist/server/app-render/action-handler.js`; `serverActions.md`). That is weaker than the app's rule.
*   `src/server/auth/http.ts` gains `sameOriginHeaders(h: Headers)`: it rejects a missing Origin, and compares the Origin with the request's host (`x-forwarded-host` only when `TRUST_PROXY_HEADERS=1`, the rule `clientIp` follows). The existing `sameOrigin(req)` delegates to it, so routes and the action share one rule (T-AUTH-016). `submitAdmission()` calls it first and throws `Forbidden` on a mismatch.

### Resubmit Guard (DD-10)

*   `AdmitInput` gains an optional `admissionId` (a UUID; anything else gives `PersonError("invalid", "admissionId: invalid")`). `admit()` uses it as the admission's primary key instead of a random one.
*   First thing inside the action's transaction, `admit()` reads `select person_id from app.admission where id = $admissionId`; a hit throws `AdmissionExists(personId)` before the duplicate check or any numbering. The primary key is the backstop for two concurrent submits: the loser's unique violation on `admission_pkey` also becomes `AdmissionExists`.

### Admit Implies View (DD-9)

*   G1 redirects to the learner's page, which needs `student.view`. **Rule (PMC under D-SEC-1):** every role holding `student.admit` also holds `student.view`. The fixtures' `student_admin` role and the system administrator (E-035) already do; a test asserts the rule over all seeded roles. Enforcing it in `rbac_set_role_permissions` waits for D-SEC-1.

### List (`/students`)

*   `listAdmissions(session, { q?, centreId? })`, new in `people.ts`: admissions at centres in `scoped_centre_ids('student.view')`, newest first, at most 100 rows, joined to the person (given and family name) and the centre code.
*   `q` matches the Admission No or a Register No exactly, or the start of the given or family name (case-insensitive), or the mobile's last ten digits. Each search calls the existing `limitSearch(tx)` (`src/server/rate-limit.ts`; 30 per minute per user, PMC; T-SEC-015), and the page catches `RateLimited` as the centre list does.
*   `centreId` can only narrow the scope (a crafted one outside it gives an empty list, T-SEC-005). The mobile number is not shown in the list.

### View (`/students/[personId]`)

*   `getPerson()` as built, plus two fields in its existing query: the admission's centre code and each registration's course name.
*   Shows the identity fields, then each admission in scope (centre code, year, Admission No, date) with its registrations (course code and name, Register No, status, dates).

## Decisions

1.  **DD-1: Existing fields only.** The form collects what `admit()` takes today; more person fields come by a later expand migration (design owner, 2026-10-29).
2.  **DD-2: Unstyled pages** until a design system is chosen (design owner, 2026-10-29).
3.  **DD-3: No documents** in this piece (design owner, 2026-10-29).
4.  **DD-4: The admit form submits to a Server Action** that returns the typed values and any candidates to the page, so the duplicate choice needs no retyping and no personal data enters a URL. The rest of the app keeps route handlers (design owner, 2026-10-29).
5.  **DD-5: No edits after save.** A wrong admission is corrected by a later R-095 ticket (D-ADM-3's proposed default: identity and contact fields via ticket only).
6.  **DD-6: The list searches by Admission No, Register No, name start and mobile,** at most 100 rows, under the existing search rate limit; it never shows the mobile.
7.  **DD-7: A plain select of active courses** per course row, three rows.
8.  **DD-8: The admission date defaults to today (Asia/Kolkata)** and is not checked against the academic year's dates (catalogue DD-6).
9.  **DD-9: Admit implies view.** Every role with `student.admit` also holds `student.view` (PMC under D-SEC-1; design owner, 2026-10-29, Z3).
10. **DD-10: Resubmit guard.** The form's hidden `admissionId` becomes the admission's primary key; a repeat redirects to the existing learner instead of admitting twice (design owner, 2026-10-29, Z12).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| D-ADM-2 | Admissions + MIS | When an admission "counts" | Counted on save; nothing here reports counts |
| D-ADM-3 | PRO | Edits after save | None (DD-5) |
| D-ADM-4 | Admissions + MIS | What creates the record | Record on save |
| D-STU-5 | Admissions/PRO | Merging duplicate persons | The user can only link to an existing person or create a new one |
| D-SEC-1 | IT/Ops | Role matrix | Admit implies view (DD-9) |
| D-SEC-4 | IT + Legal | Sensitive fields | Not collected |
| NP-1…8 | Numbering owners | Number formats shown after save | As built |

## Alternatives Considered

### Alternative A: Route Handler and Redirect, as the Ticket Screens

*   **Pros:** One pattern across the app; `adminPost()` already maps errors.
*   **Cons:** A redirect cannot carry the typed values except in the URL or a server-side draft; the duplicate choice would need retyping, or personal data in the URL.
*   **Reason for Rejection:** G2 (DD-4).

### Alternative B: Server-Side Draft Table

*   **Pros:** Keeps route handlers; values survive a redirect.
*   **Cons:** A new table holding unsaved personal data, with expiry, RLS and cleanup.
*   **Reason for Rejection:** More to secure than the native Server Action state (DD-4).

### Alternative C: Client-Side Form With a JSON Endpoint

*   **Pros:** Richest interaction (live search of courses, inline duplicate check).
*   **Cons:** Needs JavaScript, a JSON API with its own CSRF and error handling, and contradicts DD-2's harness-style screens.
*   **Reason for Rejection:** Not needed for the first version.

### Alternative D: Show the Result in the Action State

*   **Pros:** No redirect; works for a role without `student.view`.
*   **Cons:** A refresh of that page re-posts the form; post-redirect-get is what prevents a second admission.
*   **Reason for Rejection:** DD-9 and DD-10 keep the redirect.

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| A Server Action is a new request path | A missed check (origin, session, scope) | One origin rule for routes and the action, stricter than Next's; session and authorisation through `pageRead()` and `admit()` | T-ADM-005 |
| Next ignores URL-encoded action posts | A naive cross-origin test passes without reaching the check | T-ADM-005 posts multipart with the real action id taken from the rendered form, plus a same-origin control | T-ADM-005 |
| ~1,200 options in a select | Slow to pick | Accepted for the first version; native type-to-jump; division/category filters later (R-150.01) | none |
| A centre user sees candidates' names and dates of birth | Personal data shown for a duplicate check | Only persons admitted in the caller's own `student.admit` scope (person-core DD-1); no mobile shown | T-ADM-002 |
| A role with `student.admit` but not `student.view` | Admits, then cannot see the result | DD-9 rule, asserted on the seeded roles; enforcement waits for D-SEC-1 | T-ADM-001 |
| No edits after save | A typo stays until R-095 exists | Accepted (DD-5) | none |

## Detailed Implementation Plan

Outline; the full plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| A1 Documents | T-ADM-001…006 in audit 09; matrix links on R-150, R-001, R-229 |
| A2 Server | `pageRead()` not-found mapping; `sameOriginHeaders()`; `admit()` `admissionId` and `AdmissionExists`; `getPerson()` fields; `admitOptions()`, `listAdmissions()`, export `istToday()`; `src/server/admission-form.ts` |
| A3 Pages | `/students`, `/students/new` (form component and thin action), `/students/[personId]`, home link |
| A4 Tests and evidence | vitest for `submitAdmission()`, the list and the guard; smoke-security additions (404 parity, multipart cross-origin and Origin-less action posts with a control, no personal data in URLs, error digest only); mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
