# Admission screens (Stage 3, first piece)

*   **Author:** gtm
*   **Status:** Approved for build by the design owner on 2026-10-29, after the EGM review (steps 5–9); built the same day (evidence E-037). The design owner decided DD-1…DD-3 and accepted DD-4…DD-8 on 2026-10-29; DD-9 and DD-10 came from EGM step 5 ([`zoom_out_report.md`](zoom_out_report.md)), DD-11 from step 6 ([`comprehension_report.md`](comprehension_report.md)), DD-12…DD-15 from step 7 ([`critic_report.md`](critic_report.md)), DD-16 and the revisions of DD-11, DD-12 and DD-14 from step 8 ([`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md)). Build approval follows the EGM review (steps 5–9).
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
| Scope | The centres where the caller holds a permission: `app.scoped_centre_ids(permission)` | migration 0011 |
| Match key | `app.person_match_key(given, family, dob, mobile)`, the duplicate-detection key | migration 0011 |
| MPA post | A form post made before Next's client runtime has loaded (a plain multipart POST) | Next.js docs |
| R-, T-, D-, NP- ids | Requirements, tests, open decisions, numbering policies | `docs/audit/` (02, 09, 04) |

## The Problem

1.  **No way to admit a learner.** Centres cannot use the rebuilt system for their main daily task; `admit()` is reachable only from tests.
2.  **No way to find or view learners.** `getPerson()` exists, but there is no list or search (R-001, R-229).
3.  **The duplicate check needs a choice the user makes.** When `admit()` reports a likely duplicate, the user must decide "this is the same person" (admit them again at this centre) or "this is a new person". Neither the existing POST-and-redirect pattern (which loses typed values, `app/tickets/create/route.ts`) nor putting the values in the URL (which would leak mobile numbers and dates of birth into history and logs) fits.

## Goals

Each goal is met when the tests named in brackets pass in `bash scripts/ci.sh`.

*   **G1: A holder of `student.admit` at a centre admits a learner** with name, gender, date of birth and mobile (both required on this form, DD-14), email, academic year, admission date and one to three courses, and then sees the Admission No and Register Nos on the learner's page [T-ADM-001].
*   **G2: Likely duplicates are shown before anything is written,** and the user either admits the existing person or confirms a new one, without retyping and without personal data in any URL [T-ADM-002].
*   **G3: Errors reach the user as field messages** (closed year, inactive course, invalid date) on the right input and course row, and as a form message for the rest (missing number series, a stale candidate), with the typed values kept [T-ADM-003].
*   **G4: The list and the view show only learners admitted at centres in the caller's `student.view` scope;** another centre's learner gives 404, as a missing one does [T-ADM-004, T-SEC-001].
*   **G5: The admit action refuses a cross-site or Origin-less POST; a resubmitted form never admits twice, and a person has at most one admission per centre and academic year** [T-ADM-005, T-ADM-006].
*   **G6: No search term or personal data reaches a URL** [T-ADM-004, smoke]; **the duplicate and already-submitted refusals are audited** [T-ADM-002, T-ADM-006].

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
| `/students` | List (GET: the newest 100) and search (POST, DD-13: `q`, `centreId` or both) admissions | `student.view` at some centre | `listAdmissions()` (new), the search action |
| `/students/new` | Admit a learner | `student.admit` at some centre | `admitOptions()` (new), the admit action |
| `/students/[personId]` | View a learner: identity, admissions, registrations | `student.view` where the person is admitted | `getPerson()` (two fields added) |

*   All three use `pageRead()`. **`pageRead()` gains one mapping:** `e instanceof PersonError && e.reason === "notfound"` becomes `notFound()`, as `TicketNotFound` already does (mapped directly; person-core's shared `NotFound` base class is deferred). Today it would surface as a 500, so G4 needs this change. Only reads let a `notfound` reach `pageRead()`; the admit action catches its own (below).
*   The home page gets an unconditional "Students" link, as "Tickets" is.

### Read Functions (`src/server/people.ts`)

```ts
export async function admitOptions(session: string | undefined): Promise<{
  centres: { id: number; code: string; name: string }[]; years: { code: string }[];
  courses: { code: string; name: string }[]; today: string }>;
export async function listAdmissions(session: string | undefined, f: { q?: string; centreId?: number }): Promise<{
  admissionId: string; personId: string; givenName: string; familyName: string | null;
  centreCode: string; academicYear: string; admissionNo: string; admittedOn: string }[]>;
export const istToday: () => string; // now exported (Asia/Kolkata, YYYY-MM-DD)
```

*   **`admitOptions`**, in the pattern of `raiseOptions()` (`src/server/tickets/engine.ts`): centres in `app.scoped_centre_ids('student.admit')`, open academic years, active courses ordered by code, `today = istToday()`. It throws `Forbidden` when that scope is empty, so `/students/new` answers 404.
*   **`listAdmissions`**: throws `Forbidden` when `app.scoped_centre_ids('student.view')` is empty (`/students` answers 404). Otherwise it returns one row per admission at a centre in that scope, `order by a.created_at desc`, `limit 100`; a person with two admissions appears twice.
    *   `q` arrives only from the search action (DD-13), never from the URL. It is trimmed. If, after removing spaces, dashes and a leading `+91` or `0`, it is 10 digits, it matches `person.mobile`. It also matches `admission_no` or a `register_no` case-insensitively, and `given_name` or `family_name` by `ilike <escaped q> || '%'` (`\`, `%` and `_` escaped, so the prefix search cannot become a contains search). No new index: the query scans the caller's admissions; an index on `lower(given_name)`, `lower(family_name)` and `mobile` is added when a measured search exceeds 1 s (`ponytail:` note in the code). `limitSearch(tx)` (`src/server/rate-limit.ts`; 30 per minute per user, PMC; T-SEC-015) runs only when `q` is non-empty, and the page catches `RateLimited` as the centre list does.
    *   `centreId` (from the search form only; the GET page takes no parameters) can only narrow the scope (a crafted one outside it gives an empty list, T-SEC-005). The mobile number is not shown in the list.
*   **Search action (DD-13):** `app/students/actions.ts` exports `searchAction(prev, formData)`: `pageRead((s) => listAdmissions(s, { q, centreId }))` with `q` and `centreId` read from the form data, returning `{ q, centreId, rows }`. It is a read, so no origin check of its own: a cross-site post cannot read the response, and Next already refuses a foreign Origin. The list page renders the GET rows; a small client component (`useActionState`) replaces them with the search result. A `RateLimited` result returns `{ rateLimited: true }` and the message "Too many searches. Wait a minute and try again."
*   **`getPerson`** as built, with `admissions[].centreCode: string` and `registrations[].courseName: string` added to its existing query (joins to `app.centre` and `app.course`).

### Admit Form (`/students/new`)

*   **`page.tsx`** (server) calls `admitOptions()` and generates `admissionId = randomUUID()`, as `app/tickets/new/page.tsx` does for `ticketId`; it passes both to the form component.
*   **`form.tsx`** (`"use client"`, `useActionState`), like `app/tickets/new/upload.tsx`. Inputs use `defaultValue={state.values[name]}`. Before hydration the browser posts it as a multipart form and the server re-renders the page with the returned state. No new CSP source: the existing nonce and `'strict-dynamic'` cover Next's runtime.
*   **Inputs** (names in brackets): centre `centreId` (select, preselected when there is one), academic year `academicYear` (select of open years), admission date `admittedOn` (`<input type="date">`, default `today`), given name `givenName` (required), family name `familyName`, gender `gender` (select with an empty choice), date of birth `dateOfBirth` (required, DD-14), mobile `mobile` (required, DD-14), email `email`; three course rows `course.<n>.courseCode` (select of "CODE Name"), `course.<n>.joinDate`, `course.<n>.endDate` for n = 1…3 (DD-7); hidden `admissionId` (DD-10) whose value is **`state.admissionId`**, never the page prop directly (an MPA post re-renders `page.tsx`, which generates a new UUID; only the state carries the posted one).
*   **Button order:** the main "Admit" submit button is the **first** submit button in the form; the duplicate list is rendered after it, so Enter in a text field (HTML implicit submission) never links to a candidate. A test checks the order.
*   **Duplicate list:** rendered inside the same `<form>`, after the main button, when `state.candidates` is set. Each candidate has `<button name="existingId" value={id}>Admit this person</button>`; one more `<button name="confirmNew" value={candidateIds.join(",")}>None of these: admit as a new person</button>`, carrying the ids that were shown. The typed values are re-posted from the kept inputs. `admit()` accepts the new person only when every current match is among those ids (so a user can only dismiss candidates they were shown); otherwise it throws the new `PossibleDuplicate`. With `existingId`, `admit()` ignores the typed identity fields: the existing person's record is unchanged and the view shows its stored identity.

### The Admit Action

```ts
type AdmitFormState = {
  values: Record<string, string>;      // the known input names only (not $ACTION_* or extra fields)
  admissionId: string;                 // echoed from the posted form data; new only when the page reloads
  fieldErrors: Record<string, string>; // by input name, e.g. "course.2.courseCode"
  formError?: string;
  candidates?: Candidate[];            // from PossibleDuplicate
  savedPersonId?: string;              // AdmissionExists, when visible in student.view scope
};
// app/students/new/actions.ts ("use server"), the thin action; prev is ignored:
export async function admitAction(prev: AdmitFormState, formData: FormData): Promise<AdmitFormState> {
  const r = await pageRead(async (s) => submitAdmission(s, await headers(), formData));
  if ("redirect" in r) redirect(r.redirect);
  return r;
}
// src/server/admission-form.ts, a plain function covered by vitest (tests pass new Headers({ origin, host })):
export async function submitAdmission(session: string, h: Headers, formData: FormData): Promise<AdmitFormState | { redirect: string }>;
```

*   Initial state (from the page): `{ values: {}, admissionId: <the page's UUID>, fieldErrors: {} }`.
*   **`submitAdmission` steps:**
    1.  `hasOrigin(h)` (below); false throws `Forbidden`, so an Origin-less post gets the 404 page.
    2.  Map the form to `AdmitInput` (`admissionId` is passed as posted; `admit()` validates it, I9):
        *   an empty string means absent: `gender`, `email`, `familyName`, `course.<n>.endDate` → `null`/omitted; `dateOfBirth` and `mobile` empty → `fieldErrors` "required", **only when `existingId` is absent** (DD-14; with `existingId` the identity inputs are ignored; `admit()` itself keeps them optional for the migration and legacy rows);
        *   `centreId` empty → `fieldErrors.centreId = "required"`, else `Number()`;
        *   a course row is empty when its course, join date and end date are all empty, and is dropped; a partial row is kept (join date has no default) and its errors shown; all rows empty → `fieldErrors["course.1.courseCode"] = "required"`; a row-index map remembers which form row each `courses[i]` came from;
        *   `confirmNew` is split on commas into the dismissed ids (`AdmitInput.confirmNew: string[]`, I4); absent means none; `existingId` is passed as given.
    3.  Call `admit()` and map the outcome:
        *   success → `{ redirect: "/students/<personId>" }` (post-redirect-get; a 303 before hydration, a client-side navigation after);
        *   `PossibleDuplicate` → state with `candidates`;
        *   `PersonError` `invalid` → its structured `field` and `rule` (D14: `PersonError` gains `readonly field?: string; readonly rule?: string`, set by the existing `invalid()` helper; the message is unchanged): the field, through the row-index map (`courses[0].courseCode` → `course.<n>.courseCode`), picks the input, and the rule is shown as is (e.g. "no such course", one message for inactive and missing courses); an error with no field (`number already issued`, `inconsistent reference`, `malformed value`) goes to `formError`, and so does field `admissionId` ("Reload the form and try again");
        *   `PersonError` `notfound` (only from a stale `existingId`) → `formError` "That person can no longer be linked; choose again";
        *   `SeriesMissing` (Admission or Register series) → `formError` "Numbering is not set up for this; contact the head office";
        *   `AdmissionExists` (no payload) → one fresh `withScope` read `select person_id from app.admission where id = $admissionId and centre_id = any (app.scoped_centre_ids('student.view'))`, the only place that scope rule lives; `formError` "This form was already saved; nothing new was admitted", plus `savedPersonId` in the state when the read found the person, which the form shows as a link to that learner (DD-11/DD-12); nothing is named when it did not;
        *   `PersonError` field `admission` rule `already admitted at this centre this year` (DD-16) → `formError` "Already admitted at this centre this year";
        *   a lost connection (`isConnectionLost(e)`, `src/server/db.ts`): only a loss during COMMIT reaches here, since `withScope` retries one before COMMIT → `formError` "The connection dropped. Submit again; this form cannot admit twice.", with the values and the same `admissionId` (DD-14; no recheck, I2);
        *   anything else is thrown and shown by `app/error.tsx` with its reference digest only (T-SEC-012).
*   The values travel only in the POST body and the returned state, never in a URL (G2). An expired session during submit redirects to `/login?error=expired` and loses the typed values (accepted; the redirect cannot carry them).

### Origin Check

*   **Next owns the foreign-Origin case.** Next 16.4 compares a Server Action's Origin host with `x-forwarded-host` or `host` and, on a mismatch or `Origin: null`, aborts before our code runs (an error response, `dist/server/app-render/action-handler.js`); `allowedOrigins` stays unset. But it **lets a request with no Origin header through** with a warning (`serverActions.md`).
*   **Our check closes only the missing-Origin gap.** `src/server/auth/http.ts` gains `hasOrigin(h: Headers): boolean` = `origin` present and not `"null"`, used by the admit action only (by the time our code runs, Next has matched the host; repeating that comparison could only disagree with it behind a proxy). False throws `Forbidden`, so the post gets the 404 page.
*   **`sameOrigin(req)` for route handlers is unchanged** (it compares the full origin, scheme included, with `req.url`), so the existing routes and their tests are untouched.

### Order of Checks in `admit()`

1.  Validation before the transaction, as today, plus the `admissionId` format (`invalid("admissionId", "invalid")`; the id is lower-cased first; a missing id keeps today's random one, for tests and the migration).
2.  `authorize(student.admit, centreId)` (inside `scopedAction`).
3.  **The form lock and existence check (DD-10):** `pg_advisory_xact_lock(hashtext(${"admit-form:" + admissionId}))` (key built in TypeScript, as the match-key lock is), then `select 1 from app.admission where id = $1` under plain RLS; a hit throws `AdmissionExists`. Two submits of one form queue on this lock, so the second sees the first's committed row instead of meeting its own learner as a `PossibleDuplicate` (`tests/people.test.ts` shows that path for two *different* forms). It runs before the catalogue checks, so a resubmit after the year closed still reports "already saved". (`ponytail:` the form lock shares the one-argument key space with the match-key lock; a hash collision only makes two unrelated admits wait.)
4.  Year open, then courses active (catalogue design).
5.  Match key, the existing advisory lock, `findMatches()`: matches not all in `confirmNew` → `PossibleDuplicate`; or, with `existingId`, the link check.
6.  Numbering and inserts, the admission with `id = admissionId`.

Lock order is always form lock, match-key lock, then the series rows, so there is no inversion. `AdmissionExists` is `class AdmissionExists extends Error {}` in `people.ts`. `personDb()` maps two unique violations: 23505 on `admission_pkey` (an id used where the caller's RLS cannot see it, or a concurrent submit at the very end) to `AdmissionExists`, and 23505 on `admission_person_centre_year_key` (DD-16) to `invalid("admission", "already admitted at this centre this year")`.

### One Admission per Person, Centre and Year (DD-16)

*   Migration `0014_admission_unique` adds `unique (person_id, centre_id, academic_year)` on `app.admission` (`@@unique([personId, centreId, academicYear], map: "admission_person_centre_year_key")` in the schema). After a reload (new form id), "Admit this person" on the learner just saved now ends at this key instead of a second admission. A further course at the same centre and year belongs on the existing admission (a later piece).
*   **Migration framework:** the admission rule rejects a row whose person (after MERGED resolution) already has an imported admission at the same centre and year (`admission: already admitted at this centre this year`); the P8 fixture gains such a pair, and all three rules move to version 3 (`people.ts` is hashed with every rule). Real legacy data may hold such pairs; their treatment is a D-MIG-4 question, and the rejects are listed in the exceptions file.

### Audit of Refusals (DD-15)

*   `admit()` passes an `onFailure` hook to `scopedAction` (the hook the ticket engine uses) that writes `person.admit` with outcome FAILED for two refusals only: `PossibleDuplicate` (reason `duplicate`, detail `{ candidates: [ids] }`, no names or dates) and `AdmissionExists` (reason `already_submitted`, detail `{ admissionId }`). Other validation refusals stay unaudited, as today.
*   Opening a learner's page is not audited until the audit-read decision (T-AUD-010).

### Action Files

*   `app/students/new/actions.ts` exports only `admitAction`, and `app/students/actions.ts` only `searchAction`; no inline `"use server"` closures (every export of a `"use server"` file is a public endpoint, and a closure would encrypt its captured values into the page). A test lists the exports of every `actions.ts` under `app/` and fails on any other name.

### Admit Implies View (DD-9)

*   G1 redirects to the learner's page, which needs `student.view`. **Rule (PMC under D-SEC-1):** every role holding `student.admit` also holds `student.view`. The fixtures' `student_admin` role and the `system_admin` role (granted every permission by migration 0013) already do. A test asserts the rule over every role in `app.role_permission` after migrations and `tests/fixtures.ts`. Enforcing it in `rbac_set_role_permissions` waits for D-SEC-1.

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-ADM-001 | `submitAdmission` with a valid form as `student.admit` at centre A (one empty course row); the DD-9 rule over all roles | Redirect to `/students/<personId>`; `getPerson` shows the Admission No, Register Nos, centre code and course names; rule holds |
| T-ADM-002 | Admit a learner at centre A; then submit the same identity at centre A2 (another centre in scope); edit the DOB after the list appears and press "None of these"; check the submit-button order | State with the candidate (name, family name, DOB; no mobile); `existingId` adds an admission at A2 to that person, identity unchanged; `confirmNew` with the shown ids creates a second person; an edited identity with new matches returns the new list; the main button is first; one `person.admit` FAILED row with reason `duplicate` and candidate ids; no URL carries the values |
| T-ADM-003 | Closed year, inactive course on row 2, bad date, empty DOB and mobile (with and without `existingId`), missing Register series, stale `existingId`, a lost connection (injected) | Field errors on the right inputs (`course.2.courseCode: no such course`, `dateOfBirth: required` only without `existingId`), form errors for the rest, `values` echoed (known names only); lost connection: the "submit again" message with the same `admissionId` |
| T-ADM-004 | List and view as centre B's user, crafted `centreId`, malformed person id; search (action) by Admission No, Register No, name start, mobile, and `a%` | B's learners only; crafted filter gives an empty list; malformed and out-of-scope ids give 404; no mobile in the list; `%` matched literally; the search term never appears in a URL |
| T-ADM-005 | Real server: multipart action post with the action id from the rendered form and a valid session, with (1) a foreign Origin, (2) no Origin, (3) the same Origin | (1) no 2xx or 3xx (Next refuses it), (2) 404, both with no admission or audit row; (3) 303 to `/students/<id>` |
| T-ADM-006 | The same `admissionId` submitted twice in turn, concurrently, and as a real MPA post; an id used at centre B, by a user holding only a ticket role at B; the same person admitted again at the same centre and year with a new form; `actions.ts` exports | Second submit: "already saved" with a link to the first learner, one admission only, one `already_submitted` FAILED row; the centre-B id: the same message, no link; same centre and year: "Already admitted at this centre this year"; only the two action names are exported |

## Decisions

1.  **DD-1: Existing fields only.** The form collects what `admit()` takes today; more person fields come by a later expand migration (design owner, 2026-10-29).
2.  **DD-2: Unstyled pages** until a design system is chosen (design owner, 2026-10-29).
3.  **DD-3: No documents** in this piece (design owner, 2026-10-29).
4.  **DD-4: The admit form submits to a Server Action** that returns the typed values and any candidates to the page, so the duplicate choice needs no retyping and no personal data enters a URL. The rest of the app keeps route handlers (design owner, 2026-10-29).
5.  **DD-5: No edits after save.** A wrong admission is corrected by a later R-095 ticket (D-ADM-3's proposed default: identity and contact fields via ticket only). *Superseded for contact and family details by learner-details DD-10 (2026-10-29): those are edited directly; identity stays ticket-only.*
6.  **DD-6: The list searches by Admission No, Register No, name start and mobile,** at most 100 rows, under the existing search rate limit; it never shows the mobile.
7.  **DD-7: A plain select of active courses** per course row, three rows.
8.  **DD-8: The admission date defaults to today (Asia/Kolkata)** and is not checked against the academic year's dates (catalogue DD-6).
9.  **DD-9: Admit implies view.** Every role with `student.admit` also holds `student.view` (PMC under D-SEC-1; design owner, 2026-10-29, Z3).
10. **DD-10: Resubmit guard.** The form's hidden `admissionId` becomes the admission's primary key; a repeat redirects to the existing learner instead of admitting twice (design owner, 2026-10-29, Z12).
11. **DD-11: A used `admissionId` the caller cannot see names no one:** the message is shown without a link (design owner, 2026-10-29, C4; merged with DD-12 at step 8).
12. **DD-12: A reused form says so on the form:** "This form was already saved; nothing new was admitted", with a link to the learner when the caller may see them; no redirect and no URL flag (design owner, 2026-10-29, D4; revised at step 8, I10).
13. **DD-13: Search posts.** The list's search term and centre filter travel only in a Server Action's POST body; the GET page shows the newest 100 (design owner, 2026-10-29, D7).
14. **DD-14: A lost connection says "submit again", and date of birth and mobile are required on the form** for a new person, so the duplicate check always runs for screen admissions (PMC under D-ADM-3; `admit()` keeps them optional for migrated rows). The resubmit guard makes "submit again" safe, so there is no recheck (design owner, 2026-10-29, D8; revised at step 8, I2).
15. **DD-15: The duplicate and already-submitted refusals are audited** as `person.admit` FAILED (`duplicate`, `already_submitted`); other refusals and page views are not, until T-AUD-010 (design owner, 2026-10-29, D12).
16. **DD-16: One admission per person, centre and academic year,** enforced by a unique key (PMC under D-ADM-4; design owner, 2026-10-29, I5).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| D-ADM-2 | Admissions + MIS | When an admission "counts" | Counted on save; nothing here reports counts |
| D-ADM-3 | PRO | Edits after save | None (DD-5) |
| D-ADM-4 | Admissions + MIS | What creates the record | Record on save; one per person, centre and year (DD-16) |
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
*   **Cons:** A refresh of that page would offer to re-post the form; post-redirect-get avoids that prompt (the DD-10 guard would refuse the repeat anyway).
*   **Reason for Rejection:** DD-9 keeps the redirect to the learner's page.

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| A Server Action is a new request path | A missed check (origin, session, scope) | Next refuses a foreign Origin; `hasOrigin()` refuses a missing one; session and authorisation through `pageRead()` and `admit()` | T-ADM-005 |
| Next ignores URL-encoded action posts | A naive cross-origin test passes without reaching the check | T-ADM-005 posts multipart with the real action id taken from the rendered form, plus a same-origin control | T-ADM-005 |
| ~1,200 options in a select | Slow to pick | Accepted for the first version; native type-to-jump; division/category filters later (R-150.01) | none |
| A centre user sees candidates' names and dates of birth | Personal data shown for a duplicate check | Only persons admitted in the caller's own `student.admit` scope (person-core DD-1); no mobile shown | T-ADM-002 |
| A role with `student.admit` but not `student.view` | Admits, then cannot see the result | DD-9 rule, asserted on the seeded roles; enforcement waits for D-SEC-1 | T-ADM-001 |
| No edits after save | A typo stays until R-095 exists | Accepted (DD-5) | none |
| Session expires while the form is open | Typed values lost on submit | Accepted: the login redirect cannot carry them | none |
| Search scans the caller's admissions | Slow search as admissions grow | Accepted until a measured search exceeds 1 s; then the name and mobile indexes | none |
| A centre user who has only a non-student role at another centre | Could learn that a form id exists there | The only person lookup uses the `student.view` scope; without it the message names nothing | T-ADM-006 |
| Legacy data with two admissions of one person at one centre and year | Rejected by the migration (DD-16) | Listed in the exceptions file; D-MIG-4 decides | P8 |

## Detailed Implementation Plan

Written against the code at EGM step 9 ([`implementation_readiness_report.md`](implementation_readiness_report.md)). Each phase ends with `bash scripts/ci.sh` exit 0.

### A1 Documents

1.  `docs/audit/09-test-strategy-and-acceptance-criteria.md`: after T-CAT, `### T-ADM: admission screens (docs/designs/admission-screens/admission-screens.md)` with T-ADM-001…006 from the Tests table, condensed, in the T-PER format.
2.  Matrix tests column: R-150 (`matrix-03-academics-general1.tsv`) gains `T-ADM-001,T-ADM-002,T-ADM-003,T-ADM-005,T-ADM-006`; R-001 and R-229 (`matrix-01-shell.tsv`) gain `T-ADM-004`.
3.  Regenerate and commit `docs/audit/02-requirements-traceability-matrix.csv` and `docs/requirements/FRD-GEMS-OMNIX.md` (`build_matrix.py`, `build_frd.py`; `ci.sh` diff-checks both).

### A2 Server (with the tests that cover it)

4.  `prisma/migrations/0014_admission_unique/migration.sql`: `CREATE UNIQUE INDEX "admission_person_centre_year_key" ON "app"."admission"("person_id", "centre_id", "academic_year");` (the form `prisma migrate diff` generates); `prisma/schema.prisma` `Admission`: `@@unique([personId, centreId, academicYear], map: "admission_person_centre_year_key")`, `@@index([personId])` kept. Check with the drift gate locally.
5.  `src/server/people.ts`:
    *   `PersonError` gains `readonly field?: string, readonly rule?: string`; `invalid(field, rule)` passes them; every refusal named here is built with `invalid()` (`invalid("admissionId", "invalid")`, `invalid("admission", "already admitted at this centre this year")`), one rule text shared with the ETL.
    *   `export const istToday`; `export class AdmissionExists extends Error { override name = "AdmissionExists"; }`.
    *   `personDb`: 23505 on `admission_pkey` → `AdmissionExists`; 23505 on `admission_person_centre_year_key` → the DD-16 `invalid()`.
    *   `AdmitInput` gains `admissionId?: string; confirmNew?: string[]`. `admit()` lower-cases and validates `admissionId`, validates `confirmNew` as an array of strings; first in the callback the form lock `pg_advisory_xact_lock(hashtext(${"admit-form:" + admissionId}))` and `select 1 as ok from app.admission where id = ${admissionId}::uuid` → `AdmissionExists`; the duplicate rule becomes `matches.some((m) => !confirmNew.includes(m.id))`.
    *   The `onFailure` hook (fifth `scopedAction` argument): `PossibleDuplicate` → `{ reason: "duplicate", candidates: ids }`, `AdmissionExists` → `{ reason: "already_submitted", admissionId }`, anything else → no row. The row's `target_id` is the person id `admit()` would have used (never created for a fresh identity); documented in the comment.
    *   `getPerson`: `c.code as "centreCode"` (join `app.centre`), `'courseName', co.name` (join `app.course`); `PersonView` updated.
    *   `admitOptions()` and `listAdmissions()` as in [Read Functions](#read-functions-srcserverpeoplets): `Prisma.sql` fragments as in `tickets/engine.ts`; `admission_no`/`register_no` by `lower(x) = lower(q)`; mobile through `identityField("mobile", q)` in a try; LIKE escape `q.replace(/[\\%_]/g, "\\$&") + "%"`; a non-integer `centreId` → `[]`; `order by a.created_at desc, a.id desc limit 100`; `limitSearch(tx)` only for a non-empty `q`.
6.  `src/server/page-read.ts`: `|| (e instanceof PersonError && e.reason === "notfound")` in the 404 mapping.
7.  `src/server/auth/http.ts`: `export const hasOrigin = (h: Headers) => { const o = h.get("origin"); return o !== null && o !== "null"; };`.
8.  `src/server/admission-form.ts` (new; imports nothing from `page-read.ts` or `next/*`, so vitest can load it): `AdmitFormState`, `FORM_NAMES` (the identity, year, centre and date names and `course.{1..3}.{courseCode,joinDate,endDate}`), `submitAdmission()` with the steps above. Mapping edge cases: any mapping field error returns without calling `admit()`; an error on a field with no input (`courses`, `confirmNew`) goes to `formError`. It catches `PossibleDuplicate`, `PersonError`, `SeriesMissing`, `AdmissionExists` and `isConnectionLost(e)`, and rethrows everything else (`ScopeError`, `Forbidden`).
9.  Migration framework: `etl/rules/admission.ts` DD-16 check in the result loop (after survivor grouping, in source-key order): key `survivor|centre|year`; a repeat rejects person and admission with `{ field: "academic_year", message: "already admitted at this centre this year" }`; the survivor is always first in its group, so it is never the rejected row. All three rules move to `version: 3` (`people.ts` is hashed with every rule).
10. `etl/fixture.ts`: pin the merge pairs to different centres (Meera and Rahul rows `KL2-25`, Nair and second-Rahul rows `KL3-07`, by spread after `pick()`, so the random stream is unchanged); append two "Vani Das" rows (same identity, `TN1-03`, 2026-27) at the end.
11. `tests/etl.test.ts`: `rule centre v3: …`; Vani persons `["IMPORTED", "REJECTED"]`, admissions `[null, "academic_year: already admitted at this centre this year"]`, the second row's registration `admission_key: admission not imported`. Seeds unchanged.
12. Existing tests: `tests/people.test.ts` T-PER-001 re-admits `first` in `2027-28` (DD-16); `confirmNew: true` at the duplicate tests becomes `[p.personId]` / `[a.personId]`, and the chained-years test admits by `existingId`; the "no audit row" assertion after `PossibleDuplicate` becomes the FAILED `duplicate` row with `candidates`. `tests/catalogue.test.ts` input helper drops `confirmNew` (its learners have no DOB, so no match key).
13. `tests/admission-screens.test.ts` (new): `beforeEach(reset)`; `new Headers({ origin: "http://localhost", host: "localhost" })`; a `form(obj)` → `FormData` helper.
    *   T-ADM-001: `sa`, rows 2–3 empty → redirect; `getPerson` numbers, `centreCode`, `courseName`; DD-9 rule (admit roles minus view roles empty, and at least one admit role); `admitOptions` contents; `Forbidden` for `T.uA`.
    *   T-ADM-002: person Y seeded at A with the edited DOB; the A2 steps as `sr`; FAILED row exact.
    *   T-ADM-003: closed year; rows 1 valid, 2 empty, 3 inactive → `course.3.courseCode`; bad date; empty DOB and mobile with and without `existingId`; an extra `$ACTION_X` field not echoed; the REGISTER series row deleted → `formError`; stale `existingId`; no Origin → `Forbidden`; lost connection: a deferred constraint trigger on `app.admission` for `admitted_on = 2001-01-01` that calls `pg_terminate_backend(pg_backend_pid())` at COMMIT (`withScope` does not retry that) → the "submit again" message, same `admissionId`, 0 admissions; trigger dropped in `finally`, the same state resubmitted → redirect.
    *   T-ADM-004: role assignments inserted in the test: `sb` plus `tk_raiser` at A still sees only B (list and view); a learner "Anu…" in scope and `q = "a%"` does not return them; an in-scope `centreId` returns rows, an out-of-scope one `[]`; exact row keys (no `mobile`); a 31st search → `RateLimited`.
    *   T-ADM-006: sequential and `Promise.all` resubmits (one admission, one `already_submitted` row, `savedPersonId`); `sa` reusing an id saved by `sb` (primary-key path) → message, no link; `sa` plus `tk_raiser` at B reusing it (existence-check path) → message, no link; same person, centre and year with a new form id → "already admitted at this centre this year".

### A3 Pages

14. `app/students/new/actions.ts` (`"use server"`, only `admitAction`); `page.tsx` (`pageRead(admitOptions)`, `randomUUID()`, initial state); `form.tsx` (`"use client"`, `useActionState`, `import type` for server types, hidden `admissionId` from the state, "Admit" first, then `formError`, the `savedPersonId` link and the candidates).
15. `app/students/actions.ts` (`"use server"`, only `searchAction`; `RateLimited` → `{ rateLimited: true }`); `search.tsx` (client); `page.tsx` (`listAdmissions(s, {})`, columns Admission No, name, centre, year, date, each linking to the learner).
16. `app/students/[personId]/page.tsx`: `pageRead((s) => getPerson(s, personId))`; identity, then admissions and registrations.
17. `app/page.tsx`: a "Students" link before "Tickets".
18. `tests/admission-screens.test.ts`: the exports test reads every `app/**/actions.ts` as text (importing would pull in `next/headers`) and asserts the exported names are exactly `admitAction` and `searchAction`.

### A4 Smoke and evidence

19. `scripts/smoke-security.mjs` seeds a category, division, course `SMKC`, academic year `2026-27`, the REGISTER and ADMISSION series and a role with `student.view` and `student.admit` at the smoke centre A; a learner at the smoke centre B by SQL. Then:
    *   404 parity: `/students/<own>` 200; `/students/<B's>`, `/students/<random uuid>`, `/students/not-a-uuid` 404 and identical after normalisation;
    *   T-ADM-005: one `post(origin)` builder: GET `/students/new`, copy every hidden `$ACTION_…` input and `admissionId` (HTML-decoded), the same fields; (1) foreign Origin → 500 (Next's refusal), (2) no Origin → 404, (3) same Origin → 303 to `/students/<uuid>`; then exactly one admission and no `person.admit` row but the OK one;
    *   the same body re-posted → 200 with "already saved", still one admission;
    *   a duplicate post → the candidate button exists and the "Admit" button comes first in the HTML;
    *   no `Location` header carries a name or mobile; `/students` has no `method="get"` search form.
20. Evidence: E-037 (CI output, one row per mutation check below); `docs/STATUS.md`; design status "built".

### Mutation Checks

| Mutation | File | Test that must fail |
|---|---|---|
| No form lock | `people.ts` | T-ADM-006 concurrent |
| No existence check | `people.ts` | T-ADM-006 sequential |
| No `admission_pkey` mapping | `people.ts` | T-ADM-006 primary-key path |
| No DD-16 mapping | `people.ts` | T-ADM-006 same centre and year |
| 0014 and `@@unique` removed | migration, schema | T-ADM-006 same centre and year (SQL alone: drift gate) |
| `confirmNew` ignored when non-empty | `people.ts` | T-ADM-002 edited identity |
| Failure hook returns nothing | `people.ts` | T-ADM-002, T-ADM-006, T-PER-002 |
| `hasOrigin` always true | `auth/http.ts` | T-ADM-003 no Origin, smoke T-ADM-005 (2) |
| No `PersonError` 404 mapping | `page-read.ts` | smoke 404 parity |
| `student.view` filter dropped | `listAdmissions` | T-ADM-004 |
| LIKE not escaped | `listAdmissions` | T-ADM-004 `a%` |
| `centreId` ignored | `listAdmissions` | T-ADM-004 filter |
| No `limitSearch` | `listAdmissions` | T-ADM-004 31st search |
| Compacted row index | `admission-form.ts` | T-ADM-003 `course.3` |
| All form entries echoed | `admission-form.ts` | T-ADM-003 known names |
| DOB required with `existingId` | `admission-form.ts` | T-ADM-003 |
| No lost-connection branch | `admission-form.ts` | T-ADM-003 lost connection |
| Saved-person read by `visible_centre_ids` | `admission-form.ts` | T-ADM-006 existence-check path |
| ETL DD-16 check removed | `etl/rules/admission.ts` | P8 |
| Candidates before "Admit" | `form.tsx` | smoke button order |
| Extra export in an `actions.ts` | `app/students/actions.ts` | exports test |
| `courseName` join dropped | `getPerson` | T-ADM-001 |

*Drafted with EGM (draft step followed manually)*
