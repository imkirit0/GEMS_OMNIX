# Admission screens (Stage 3, first piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-3 and accepted DD-4…DD-8 on 2026-10-29; build approval follows the EGM review (steps 5–9).
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
| Server Action | A Next.js server function bound to a `<form action>`; works without client JavaScript (progressive enhancement) and returns state to the page | Next.js 16 |
| 404 parity | A record outside the caller's scope gives the same response as a missing one | T-SEC-001 |

## The Problem

1.  **No way to admit a learner.** Centres cannot use the rebuilt system for their main daily task; `admit()` is reachable only from tests.
2.  **No way to find or view learners.** `getPerson()` exists, but there is no list or search (R-001, R-229).
3.  **The duplicate check needs a choice the user makes.** When `admit()` reports a likely duplicate, the user must decide "this is the same person" (admit them again at this centre) or "this is a new person". Neither the existing POST-and-redirect pattern (which loses typed values, `app/tickets/create/route.ts`) nor putting the values in the URL (which would leak mobile numbers and dates of birth into history and logs) fits.

## Goals

Each goal is met when the tests named in brackets pass in `bash scripts/ci.sh`.

*   **G1: A holder of `student.admit` at a centre admits a learner** with name, gender, date of birth, mobile, email, academic year, admission date and one to three courses, and sees the Admission No and Register Nos [T-ADM-001].
*   **G2: Likely duplicates are shown before anything is written,** and the user either admits the existing person or confirms a new one, without retyping and without personal data in any URL [T-ADM-002].
*   **G3: Errors reach the user as field messages** (closed year, inactive course, invalid date, missing number series), with the typed values kept [T-ADM-003].
*   **G4: The list and the view show only learners admitted at centres in the caller's `student.view` scope;** another centre's learner gives 404, as a missing one does [T-ADM-004, T-SEC-001].

## Non-Goals

*   **Fields beyond `admit()`'s** (DD-1): address, guardian, qualification, previous marks (R-150.02, R-150.04) come in a follow-up; Aadhaar, religion, caste wait for D-SEC-4 (R-150.05).
*   **Styling** (DD-2): unstyled pages, as the ticket screens.
*   **Documents** (DD-3, R-150.06): wait for ADR-002 and D-SEC-5.
*   **Fees, schemes, discounts, batch** (R-150.01): Stage 4 and R-155.
*   **Edits after save** (DD-5): corrections are R-095 tickets, a later piece.
*   **Enquiry conversion** (R-081), a students export, and the "Missing Fields" panel as client-side checking.

## Technical Plan (Architecture)

### Pages

| URL | Purpose | Needs | Reads / writes |
|---|---|---|---|
| `/students` | List and search admissions | `student.view` at some centre | `listAdmissions()` (new) |
| `/students/new` | Admit a learner | `student.admit` at some centre | `admitOptions()` (new), `admit()` |
| `/students/[personId]` | View a learner: identity, admissions, registrations | `student.view` where the person is admitted | `getPerson()` |

All three use `pageRead()` (404 on `Forbidden`, login redirect on an expired session). The home page links to `/students` when the viewer holds `student.view` anywhere.

### Admit Form (`/students/new`)

*   **Options** (`admitOptions(session)`, new in `people.ts`): centres where the caller holds `student.admit` (`app.scoped_centre_ids('student.admit')`), open academic years, active courses (code and name, ordered by code). A caller with no such centre gets 404.
*   **Fields:** centre (select, preselected when there is one), academic year (select of open years), admission date (`<input type="date">`, default today in Asia/Kolkata), given name (required), family name, gender (select), date of birth (date), mobile, email; **three course rows** (course select, join date, end date); empty rows are ignored, at least one is required (`admit()` already says `courses: at least one`).
*   **Course picker** (DD-7): a plain `<select>` per row listing every active course as "CODE Name". About 1,200 options is acceptable for a native select, which supports typing to jump; no client script.
*   **Submit** goes to a **Server Action** (DD-4) that calls `admit()` and returns one of:
    *   success: redirect (303) to `/students/<personId>?admitted=<admissionNo>`; the Admission No is not personal data;
    *   `PossibleDuplicate`: the form is shown again with its values and a candidate list (given name, family name, date of birth, as `findMatches()` returns them), each with "Admit this person" (re-submits with `existingId`), plus "None of these: admit as a new person" (re-submits with `confirmNew`);
    *   `PersonError` (field errors from `admit()`), `SeriesMissing` ("Admission numbers for this academic year are not set up; contact the head office"), `Forbidden`: the form again with its values and one message.
*   The values travel only in the POST body and the action's returned state, never in a URL (G2).

### List (`/students`)

*   `listAdmissions(session, { q?, centreId?, academicYear? })`, new in `people.ts`: admissions at centres in `scoped_centre_ids('student.view')`, newest first, at most 100 rows, joined to the person (given and family name) and the centre code.
*   `q` matches the Admission No or a Register No exactly, or the start of the given or family name (case-insensitive), or the mobile's last ten digits. Each search takes one token from `app.rate_take` with the existing search limit (30 per minute per user, PMC; T-SEC-015), as the centre list does.
*   Filters can only narrow the scope (crafted `centreId` outside it gives an empty list, T-SEC-005).
*   The mobile number is not shown in the list (only on the view page).

### View (`/students/[personId]`)

*   `getPerson()` as built: 404 for a malformed id, a person not admitted in scope, or a missing one (G4).
*   Shows identity fields, then each admission in scope (centre, year, Admission No, date) with its registrations (course code and name, Register No, status, dates). `?admitted=` shows "Admitted: <Admission No>".

### Server Action Security

*   Next.js rejects a Server Action whose `Origin` does not match the host; the action additionally runs the existing `sameOrigin()` check on the request headers, so a cross-site POST is refused the same way as on every route handler (T-AUTH-016).
*   The action reads the session cookie itself, wraps the call in the request context (request id, client IP) as `safeRoute()` does, and maps unexpected errors to the generic message with a reference id (T-SEC-012).
*   No new CSP source: the page renders without client script; when Next's client runtime loads, it uses the existing per-request nonce.

## Decisions

1.  **DD-1: Existing fields only.** The form collects what `admit()` takes today; more person fields come by a later expand migration (design owner, 2026-10-29).
2.  **DD-2: Unstyled pages** until a design system is chosen (design owner, 2026-10-29).
3.  **DD-3: No documents** in this piece (design owner, 2026-10-29).
4.  **DD-4: The admit form submits to a Server Action** that returns the typed values and any candidates to the page, so the duplicate choice needs no retyping and no personal data enters a URL. The rest of the app keeps route handlers.
5.  **DD-5: No edits after save.** A wrong admission is corrected by a later R-095 ticket (D-ADM-3's proposed default: identity and contact fields via ticket only).
6.  **DD-6: The list searches by Admission No, Register No, name start and mobile,** at most 100 rows, under the existing search rate limit; it never shows the mobile.
7.  **DD-7: A plain select of active courses** per course row, three rows.
8.  **DD-8: The admission date defaults to today (Asia/Kolkata)** and is not checked against the academic year's dates (catalogue DD-6).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| D-ADM-2 | Admissions + MIS | When an admission "counts" | Counted on save; nothing here reports counts |
| D-ADM-3 | PRO | Edits after save | None (DD-5) |
| D-ADM-4 | Admissions + MIS | What creates the record | Record on save |
| D-STU-5 | Admissions/PRO | Merging duplicate persons | The user can only link to an existing person or create a new one |
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
*   **Cons:** The first client-rendered form; needs JavaScript, a JSON API with its own CSRF and error handling, and contradicts DD-2's harness-style screens.
*   **Reason for Rejection:** Not needed for the first version.

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| A Server Action is a new request path | A missed check (origin, session, scope) | Same `sameOrigin()`, session and `admit()` authorisation as every other write; a cross-origin POST test | T-ADM-005 |
| ~1,200 options in a select | Slow to pick | Accepted for the first version; native type-to-jump; division/category filters later (R-150.01) | none |
| A centre user sees candidates' names and dates of birth | Personal data shown for a duplicate check | Only persons admitted in the caller's own `student.admit` scope (person-core DD-1); no mobile shown | T-ADM-002 |
| No edits after save | A typo stays until R-095 exists | Accepted (DD-5); the admission can still be seen and reported | none |

## Detailed Implementation Plan

Outline; the full plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| A1 Documents | T-ADM-001…005 in audit 09; matrix links on R-150, R-001, R-229 |
| A2 Server | `admitOptions()`, `listAdmissions()` in `people.ts`; the Server Action |
| A3 Pages | `/students`, `/students/new`, `/students/[personId]`, home link |
| A4 Tests and evidence | page/action tests; smoke-security additions (404 parity, cross-origin action, no PII in URLs); mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
