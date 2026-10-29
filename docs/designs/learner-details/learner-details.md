# Learner details (Stage 3, second piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-3 and accepted DD-4…DD-9 on 2026-10-29; build approval follows the EGM review (steps 5–9). Step 5: [`zoom_out_report.md`](zoom_out_report.md); step 6: [`comprehension_report.md`](comprehension_report.md) (DD-10…DD-12); step 7: [`critic_report.md`](critic_report.md) (DD-13…DD-15, DD-9 revised).
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
*   **G2: The learner's page shows the details, and a holder of `student.admit` at a centre where the learner is admitted edits them;** every change is audited (which fields changed, with keyed fingerprints of old and new values, DD-14); a stale edit is refused [T-LD-002].
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
| `current_address`, `permanent_address` | text, null | `col ~ '^\S(.*\S)?$'` (Postgres `\s` = the whitespace JS `trim()` removes for ASCII; addresses use the newline-sensitive flag so inner newlines are allowed) and `char_length(col) between 1 and 500` |
| `current_place`, `permanent_place` | text, null | the same pattern, 1–100 |
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
// src/server/details-lists.ts (codes only; labels for the short lists). It and detailField live in person-rules.ts's hashed set (D14)
export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const EMPLOYMENT_STATUSES = { STUDENT: "Student", EMPLOYED: "Employed", SELF_EMPLOYED: "Self-employed", UNEMPLOYED: "Unemployed", NOT_KNOWN: "Not known" };
export const QUALIFICATIONS = { BELOW_SSLC: "Below SSLC", SSLC: "SSLC", PLUS_TWO: "Plus Two", DIPLOMA: "Diploma", DEGREE: "Degree", POSTGRADUATE: "Postgraduate", OTHER: "Other", NOT_KNOWN: "Not known" };
export const COUNTRY_CODES: readonly string[]; // the 249 officially assigned ISO 3166-1 alpha-2 codes, written out
export const DEFAULT_NATIONALITY = "IN"; // DD-12
// src/server/people.ts
export const DETAIL_KEYS = ["currentAddress", "currentPlace", "currentPincode", "permanentAddress", "permanentPlace",
  "permanentPincode", "nationality", "bloodGroup", "employmentStatus", "qualification", "fatherName", "fatherOccupation",
  "fatherPhone", "motherName", "motherOccupation", "motherPhone", "guardianName", "guardianRelation", "guardianPhone",
  "guardianOccupation"] as const; // the 20 columns in camelCase; no version, no permanentSame
export type DetailKey = (typeof DETAIL_KEYS)[number];
export type Details = Record<DetailKey, string | null>;
export function detailField(k: DetailKey, v: unknown): string | null; // throws invalid(k, rule); k is also the input name
```

*   Country names come from `new Intl.DisplayNames(["en"], { type: "region" })`; `Intl` cannot list regions, so the codes are written out once, and a test asserts each has a display name other than itself (C13).
*   A test asserts the three short lists equal the database checks (by inserting each value and one outsider); nationality is excluded (format only in the database).

### Validation (`detailField`)

`v == null` → `null` (clears); a non-string → `invalid(k, "invalid")` (D2). Then: not well-formed Unicode (`!v.isWellFormed()`) or any C0 control or DEL character → `invalid(k, "invalid characters")`, except newline, carriage return and tab inside addresses (D8); trimmed; `""` → `null`; lengths counted in code points (`[...s].length`), as `char_length` counts (D9). Then:

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
*   **With `existingId` (DD-13, D5):** the required checks are skipped (as admission-screens DD-14 does for `dateOfBirth` and `mobile`). If any detail is non-null: when the person has no detail row, it is inserted in the same transaction (the link check has already proved `student.admit` where the person is admitted) and the `person.admit` audit lists the keys written; when the person already has one, `admit()` throws `invalid("details", "this learner already has details; clear the Contact and Family sections, or edit them on the learner's page")` before any write (a form message). A redirect could not carry a "not saved" note, so the form refuses instead of dropping them.
*   **Insert:** after the admission insert, a plain `insert into app.person_detail (person_id, <given non-null columns>) values (…)` with no `returning` (version defaults to 1), skipped when every value is null (C7); it follows the admission so the insert policy (D1) and later reads pass. It runs inside `personDb()`, which maps 23514 on `person_detail_<column>_check` to `invalid(<key>, "invalid")` (D8), so a disagreement between app and database (T-LD-004 guards it) gives a field error, never a raw database error carrying the row. Creating details at admission is recorded by `person.admit` (key names only), not as a `person.details.update` (D18).
*   **Shared form parts (Z4):** `DETAIL_NAMES = [...DETAIL_KEYS, "permanentSame"]`, spread into `FORM_NAMES`; `detailsFrom(fd): Partial<Details>` in `admission-form.ts` reads a detail key **only when the form posted it** (`fd.has(k)`: a posted `""` clears, an absent input leaves the stored value; D3) and, when `permanentSame` is checked, overwrites the three permanent fields with the current ones; `<DetailsFields values errors>` in `app/students/details-fields.tsx` renders the "Contact" and "Family" sections for both forms. The checkbox is unchecked on load (C16). Every detail `<select>` has an empty first option, so a stored `null` is posted back as `""`, not as the first list value (D4); the nationality select defaults to `IN` on the admit form only (DD-12). The form state echoes every detail input, `""` included, and a re-rendered form reads only the state; stored values fill only the initial state (D16).
*   **Required (DD-6, DD-11):** `currentPincode`, `employmentStatus`, `qualification` → `fieldErrors[k] = "required"` when empty, on the admit form for a new person and on the edit form always.
*   Field errors reach their inputs through the existing mapping (`PersonError.field` equals the input name).

### Edit Path (DD-3, DD-7, DD-8, DD-10, DD-11)

*   **`PersonView` gains** `details: Details | null` (null without a row), `detailsVersion: number` (0 without a row) and `editCentreId: number | null` (C2). `editCentreId` = `select centre_id from app.admission where person_id = $id and centre_id = any (app.scoped_centre_ids('student.admit')) order by created_at, id limit 1`, read in `getPerson()`'s transaction. Since `getPerson()` needs `student.view`, editing needs both: `student.view` to see the person and `student.admit` at the edit centre (DD-9 of admission-screens already gives every admit role view) (C10).
*   **The view page** shows the details and an "Edit details" link iff `editCentreId !== null`. **The edit page** `/students/[personId]/details` calls `getPerson()` and `notFound()` when `editCentreId` is null; otherwise it renders the form pre-filled from `details`, with hidden `personId`, `centreId` and `version`.
*   **`updateDetails(session, personId, centreId, version, changes: Partial<Details>): Promise<{ version: number; changed: DetailKey[]; fpBefore: Record<string, string | null>; fpAfter: Record<string, string | null> }>`** (C2, C3, C5, C8, D7):
    1.  Before the action: `personId` a UUID; `centreId` and `version` must match `/^\d+$/` before `Number()` (so `""`, `" 7 "` or `"1e0"` never become numbers; D12) and be safe integers; else `PersonError("notfound")` (a 404, no audit). Every key in `changes` through `detailField` (field errors, no audit). Keys absent from `changes` are left as they are; a key present with `null` clears it.
    2.  `scopedAction(session, { action: "person.details.update", permission: "student.admit", centreId, targetType: "person", targetId: personId }, fn, (r) => ({ fields: r.changed, before: r.fpBefore, after: r.fpAfter }))`, no `onFailure`. The audit row carries the changed key names and, per key, a keyed fingerprint of the old and new value (DD-14, D7): `fingerprint(value, key)` as `etl/canonical.ts` computes it (HMAC-SHA-256, first 16 hex characters), keyed with a secret derived from `AUTH_ENC_KEY` by HKDF with the label `audit-fingerprint`. No value is written to the append-only log, so a correction or erasure in `person_detail` is complete. A centre without `student.admit` gives `Forbidden`, audited DENIED, a 404 on the page.
    3.  In the transaction: `assertAdmittedAt(tx, centreId, personId)` (a `notfound` here is not audited, as for `changeIdentity`'s callers, C18); `select 1 from app.person where id = $1 for no key update` (two first edits queue, Z5; does not block a concurrent new admission of the person, D10); read the detail row. Its `version` (0 without a row) ≠ `version` → `invalid("details", "changed since you opened them; reload the page")`. Changed keys = those whose normalised value differs from the stored one (all-null without a row); none → `invalid("details", "nothing to change")`.
    4.  The columns come only from `DETAIL_KEYS.filter((k) => k in changes)` through a fixed key→column table; no caller-supplied name reaches SQL (D11). No row: `insert` the changed keys with `version = 1`. A row: `update app.person_detail set <changed columns>, version = version + 1 where person_id = $1 and version = $v`; 0 rows → the stale error. Both run inside `personDb()` (D8). Return the new version, the changed keys and their fingerprints.
*   **The form:** `saveDetailsAction(prev: DetailsFormState, fd)` in `app/students/[personId]/details/actions.ts`, the thin pattern of `admitAction`: `pageRead(async (s) => submitDetails(s, await headers(), fd))`, redirect on success.

```ts
export type DetailsFormState = { values: Record<string, string>; personId: string; centreId: string; version: string;
  fieldErrors: Record<string, string>; formError?: string };
export async function submitDetails(session: string, h: Headers, fd: FormData): Promise<DetailsFormState | { redirect: string }>;
```

*   `submitDetails`: `hasOrigin(h)` (else `Forbidden`); `detailsFrom(fd)` with all 20 keys (every input is posted, so an empty input clears); the required check (DD-11); `updateDetails(...)`; success → `{ redirect: "/students/<personId>" }`. `PersonError` `invalid` with `field === "details"` → `formError` = its rule; other fields → `fieldErrors`. It does **not** catch `Forbidden` or `PersonError("notfound")`, so `pageRead()` answers 404 (C9). A stale refusal keeps the posted `version`, so the message tells the user to reload.

### Visibility and Personal Data

*   Details are read only through `getPerson()`, so they follow its `student.view` scope and 404 parity.
*   Audit rows of `person.details.update` carry key names and fingerprints only (DD-14). No details enter URLs, the audit log or exports; the database checks that could put a failing row into a database error are prevented by the app's own checks and mapped by `personDb()` (D8).
*   The audit row's `target_centre_id` is the edit centre; auditors at the learner's other centres see the change only through the person id (accepted, D15).

### Migration Framework (Z3, C11)

*   `src/server/person-rules.ts` (new) also holds `DETAIL_KEYS`, `Details`, `detailField` and imports `details-lists.ts`, so a later rule that maps legacy details needs no further version bump (D14). It takes, unchanged: `PersonError`, `invalid` (now exported), `optText`, `istToday`, `isoDate`, `identityField`, `IDENTITY_KEYS`, `StoredIdentity`, `Identity`, `Gender`, `ACADEMIC_YEAR_RULE`, `academicYearOk`, `ADMITTED_THIS_YEAR`, `normCode`, `CODE_RULE`, `PERSON_POLICY` (the last two are not imported by a rule; they move to keep the stored-format rules together). It imports nothing from `./db`, `./action` or Prisma. `people.ts` re-exports all of them, so app callers do not change.
*   The three rule files change their imports to `../../src/server/person-rules`; `etl/run.ts`, `etl/types.ts` and `etl/checks.ts` may keep importing from `people.ts` (they are not hashed). `HASHED_WITH_EVERY_RULE` (`etl/canonical.ts`) becomes `["src/server/person-rules.ts", "etl/ids.ts"]`, and the comment in `etl/run.ts` says so. `HASHED_WITH_EVERY_RULE` also lists `src/server/details-lists.ts`. All three rules move to version 4; `tests/etl.test.ts` expects `rule centre v4: …`. No rule maps details yet.
*   **Reset and preflight (D6):** `scripts/etl/reset.sql` truncates `app.person_detail` with `app.person` (Postgres refuses to truncate a referenced table alone), and the runner's empty-database preflight counts it. `tests/fixtures.ts` lists it in its truncate. A later legacy-details rule will need `gems_etl` grants and the table in the digest.

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-LD-001 | `submitAdmission` with details, with "same as current", without the three required fields; with `existingId` for a learner without details, and for one with details | Row written with the admission (version 1); permanent copied; three `required` field errors; details saved for the learner without; the form message for the one with |
| T-LD-002 | `submitDetails` as `student.admit` at the learner's centre; a second edit with the old `version`; clearing a field; clearing a required field; `NOT_KNOWN`; posting the stored phone in another spelling; an untouched form for a learner without details; a post missing an input; nothing changed; a view-only centre user (GET page and post); a forged `centreId` without `student.admit` there, and one with `student.admit` but no admission; `""` and `"1e0"` as `centreId` | Saved, version 2, one audit row with the changed key names and fingerprints, no values; stale form message; the field cleared; `required`; accepted; no change; "nothing to change"; the missing input's value kept; 404 for the view-only user; 404 + DENIED, and 404 without an audit row; 404 |
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
11. **DD-11: Pincode, employment status and qualification stay required once set:** the edit form requires them too, so a migrated learner without them gets them on the first edit (design owner, 2026-10-29, C4).
12. **DD-12: Nationality lists all officially assigned ISO 3166-1 alpha-2 codes,** defaulting to India on the admit form (design owner, 2026-10-29, C13).
13. **DD-13: Details typed for an existing learner are saved when the learner has none yet;** otherwise the form refuses and points to the learner's page (design owner, 2026-10-29, D5).
14. **DD-14: Detail edits are audited by changed field names and keyed fingerprints, not values,** so the append-only log never holds family names or phones that a later D-SEC-4 rule or an erasure request could not remove (design owner, 2026-10-29, D7; revises DD-9).
15. **DD-15: Employment status and qualification gain "Not known"** (`NOT_KNOWN`), so DD-11 never forces an invented value; pincode stays required (design owner, 2026-10-29, D17).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| D-ADM-3 / D-STU-1 | PRO | Which fields need a ticket | Identity only; contact and family details edited directly (DD-3, DD-10; supersedes admission-screens DD-5's default) |
| D-SEC-4 | IT + Legal | Family data, audit content | Stored plainly in `person_detail`; audited by field names and fingerprints (DD-14) |
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
| A centre edits details of a learner also admitted elsewhere | The other centre sees the change | Accepted: details belong to the person (DD-5); audited | T-LD-002 |
| Fixed lists differ from legacy values | Migration cannot map some rows | Accepted until Stage 0; D-MIG-4 maps them | none |
| Fingerprints are keyed with a secret derived from `AUTH_ENC_KEY` | Rotating that key changes later fingerprints, so old and new rows of one value no longer compare | Accepted: fingerprints show that a value changed, not what it was; a rotation is recorded with its date | none |

## Detailed Implementation Plan

Outline; the file-by-file plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| D1 Documents | T-LD-001…004 in audit 09; matrix links on R-150.02 |
| D2 Server | Migration 0015 and the `PersonDetail` model; `details-lists.ts`; `person-rules.ts` and the ETL hash change, rules v4; reset and preflight; `detailField()`; `admit()` details (new and existing person); `updateDetails()` with fingerprints; `personDb` check mapping; `getPerson()` details and `editCentreId`; `person.details.update` in `AUDIT_CATALOGUE`; tests |
| D3 Pages | `DetailsFields` component; admit form sections; view page details; `/students/[personId]/details` with its action |
| D4 Evidence | Smoke additions (edit page 404 parity, origin), mutation checks, E-entry |

*Drafted with EGM (draft step followed manually)*
