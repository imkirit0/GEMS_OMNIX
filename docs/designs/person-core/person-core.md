# Person, admission and registration core (Stage 2)

*   **Author:** gtm
*   **Status:** Proposed. Every section was accepted by the owner in session on 2026-10-28; that is not approval for build, which comes after the EGM review (stages 5–9). Review so far: [`zoom_out_report.md`](zoom_out_report.md) (Stage 5), [`comprehension_report.md`](comprehension_report.md) (Stage 6)
*   **Date:** 2026-10-28

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source), INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its business owner to sign). Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

Every learner in GEMS is admitted at a centre into one or more courses. The admission form (R-150, SRC) captures who the learner is, one admission with an Admission No, and a repeatable grid of course rows, each with its own status (Active, Drop, Leave, Transfer). Certification issues a Register No per course (R-029, SRC). Fees, receipts, exams, certificates and most correction tickets in later stages all point at one of these three things: the **person**, the **admission**, or the **course registration**.

This design covers the **core** that those modules stand on, which is Stage 2 of the roadmap (`docs/audit/10-implementation-roadmap.md`):

*   the three entities and how they relate. This is the default of decision D-STU-4: a person entity, then admissions, then a course registration per course, with the Register No per registration;
*   how a person is identified, and how duplicates are caught;
*   Admission No and Register No as number series, with the open numbering policy as parameters;
*   centre scope: which centre may see which person, admission and registration;
*   which personal fields are stored now, and which wait for D-SEC-4.

The admission and enquiry screens, lists, correction handlers and fee links are Stage 3 and later. They must be able to sit on this core without changing it.

### Terms and references

| Term | Meaning | Where |
|---|---|---|
| HO | Head office: users whose role assignment covers ALL centres ("ALL scope") | `src/server/rbac.ts`, migration 0002 |
| R-xxx, DR-xx, X-n | Requirement rows; discrepancy and cross-check items | `docs/audit/02-requirements-traceability-matrix.csv`, `docs/audit/03-requirements-discrepancy-report.md` |
| D-xxx, NP-n, G-FIN | Open business decisions with owners and proposed defaults; the finance sign-off gate before Stage 4 | `docs/audit/04-manager-decision-register.md`; NP-1…8 in `docs/audit/revisions/v1.1-corrections.md` §C-02.1 |
| T-xxx | Acceptance and security tests (T-XM cross-module, T-NUM numbering, T-RLS isolation, T-SEC security, T-MIG migration, T-DOC the document check) | `docs/audit/09-test-strategy-and-acceptance-criteria.md` |
| P8 | Proof of concept for repeatable migration dry runs | `docs/audit/11-proof-of-concept-specification.md` |
| FNC, LNC, CMC | Ticket types: first-name correction, last-name correction, course change | R-094.01, R-095 |
| DPDP Act | India's Digital Personal Data Protection Act, 2023 | D-SEC-4 |
| EGM | The design-and-review workflow used for this document | `docs/designs/` |
| FRD | Functional requirements document, generated from the matrix | `docs/requirements/FRD-GEMS-OMNIX.md` |
| `scopedAction()`, `Forbidden` | Authorise, change and audit in one transaction; a denial is audited as DENIED | `src/server/action.ts` |
| `app.visible_centre_ids()` | All centres any of the user's role assignments cover; drives RLS | migration 0002 |
| `app.scoped_centre_ids(p)` | The centres where the user holds permission `p` | migration 0002 |
| The 0002 loop | The block in migration 0002 that gives a table with `centre_id` RLS plus select/insert/update/delete policies | migration 0002 |
| Permission rows "as in 0007" | `insert into app.permission … on conflict (key) do nothing` | migration 0007 |
| Drift gate, catalogue gate | CI checks: the Prisma schema equals the migrated database; every audit action is catalogued and tested (T-AUD-009 in `tests/audit.test.ts`) | `scripts/ci.sh` |
| Expand migration | A migration that only adds (columns, tables), never breaks existing code | |

## The Problem

The legacy system does not say clearly what a "student" is, and that ambiguity would spread to every module built on it.

1.  **No person identity.** The same names appear under different register numbers (DR-05). The legacy API reports **56,336** student records while the home page shows **43,513** (X11). Both point to one record per course registration rather than per person (INF). Without a person entity, nobody can answer "how many people did we teach", and a learner who returns for a second course is a stranger to the system.
2.  **Numbers without a policy.** Register numbers run from 2,000,001 (current 2,064,112) and admission numbers use a yearly prefix such as `GTEC2627` (current 43,887), with "counters reset per academic year prefix" (R-029). The sources disagree on whether register numbers reset per year or run globally (X1). The scope, reset and legacy continuation are all unsigned (NP-2, NP-7, NP-8).
3.  **Scope across centres.** A learner can study at more than one centre over time. If the person record belongs to one centre, the other centre cannot serve them. If it belongs to none, a centre could see learners it never admitted.
4.  **Sensitive personal data.** The form asks for Aadhaar, religion, caste and disability (R-150.05). How and whether these may be stored is D-SEC-4, a production gate owned by IT and Legal. Storing them carelessly now creates legal exposure under the DPDP Act.
5.  **Corrections rewrite history.** Name and date-of-birth corrections are tickets (R-095), approved at HO, after which "the record is rewritten by the system". Without before/after history, an approved correction would erase what the record used to say.

**Proposed solution (PRO):**
*   **Three entities.** A network-wide **person**, an **admission** held at one centre, and a **course registration** under that admission. Each registration carries its own status, dates and Register No.
*   **Scope through admissions.** A centre sees a person only through an admission it holds.
*   **Numbers from the existing allocator.** Both numbers come from the existing row-lock allocator, as named series, with the policy as parameters.
*   **Personal data.** Fields under D-SEC-4 are left out until it is signed.
*   **Corrections.** Identity fields change through one function that returns before and after, so the Stage 3 correction handlers plug into the ticket engine, which audits them.

## Goals

Each goal is met when its listed tests pass in `bash scripts/ci.sh`. The T-PER tests are new (item 1); T-NUM-007/010 are unchanged (they test the allocator).

*   **G1: People and registrations are counted separately.** One person can hold several admissions and registrations, and each can be counted (T-PER-001, with T-XM-01).
*   **G2: Duplicates are caught at entry.** Creating a person whose normalised name, date of birth and mobile number match an existing person in the caller's scope is flagged before saving, so staff can pick the existing person instead (T-PER-002).
*   **G3: Numbers follow the allocator.** Admission No and Register No are allocated in the same transaction as the admission or registration, unique network-wide, and formatted from parameters (NP-2, NP-7, NP-8 stay unsigned) (T-PER-003; T-NUM-007, T-NUM-010).
*   **G4: Scope holds.** A centre sees only the admissions and registrations it holds, and a person only through one of them. Another centre's records are indistinguishable from missing ones (T-PER-004; T-RLS-002 extended).
*   **G5: Identity changes keep their history.** Every change to a person's identity fields goes through one function that returns before and after, which the ticket engine records in the audit trail (T-PER-005).
*   **G6: Migration fits.** The legacy rows (43,513 or 56,336, depending on what the export counts) map onto the three entities through an approved dedupe map, with no migration-only columns added now (T-MIG-004 at P8).

## Non-Goals

*   **Screens.** The admission form, enquiry form and lists are Stage 3 (R-150, R-081). Stage 2 ships no user-facing page for these entities.
*   **Enquiries and leads.** The enquiry record and its conversion wait for D-ADM-1 (GEMS enquiry, CRM, or both).
*   **Correction handlers.** The ten correction ticket types (FNC, LNC, …) are built with Stage 3. This design only makes them possible.
*   **Sensitive fields.** Aadhaar, religion, caste and disability are not stored until D-SEC-4 is signed.
*   **Fees, schemes and discounts** on the course grid. These are Stage 4, behind the G-FIN gate.
*   **Documents and the photo** on the admission. These use the ticket engine's storage pattern later; not part of the core.
*   **Merging duplicate persons.** A merge tool needs D-MIG-4 maps and its own design. The model must allow it, but it is not built.
*   **Running the migration.** P8 is a separate Stage 2 piece; this design only keeps the shape migration-ready.
*   **The Academic Year Master** (R-028, D-YEAR-3). Stage 2 holds the academic year as a checked text value (`2026-27`); the master table and its rules come with their decision.
*   **A direct HO identity edit** (outside a ticket). No Stage 2 caller needs it; it comes with a Stage 3 HO screen (DD-5).
*   **Mandatory fields beyond the given name.** Which fields a user must fill in is decided by the Stage 3 form; the core requires only `given_name`.

## Technical Plan (Architecture)

### Components

```text
 Stage 3 screens (admission form, lists)        Stage 3 correction tickets (FNC, LNC, …)
            │ admit(), getPerson()                         │ handler.apply(tx) → changeIdentity(tx, …)
            ▼                                              ▼
 src/server/people.ts   admit · changeIdentity · getPerson · findMatches
   │   scopedAction() = authorise → change → audit, one transaction
   │   allocateGlobal() for Admission No (series ADMISSION, one row per academic year)
   │   allocateGlobal() for Register No (series REGISTER), both network-wide
   ▼
 Postgres (schema app)
   person (no centre_id)  ─<  admission (centre_id)  ─<  registration (centre_id)
   global_number_series   ·   RLS: admission/registration by centre; person through an admission in scope
```

### Data model (migration `0011_person_core`)

| Table | Columns | Notes |
|---|---|---|
| `person` | id (uuid), **given_name** (required), family_name, gender (MALE, FEMALE, OTHER), date_of_birth (date), mobile (10 digits, normalised), email, match_key (derived, set by trigger), created_at | Network-wide: **no `centre_id`**. Only identity fields for now; addresses, parents and qualifications arrive with the Stage 3 form as expand migrations. No Aadhaar, religion, caste or disability (D-SEC-4). Everything except `given_name` may be null |
| `admission` | id (uuid), person_id, centre_id, academic_year (text, checked format `YYYY-YY`, e.g. `2026-27`), admission_no (text, unique), admitted_on (date), created_at; unique (id, centre_id) | One per admission event at one centre (R-150: one Admission No per form). The extra unique key lets registration reference (id, centre_id) |
| `registration` | id (uuid), admission_id, centre_id, course_code (text), register_no (text, unique), status (ACTIVE, DROP, LEAVE, TRANSFER; starts ACTIVE), join_date (required), end_date (nullable), created_at | One per course row (R-150.01). `centre_id` repeats the admission's centre so RLS needs no join; a composite foreign key (admission_id, centre_id) → admission (id, centre_id) keeps them equal. `register_no` is text, so a later prefix (NP-2/NP-7) is not a type change. `course_code` is text until the catalogue skeleton exists, then gains a foreign key by an expand migration |
| `global_number_series` | series (text), period (text), current (bigint); primary key (series, period) | Network-wide counters whose key has no centre. **Generalises the ticket engine's `ticket_number_series`**: the migration renames that table and its rows become series `TICKET`. Admission No uses series `ADMISSION` (one row per academic year) and Register No series `REGISTER` |

**Identity fields** are `given_name`, `family_name`, `gender`, `date_of_birth`, `mobile` and `email`. They are the only person columns `changeIdentity` may change.

**`match_key`** is derived by the database, so migration bulk loads get it too. It is used only for the duplicate check (G2), and is null whenever a part is missing, so no match is claimed on partial data. The exact rule is in item 4.

**Grants.** `gems_app` may select and insert all three tables. It has a column-level update grant on the identity fields of `person`; by convention only `changeIdentity` writes them (one write path, G5), which the database does not itself enforce. Updating a registration (status, dates) is granted in Stage 3 with the first function that needs it (the course-change ticket). No deletes.

### Numbers (G3; NP-2, NP-7, NP-8 stay parameters)

*   **Admission No.**
    *   **Series:** one network-wide series per academic year, `allocateGlobal(tx, "ADMISSION", academicYear)` (DD-2).
    *   **Why network-wide:** "counters reset per academic year prefix" (R-029, SRC), and the legacy shows a single running value (current 43,887), not one per centre.
    *   **Format:** `{prefix}{seq}`. The prefix is built from the year (`2026-27` → `GTEC2627`, as legacy), and the padding is a parameter.
    *   **New year:** the row creates itself the first time that year is used, starting at 1, which is the reset the source describes.
    *   **Cutover:** the year in progress then (`2026-27`, current 43,887) is seeded from the legacy value by the cutover script (NP-8).
*   **Register No.**
    *   **Series:** `global_number_series`, series `REGISTER`, period `ALL`. The legacy numbers run network-wide from 2,000,001 (R-029, SRC); whether they should reset per year is NP-2/X1, unsigned.
    *   **Format:** a plain number.
    *   **Must already exist:** it is allocated with `mustExist`, so it never starts silently at 1 beside the legacy numbers (zoom-out finding Z3).
    *   **Who seeds it:** migration 0011 does not. The cutover script seeds it from the legacy current value read on that day (NP-8), because the legacy system keeps issuing numbers until then. Until it is seeded, admitting fails loudly. Tests seed it in fixtures.
*   **Same transaction.** Both are allocated inside the admission transaction, so a rolled-back admission releases its numbers, as the allocator already guarantees.
*   **One shared counter table.** This design generalises the ticket engine's `ticket_number_series` into `global_number_series`, with tickets as series `TICKET`. There is one network-wide allocator, `allocateGlobal(tx, series, period, { mustExist? })` in `numbering.ts`. This supersedes the table name in the ticket-engine design (item 2a).

### Scope (G4)

*   **admission, registration:** the 0002 loop by `centre_id`, so a centre sees only what it holds.
*   **person:** no `centre_id`. Its select and update policies allow a row only when the person has an admission the caller can see. `admission`'s own policy already limits that check to the caller's centres. A learner admitted at two centres is visible to both, and each centre still sees only its own admissions and registrations.
*   **Inserting a person** happens in the same transaction as the first admission. The app generates the uuid and never reads the row back before the admission exists, because `insert … returning` would need the select policy.
*   **Records outside scope** are indistinguishable from missing ones. Stage 2 functions throw the same `PersonError("notfound")` for both. The Stage 3 routes turn that into 404 through `pageRead`, as for `TicketNotFound`.

### Writes and reads (`src/server/people.ts`)

*   **`admit(session, { person, centreId, academicYear, admittedOn, courses, confirmNew? })`** runs as one `scopedAction()` with `student.admit` for the centre.
    *   **Inputs:**
        *   `person` is either `{ existingId }`, a person the caller can already see, or new identity fields.
        *   `courses` is `{ courseCode: string; joinDate: date; endDate?: date }[]`, with at least one entry.
        *   `academicYear` must match `YYYY-YY` with consecutive years.
    *   **Duplicate check, new person only:** `findMatches` runs inside the action. If it finds a match and `confirmNew` is not true, it throws `PossibleDuplicate` with the matching persons; the transaction rolls back, and no audit row is written. No match check runs for `existingId`.
    *   **Writes:** it inserts the person if new, allocates the Admission No, and inserts the admission. For each course it allocates a Register No and inserts the registration with status ACTIVE.
    *   **Audit:** `person.admit`, with the ids and numbers.
    *   **Errors:**
        *   an invisible or unknown `existingId` gives `PersonError("notfound")`;
        *   a centre outside the caller's `student.admit` scope gives `Forbidden`, audited as DENIED by `scopedAction()`;
        *   a failed validation, including an empty `courses`, gives `PersonError("invalid", "<field>: <rule>")`.
*   **`changeIdentity(tx, personId, changes, reason)`**: the one place identity fields change, inside the caller's transaction.
    *   **Returns** `{ before, after, reason }`, for the caller to audit.
    *   **Caller in Stage 2 design:** only the correction handlers, inside `handler.apply()`. The `tx` is the approver's transaction (ticket-engine design, Act step 5), and the approver can see the person, because the ticket's centre is in their scope and the person has an admission there. The ticket engine writes the approval's audit row with this `before` and `after`.
    *   **Any future non-ticket caller** must audit the change itself.
*   **`findMatches(tx, identity)`**: persons with an admission at a centre in `app.scoped_centre_ids('student.view')` whose `match_key` equals the key computed by the same SQL function for the candidate.
    *   **Deliberately in scope only** (DD-1). Looking across all centres would tell a centre that a person with this name, birth date and mobile studies elsewhere, which is a leak. HO finds cross-centre duplicates later through the merge process (D-MIG-4).
*   **`getPerson(session, id)`** requires `student.view`. It returns `{ person: { id, givenName, familyName, gender, dateOfBirth, mobile, email }, admissions: [{ id, centreId, academicYear, admissionNo, admittedOn, registrations: [{ id, courseCode, registerNo, status, joinDate, endDate }] }] }`. It includes only admissions at centres in `app.scoped_centre_ids('student.view')`, and throws `PersonError("notfound")` when none is visible.
*   **Permissions** (inserted as in 0007): `student.view`, `student.admit`.

### How later stages plug in

*   **Stage 3 forms** call `admit()` and `getPerson()`. The form's other sections add columns by expand migrations.
*   **Correction tickets** (R-095) are ticket types whose handlers call `changeIdentity()`. A course change (CMC) is a handler that ends one registration (status TRANSFER) and creates another under the same admission.
*   **A move to another centre** (DD-4):
    *   only an **HO user**, whose scope covers every centre, can admit an existing person at a new centre, by passing `existingId`; no extra code is needed;
    *   a centre user cannot see learners of other centres (DD-1), so a centre-initiated move creates a new person, which HO later merges (D-MIG-4);
    *   the old centre's registrations stay with the old centre.
*   **Fees and receipts** (Stage 4) reference `registration.id`. **Certificates** reference `register_no`.

### Decisions accepted by the owner (2026-10-28)

Accepted in session; each stays PRO until the design is approved. DD-2 stays PMC under NP-2/NP-7/NP-8 until the numbering owners sign.

1.  **DD-1: Duplicate check in scope only.** Cross-centre duplicates are left to HO's merge process, to avoid revealing other centres' learners.
2.  **DD-2: Register No network-wide (period `ALL`) and Admission No network-wide per academic year.** This was changed after zoom-out finding Z1: per-centre counters with a year-only prefix would clash. The admission series creates itself each new year; the register series must be seeded at cutover (comprehension findings C1, C20).
3.  **DD-3: Stage 2 ships functions, not screens.** `admit()` and `changeIdentity()` are tested directly; the first screen is Stage 3.
4.  **DD-4: Only HO links an existing person at a new centre** (zoom-out finding Z2). Centre-initiated moves create a new person, merged later.
5.  **DD-5: No direct HO identity edit in Stage 2** (zoom-out finding Z7). It waits for a Stage 3 HO screen.
6.  **DD-6: Only `given_name` is required** (comprehension finding C7). The duplicate check works only when date of birth and mobile are given; the Stage 3 form decides what users must fill in.

## Alternatives Considered

### Alternative A: Keep one record per registration (the legacy shape)

*   **Pros**: Migration maps one legacy row to one row; no dedupe map needed.
*   **Cons**: Nobody can count people (G1). A returning learner is a new stranger, and identity corrections must be repeated on every copy. This is the root of DR-05 and X11.
*   **Reason for Rejection**: It keeps the problem this design exists to fix.

### Alternative B: The person belongs to one centre (`centre_id` on person)

*   **Pros**: The 0002 loop works unchanged; no special policy for person.
*   **Cons**: When the learner moves, the second centre either cannot see them, or creates a copy, which brings back the duplicates. Moving the row moves the first centre's history away from it.
*   **Reason for Rejection**: Visibility through admissions gives each centre exactly the learners it serves, with one person row.

### Alternative C: A natural key (Aadhaar, mobile, or name with date of birth)

*   **Pros**: Duplicates become impossible rather than merely flagged.
*   **Cons**:
    *   Aadhaar is optional and falls under D-SEC-4 (not stored yet).
    *   A mobile number is often shared within a family.
    *   Name with date of birth is not unique, and a uniqueness constraint would refuse a genuine second learner.
*   **Reason for Rejection**: No field is both mandatory and unique. A warning on a match key (G2) catches likely duplicates without blocking real ones.

### Alternative D: A duplicate check across all centres

*   **Pros**: Finds a learner who studied at another centre.
*   **Cons**: Telling centre A that a matching person exists at centre B reveals B's learner to A (no existence oracle, T-SEC-001).
*   **Reason for Rejection**: The owner chose a check within the caller's scope (DD-1). Cross-centre duplicates go to HO's merge process.

### Alternative E: Store Aadhaar, religion and caste now, encrypted

*   **Pros**: The admission form can be complete from day one.
*   **Cons**: D-SEC-4 (IT + Legal, ⛔ prod-gate) has not decided whether, why and how these may be held. Encryption without that decision still means holding data that may have no lawful basis under the DPDP Act.
*   **Reason for Rejection**: Adding the columns later is an expand migration. Holding the data early is a risk with no Stage 2 benefit.

### Alternative F: Course columns on the admission, no registration table

*   **Pros**: One table fewer.
*   **Cons**: One admission carries several course rows (R-150.01), each with its own status, dates and Register No, and fees, exams and certificates attach to each course.
*   **Reason for Rejection**: The repeatable course grid is a one-to-many relation, so it needs its own table.

### Alternative G: Numbers per centre, from `number_series`

*   **Pros**: Reuses the existing per-centre allocator with no new table.
*   **Cons**: The legacy register numbers form one network-wide run (2,000,001 to 2,064,112; R-029). Per-centre counters would produce the same number at two centres, and a year-only admission prefix would clash in the same way (zoom-out finding Z1).
*   **Reason for Rejection**: It contradicts the source. The shared network-wide series table matches it (DD-2).

### Alternative H: Build the Stage 3 admission screens now

*   **Pros**: Something users can see.
*   **Cons**: The form depends on the lead-source and counting decisions (D-ADM-1, D-ADM-2), the course catalogue, and the fee structure, none of which exist or are signed.
*   **Reason for Rejection**: The owner chose functions now and screens in Stage 3 (DD-3).

## Detailed Implementation Plan

### Build phases

`bash scripts/ci.sh` must be green at the end of each phase. The items in one phase land together.

| Phase | Items | Why they go together |
|---|---|---|
| Q1 Documents | 1, 2, 2a | Test IDs and matrix links must stay consistent (T-DOC-001); the FRD is regenerated |
| Q2 Schema | 3, 4, 5, 6, 7a | The counter rename (item 4) and the code and tests that use the counter (item 7a) must change together, or the ticket tests fail; `reset()` must re-seed the new permissions and series |
| Q3 Server | 7, 8, 9 | The new audit action must be catalogued and tested in the same change |
| Q4 Evidence | 10 | After CI is green |

There is no web phase: Stage 2 ships no screen (DD-3).

### Target Files to Create/Modify

#### 1. `docs/audit/09-test-strategy-and-acceptance-criteria.md` and `docs/audit/data/matrix-*.tsv` (Modify)

*   Adds a T-PER group:
    *   T-PER-001: one person, several admissions and registrations; persons and registrations counted separately (with T-XM-01). HO admits an existing person at a second centre.
    *   T-PER-002: a likely duplicate is flagged in the caller's scope, never across centres.
    *   T-PER-003: Admission No network-wide per academic year and Register No network-wide, never clashing between centres; allocated in the admission transaction; a rollback releases them.
    *   T-PER-004: scope. A centre sees only its own admissions and registrations, and a person only through one of them; another centre's record raises the same error as a missing one.
    *   T-PER-005: identity changes go through one function that returns before and after.
*   Adds T-PER-001…005 to R-029's `tests` column, T-PER-001/002/004 to R-150's, and T-PER-005 to R-095's.
*   Re-runs `python -I docs/audit/tools/build_matrix.py docs/audit` and `python -I docs/requirements/tools/build_frd.py .`, and commits the regenerated CSV and FRD (both are CI gates).

#### 2. `docs/audit/04-manager-decision-register.md` (Modify)

*   Records, against existing rows:
    *   D-STU-4: the core uses its default as a parameter.
    *   The NP-1…NP-8 row: Register No as one network-wide series, and Admission No network-wide per academic year (DD-2).
*   Both stay PMC.

#### 2a. `docs/designs/ticket-engine/ticket-engine.md` (Modify)

*   A note at its Numbering section, and at the plan items that name them: `ticket_number_series` and `allocateTicketNumber` were generalised into `global_number_series` and `allocateGlobal(tx, "TICKET", …)` by migration 0011 (zoom-out finding Z8).

#### 3. `prisma/schema.prisma` (Modify)

*   Models `Person`, `Admission` and `Registration`; enums `Gender` and `RegistrationStatus`; `TicketNumberSeries` renamed to `GlobalNumberSeries` with a `series` column and a composite key.
*   `Admission` has `@@unique([id, centreId])`, and `Registration` a compound relation on (admissionId, centreId) to it, so the composite foreign key is part of the schema.
*   `matchKey` is a plain nullable column set by a trigger, because Prisma cannot mirror a generated column and the drift gate would fail.
*   Written first, because item 4's table DDL is generated from it.

#### 4. `prisma/migrations/0011_person_core/migration.sql` (Create)

*   **Generated part** (`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` on a fresh database at 0010):
    *   tables, keys and unique indexes (`admission_admission_no_key`, `registration_register_no_key`, admission `(id, centre_id)`);
    *   the foreign keys, including the composite one from `registration (admission_id, centre_id)`;
    *   indexes on `admission(person_id)`, `registration(admission_id)` and `person(match_key)`.
*   **Counter rename, hand-edited**, because Prisma would generate a drop and create, which loses the counter:
    1.  `alter table app.ticket_number_series rename to global_number_series`.
    2.  Add `series text not null default 'TICKET'`, then drop the default.
    3.  Replace the primary key with (series, period), named as Prisma expects.
*   **Hand-written part:**
    1.  **`app.person_match_key(given, family, dob, mobile)`**, an immutable SQL function returning text or null:
        *   `name` = `lower(given || family)` with every character that is not a letter removed (`[^[:alpha:]]`, so non-Latin letters are kept);
        *   the result is `name || '|' || yyyymmdd || '|' || mobile`, where `yyyymmdd` is built from `extract(year/month/day …)` and `mobile` is the stored 10 digits;
        *   null when `name` is empty, the date of birth is null, or the mobile is not exactly 10 digits.

        A trigger function `app.person_set_match_key()` sets `match_key` on insert and on update of those fields.
    2.  A check `academic_year ~ '^\d{4}-\d{2}$'` on admission. The rule that the years are consecutive is validated in `admit`.
    3.  RLS on `admission` and `registration` with the 0002 loop.
    4.  RLS on `person` (ENABLE and FORCE), with three policies:
        *   select and update: `exists (select 1 from app.admission a where a.person_id = person.id)`; `admission`'s own policy limits that subquery to the caller's centres, so no new privileged function is needed;
        *   insert: `(select cardinality(app.scoped_centre_ids('student.admit')) > 0)`;
        *   no delete policy.
    5.  Grants for `gems_app`:
        *   select and insert on the three tables;
        *   update on the six identity columns of `person` only;
        *   `global_number_series` keeps the grants the renamed table had (select, insert, update).
    6.  Permissions `student.view` and `student.admit`, `on conflict (key) do nothing`.
    7.  No seed for `REGISTER` (the cutover script seeds it; DD-2).

#### 5. `tests/fixtures.ts` (Modify)

*   `reset()`:
    *   truncates `person`, `admission`, `registration` and `global_number_series` (replacing `ticket_number_series` in the list);
    *   re-inserts the two student permissions;
    *   adds role 17 `student_admin` (the next free role id after the ticket roles 10–16), with `student.view` and `student.admit`. It is held at centre A by new user `sa` (token `tok-stuA`), at centre B by new user `sb` (`tok-stuB`), and at ALL scope by the existing `hoAll` (the HO move case);
    *   seeds `global_number_series ('REGISTER', 'ALL', 2064112)`. No `ADMISSION` row: it creates itself.
*   Existing users and assignments are unchanged.

#### 6. `tests/foundation.test.ts` (Modify)

*   T-RLS-002's table list gains `admission` and `registration`.
*   A new assertion checks that `person`, which has no `centre_id`, has RLS enabled and forced, with select, insert and update policies.
*   No change to the T-RLS-005 inventory: no new definer function.

#### 7. `src/server/people.ts` (Create)

*   **`PERSON_POLICY`** (PMC):
    *   `admissionPrefix(academicYear)` returns `GTEC` plus the two two-digit years (`2026-27` → `GTEC2627`, as legacy);
    *   `admissionPad: 0`, `registerPad: 0`, `registerPeriod: "ALL"`.
*   **Allocation:**
    *   Admission No: `allocateGlobal(tx, "ADMISSION", academicYear)`, which self-creates;
    *   Register No: `allocateGlobal(tx, "REGISTER", "ALL", { mustExist: true })`.
*   **Errors:**
    *   `PersonError(reason: "invalid" | "notfound", message?)`;
    *   `PossibleDuplicate(candidates: { id, givenName, familyName, dateOfBirth }[])`, which carries only in-scope persons.
*   **`admit`**, as in the Technical Plan.
    *   **Validation:**
        *   `given_name` 1–100 characters after trimming; `family_name` up to 100;
        *   date of birth, when given, in the past;
        *   mobile, when given, exactly 10 digits after removing spaces, `-` and a leading `+91` or `0`, stored as those digits;
        *   email, when given, contains one `@`;
        *   at least one course, each course code non-empty, and `joinDate <= endDate` when `endDate` is given.
    *   **Returns** `{ personId, admissionId, admissionNo, registrations: [{ id, courseCode, registerNo }] }`.
*   **`changeIdentity`**: validates as above. It locks the row (`for update`), throws `PersonError("notfound")` if invisible, updates only the given identity fields, and returns `{ before, after, reason }`.
*   **`getPerson`**, as in the Technical Plan.
*   **Audit name:** `person.admit`, written as a string literal on the `action:` line, so the catalogue gate can read it.

#### 7a. `src/server/numbering.ts`, `src/server/tickets/engine.ts`, `tests/tickets.test.ts` (Modify; phase Q2)

*   `numbering.ts`: `allocateTicketNumber(tx, period)` becomes `allocateGlobal(tx, series, period, { mustExist? })` on `global_number_series`.
    *   By default it is the same upsert.
    *   With `mustExist`, it updates an existing row and throws when the row is missing.
*   `engine.ts`: calls `allocateGlobal(tx, "TICKET", TICKET_POLICY.numberPeriod)`.
*   `tests/tickets.test.ts`: the T-TKT-002 queries read `global_number_series where series = 'TICKET'`.

#### 8. `tests/people.test.ts` (Create)

T-PER-001…005 against the Docker database, plus:
*   two centres admitting in the same academic year get distinct, consecutive Admission Nos (in T-PER-003);
*   HO admits an existing person at a second centre, giving one person and two admissions; a centre user at the second centre can neither see nor pass that person (in T-PER-001);
*   a registration whose `centre_id` differs from its admission's is refused by the composite foreign key;
*   a missing `REGISTER` row fails loudly instead of starting at 1; a new academic year's `ADMISSION` row starts at 1;
*   an academic year in the wrong format, or with non-consecutive years, is refused;
*   `person.match_key` is null when a part is missing, so no match is claimed;
*   `changeIdentity` inside another transaction (the handler path) returns before, after and reason.

#### 9. `tests/audit-catalogue.ts` and `tests/audit.test.ts` (Modify)

*   The catalogue gains `person.admit`.
*   The T-AUD-009 gate in `tests/audit.test.ts` scans `src/server/people.ts` in the same way it scans `rbac.ts` and the ticket modules: the text of each line from `action:` up to `permission:`, with the pattern `/"(person\.[a-z0-9_.]+)"/`.

#### 10. `docs/STATUS.md` and `docs/audit/12-evidence-and-verification-log.md` (Modify)

*   An evidence entry with the CI run and test counts; STATUS completed items and test count.

### Verification Plan

*   **Build and static checks:** `bash scripts/ci.sh`: drift gate, unsafe-SQL ban, typecheck, build, bundle scan, real-server smoke (unchanged; no new pages).
*   **Tests:** `npx vitest run`, including `tests/people.test.ts`, the extended foundation and audit suites, and the catalogue gate.
*   **Mutation checks**, recorded in the evidence log:

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | Scope of persons | Make the person select policy `using (true)` | T-PER-004 |
    | Duplicates flagged | Skip `findMatches` in `admit()` | T-PER-002 |
    | Numbers released on rollback | Allocate the Register No in a separate transaction | T-PER-003 |

*Drafted with EGM*
