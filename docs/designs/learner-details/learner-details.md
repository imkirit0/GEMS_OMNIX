# Learner details (Stage 3, second piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-3 and accepted DD-4…DD-9 on 2026-10-29; build approval follows the EGM review (steps 5–9). Step 5: [`zoom_out_report.md`](zoom_out_report.md).
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
*   **G2: The learner's page shows the details, and a holder of `student.admit` at a centre where the learner is admitted edits them;** every change is audited with before and after; a stale edit is refused [T-LD-002].
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

### Data Model (migration `0015_person_detail`)

`app.person_detail`, one row per person at most (`person_id` primary key, foreign key to `person`, restrict):

| Column | Type | Rule (named check `person_detail_<column>_check`) |
|---|---|---|
| `current_address`, `permanent_address` | text, null | trimmed, 1–500 characters |
| `current_place`, `permanent_place` | text, null | trimmed, 1–100 |
| `current_pincode`, `permanent_pincode` | text, null | `^[1-9][0-9]{5}$` (Indian PIN) |
| `nationality` | text, null | `^[A-Z]{2}$` only: the database checks the format, the app checks the code against the list (the only list not mirrored, Z2) |
| `blood_group` | text, null | one of `A+ A- B+ B- AB+ AB- O+ O-` |
| `employment_status` | text, null | one of `STUDENT EMPLOYED SELF_EMPLOYED UNEMPLOYED` (PMC) |
| `qualification` | text, null | one of `BELOW_SSLC SSLC PLUS_TWO DIPLOMA DEGREE POSTGRADUATE OTHER` (PMC) |
| `father_name`, `mother_name`, `guardian_name` | text, null | trimmed, 1–100 |
| `father_occupation`, `mother_occupation`, `guardian_occupation` | text, null | trimmed, 1–100 |
| `mother_phone`, `father_phone`, `guardian_phone` | text, null | `^[0-9]{10}$` (normalised as `mobile` is) |
| `guardian_relation` | text, null | trimmed, 1–50 |
| `version` | int, not null, default 1 | optimistic lock for edits (DD-8); a person without a row is version 0 |

*   **Why a separate table (DD-4):** the identity columns of `person` keep their only update path (`changeIdentity()`), their column grants and their match-key trigger; details get their own grants and edit path. A row is created only when at least one detail is given.
*   **RLS:** as `person` (0011): `select` and `update` when an admission of the person is visible; `insert` when the caller holds `student.admit` somewhere; no delete policy. The edit function adds the stricter check (below).
*   **Grants** (`gems_app`): `select, insert`; `update` on every column except `person_id`.
*   **Lists** live in one file, `src/server/details-lists.ts` (blood groups, employment statuses, qualifications with labels, ISO country codes), imported by validation, the form and the view. Country names come from `Intl.DisplayNames(['en'], { type: 'region' })`, so the file holds codes only. The database checks mirror the three short lists, and a test asserts they agree; nationality is excluded from that agreement (format only in the database).

### Validation (`detailField()` in `src/server/people.ts`)

One function per field, as `identityField()` does: trims, normalises phones (spaces, dashes, a leading `+91` or `0` removed), turns `""` into `null`, and throws `invalid(<field>, <rule>)` (`PersonError` with `field` and `rule`). A detail set where every field is `null` writes no row.

### Admission Form

*   `AdmitInput` gains `details?: Partial<Details>`; `admit()` validates them before the transaction and, after inserting the admission, inserts the `person_detail` row **only for a new person**. Linking an existing person (`existingId`) ignores the typed details, as it ignores the typed identity; the existing details are edited on the learner's page.
*   **Shared parts (Z4):** one `DETAIL_NAMES` list (the inputs, named after the columns in camelCase: `currentAddress`, `fatherPhone`, …, plus the checkbox `permanentSame`), spread into `FORM_NAMES`; one `detailsFrom(fd)` in `admission-form.ts` that maps them and, when `permanentSame` is checked, copies the three current fields to the permanent ones; one `<DetailsFields values errors>` component in `app/students/details-fields.tsx`, rendered by the admit form and the edit form (both offer "same as current").
*   The admit form gains the two sections "Contact" and "Family" through that component. Required for a new person: `currentPincode`, `employmentStatus`, `qualification` (DD-6), checked by the form layer as `dateOfBirth` and `mobile` are (admission-screens DD-14).
*   Field errors reach their inputs through the existing mapping (`PersonError.field` equals the input name).

### Edit Path (DD-3, DD-7, DD-8)

*   **The edit centre is known before the action (Z1).** `getPerson()` returns `editCentreId`: the centre of the person's earliest admission in `scoped_centre_ids('student.admit')`, or `null`. It drives the "Edit details" link and a hidden `centreId` on the edit form.
*   **`updateDetails(session, personId, centreId, version, changes)`** in `people.ts`, through `scopedAction` with action `person.details.update`, permission `student.admit` and `meta.centreId = centreId` (so `authorize()` checks that centre first), then the existing `assertAdmittedAt(tx, centreId, personId)`. A forged centre gives `Forbidden` (audited DENIED, 404 on the page) or `PersonError("notfound")` (404); a view-only user gets the same 404.
*   Inside the transaction: lock `app.person … for update` first, as `changeIdentity()` does, so two first edits of a person without a row queue instead of colliding on the primary key (Z5); read the detail row (missing = version 0); a different `version` → `invalid("details", "changed since you opened them")`; no field changed → `invalid("details", "nothing to change")`; otherwise upsert the changed fields with `version + 1` and audit `before` and `after` of the changed fields only. `submitDetails` shows field `details` as a form-level message (Z10).
*   **Page:** `/students/[personId]/details` (form pre-filled from the current row, hidden `version`), a Server Action `saveDetailsAction` in `app/students/[personId]/details/actions.ts` following the admit action's pattern (`hasOrigin()`, thin action over a tested `submitDetails()` in `src/server/admission-form.ts`, values in the state only, redirect to the learner on success). The view page shows the details and an "Edit details" link when the viewer may edit.
*   The exports test allows the third action name.

### Visibility and Personal Data

*   Details are read only through `getPerson()` (extended), so they follow its `student.view` scope and 404 parity.
*   Audit rows of `person.details.update` carry the changed values (addresses, family names and phones), as `changeIdentity()`'s callers carry identity values; `app.redact()` does not mask them (PMC under D-SEC-4). No details enter URLs, logs or exports.

### Migration Framework

Today all of `people.ts` is hashed into every mapping rule (`etl/canonical.ts`), so every Stage 3 change to it has forced new rule versions (v2, v3) though no rule changed (Z3). This piece moves the helpers the rules import (`isoDate`, `normCode`, `academicYearOk`, `ACADEMIC_YEAR_RULE`, `ADMITTED_THIS_YEAR`, `identityField`, `IDENTITY_KEYS`, `StoredIdentity`, `PersonError`, `PERSON_POLICY`, `CODE_RULE`) into `src/server/person-rules.ts`, re-exported from `people.ts` so callers do not change, and hashes that module instead. That costs one more bump, to version 4; later changes to `people.ts` (correction tickets, previous marks) no longer do. No rule maps details yet (Non-Goals).

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-LD-001 | Admit through `submitAdmission` with details, with "same as current", without the three required fields, with `existingId` | Row written with the admission; permanent copied; three field errors; `existingId` writes no details |
| T-LD-002 | Edit as `student.admit` at the learner's centre; a second edit with the old `version`; an edit by a centre user who only views; nothing changed | Saved, `version` 2, one audit row with the changed fields before/after; stale refused; view-only user 404; "nothing to change" |
| T-LD-003 | Read and update as another centre's user; identity unchanged after a details edit; direct SQL as `gems_app` updating `person_id` | Not visible, update 0 rows; identity and match key unchanged; 42501 |
| T-LD-004 | Each list value and format, in TypeScript and as direct inserts; the lists file against the database checks | App and database accept and refuse the same values (nationality: the database checks the format only) |

## Decisions

1.  **DD-1: Contact and family details only,** with the columns listed in the Data Model (father, mother and a full guardian block); previous marks, the R-150.05 sensitive fields and the extra SMS numbers wait (design owner, 2026-10-29; columns confirmed at step 5, Z7).
2.  **DD-2: Fixed lists in code** (blood group, employment status, qualification, nationality codes), mirrored by database checks; masters later (design owner, 2026-10-29).
3.  **DD-3: Details are editable after admission, audited;** identity stays ticket-only (design owner, 2026-10-29).
4.  **DD-4: A separate 1:1 table `person_detail`,** so identity columns keep their single update path and grants.
5.  **DD-5: Details belong to the person, not the admission;** a learner admitted at two centres has one address.
6.  **DD-6: Pincode, employment status and qualification are required on the form for a new person** (as in legacy; PMC under D-ADM-3), checked by the form layer as admission-screens DD-14 does; `admit()` and the database keep them optional (migrated rows, `existingId`).
7.  **DD-7: Editing needs `student.admit` at a centre where the learner is admitted;** viewing needs `student.view` as today.
8.  **DD-8: Optimistic lock by `version`;** a stale edit is refused, not merged.
9.  **DD-9: Audit rows carry the changed detail values unmasked** (PMC under D-SEC-4).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| D-ADM-3 / D-STU-1 | PRO | Which fields need a ticket | Identity only; details edited freely (DD-3) |
| D-SEC-4 | IT + Legal | Family data, audit content | Stored plainly, audited unmasked (DD-9) |
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
| Family phones and names in audit rows | Personal data in the audit log | Accepted as PMC (DD-9), as identity corrections already do | none |

## Detailed Implementation Plan

Outline; the file-by-file plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| D1 Documents | T-LD-001…004 in audit 09; matrix links on R-150.02 |
| D2 Server | Migration 0015; `details-lists.ts`; `person-rules.ts` and the ETL hash change, rules v4; `detailField()`; `admit()` details; `updateDetails()`; `getPerson()` details and `editCentreId`; `person.details.update` in `AUDIT_CATALOGUE`; tests |
| D3 Pages | `DetailsFields` component; admit form sections; view page details; `/students/[personId]/details` with its action |
| D4 Evidence | Smoke additions (edit page 404 parity, origin), mutation checks, E-entry |

*Drafted with EGM (draft step followed manually)*
