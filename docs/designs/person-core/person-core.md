# Person, admission and registration core (Stage 2)

*   **Author:** gtm
*   **Status:** Proposed (every section approved by the owner in session, 2026-10-28; self-check against the zoom-out standard applied). Awaiting EGM review
*   **Date:** 2026-10-28

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source), INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its business owner to sign). Input: [`input-brief.md`](input-brief.md). Nothing here is approved.

--------------------------------------------------------------------------------

## Overview

Every learner in GEMS is admitted at a centre into one or more courses. The admission form (R-150, SRC) captures who the learner is, one admission with an Admission No, and a repeatable grid of course rows, each with its own status (Active, Drop, Leave, Transfer). Certification issues a Register No per course (R-029, SRC). Fees, receipts, exams, certificates and most correction tickets in later stages all point at one of these three things: the **person**, the **admission**, or the **course registration**.

This design covers the **core** that those modules stand on, which is Stage 2 in audit 10:

*   the three entities and how they relate (person → admission → registration, the D-STU-4 default);
*   how a person is identified, and how duplicates are caught;
*   Admission No and Register No as number series, with the open numbering policy as parameters;
*   centre scope: which centre may see which person, admission and registration;
*   which personal fields are stored now, and which wait for D-SEC-4.

The admission and enquiry screens, lists, correction handlers and fee links are Stage 3 and later. They must be able to sit on this core without changing it.

## The Problem

The legacy system does not say clearly what a "student" is, and that ambiguity would spread to every module built on it.

1.  **No person identity.** The same names appear under different register numbers (DR-05). The legacy API reports **56,336** student records while the home page shows **43,513** (X11). Both point to one record per course registration rather than per person (INF). Without a person entity, nobody can answer "how many people did we teach", and a learner who returns for a second course is a stranger to the system.
2.  **Numbers without a policy.** Register numbers run from 2,000,001 (current 2,064,112) and admission numbers use a yearly prefix such as `GTEC2627` (current 43,887), with "counters reset per academic year prefix" (R-029). The sources disagree on whether register numbers reset per year or run globally (X1). The scope, reset and legacy continuation are all unsigned (NP-2, NP-7, NP-8).
3.  **Scope across centres.** A learner can study at more than one centre over time. If the person record belongs to one centre, the other centre cannot serve them. If it belongs to none, a centre could see learners it never admitted.
4.  **Sensitive personal data.** The form asks for Aadhaar, religion, caste and disability (R-150.05). How and whether these may be stored is D-SEC-4, a production gate owned by IT and Legal. Storing them carelessly now creates legal exposure (DPDP Act).
5.  **Corrections rewrite history.** Name and date-of-birth corrections are tickets (R-095), approved at HO, after which "the record is rewritten by the system". Without before/after history, an approved correction would erase what the record used to say.

**Proposed solution (PRO):**
*   **Three entities.** A network-wide **person**, an **admission** held at one centre, and a **course registration** under that admission. Each registration carries its own status, dates and Register No.
*   **Scope through admissions.** A centre sees a person only through an admission it holds.
*   **Numbers from the existing allocator.** Both numbers come from the existing row-lock allocator, as named series, with the policy as parameters.
*   **Personal data.** Fields under D-SEC-4 are left out until it is signed.
*   **Corrections.** Identity fields change only through audited writes that record before and after, so the Stage 3 correction handlers plug into the ticket engine without new plumbing.

## Goals

Each goal is met when its listed tests pass in `bash scripts/ci.sh`.

*   **G1: People and registrations are counted separately.** One person can hold several admissions and registrations, and reports can count each (T-XM-01).
*   **G2: Duplicates are caught at entry.** Creating a person whose normalised name, date of birth and mobile number match an existing person in scope is flagged before saving, so staff can pick the existing person instead.
*   **G3: Numbers follow the allocator.** Admission No and Register No are allocated in the same transaction as the admission or registration, unique within their series, and formatted from parameters (NP-2, NP-7, NP-8 stay unsigned) (T-NUM-007, T-NUM-010).
*   **G4: Scope holds.** A centre sees only the admissions and registrations it holds, and a person only through one of them. Another centre's records give 404, like missing ones (T-RLS, T-SEC suites extended to the new tables).
*   **G5: Identity changes keep their history.** Every change to a person's identity fields records before and after in the audit trail, and can be made by a ticket handler through the same function.
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

## Technical Plan (Architecture)

### Components

```text
 Stage 3 screens (admission form, lists)        Stage 3 correction tickets (FNC, LNC, …)
            │ admit(), getPerson()                         │ handler.apply(tx) → changeIdentity(tx, …)
            ▼                                              ▼
 src/server/people.ts   admit · changeIdentity · getPerson · findMatches
   │   scopedAction() = authorise → change → audit, one transaction
   │   allocate() for Admission No (number_series, per centre and academic year)
   │   allocateGlobal() for Register No (global_number_series, network-wide)
   ▼
 Postgres (schema app)
   person (no centre_id)  ─<  admission (centre_id)  ─<  registration (centre_id)
   global_number_series   ·   RLS: admission/registration by centre; person through an admission in scope
```

### Data model (migration `0011_person_core`)

| Table | Key columns | Notes |
|---|---|---|
| `person` | id (uuid), given_name, family_name, gender (MALE, FEMALE, OTHER), date_of_birth, mobile, email, match_key (generated), created_at | Network-wide: **no `centre_id`**. Only identity fields for now; addresses, parents and qualifications arrive with the Stage 3 form as expand migrations. No Aadhaar, religion, caste or disability (D-SEC-4) |
| `admission` | id (uuid), person_id, centre_id, academic_year (text, e.g. `2026-27`), admission_no (unique), admitted_on (date), created_at | One per admission event at one centre (R-150: one Admission No per form) |
| `registration` | id (uuid), admission_id, centre_id, course_code (text), register_no (unique), status (ACTIVE, DROP, LEAVE, TRANSFER), join_date, end_date, created_at | One per course row (R-150.01). `centre_id` repeats the admission's centre so RLS needs no join; a check trigger keeps them equal. `course_code` is text until the catalogue skeleton exists, then gains a foreign key by an expand migration |
| `global_number_series` | series (text), period (text), current (bigint); primary key (series, period) | Network-wide counters whose key has no centre. **Generalises the ticket engine's `ticket_number_series`**: the migration renames that table and its rows become series `TICKET`. Register No uses series `REGISTER` |

**`match_key`** is a generated column: the given and family names, lower-cased, with everything except letters removed, then the date of birth, then the last 10 digits of the mobile number. It is indexed and used only for the duplicate check (G2). A missing part makes the key null, so no match is claimed on partial data.

**Grants.** `gems_app` may select and insert all three tables, and update only the identity columns of `person`, through the audited function below. Updating a registration (status, dates) is granted in Stage 3 with the first function that needs it (the course-change ticket). No deletes. Usage on no sequence is needed, because all ids are uuids generated by the app.

### Numbers (G3; NP-2, NP-7, NP-8 stay parameters)

*   **Admission No.** Allocated with the existing `allocate()` on `number_series`. The series key is (centre, `ADMISSION`, academic year): "counters reset per academic year prefix" (R-029, SRC). It is formatted as `{prefix}{seq}`, where the prefix (legacy `GTEC2627`) and the padding are parameters per centre and year. The series row is created when a centre is set up for an academic year (Stage 3), so a missing row fails loudly.
*   **Register No.** Allocated from `global_number_series`, series `REGISTER`, period `ALL`. The legacy numbers run network-wide from 2,000,001 (R-029, SRC), and whether they should reset per year is NP-2/X1, unsigned. It is formatted as a plain number. Continuing from the legacy current value (2,064,112) is a one-line seed on migration day if NP-8 says so.
*   Both are allocated **inside** the admission transaction, so a rolled-back admission releases its numbers, as the allocator already guarantees.
*   **One shared counter table.** The ticket engine's `ticket_number_series` was the same idea for one series. This design generalises it into `global_number_series`, with tickets as series `TICKET`, so there is one network-wide allocator, `allocateGlobal(tx, series, period)` in `numbering.ts`, for both. This supersedes the table name in the ticket-engine design (self-check after drafting, accepted by the owner).

### Scope (G4)

*   **admission, registration:** the standard RLS loop by `centre_id` (0002 pattern), so a centre sees only what it holds.
*   **person:** no `centre_id`. Its select and update policies allow a row only when the person has an admission at a centre in `app.visible_centre_ids()`. A learner admitted at two centres is visible to both. Each centre still sees only its own admissions and registrations.
*   **Inserting a person** happens in the same transaction as the first admission. The app generates the uuid and never reads the row back before the admission exists, because `insert … returning` would need the select policy.
*   **Records outside scope** give 404, as for centres and tickets (T-SEC-001).

### Writes and reads (`src/server/people.ts`)

*   **`admit(session, { person, centreId, academicYear, admittedOn, courses[] })`**: `student.admit` for the centre, one `scopedAction()`. `person` is either `{ existingId }`, a person already visible to the centre, or new identity fields.
    *   For a new person, `findMatches` runs first. If it finds a match and the call did not pass `confirmNew: true`, it throws `PossibleDuplicate` with the matching persons, and nothing is written (G2).
    *   It inserts the person if new, allocates the Admission No, and inserts the admission. For each course it allocates a Register No and inserts the registration.
    *   Audit `person.admit`, with the ids and numbers.
*   **`changeIdentity(tx, personId, changes, reason)`**: the one place identity fields change, inside the caller's transaction. It records before and after. Two callers:
    *   **Direct edit:** `scopedAction()` with `student.identity.edit`, audit `person.identity.update`.
    *   **Stage 3 correction handlers:** inside `handler.apply()`, where the ticket engine audits the approval with this before and after.
*   **`findMatches(tx, identity)`**: persons **in the caller's scope** with the same `match_key`.
    *   **Deliberately in scope only.** Looking across all centres would tell a centre that a person with this name, birth date and mobile studies elsewhere, which is a leak.
    *   Cross-centre duplicates are found later by HO through the merge process (D-MIG-4).
*   **`getPerson(session, id)`**: the person and the admissions and registrations in the caller's scope. 404 when none is visible.
*   **Permissions** (inserted as in 0007): `student.view`, `student.admit`, `student.identity.edit`.

### How later stages plug in

*   **Stage 3 forms** call `admit()` and `getPerson()`. The form's other sections add columns by expand migrations.
*   **Correction tickets** (R-095) are ticket types whose handlers call `changeIdentity()`. A course change (CMC) is a handler that ends one registration (status TRANSFER) and creates another under the same admission.
*   **A move to another centre** is a new admission at the new centre for the same person. The old centre's registrations stay with the old centre.
*   **Fees and receipts** (Stage 4) reference `registration.id`. **Certificates** reference `register_no`.

### Decisions accepted by the owner (2026-10-28, with the Technical Plan)

Accepted in session; each stays PRO until the design is approved. DD-2 stays PMC under NP-2/NP-7 until the numbering owners sign.


1.  **DD-1: Duplicate check in scope only.** Cross-centre duplicates are left to HO's merge process, to avoid revealing other centres' learners.
2.  **DD-2: Register No network-wide, period `ALL`, until NP-2/NP-7 are signed.** Admission No per centre and academic year.
3.  **DD-3: Stage 2 ships functions, not screens.** `admit()` and `changeIdentity()` are tested directly; the first screen is Stage 3.

## Alternatives Considered

### Alternative A: Keep one record per registration (the legacy shape)

*   **Pros**: Migration maps one legacy row to one row; no dedupe map needed.
*   **Cons**: Nobody can count people (G1). A returning learner is a new stranger, and identity corrections must be repeated on every copy. This is the root of DR-05 and X11.
*   **Reason for Rejection**: It keeps the problem this design exists to fix.

### Alternative B: The person belongs to one centre (`centre_id` on person)

*   **Pros**: The standard RLS loop works unchanged; no special policy for person.
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
*   **Reason for Rejection**: The owner chose a check within the creating centre's scope (DD-1). Cross-centre duplicates go to HO's merge process.

### Alternative E: Store Aadhaar, religion and caste now, encrypted

*   **Pros**: The admission form can be complete from day one.
*   **Cons**: D-SEC-4 (IT + Legal, ⛔ prod-gate) has not decided whether, why and how these may be held. Encryption without that decision still means holding data that may have no lawful basis (DPDP Act).
*   **Reason for Rejection**: Adding the columns later is an expand migration. Holding the data early is a risk with no Stage 2 benefit.

### Alternative F: Course columns on the admission, no registration table

*   **Pros**: One table fewer.
*   **Cons**: One admission carries several course rows (R-150.01), each with its own status, dates and Register No, and fees, exams and certificates attach to each course.
*   **Reason for Rejection**: The repeatable course grid is a one-to-many relation, so it needs its own table.

### Alternative G: Register No per centre, from `number_series`

*   **Pros**: Reuses the existing per-centre allocator with no new table.
*   **Cons**: The legacy register numbers form one network-wide run (2,000,001 to 2,064,112; R-029). Per-centre counters would produce the same number at two centres.
*   **Reason for Rejection**: It contradicts the source. A small network-wide series table matches it (DD-2).

### Alternative H: Build the Stage 3 admission screens now

*   **Pros**: Something users can see.
*   **Cons**: The form depends on the lead-source and counting decisions (D-ADM-1, D-ADM-2), the course catalogue, and the fee structure, none of which exist or are signed.
*   **Reason for Rejection**: The owner chose functions now and screens in Stage 3 (DD-3).

## Detailed Implementation Plan

### Build phases

`bash scripts/ci.sh` must be green at the end of each phase. The items in one phase land together.

| Phase | Items | Why they go together |
|---|---|---|
| Q1 Documents | 1, 2 | Test IDs and matrix links must stay consistent (T-DOC-001); the FRD is regenerated |
| Q2 Schema | 3, 4, 5, 6 | The migration changes the T-RLS-002 list; `reset()` must re-seed the new permissions and series |
| Q3 Server | 7, 7a, 8, 9 | The new audit actions must be catalogued and tested in the same change; the shared counter must keep the ticket tests green |
| Q4 Evidence | 10 | After CI is green |

There is no web phase: Stage 2 ships no screen (DD-3).

### Target Files to Create/Modify

#### 1. `docs/audit/09-test-strategy-and-acceptance-criteria.md` and `docs/audit/data/matrix-*.tsv` (Modify)

*   Adds a T-PER group:
    *   T-PER-001: one person, several admissions and registrations; persons and registrations counted separately (with T-XM-01).
    *   T-PER-002: a likely duplicate is flagged in the creating centre's scope; never across centres.
    *   T-PER-003: Admission No per centre and academic year, Register No network-wide; allocated in the admission transaction; a rollback releases them.
    *   T-PER-004: scope. A centre sees only its own admissions and registrations, and a person only through one of them; other centres' records give 404.
    *   T-PER-005: identity changes record before and after, through one function.
*   Adds T-PER-001…005 to R-029's `tests` column. Re-runs `build_matrix.py` and `build_frd.py`, and commits the regenerated CSV and FRD (both are CI gates).

#### 2. `docs/audit/04-manager-decision-register.md` (Modify)

*   Records, against existing rows:
    *   D-STU-4: the core uses its default as a parameter.
    *   The NP-1…NP-8 row: Register No as one network-wide series, Admission No per centre and year (DD-2).
*   Both stay PMC.

#### 3. `prisma/schema.prisma` (Modify)

*   Models `Person`, `Admission` and `Registration`, enums `Gender` and `RegistrationStatus`, and `TicketNumberSeries` renamed to `GlobalNumberSeries` with a `series` column and a composite key, mirroring item 4.
*   `matchKey` is a plain nullable column; a trigger sets it, because Prisma cannot mirror a generated column and the drift gate would fail.
*   Written first, because item 4's table DDL is generated from it.

#### 4. `prisma/migrations/0011_person_core/migration.sql` (Create)

*   **Generated part** (`npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` on a fresh database at 0010): tables, keys, unique indexes (`admission_admission_no_key`, `registration_register_no_key`), foreign keys, and indexes on `admission(person_id)`, `registration(admission_id)` and `person(match_key)`.
*   **Counter rename, hand-edited** (Prisma would generate drop-and-create, which loses the counter): `alter table app.ticket_number_series rename to global_number_series`, add `series text not null default 'TICKET'`, then drop the default, replace the primary key with (series, period), and rename the constraint to match what Prisma expects.
*   **Hand-written part:**
    1.  `app.person_match_key(given, family, dob, mobile)`, an immutable SQL function:
        *   names lower-cased with non-letters removed, then the date of birth as `yyyymmdd` built with `extract`, then the last 10 digits of the mobile;
        *   null when any part is missing.

        A trigger `app.person_set_match_key()` sets the column on insert and on update of those fields.
    2.  `app.registration_guard()`: before insert or update, `centre_id` must equal the admission's centre.
    3.  RLS on `admission` and `registration` with the 0002 loop.
    4.  RLS on `person` (ENABLE and FORCE), with three policies:
        *   select and update: `exists (select 1 from app.admission a where a.person_id = person.id)`. `admission`'s own policy already limits that subquery to the caller's centres, so no new privileged function is needed;
        *   insert: `(select cardinality(app.scoped_centre_ids('student.admit')) > 0)`;
        *   no delete policy.
    5.  Grants for `gems_app`:
        *   select and insert on the three tables;
        *   update on the `person` identity columns only;
        *   `global_number_series` keeps the grants the renamed table had (select, insert, update).
    6.  Permissions `student.view`, `student.admit` and `student.identity.edit` (sensitive), `on conflict do nothing`.

#### 5. `tests/fixtures.ts` (Modify)

*   `reset()`:
    *   truncates the three tables and `global_number_series`;
    *   re-inserts the three student permissions;
    *   adds role `student_admin` (17, with `student.view`, `student.admit`) at centres A and B for new users `sa` and `sb` (tokens `tok-stuA`, `tok-stuB`), plus `student.identity.edit` for the existing `hoAll` through role 18 at ALL scope;
    *   seeds `number_series` rows (centre 1, 2 and 3, `ADMISSION`, `2026-27`).
*   Existing users and assignments are unchanged.

#### 6. `tests/foundation.test.ts` (Modify)

*   T-RLS-002's table list gains `admission` and `registration`.
*   A new assertion checks that `person`, which has no `centre_id`, has RLS enabled and forced, with select, insert and update policies.
*   No change to the T-RLS-005 inventory: no new definer function.

#### 7. `src/server/people.ts` (Create)

*   **`PERSON_POLICY`** (PMC): `admissionPrefix(academicYear)`, returning `GTEC` plus the two two-digit years (`2026-27` → `GTEC2627`, as legacy), `admissionPad: 0`, `registerPad: 0`, `registerPeriod: "ALL"`.
*   **Errors:**
    *   `PersonError(reason: "invalid" | "notfound")`;
    *   `PossibleDuplicate(candidates: { id, givenName, familyName, dateOfBirth }[])`, which carries only in-scope persons.
*   **`admit(session, { person, centreId, academicYear, admittedOn, courses, confirmNew? })`**: `scopedAction()` with `student.admit` for the centre, audit `person.admit`, as in Technical Plan.
    *   Validation: names 1–100 characters, date of birth in the past, mobile 10 digits after removing spaces and `+91`, at least one course, course codes non-empty, and `join_date <= end_date`.
    *   It returns `{ personId, admissionId, admissionNo, registrations: [{ id, courseCode, registerNo }] }`.
*   **`changeIdentity(tx, personId, changes, reason)`**: validates as above. It locks the row (`for update`), throws `PersonError("notfound")` if invisible, updates the given fields, and returns `{ before, after }`.
*   **`updateIdentity(session, personId, changes, reason)`**: `scopedAction()` with `student.identity.edit` and **no `centreId`**, so a network-wide grant is required: direct edits are HO-only and centres use correction tickets (D-ADM-3 default). Audit `person.identity.update` with before, after and reason.
*   **`getPerson(session, id)`**: throws `PersonError("notfound")` for a missing, invisible or malformed id.
*   Audit action names are written as string literals on `action:` lines, so the catalogue gate can read them.

#### 7a. `src/server/numbering.ts`, `src/server/tickets/engine.ts`, `tests/tickets.test.ts`, `tests/fixtures.ts` (Modify)

*   `numbering.ts`: `allocateTicketNumber(tx, period)` becomes `allocateGlobal(tx, series, period)` on `global_number_series` (same upsert, plus the series).
*   `engine.ts`: calls `allocateGlobal(tx, "TICKET", TICKET_POLICY.numberPeriod)`.
*   `tests/tickets.test.ts`: the T-TKT-002 queries read `global_number_series where series = 'TICKET'`.
*   `tests/fixtures.ts`: truncates `global_number_series` instead of `ticket_number_series`.

#### 8. `tests/people.test.ts` (Create)

T-PER-001…005 against the Docker database, plus:
*   a registration whose `centre_id` differs from its admission's is refused by the guard;
*   a missing `ADMISSION` series row fails loudly;
*   `person.match_key` is null when a part is missing, so no match is claimed;
*   a centre user cannot call `updateIdentity` (Forbidden, DENIED row);
*   `changeIdentity` inside another transaction (the handler path) records before and after.

#### 9. `tests/audit-catalogue.ts` and `tests/audit.test.ts` (Modify)

*   The catalogue gains `person.admit` and `person.identity.update`.
*   The gate's scan adds `src/server/people.ts` with the pattern `/"(person\.[a-z0-9_.]+)"/` on the `action:` slice.

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
