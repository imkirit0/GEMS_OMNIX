# Learner details (Stage 3, second piece)

*   **Author:** gtm
*   **Status:** Approved for build by the design owner on 2026-10-29, after the EGM review (steps 5–9). The design owner decided DD-1…DD-3 and accepted DD-4…DD-9 on 2026-10-29. Step 5: [`zoom_out_report.md`](zoom_out_report.md); step 9: [`implementation_readiness_report.md`](implementation_readiness_report.md) (no new decisions); step 6: [`comprehension_report.md`](comprehension_report.md) (DD-10…DD-12); step 7: [`critic_report.md`](critic_report.md) (DD-13…DD-15, DD-9 revised); step 8: [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (DD-11, DD-13, DD-14 revised).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO; every fixed list below is PMC (a parameter until its owner signs). Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

The admission form (admission-screens design, E-037) collects only the identity fields Stage 2 had. This piece adds the learner's **contact and family details** (R-150.02): current and permanent address, pincode, nationality, blood group, employment status, academic qualification, and father, mother and guardian names, phones and occupations. They are entered on the admission form and **edited afterwards on the learner's page**, audited. Identity fields (name, date of birth, gender, mobile, email) stay correctable only by ticket (D-ADM-3).

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Identity fields | `person.given_name`, `family_name`, `gender`, `date_of_birth`, `mobile`, `email`; changed only by `changeIdentity()` (correction tickets) | person-core design, `src/server/people.ts` |
| Details | The fields of this design, in `app.person_detail` | this design |
| Admission form | `app/students/new`, `src/server/admission-form.ts` (`FORM_NAMES`, mapping, field errors by input name) | admission-screens design |
| Scope | `app.scoped_centre_ids(permission)` | migration 0011 |
| R-, D-, T-, NP- ids | Requirements, open decisions, tests, numbering policies | `docs/audit/` |

## The Problem

1.  **Centres cannot record how to reach a learner or their family.** Only mobile and email exist.
2.  **The legacy form requires some of these** (pincode, employment status, qualification: SRC, SPEC pp. 30–31), so the rebuilt form is incomplete for daily use.
3.  **Addresses change.** Without an edit path, a moved learner's address would wait for a correction ticket meant for identity errors.

## Goals

*   **G1: The admission form collects the details**, with pincode, employment status and qualification required for a new person (DD-6), in the same transaction as the admission [T-LD-001].
*   **G2: The learner's page shows the details, and a holder of `student.view` and of `student.admit` at a centre where the learner is admitted edits them;** every change is audited with the names of the changed fields (DD-14); a stale edit is refused [T-LD-002].
*   **G3: Details are visible exactly where the person is** (through an admission in the caller's scope) and never change identity fields [T-LD-003].
*   **G4: Every value is validated against its fixed list or format** in the app and the database [T-LD-004].

## Non-Goals

*   **Previous marks** (R-150.04), mother tongue, last school, state/district masters (R-150.05, R-033): a later piece (DD-1).
*   **The legacy "SMS mobile 1/2" and "contact no"** (R-150.02): the learner's own `mobile` exists; extra numbers wait for a need (design owner, Z7).
*   **Aadhaar, religion, caste, differently abled**: D-SEC-4.
*   **Masters with admin screens** for the lists (R-020, R-033): later (DD-2).
*   **Migrating legacy details:** the legacy columns are unknown until Stage 0; migrated persons simply have no detail row yet.
*   **Styling** (admission-screens DD-2).

## Technical Plan (Architecture)

Z-, C- and D- ids refer to the findings in [`zoom_out_report.md`](zoom_out_report.md) (step 5), [`comprehension_report.md`](comprehension_report.md) (step 6) and [`critic_report.md`](critic_report.md) (step 7).

### Data Model (migration `0015_person_detail`)

`app.person_detail`, one row per person at most (`person_id` primary key, foreign key to `person`, restrict):

| Column | Type | Named check `person_detail_<column>_check` |
|---|---|---|
| `current_address`, `permanent_address` | text, null | no leading or trailing JS-trim whitespace, no control characters except tab, newline and carriage return, `char_length` 1–500 (exact SQL in the Implementation Plan; no regex flag, locale-independent) |
| `current_place`, `permanent_place` | text, null | the same rule without inner controls, 1–100 |
| `current_pincode`, `permanent_pincode` | text, null | `col ~ '^[1-9][0-9]{5}$'` (Indian PIN) |
| `nationality` | text, null | `col ~ '^[A-Z]{2}$'` only: the database checks the format, the app checks the code against the list (Z2) |
| `blood_group` | text, null | `col in ('A+','A-','B+','B-','AB+','AB-','O+','O-')` |
| `employment_status` | text, null | `col in ('STUDENT','EMPLOYED','SELF_EMPLOYED','UNEMPLOYED','NOT_KNOWN')` (PMC; `NOT_KNOWN`, DD-15) |
| `qualification` | text, null | `col in ('BELOW_SSLC','SSLC','PLUS_TWO','DIPLOMA','DEGREE','POSTGRADUATE','OTHER','NOT_KNOWN')` (PMC; DD-15) |
| `father_name`, `mother_name`, `guardian_name` | text, null | trimmed, 1–100 |
| `father_occupation`, `mother_occupation`, `guardian_occupation` | text, null | trimmed, 1–100 |
| `father_phone`, `mother_phone`, `guardian_phone` | text, null | `col ~ '^[0-9]{10}$'` |
| `guardian_relation` | text, null | trimmed, 1–50 |
| `version` | int, not null, default 1 | optimistic lock (DD-8); a person without a row has version 0 |

*   **Why a separate table (DD-4):** the identity columns of `person` keep their only update path (`changeIdentity()`), their column grants and their match-key trigger.
*   **RLS (D1):** `select` as `person` (an admission of the person is visible). `insert` and `update` (`using` and `with check`) only where the caller holds **`student.admit` at a centre where the person is admitted**: `exists (select 1 from app.admission a where a.person_id = person_detail.person_id and a.centre_id = any (app.scoped_centre_ids('student.admit')))`. So a direct statement by a view-only user, or by an admitting user of another centre, changes nothing; `admit()` inserts details after the admission row in the same transaction, so its insert passes. No delete policy.
*   **Prisma model `PersonDetail`** in `schema.prisma` (the drift gate needs it), relation to `Person` with `onDelete: Restrict, onUpdate: Restrict` (D13); checks and policies stay hand-written in the migration.
*   **Grants** (`gems_app`): `select, insert`; `update` on every column except `person_id`.

### Types and Lists

```ts
// src/server/details.ts (I4): the lists, DETAIL_KEYS, Details and detailField in one file; imports only person-rules.ts
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const EMPLOYMENT_STATUSES = { STUDENT: "Student", EMPLOYED: "Employed", SELF_EMPLOYED: "Self-employed", UNEMPLOYED: "Unemployed", NOT_KNOWN: "Not known" };
export const QUALIFICATIONS = { BELOW_SSLC: "Below SSLC", SSLC: "SSLC", PLUS_TWO: "Plus Two", DIPLOMA: "Diploma", DEGREE: "Degree", POSTGRADUATE: "Postgraduate", OTHER: "Other", NOT_KNOWN: "Not known" };
export const COUNTRY_CODES: readonly string[]; // the 249 officially assigned ISO 3166-1 alpha-2 codes, written out
export const DEFAULT_NATIONALITY = "IN"; // DD-12
// (same file)
export const DETAIL_KEYS = ["currentAddress", "currentPlace", "currentPincode", "permanentAddress", "permanentPlace",
  "permanentPincode", "nationality", "bloodGroup", "employmentStatus", "qualification", "fatherName", "fatherOccupation",
  "fatherPhone", "motherName", "motherOccupation", "motherPhone", "guardianName", "guardianRelation", "guardianPhone",
  "guardianOccupation"] as const; // the 20 columns in camelCase; no version, no permanentSame
export type DetailKey = (typeof DETAIL_KEYS)[number];
export type Details = Record<DetailKey, string | null>;
export function detailField(k: DetailKey, v: unknown): string | null; // throws invalid(k, rule); k is also the input name
```

*   Country names come from `new Intl.DisplayNames(["en"], { type: "region" })`, computed on the server by `countryOptions()` and passed to the client as a prop, so server and browser render the same names (R7). `Intl` cannot list regions, so the codes are written out once, and a test asserts each has a display name other than itself (C13).
*   A test asserts the three short lists equal the database checks (by inserting each value and one outsider); nationality is excluded (format only in the database).

### Validation (`detailField`)

`v == null` → `null` (clears); a non-string → `invalid(k, "invalid")` (D2). Then: a lone surrogate (`/\p{Cs}/u`) or any C0 control or DEL character → `invalid(k, "invalid characters")`, except newline, carriage return and tab inside addresses (D8); trimmed; `""` → `null`; lengths counted in code points (`[...s].length`), as `char_length` counts (D9). Then:

| Keys | Rule string (shown to the user) |
|---|---|
| addresses | `1-500 characters` |
| places, names, occupations | `1-100 characters` |
| `guardianRelation` | `1-50 characters` |
| pincodes | `6 digits, not starting with 0` |
| phones | spaces, dashes and a leading `+91` or `0` removed, then `10 digits` |
| `nationality` | `a country code` (upper-cased, must be in `COUNTRY_CODES`) |
| `bloodGroup`, `employmentStatus`, `qualification` | `one of the listed values` |

### Admission Form (new person only)

*   **`AdmitInput.details?: Partial<Details>`.** `admit()` validates every given key with `detailField` before the transaction (field errors, nothing audited).
*   **With `existingId` (DD-13, revised at step 8):** the required checks are skipped (as admission-screens DD-14 does for `dateOfBirth` and `mobile`). Inside the transaction, after the link check: `select 1 from app.person where id = $1 for no key update` (the lock `updateDetails` takes, so a concurrent first edit queues; I5), then the detail row is read; when the person has none and any typed detail is non-null, they are inserted; when the person has one, the typed details are ignored. The duplicate list shows one line: "Details you typed are saved only if this learner has none yet; otherwise edit them on the learner's page", so nothing is dropped silently, and the redirect lands on that page with its Edit link.
*   **Insert:** after the admission insert, a plain `insert into app.person_detail (person_id, <given non-null columns>) values (…)` with no `returning` (version defaults to 1), skipped when every value is null (C7); it follows the admission so the insert policy (D1) and later reads pass. It runs inside `personDb()`, which maps 23514 on `person_detail_<column>_check` to `invalid(<key>, "invalid")` (D8), so a disagreement between app and database (T-LD-004 guards it) gives a field error, never a raw database error carrying the row. Creating details at admission is recorded in the `person.admit` audit as `detailFields: [keys written]` (asserted in T-LD-001), not as a `person.details.update` (D18, I10).
*   **Shared form parts (Z4):** `DETAIL_NAMES = [...DETAIL_KEYS, "permanentSame"]`, spread into `FORM_NAMES`; `detailsFrom(fd): Partial<Details>` in `admission-form.ts` (imports `details.ts` only for the keys) reads a detail key **only when the form posted it** (`fd.has(k)`: a posted `""` clears, an absent input leaves the stored value; D3) and, when `permanentSame` is checked, overwrites the three permanent fields with the current ones; `<DetailsFields values errors>` in `app/students/details-fields.tsx` renders the "Contact" and "Family" sections for both forms. The checkbox is unchecked on load (C16). Every detail `<select>` has an empty first option, so a stored `null` is posted back as `""`, not as the first list value (D4); the nationality select defaults to `IN` on the admit form only, through the page's initial state (`values.nationality`), never as a render fallback, so an emptied choice stays empty after an error (DD-12, R8). Once a state exists the form renders only from it, and an absent value is empty (the existing `values` echo stays as it is); stored values fill only the initial state (D16, I8). `app/students/details-fields.tsx` is a client component that imports only `src/server/details.ts` (no Prisma or `db` in the client bundle, I4). `submitAdmission` maps `field === "details"` to `formError = rule`, as `submitDetails` does (I7).
*   **Required (DD-6, DD-11):** `currentPincode`, `employmentStatus`, `qualification` → `fieldErrors[k] = "required"` when empty, on the admit form for a new person and on the edit form always.
*   Field errors reach their inputs through the existing mapping (`PersonError.field` equals the input name).

### Edit Path (DD-3, DD-7, DD-8, DD-10, DD-11)

*   **`PersonView` gains** `details: Details | null` (null without a row), `detailsVersion: number` (0 without a row) and `editCentreId: number | null` (C2). `editCentreId` = `select centre_id from app.admission where person_id = $id and centre_id = any (app.scoped_centre_ids('student.admit')) order by created_at, id limit 1`, read in `getPerson()`'s transaction. Since `getPerson()` needs `student.view`, editing needs both: `student.view` to see the person and `student.admit` at the edit centre (DD-9 of admission-screens already gives every admit role view) (C10).
*   **The view page** shows the details and an "Edit details" link iff `editCentreId !== null`. **The edit page** `/students/[personId]/details` calls `getPerson()` and `notFound()` when `editCentreId` is null; otherwise it renders the form pre-filled from `details`, with hidden `personId`, `centreId` and `version`.
*   **`updateDetails(session, personId, centreId, version, changes: Partial<Details>): Promise<{ version: number; changed: DetailKey[] }>`** (C2, C3, C5, C8):
    1.  Before the action: `personId` a UUID; `centreId` and `version` must match `/^\d+$/` before `Number()` (so `""`, `" 7 "` or `"1e0"` never become numbers; D12) and be safe integers; else `PersonError("notfound")` (a 404, no audit). Every key in `changes` through `detailField` (field errors, no audit). Keys absent from `changes` are left as they are; a key present with `null` clears it.
    2.  `scopedAction(session, { action: "person.details.update", permission: "student.admit", centreId, targetType: "person", targetId: personId }, fn, (r) => ({ fields: r.changed }))`, no `onFailure`. The audit row carries the changed field names only, no values (DD-14): the values live only in `person_detail`, where they can be corrected or erased. A centre without `student.admit` gives `Forbidden`, audited DENIED, a 404 on the page.
    3.  In the transaction: `assertAdmittedAt(tx, centreId, personId)` (a `notfound` here is not audited, as for `changeIdentity`'s callers, C18); `select 1 from app.person where id = $1 for no key update` (two first edits queue, Z5; does not block a concurrent new admission of the person, D10); read the detail row. Its `version` (0 without a row) ≠ `version` → `invalid("details", "changed since you opened them; reload the page")`. Changed keys = those whose normalised value differs from the stored one (all-null without a row); none → `invalid("details", "nothing to change")`.
    4.  The columns come only from `DETAIL_KEYS.filter((k) => k in changes)` through a fixed key→column table; no caller-supplied name reaches SQL (D11). No row: `insert` the changed keys with `version = 1`. A row: `update app.person_detail set <changed columns>, version = version + 1 where person_id = $1 and version = $v`; 0 rows → the stale error. Both run inside `personDb()` (D8). Return the new version and the changed keys.
*   **The form:** `saveDetailsAction(prev: DetailsFormState, fd)` in `app/students/[personId]/details/actions.ts`, the thin pattern of `admitAction`: `pageRead(async (s) => submitDetails(s, await headers(), fd))`, redirect on success.

```ts
export type DetailsFormState = { values: Record<string, string>; personId: string; centreId: string; version: string;
  fieldErrors: Record<string, string>; formError?: string };
export async function submitDetails(session: string, h: Headers, fd: FormData): Promise<DetailsFormState | { redirect: string }>;
```

*   `submitDetails`: `hasOrigin(h)` (else `Forbidden`); `detailsFrom(fd)` with all 20 keys (every input is posted, so an empty input clears); the required check (DD-11); `updateDetails(...)`; success → `{ redirect: "/students/<personId>" }`. `PersonError` `invalid` with `field === "details"` → `formError` = its rule; other fields → `fieldErrors`. It does **not** catch `Forbidden` or `PersonError("notfound")`, so `pageRead()` answers 404 (C9). A stale refusal keeps the posted `version`, so the message tells the user to reload.

### Visibility and Personal Data

*   Details are read only through `getPerson()`, so they follow its `student.view` scope and 404 parity.
*   Audit rows of `person.details.update` carry the changed field names only (DD-14). No details enter URLs, the audit log or exports; the database checks that could put a failing row into a database error are prevented by the app's own checks and mapped by `personDb()` (D8).
*   The audit row's `target_centre_id` is the edit centre; auditors at the learner's other centres see the change only through the person id (accepted, D15).

### Migration Framework (Z3, C11)

*   `src/server/person-rules.ts` (new) holds **exactly what the rules import** (I3): `PersonError`, `invalid` (now exported), `optText`, `istToday`, `isoDate`, `identityField`, `IDENTITY_KEYS`, `StoredIdentity`, `Identity`, `Gender`, `ACADEMIC_YEAR_RULE`, `academicYearOk`, `ADMITTED_THIS_YEAR`, `normCode`. It imports nothing from `./db`, `./action` or Prisma. `PERSON_POLICY` and `CODE_RULE` stay in `people.ts` (no rule imports them), and so does the detail code (`src/server/details.ts`, unhashed): PMC list edits must not bump the rules; a future rule that maps legacy details adds `details.ts` to the hash when it is written. `people.ts` re-exports everything, so app callers do not change.
*   The three rule files change their imports to `../../src/server/person-rules`; `etl/run.ts`, `etl/types.ts` and `etl/checks.ts` may keep importing from `people.ts` (they are not hashed). `HASHED_WITH_EVERY_RULE` (`etl/canonical.ts`) becomes `["src/server/person-rules.ts", "etl/ids.ts"]`, and the comment in `etl/run.ts` says so. All three rules move to version 4; `tests/etl.test.ts` expects `rule centre v4: …`. No rule maps details yet.
*   **Reset and preflight (D6):** `scripts/etl/reset.sql` truncates `app.person_detail` with `app.person` (Postgres refuses to truncate a referenced table alone), and the runner's preflight needs no change: `gems_etl` has no grant on the table, and the foreign key means an empty `person` implies an empty `person_detail` (R1). `tests/fixtures.ts` lists it in its truncate. A later legacy-details rule will need `gems_etl` grants and the table in the digest.

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-LD-001 | `submitAdmission` with details; with "same as current"; without the three required fields; with `existingId` for a learner without details; for one with details; the nationality default and an untouched blood-group select through `detailsFrom` | Row written with the admission (version 1) and `detailFields` in the `person.admit` audit; permanent copied; three `required` field errors; details saved; typed details ignored and the stored ones unchanged; `IN` and `null` (D4) |
| T-LD-002 | `submitDetails` as `student.admit` (and `student.view`) at the learner's centre, case → expected: a change → saved, version 2, one audit row with `fields` only; the same edit with the old `version` → stale form message; clearing an optional field → cleared; clearing a required field → `required`; `NOT_KNOWN` → accepted; the stored phone in another spelling → "nothing to change"; a post missing an input → that value kept; a view-only centre user (page and post) → 404; a forged `centreId` without `student.admit` there → 404 and DENIED; one with `student.admit` but no admission → 404, no audit row; `""` or `"1e0"` as `centreId` → 404 | as listed |
| T-LD-003 | Read and update as another centre's user; direct SQL as `gems_app`: a view-only user at the learner's own centre updating, an admitting user of another centre inserting, anyone updating `person_id`; identity and match key unchanged after a details edit; two concurrent first edits | Not visible, update 0 rows; 0 rows; 42501; 42501; identity unchanged; one saved, the other stale |
| T-LD-004 | Each list value and format, in TypeScript and as direct inserts (including an emoji address at the length limit, a leading NBSP, NUL and a lone surrogate); every country code has an `Intl` name; `scripts/etl/reset.sql` after a details row exists | App and database accept and refuse the same values (nationality: format only in the database); the control characters refused by the app as field errors; the reset succeeds |
| T-ADM-006 (changed) | The exports test | Exactly `["admitAction", "saveDetailsAction", "searchAction"]` |
| T-AUD-009 | The coverage gate | `person.details.update` is in `AUDIT_CATALOGUE` (the gate finds it in `people.ts` and fails without it) and asserted by T-LD-002 |

## Decisions

1.  **DD-1: Contact and family details only,** with the columns listed in the Data Model (father, mother and a full guardian block); previous marks, the R-150.05 sensitive fields and the extra SMS numbers wait (design owner, 2026-10-29; columns confirmed at step 5, Z7).
2.  **DD-2: Fixed lists in code** (blood group, employment status, qualification, nationality codes), mirrored by database checks; masters later (design owner, 2026-10-29).
3.  **DD-3: Details are editable after admission, audited;** identity stays ticket-only (design owner, 2026-10-29).
4.  **DD-4: A separate 1:1 table `person_detail`,** so identity columns keep their single update path and grants.
5.  **DD-5: Details belong to the person, not the admission;** a learner admitted at two centres has one address.
6.  **DD-6: Pincode, employment status and qualification are required on the form for a new person** (as in legacy; PMC under D-ADM-3), checked by the form layer as admission-screens DD-14 does; `admit()` and the database keep them optional (migrated rows, `existingId`).
7.  **DD-7: Editing needs `student.admit` at a centre where the learner is admitted;** viewing needs `student.view` as today.
8.  **DD-8: Optimistic lock by `version`;** a stale edit is refused, not merged.
9.  **DD-9: ~~Audit rows carry the changed detail values unmasked~~** — revised by DD-14 at step 7.
10. **DD-10: Contact and family details are edited directly; only identity needs a ticket.** This supersedes admission-screens DD-5 for these fields: D-ADM-3's proposed default becomes "identity fields via ticket only" (design owner, 2026-10-29, C12).
11. **DD-11: Pincode, employment status and qualification are required on every edit,** so a migrated learner without them gets them on the first edit ("Not known" is allowed, DD-15) (design owner, 2026-10-29, C4).
12. **DD-12: Nationality lists all officially assigned ISO 3166-1 alpha-2 codes,** defaulting to India on the admit form (design owner, 2026-10-29, C13).
13. **DD-13: Details typed for an existing learner are saved when the learner has none yet, otherwise ignored, with a visible note in the duplicate list** (design owner, 2026-10-29, D5; revised at step 8, I1: a refusal would have blocked every re-admission, since the button resends the filled form).
14. **DD-14: Detail edits are audited by the names of the changed fields only,** no values and no fingerprints: the append-only log never holds family names or phones, and low-entropy fingerprints would have been reversible (design owner, 2026-10-29, D7; revised at step 8, I2; revises DD-9).
15. **DD-15: Employment status and qualification gain "Not known"** (`NOT_KNOWN`), so DD-11 never forces an invented value; pincode stays required (design owner, 2026-10-29, D17).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| D-ADM-3 / D-STU-1 | PRO | Which fields need a ticket | Identity only; contact and family details edited directly (DD-3, DD-10; supersedes admission-screens DD-5's default) |
| D-SEC-4 | IT + Legal | Family data, audit content | Stored plainly in `person_detail`; audited by field names only (DD-14) |
| D-MIG-4 | Owners | Legacy lists | Fixed lists; legacy mapping later |

## Alternatives Considered

### Alternative A: Columns on `person`

*   **Pros:** No join; one row per learner.
*   **Cons:** Mixes freely editable details with ticket-only identity in one table: the update grant, the match-key trigger and the single-writer convention would need per-column care.
*   **Reason for Rejection:** DD-4.

### Alternative B: Address and Guardians as Child Tables

*   **Pros:** Any number of addresses and guardians; history.
*   **Cons:** The legacy form has exactly two addresses and three family blocks; child tables add ordering, deletion and RLS for no requirement.
*   **Reason for Rejection:** Not needed; a later expand migration can split them out.

### Alternative C: Masters for Every List Now

*   **Pros:** Matches the legacy masters; admins can add values.
*   **Cons:** Five more tables, seeds and functions before any admin screen exists.
*   **Reason for Rejection:** DD-2.

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| Two centres edit one learner's details at once | One edit lost | Optimistic `version` (DD-8) | T-LD-002 |
| A centre edits details of a learner also admitted elsewhere | The other centre sees the change | Accepted: details belong to the person (DD-5); audited by field names | none |
| Fixed lists differ from legacy values | Migration cannot map some rows | Accepted until Stage 0; D-MIG-4 maps them | none |

## Detailed Implementation Plan

Written against the code at EGM step 9 ([`implementation_readiness_report.md`](implementation_readiness_report.md)); each phase ends with `bash scripts/ci.sh` exit 0 (in a fresh clone before push).

### Exact SQL (R3, R4, R10, R19)

`ws` below is the set JS `trim()` removes: `[\t\n\v\f\r    -     　﻿]`, written out because Postgres `\s` depends on the database locale. No regex flag is used (Postgres AREs already let `.` match a newline and anchor `^`/`$` at the string ends; the newline-sensitive flag would anchor at every line).

```sql
-- every text column, N = 500 (addresses), 100 (places, names, occupations), 50 (guardian_relation)
alter table app.person_detail add constraint person_detail_father_name_check check (
  father_name !~ '^<ws>' and father_name !~ '<ws>$'
  and father_name !~ '[\u0001-\u001f\u007f]'                 -- addresses: '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]'
  and char_length(father_name) between 1 and 100);
-- pincodes '^[1-9][0-9]{5}$', phones '^[0-9]{10}$', nationality '^[A-Z]{2}$', the three in (...) lists
alter table app.person_detail enable row level security;
alter table app.person_detail force row level security;
create policy scope_select on app.person_detail for select
  using (exists (select 1 from app.admission a where a.person_id = person_detail.person_id));
create policy scope_insert on app.person_detail for insert
  with check (exists (select 1 from app.admission a where a.person_id = person_detail.person_id
    and a.centre_id = any ((select app.scoped_centre_ids('student.admit'))::int[])));
create policy scope_update on app.person_detail for update using (<the same exists>) with check (<the same exists>);
grant select, insert on app.person_detail to gems_app;
grant update (<the 20 detail columns>, version) on app.person_detail to gems_app;
```

The JS mirrors in `detailField`: controls `/[\u0000-\u001f\u007f]/` (addresses `/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/`), lone surrogates `/\p{Cs}/u` (`isWellFormed` is ES2024; the project targets ES2023), `s.trim()`, `[...s].length`; list membership by `Object.hasOwn`; nationality `/^[a-z]{2}$/i` before upper-casing (so `ß` never becomes `SS`).

### D1 Documents

1.  `docs/audit/09-test-strategy-and-acceptance-criteria.md`: `### T-LD: learner details` after T-ADM with T-LD-001…004 (Tests table, as amended); T-ADM-006 "only the three action functions".
2.  `docs/audit/data/matrix-03-academics-general1.tsv` R-150.02 tests: `T-AUD-005,T-LD-001,T-LD-002,T-LD-003,T-LD-004`; regenerate and commit the matrix CSV and the FRD.

### D2 Server (domain only, no form layer)

1.  `src/server/person-rules.ts` (new, no imports): `PersonError`, `invalid` and `optText` (now exported), `istToday`, `isoDate`, `identityField`, `IDENTITY_KEYS`, `StoredIdentity`, `Identity`, `Gender`, `ACADEMIC_YEAR_RULE`, `academicYearOk`, `ADMITTED_THIS_YEAR`, `ASCII_SPACE` (private), `normCode`. `people.ts` deletes them, adds `export * from "./person-rules"` and imports what it uses; `UUID`, `previousYear`, `courses`, `identity`, `personDb`, `CODE_RULE`, `PERSON_POLICY` stay.
2.  Rules: the three rule files import `../../src/server/person-rules`, `version: 4`; `etl/canonical.ts` `HASHED_WITH_EVERY_RULE = ["src/server/person-rules.ts", "etl/ids.ts"]`; the `etl/run.ts` comment. **No preflight change (R1):** `gems_etl` has no grant on `person_detail`, and the foreign key means an empty `person` implies an empty `person_detail`. `tests/etl.test.ts`: `rule centre v4: …`, plus an import guard (`person-rules.ts` has no `import`; each rule imports only `person-rules`, `../ids`, `../types`).
3.  `prisma/schema.prisma`: `PersonDetail` (20 `String?` columns mapped to snake case, `version Int @default(1)`, relation to `Person` with `onDelete: Restrict, onUpdate: Restrict`), `detail PersonDetail?` on `Person`. `prisma/migrations/0015_person_detail/migration.sql`: the generated table, key and foreign key, then the hand-written checks, RLS and grants above.
4.  `scripts/etl/reset.sql`: `app.person_detail` before `app.person`; `tests/fixtures.ts` truncate lists it.
5.  `src/server/details.ts` (new; imports only `./person-rules`): the lists, `COUNTRY_CODES` (249, unique), `DEFAULT_NATIONALITY`, `DETAIL_KEYS`, `DetailKey`, `Details`, `REQUIRED_DETAILS`, `DETAIL_COLUMN` (key → column), `detailField`, `countryOptions(): [code, name][]` (names from `Intl.DisplayNames` on the server, sorted by name; R7).
6.  `src/server/people.ts`: `AdmitInput.details`, validated before `scopedAction`; the fresh-person insert after the admission (all 20 columns in one static statement; skipped when all null); the existing-person branch (lock, read, insert if none); closure `written` reset per attempt like `dismissed` (R16), audited as `detailFields`; `personDb` maps 23514 on `^person_detail_(\w+)_check$` through `DETAIL_COLUMN` to `invalid(key, "invalid")`; `PersonView.details`, `detailsVersion`, `editCentreId`; `updateDetails` with `{ action: "person.details.update", permission: "student.admit", …` on one line (the T-AUD-009 scan reads `action:` up to `permission:`, R11) and static SQL `col = case when ${set(k)} then ${v} else col end` for all 20 columns, as `changeIdentity` does (R17).
7.  `tests/audit-catalogue.ts`: `"person.details.update"`. `tests/foundation.test.ts` T-RLS-002: `person_detail` expects `INSERT, SELECT, UPDATE` policies.
8.  `tests/learner-details.test.ts` (new): `beforeEach` adds role 19 `student_viewer` (`student.view` only) with a user at centre A and session `tok-stuV` (R9). Domain cases of T-LD-001…004: vitest expects `Forbidden` or `PersonError("notfound")` where the page shows 404, and a DENIED row for a view-only post (R18); the R10 samples (`" x"`, `"x\u0085"`, `" x\ny"` address, `"a\tb"` name, 500 and 501 × 😀, `"constructor"`, `"ß"`; NUL: app `invalid characters`, database 22021; lone surrogate: app only); the `personDb` mapping by temporarily replacing `person_detail_father_name_check` with `char_length <= 5` (restored in `finally`, R13); `Promise.all` of an existing-person admit with details and a first edit (R21).

### D3 Pages and form layer (with the existing tests that need the new required fields, R5)

1.  `src/server/admission-form.ts`: `DETAIL_NAMES` in `FORM_NAMES`; `detailsFrom(fd)` (`fd.has`; `permanentSame` = `fd.has("permanentSame")` copies the posted current text); the required check by posted text, an absent required key counting as empty (R12); `input.details`; `e.field === "details"` → `formError: e.rule`; `ADMIT_MESSAGES.detailsNote`; `DetailsFormState` and `submitDetails` (R14).
2.  `app/students/details-fields.tsx` (client; imports only `@/server/details`): props `{ values, errors, countries }`; every select with an empty first option; `values[k] ?? ""`; checkbox unchecked.
3.  `app/students/new/form.tsx` (renders `DetailsFields`; the note in the candidates panel) and `page.tsx` (`initial.values = { nationality: DEFAULT_NATIONALITY }`, `countries = countryOptions()`; R8).
4.  `app/students/[personId]/page.tsx` (details section; "Edit details" iff `editCentreId !== null`; comment DD-10); `app/students/[personId]/details/page.tsx` (`notFound()` without `editCentreId`), `form.tsx` (client, `useActionState(saveDetailsAction)`, hidden `personId`, `centreId`, `version`), `actions.ts` (`"use server"`, only `saveDetailsAction`).
5.  Existing tests: `tests/admission-screens.test.ts` `fields()` gains `currentPincode: "682001", employmentStatus: "STUDENT", qualification: "SSLC"`, and its exports list becomes `["admitAction", "saveDetailsAction", "searchAction"]`; `scripts/smoke-security.mjs` `learner` gains the same three. `tests/learner-details.test.ts` gains the form-level cases (same as current, `required`, untouched select → null, a missing optional input (`bloodGroup`) kept, clearing a required field, stale `formError`).

### D4 Smoke and evidence

1.  `scripts/smoke-security.mjs`: `/students/new` renders `IN` selected; `/students/<own>/details` 200; `/students/<other centre's>/details` and `/students/<random>/details` 404 and identical; an Origin-less details post 404 with no `person.details.update` row; a same-origin post 303.
2.  Mutation checks below; E-038; STATUS; design status built.

### Mutation Checks

| Mutation | File | Must fail |
|---|---|---|
| `person_detail` dropped from the truncate | `reset.sql` | etl.test, T-LD-004 reset |
| A rule imports `people.ts` again | `etl/rules/centre.ts` | etl import guard |
| `text(k)` instead of `fd.has` | `admission-form.ts` | T-LD-002 missing input kept |
| No `for no key update` | `people.ts` | T-LD-003 concurrent first edits |
| Update policy without the `student.admit` scope | 0015 | T-LD-003 view-only direct update |
| `update (person_id)` granted | 0015 | T-LD-003 42501 |
| `NOT_KNOWN` dropped from a database list | 0015 | T-LD-004 list equality |
| `\s` instead of the explicit class | 0015 | T-LD-004 NBSP / U+0085 |
| `(?n)` on the address check | 0015 | T-LD-004 `" x\ny"` |
| No database control clause | 0015 | T-LD-004 `"a\tb"` |
| Values in the audit detail | `people.ts` | T-LD-002 exact detail |
| `person.details.update` not catalogued | `audit-catalogue.ts` | T-AUD-009 |
| No required check on edit | `admission-form.ts` | T-LD-002 |
| No version comparison | `people.ts` | T-LD-002 stale |
| No `/^\d+$/` | `people.ts` | T-LD-002 `"1e0"` |
| No 23514 mapping | `people.ts` | T-LD-004 mapping case |
| Existing-person path always writes | `people.ts` | T-LD-001 stored unchanged |
| Details inserted before the admission | `people.ts` | T-LD-001 |
| No `detailFields` | `people.ts` | T-LD-001 |
| `editCentreId` by `student.view` | `people.ts` | T-LD-002 view-only |
| `in` instead of `Object.hasOwn` | `details.ts` | T-LD-004 `"constructor"` |
| No ASCII check on nationality | `details.ts` | T-LD-004 `"ß"` |
| No `\p{Cs}` check | `details.ts` | T-LD-004 lone surrogate |
| No `notFound()` on the edit page | details `page.tsx` | smoke edit-page 404 |
| No `hasOrigin` in `submitDetails` | `admission-form.ts` | T-LD-002 no Origin, smoke |
| A second export in the details `actions.ts` | details `actions.ts` | T-ADM-006 exports |
| No `person_detail` select policy | 0015 | T-RLS-002 |

The rule-version bump to v4 is checked in review only (the tests clear `migration.rule`).

*Drafted with EGM (draft step followed manually)*
