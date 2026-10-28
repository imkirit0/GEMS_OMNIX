# Person, admission and registration core (Stage 2)

*   **Author:** gtm
*   **Status:** Proposed. The owner accepted every section on 2026-10-28. Build approval follows EGM review Stages 5–9. Reviews so far: [`zoom_out_report.md`](zoom_out_report.md) (Stage 5), [`comprehension_report.md`](comprehension_report.md) (Stage 6), [`critic_report.md`](critic_report.md) (Stage 7), [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (Stage 8), [`implementation_readiness_report.md`](implementation_readiness_report.md) (Stage 9).
*   **Date:** 2026-10-28

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source), INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its business owner to sign). Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

Every learner in GEMS is admitted at a centre into one or more courses. The admission form (R-150, SRC) captures the learner's identity, one admission with an Admission No, and a repeatable grid of course rows, each with its own status (Active, Drop, Leave, Transfer). Certification issues a Register No per course (R-029, SRC). Fees, receipts, exams, certificates and most correction tickets in later stages all point at one of three things: the **person**, the **admission**, or the **registration** (one course row on the form).

This design covers the **core** that those modules depend on, which is Stage 2 of the roadmap (`docs/audit/10-implementation-roadmap.md`):

*   the three entities and how they relate. This follows the proposed default of D-STU-4: a person, then admissions, then one registration per course, with the Register No on the registration;
*   how a person is identified, and how duplicates are caught;
*   Admission No and Register No as number series, with the open numbering policy as parameters;
*   centre scope: which centre may see which person, admission and registration;
*   which personal fields are stored now, and which wait for D-SEC-4.

The admission and enquiry screens, lists, correction handlers and fee links are Stage 3 and later. They must be able to sit on this core without changing the core.

### Terms and references

| Term | Meaning | Where |
|---|---|---|
| Head office, HO user | Head office is the organisation's central office. An HO user is a user whose role assignment covers ALL centres ("ALL scope") | `src/server/rbac.ts`, migration 0002 |
| RLS | Postgres row-level security: the database filters rows by the caller's centres | migration 0002 |
| R-xxx | Requirement rows | `docs/audit/02-requirements-traceability-matrix.csv` |
| DR-xx, X-n | Discrepancy and cross-check items | `docs/audit/03-requirements-discrepancy-report.md` |
| D-xxx | Open business decisions, with owners and proposed defaults | `docs/audit/04-manager-decision-register.md` |
| NP-n | Numbering-policy decisions NP-1…8 | `docs/audit/revisions/v1.1-corrections.md` §C-02.1 |
| G-FIN | The finance sign-off gate before Stage 4 | `docs/audit/04-manager-decision-register.md` |
| DD-n | Design decisions of this document | [Decisions](#decisions) |
| T-xxx | Acceptance and security tests (T-XM cross-module, T-NUM numbering, T-RLS isolation, T-SEC security, T-MIG migration, T-DOC the document check) | `docs/audit/09-test-strategy-and-acceptance-criteria.md` |
| P8 | Proof of concept for repeatable migration dry runs | `docs/audit/11-proof-of-concept-specification.md` |
| FNC, LNC, CMC | Ticket types: first-name correction, last-name correction, course change | R-094.01, R-095 |
| Ticket engine | The approval workflow built in Stage 2; its handlers apply approved changes | `docs/designs/ticket-engine/ticket-engine.md`, `src/server/tickets/` |
| DPDP Act | India's Digital Personal Data Protection Act, 2023 | D-SEC-4 |
| EGM | The design-and-review workflow used for this document (Stages 5–9 are reviews) | `docs/designs/ticket-engine/` for a completed example |
| FRD | Functional requirements document, generated from the matrix | `docs/requirements/FRD-GEMS-OMNIX.md` |
| `scopedAction()` | Authorise, change and audit in one transaction | `src/server/action.ts` |
| `Forbidden` | The error `scopedAction()` throws on a denial, which it audits as DENIED | `src/server/action.ts` |
| `app.visible_centre_ids()` | All centres any of the user's role assignments cover; drives RLS | migration 0002 |
| `app.scoped_centre_ids(p)` | The centres where the user holds permission `p` | migration 0002; executable by `gems_app` since 0007 |
| The 0002 loop | The block in migration 0002 that gives a table with `centre_id` RLS plus select/insert/update/delete policies | migration 0002 |
| Permission rows "as in 0007" | `insert into app.permission … on conflict (key) do nothing` | migration 0007 |
| Drift gate | CI check: the Prisma schema equals the migrated database | `scripts/ci.sh` |
| Catalogue gate | CI check: every audit action is catalogued and tested (T-AUD-009) | `tests/audit.test.ts` |
| Expand migration | A migration that only adds columns or tables and does not alter or drop existing ones | n/a |
| `allocateGlobal`, `SeriesMissing` | The network-wide number allocator this design introduces, and the error it throws when a series row may not be created | `src/server/numbering.ts` (Implementation Plan, item 7a) |
| Cutover script | The one-off script that moves from the legacy system to GEMS on go-live day; it seeds the number series from legacy values (NP-8) | built with P8 |

## The Problem

The legacy system does not say clearly what a "student" is, and that ambiguity would spread to every module built on it.

1.  **No person identity.** The same names appear under different register numbers (DR-05). The legacy API reports **56,336** student records while the home page shows **43,513** (X11). Both counts suggest one record per registration rather than per person (INF). Without a person entity, nobody can answer "how many people did we teach", and a learner who returns for a second course gets a new, unlinked record.
2.  **Numbers without a policy.** Register numbers run from 2,000,001 (current 2,064,112) and admission numbers use a yearly prefix such as `GTEC2627` (current 43,887), with "counters reset per academic year prefix" (R-029). The sources disagree on whether register numbers reset per year or run globally (X1). Whether numbers are per centre or network-wide, when they reset, and how they continue from the legacy values are all unsigned (NP-2, NP-7, NP-8).
3.  **Scope across centres.** A learner can study at more than one centre over time. If the person record belongs to one centre, the other centre cannot serve them. If it belongs to none, a centre could see learners it never admitted.
4.  **Sensitive personal data.** The form asks for Aadhaar, religion, caste and disability (R-150.05). How and whether these may be stored is D-SEC-4, a production gate owned by IT and Legal. Storing them before D-SEC-4 is signed creates legal exposure under the DPDP Act.
5.  **Corrections rewrite history.** Name and date-of-birth corrections are tickets (R-095), approved by head office, after which "the record is rewritten by the system". Without before/after history, an approved correction would erase what the record used to say.

## Goals

Each goal is met when its listed tests pass in `bash scripts/ci.sh`. The T-PER tests are new (Implementation Plan, item 1). R-029 also lists T-NUM-007, which tests `financialYear()` only and is unchanged, and T-NUM-010 ("first new number = legacy current + 1"), which has no CI test today; this design implements it in `tests/people.test.ts` against the seeded `REGISTER` and `ADMISSION` rows.

*   **G1: People and registrations are counted separately.** One person can hold several admissions and registrations, and each can be counted (T-PER-001, with T-XM-01).
*   **G2: Duplicates are caught at entry.** When a new person's match key equals that of a person in the caller's scope, `admit()` throws `PossibleDuplicate` before saving, so staff can pick the existing person instead (T-PER-002).
*   **G3: Numbers follow the allocator.** Admission No and Register No are allocated in the same transaction as the admission or registration, unique network-wide, and formatted from parameters; NP-2, NP-7 and NP-8 stay unsigned (T-PER-003, T-NUM-010).
*   **G4: Scope holds.** A centre sees only the admissions and registrations it holds, and a person only through one of them. Another centre's records are indistinguishable from missing ones (T-PER-004; T-RLS-002 extended).
*   **G5: Identity changes keep their history.** Every change to a person's identity fields goes through one function that returns before and after, which the ticket engine records in the audit trail (T-PER-005).
*   **G6: The shape fits the migration.** No migration-only columns are added, and a bulk insert gets its `match_key` from the database, as the migration load will (T-PER-002). P8 later confirms the legacy rows map onto the three entities (T-MIG-004).

## Non-Goals

*   **Screens.** The admission form, enquiry form and lists are Stage 3 (R-150, R-081). Stage 2 ships no user-facing page for these entities (DD-3).
*   **Enquiries and leads.** The enquiry record and its conversion wait for D-ADM-1 (GEMS enquiry, CRM, or both).
*   **Correction handlers.** The ten correction ticket types (FNC, LNC, …) are built with Stage 3. This design only makes them possible.
*   **Sensitive fields.** Aadhaar, religion, caste and disability are not stored until D-SEC-4 is signed.
*   **Fees, schemes and discounts** on the course grid. These are Stage 4, behind the G-FIN gate.
*   **Documents and the photo** on the admission. These will use the ticket engine's file-storage pattern in Stage 3.
*   **Merging duplicate persons** (D-STU-5, new). A merge tool needs its own design; the D-MIG-4 master dedupe maps are an input. The model must allow it, but it is not built.
*   **Running the migration.** P8 is a separate Stage 2 piece; this design only keeps the tables compatible with it.
*   **The Academic Year Master** (R-028). Stage 2 holds the academic year as a checked text value (`2026-27`); the master table and its rules come with their decision.
*   **A direct identity edit by an HO user** outside a ticket (DD-5).
*   **Mandatory fields beyond the given name** (DD-6).

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
| `person` | id (uuid), **given_name** (required), family_name, gender (MALE, FEMALE, OTHER), date_of_birth (date), mobile (10 digits, normalised), email, match_key (derived, set by trigger), created_at | One row per human being, network-wide |
| `admission` | id (uuid), person_id, centre_id, academic_year (text, checked format `YYYY-YY`, e.g. `2026-27`), admission_no (text, unique), admitted_on (date), created_at; unique (id, centre_id) | One per admission form at one centre (R-150) |
| `registration` | id (uuid), admission_id, centre_id, course_code (text), register_no (text, unique), status (ACTIVE, DROP, LEAVE, TRANSFER; starts ACTIVE), join_date (required), end_date (nullable), created_at | One per course row on the form (R-150.01) |
| `global_number_series` | series (text), period (text), current (bigint); primary key (series, period) | Network-wide counters; see [Numbers](#numbers) |

*   **`person`** has **no `centre_id`**. It holds only identity fields for now; addresses, parents and qualifications arrive with the Stage 3 form as expand migrations. No Aadhaar, religion, caste or disability (D-SEC-4). Everything except `given_name` may be null (DD-6).
*   **`registration.centre_id`** repeats the admission's centre so RLS needs no join. A composite foreign key (admission_id, centre_id) → admission (id, centre_id) keeps the two equal; that is why `admission` has the extra unique key.
*   **`register_no`** is text, so a later prefix (NP-2/NP-7) is not a type change. **`course_code`** is text until the catalogue skeleton exists, then gains a foreign key by an expand migration.

**Identity fields** are `given_name`, `family_name`, `gender`, `date_of_birth`, `mobile` and `email`. They are the only person columns `changeIdentity` may change.

**`match_key`** is set by a database trigger, so migration bulk loads get it too. It is used only for the duplicate check (G2). The rule:

*   **Name part:** the words of `given_name` and `family_name` together (a missing family name counts as empty), lower-cased, keeping letters and the combining marks of Indic scripts (so a Malayalam or Tamil name is not cut at its vowel signs), sorted and joined. "Raj" + "Kumar" and "Kumar" + "Raj" give the same name part, and a single-name learner still has one.
*   **Key:** name part, date of birth as `yyyymmdd`, and the stored 10-digit mobile, joined with `|`.
*   **Null** when the name part is empty, the date of birth is null, or the mobile is not exactly 10 digits. No match is claimed on partial data.

**Grants.** `gems_app` may select and insert all three tables. It has a column-level update grant on the identity fields of `person`. The database does not enforce the single write path; it is a code convention that only `changeIdentity` writes them (G5). Updating a registration (status, dates) is granted in Stage 3 with the first function that needs it (the course-change ticket). No role is granted delete on these tables.

### Numbers

NP-2, NP-7 and NP-8 stay parameters (PMC).

*   **The allocator.** Today `numbering.ts` has `allocateTicketNumber(tx, period)` over `ticket_number_series`. This design renames that table to `global_number_series`, moves tickets to series `TICKET`, and generalises the function to `allocateGlobal(tx, series, period, options)`. It supersedes the table name in the ticket-engine design (Implementation Plan, item 2a). The options say when a missing row may be created:
    *   none: the row is created on first use, starting at 1 (tickets, as today);
    *   `mustExist`: a missing row throws `SeriesMissing`;
    *   `previous: <period>`: a missing row is created only if the row for `<period>` exists; otherwise `SeriesMissing`.
*   **Admission No.**
    *   **Series:** one network-wide series per academic year: `allocateGlobal(tx, "ADMISSION", academicYear, { previous: <the year before> })` (DD-2).
    *   **Why network-wide:** "counters reset per academic year prefix" (R-029, SRC), and the legacy system shows a single running value (current 43,887), not one per centre.
    *   **Format:** `{prefix}{seq}`. The prefix is built from the year (`2026-27` → `GTEC2627`, as the legacy system does), and the padding is a parameter.
    *   **Years chain** (DD-7). `allocateGlobal` creates a new year's row at 1 only when the previous year's row exists, which is the reset the source describes. Before cutover no `ADMISSION` row exists, so every `admit()` throws `SeriesMissing` instead of reissuing legacy numbers. The cutover script seeds the year in progress at cutover (`2026-27`, from the legacy value, NP-8), plus any earlier year that still takes late admissions. A year before the earliest seeded one can never open by itself.
*   **Register No.**
    *   **Series:** `REGISTER`, period `ALL`. The legacy numbers run network-wide from 2,000,001 (R-029, SRC); whether they should reset per year is NP-2/X1, unsigned.
    *   **Format:** a plain number.
    *   **Must already exist:** allocated with `mustExist`, so it never starts at 1 beside the legacy numbers.
    *   **Who seeds it:** the cutover script, from the legacy current value read on that day (NP-8), because the legacy system keeps issuing numbers until then. Migration 0011 does not seed it. Tests seed it in fixtures.
*   **Same transaction.** Both are allocated inside the admission transaction, so a rolled-back admission releases its numbers, as the allocator already guarantees.

### Scope

*   **admission, registration:** the 0002 loop by `centre_id`, so a centre sees only what it holds.
*   **person:** no `centre_id`. Its select and update policies allow a row only when the person has an admission the caller can see. `admission`'s own policy already limits that check to the caller's centres. A learner admitted at two centres is visible to both, and each centre still sees only its own admissions and registrations.
*   **Inserting a person** happens in the same transaction as the first admission. The app generates the uuid and never reads the row back before the admission exists, because `insert … returning` would need the select policy.
*   **Records outside scope** are indistinguishable from missing ones. Stage 2 functions throw the same `PersonError("notfound")` for both. Stage 3 extends `pageRead` (`src/server/page-read.ts`, which today maps only `Forbidden` and `TicketNotFound`) so the routes turn it into 404, preferably through a shared `NotFound` base class.

### Writes and reads (`src/server/people.ts`)

*   **`admit(session, { person, centreId, academicYear, admittedOn, courses, confirmNew? })`** runs as one `scopedAction()` with `student.admit` for the centre.
    *   **Inputs:**
        *   `person` is either `{ existingId }` or new identity fields. An `existingId` must have an admission at a centre in the caller's `student.admit` scope (DD-4); the same set `findMatches` searches, so any person the duplicate check names can be linked.
        *   `courses` is `{ courseCode: string; joinDate: string; endDate?: string }[]`, with at least one entry. All dates cross the API as `'YYYY-MM-DD'` strings, never `Date`, so no time zone shifts a day.
        *   `academicYear` must match `YYYY-YY` with consecutive years. The database check enforces both (so bulk loads get the rule too); `admit` checks first only to give `PersonError("invalid")` before allocating. `admittedOn` is not checked against it until the Academic Year Master (R-028) defines year boundaries.
    *   **Duplicate check, new person only:**
        *   When the candidate's match key is not null, `admit` takes a transaction-scoped advisory lock on it first, so two admits of the same learner run one after the other and the second sees the first.
        *   `findMatches(tx, identity, "student.admit")` runs inside the action. If it finds a match and `confirmNew` is not true, `admit` throws `PossibleDuplicate` with the matching persons; the transaction rolls back, and no audit row is written.
        *   No match check runs for `existingId`.
    *   **Writes:** it inserts the person if new, allocates the Admission No, and inserts the admission. For each course it allocates a Register No and inserts the registration with status ACTIVE.
    *   **Audit:** `person.admit`, with the ids and numbers, and `dismissedCandidates` (the ids `PossibleDuplicate` named) when `confirmNew` was used.
    *   **Errors:**
        *   an `existingId` that is unknown or has no admission in the caller's `student.admit` scope gives `PersonError("notfound")`;
        *   a centre outside the caller's `student.admit` scope gives `Forbidden`, audited as DENIED by `scopedAction()`;
        *   a failed validation, including an empty `courses`, gives `PersonError("invalid", "<field>: <rule>")`;
        *   a missing number series gives `SeriesMissing`.
*   **`changeIdentity(tx, centreId, personId, changes)`**: the one place identity fields change, inside the caller's transaction.
    *   **Centre binding:** it calls `assertAdmittedAt(tx, centreId, personId)`, which throws `PersonError("notfound")` unless the person has an admission at `centreId`, the ticket's centre. An HO approver sees every person, so without this check a ticket raised at one centre could change another centre's learner.
    *   **Returns** `{ before, after }`, the handler `apply()` contract, for the caller to audit. The approval remarks come from the ticket.
    *   **Caller in Stage 2:** only the correction handlers, inside `handler.apply()`. The `tx` is the approver's transaction (ticket-engine design, Act step 5). Handlers call the exported `assertAdmittedAt` in `validate`, so an id from another centre fails at raise exactly like a missing one (the engine re-runs `validate` at final approval when there is no `revalidate`). The ticket engine writes the approval's audit row with this `before` and `after`.
    *   **Any future non-ticket caller** must audit the change itself.
*   **`findMatches(tx, identity, permission)`**: persons with an admission at a centre in `app.scoped_centre_ids(permission)` whose `match_key` equals the key computed by the same SQL function for the candidate.
    *   **Deliberately in scope only** (DD-1). Looking across all centres would tell a centre that a person with this name, birth date and mobile studies elsewhere.
*   **`getPerson(session, id)`** runs in `withScope`, is not audited, and requires `student.view` somewhere (otherwise `PersonError("notfound")`). It includes only admissions at centres in `app.scoped_centre_ids('student.view')`, and throws `PersonError("notfound")` when none is visible. It returns:

    ```ts
    { person: { id, givenName, familyName, gender, dateOfBirth, mobile, email },
      admissions: [{ id, centreId, academicYear, admissionNo, admittedOn,
                     registrations: [{ id, courseCode, registerNo, status, joinDate, endDate }] }] }
    ```
*   **Permissions** (inserted as in 0007, `sensitive = false`, so no TOTP step-up; PMC under D-SEC-4): `student.view` "View learners admitted at a centre in your scope", `student.admit` "Admit learners at a centre".

### How later stages plug in

*   **Stage 3 forms** call `admit()` and `getPerson()`. The form's other sections add columns by expand migrations. A client idempotency key, if wanted, is an optional new `admit` field and breaks no caller.
*   **Correction tickets** (R-095) are ticket types whose handlers call `changeIdentity()`. A course change (CMC) is a handler that ends one registration (status TRANSFER) and creates another under the same admission.
*   **A move to another centre** (DD-4): a user whose `student.admit` covers both the old and the new centre (an HO user, or a regional user within their region) admits the existing person at the new centre with `existingId`. A centre user cannot see learners of other centres (DD-1), so a move they start creates a new person, which head office later merges (D-STU-5). Ending the old centre's registrations is the Stage 3 transfer ticket's job (see Risks).
*   **Fees and receipts** (Stage 4) reference `registration.id`. **Certificates** reference `register_no`.

## Decisions

Accepted by the owner on 2026-10-28; each stays PRO until the design is approved. DD-2 and DD-7 stay PMC under NP-2/NP-7/NP-8 until the numbering owners sign. How each was reached is in the review reports.

1.  **DD-1: The duplicate check looks only within the caller's scope.** Cross-centre duplicates are left to head office's merge process (D-STU-5), so no centre learns about another centre's learners.
2.  **DD-2: Register No is one network-wide series (period `ALL`); Admission No is network-wide per academic year.** Per-centre counters with a year-only prefix would issue the same number at two centres.
3.  **DD-3: Stage 2 ships functions, not screens.** `admit()` and `changeIdentity()` are tested directly; the first screen is Stage 3.
4.  **DD-4: Linking an existing person at a new centre needs `student.admit` at both centres**: the new one and one where the person is already admitted. HO users qualify everywhere, regional users within their region. A move started by a single-centre user creates a new person, merged later.
5.  **DD-5: No direct identity edit by an HO user in Stage 2.** No Stage 2 caller needs it; it comes with a Stage 3 HO screen.
6.  **DD-6: Only `given_name` is required.** The Stage 3 form decides what users must fill in. The duplicate check works only when date of birth and mobile are given.
7.  **DD-7: Academic years chain.** A year's Admission No series opens by itself only after the previous year's series exists; the cutover script seeds the first.

## Open questions

| ID | Owner (register) | What it affects here | Default used now |
|---|---|---|---|
| D-STU-4 | `04-manager-decision-register.md` | The three-entity model | Its proposed default: person → admission → registration |
| NP-2, NP-7, X1 | NP register (§C-02.1) | Register No reset and prefix | Network-wide, period `ALL`, no prefix (DD-2) |
| NP-8 | NP register (§C-02.1) | Seed values at cutover; gapless or not | Cutover script seeds from legacy; numbers released on rollback |
| D-SEC-4 | IT and Legal | Aadhaar, religion, caste, disability; PII erasure | Not stored |
| D-ADM-1, D-ADM-2 | `04-manager-decision-register.md` | Enquiries, lead source, counting | Not built (Stage 3) |
| D-STU-5 (new, item 2) | `04-manager-decision-register.md` | Merging duplicate persons | Duplicates allowed; merged later by a reviewed process |
| D-MIG-4 | `04-manager-decision-register.md` | Master dedupe maps (religion, caste, designation, course names), an input to merging | Not used in Stage 2 |
| R-028 (master), D-YEAR-3 (AY vs FY) | `04-manager-decision-register.md` | Academic year boundaries, `admittedOn` check | Checked text `YYYY-YY` only; AY and FY both kept |
| G-FIN | Finance | Fees on registrations | Stage 4 |

## Alternatives Considered

### Alternative A: Keep one record per registration (the legacy shape)

*   **Pros**: Migration maps one legacy row to one row; no dedupe map needed.
*   **Cons**: Nobody can count people (G1). A returning learner gets a new, unlinked record, and identity corrections must be repeated on every copy. This is the root of DR-05 and X11.
*   **Reason for Rejection**: It keeps the problem this design exists to fix.

### Alternative B: The person belongs to one centre (`centre_id` on person)

*   **Pros**: The 0002 loop works unchanged; no special policy for person.
*   **Cons**: When the learner moves, the second centre either cannot see them, or creates a copy, which brings back the duplicates. Moving the row moves the history away from the first centre.
*   **Reason for Rejection**: Visibility through admissions gives each centre exactly the learners it serves, with one person row.

### Alternative C: A natural key (Aadhaar, mobile, or name with date of birth)

*   **Pros**: Duplicates become impossible rather than flagged.
*   **Cons**: Aadhaar is optional and falls under D-SEC-4 (not stored yet). A mobile number is often shared within a family. Name with date of birth is not unique, and a uniqueness constraint would refuse a genuine second learner.
*   **Reason for Rejection**: No field is both mandatory and unique. A warning on a match key (G2) catches likely duplicates without blocking real ones.

### Alternative D: A duplicate check across all centres

*   **Pros**: Finds a learner who studied at another centre.
*   **Cons**: Telling centre A that a matching person exists at centre B reveals B's learner to A; the system must not reveal whether a record exists outside the caller's scope (T-SEC-001).
*   **Reason for Rejection**: It leaks other centres' learners. Cross-centre duplicates go to head office's merge process instead (DD-1).

### Alternative E: Store Aadhaar, religion and caste now, encrypted

*   **Pros**: The admission form can be complete from day one.
*   **Cons**: D-SEC-4 (owned by IT and Legal; a production gate) has not decided whether, why and how these may be held. Encryption without that decision still means holding data that may have no lawful basis under the DPDP Act.
*   **Reason for Rejection**: Adding the columns later is an expand migration. Holding the data early is a risk with no Stage 2 benefit.

### Alternative F: Course columns on the admission, no registration table

*   **Pros**: One table fewer.
*   **Cons**: One admission carries several course rows (R-150.01), each with its own status, dates and Register No, and fees, exams and certificates attach to each course.
*   **Reason for Rejection**: The repeatable course grid is a one-to-many relation, so it needs its own table.

### Alternative G: Numbers per centre, from `number_series`

*   **Pros**: Reuses the existing per-centre allocator with no new table.
*   **Cons**: The legacy register numbers form one network-wide run (2,000,001 to 2,064,112; R-029). Per-centre counters would produce the same number at two centres, and a year-only admission prefix would clash in the same way.
*   **Reason for Rejection**: It contradicts the source (DD-2).

### Alternative H: Postgres sequences for the network-wide numbers

*   **Pros**: No hot row lock; no counter table.
*   **Cons**: A sequence is not transactional: a rolled-back admission burns its number, and numbers have gaps. Seeding and per-year reset need DDL.
*   **Reason for Rejection**: Whether numbers must be gapless is NP-8, unsigned, and the row-lock allocator keeps both options open.

### Alternative I: Build the Stage 3 admission screens now

*   **Pros**: Users get a visible screen in Stage 2.
*   **Cons**: The form depends on the lead-source and counting decisions (D-ADM-1, D-ADM-2), the course catalogue, and the fee structure, none of which exist or are signed.
*   **Reason for Rejection**: The screens would be built on guesses and rebuilt once those decisions land (DD-3).

## Risks and limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| A ticket raised at one centre targets another centre's person | Wrong learner renamed | `changeIdentity` and handler `validate` bind the person to the ticket's centre | T-PER-005 |
| Admission numbers reissue legacy ones (before cutover, or a past year) | Duplicate numbers on printed forms | Chained years (DD-7); `SeriesMissing` until the cutover script seeds | T-PER-003 |
| Register No starts at 1 beside legacy numbers | Clashing certificates | `mustExist`; seeded at cutover | T-PER-003 |
| Concurrent or double-submitted admits of one learner | Duplicate persons, burnt numbers | Advisory lock on the match key. **Accepted:** learners with a null key (no date of birth or mobile) can still be duplicated, and are merged later (D-STU-5) | T-PER-002 |
| Move started by a single-centre user | Duplicate person | **Accepted** (DD-4); merged later (D-STU-5) | T-PER-001 |
| After a move, the old centre's registrations stay ACTIVE | Active learners double-counted per centre | **Accepted for Stage 2** (no users, no move screen). The Stage 3 transfer ticket ends them (TRANSFER) | T-PER-001 asserts they are untouched |
| Renaming `ticket_number_series` is not an expand migration | Ticket raise fails if the old app runs against 0011 | Migration 0011 and the app deploy together. No production system exists yet | T-TKT-002 |
| One row per counter (`REGISTER`, each `ADMISSION` year) | Every admission in the network queues on it for the rest of its transaction | At about 44,000 admissions a year (R-029 current values) the queue is negligible inside the 5 s transaction timeout (`src/server/db.ts`) | n/a |
| Person RLS admits any role at an admitting centre, not only `student.view` | A future raw query could read PII without `student.view` | **Accepted:** a ticket approver without `student.view` must see the person for `changeIdentity`. `getPerson` checks `student.view` | T-PER-004 |
| After a move, both centres see later identity corrections | Centre A sees centre B's updated mobile and email | **Accepted:** one person, one identity | n/a |
| PII in before/after audit rows (G5) | The append-only audit log cannot be erased under the DPDP Act | Decided with D-SEC-4 before production | n/a |
| Only convention keeps identity writes in `changeIdentity` | A new code path could skip the audit | Column grant limits what can change; code review | n/a |
| Legacy count unresolved (43,513 vs 56,336, X11) | Migration sizing | P8 dry run decides | T-MIG-004 |

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
    *   T-PER-001: one person, several admissions and registrations; persons and registrations counted separately (with T-XM-01). An HO user, and a regional user within their region, admit an existing person at a second centre.
    *   T-NUM-010 (existing ID, first CI test): the first new number equals the legacy current value + 1.
    *   T-PER-002: a likely duplicate is flagged in the caller's scope, never across centres, including single-name learners and swapped name order; a bulk insert gets its match key.
    *   T-PER-003: Admission No network-wide per academic year and Register No network-wide, never clashing between centres; allocated in the admission transaction; a rollback releases them; academic years chain.
    *   T-PER-004: scope. A centre sees only its own admissions and registrations, and a person only through one of them; another centre's record raises the same error as a missing one.
    *   T-PER-005: identity changes go through one function that returns before and after, and only for a person admitted at the given centre.
*   Adds T-PER-001…005 to R-029's `tests` column (keeping T-NUM-007 and T-NUM-010), T-PER-001/002/004 to R-150's, and T-PER-005 to R-095's.
*   Re-runs `python -I docs/audit/tools/build_matrix.py docs/audit` and `python -I docs/requirements/tools/build_frd.py .`, and commits the regenerated CSV and FRD (both are CI gates).

#### 2. `docs/audit/04-manager-decision-register.md` (Modify)

*   Records, against existing rows:
    *   D-STU-4: the core uses its default as a parameter.
    *   The NP-1…NP-8 row: Register No as one network-wide series, Admission No network-wide per academic year with chained years (DD-2, DD-7).
*   Adds a new row after D-STU-4: `D-STU-5 | Merging duplicate person records | Admissions/PRO | person-core design | Duplicates allowed at entry; merged later by a reviewed process (D-MIG-4 maps are an input) | People counted twice | T-PER-001, T-PER-002`, and updates the open-decision count.
*   All stay PMC.

#### 2a. `docs/designs/ticket-engine/ticket-engine.md` (Modify)

*   A note at its Numbering section, and at the plan items that name them: `ticket_number_series` and `allocateTicketNumber` were generalised into `global_number_series` and `allocateGlobal(tx, "TICKET", …)` by migration 0011.

#### 3. `prisma/schema.prisma` (Modify)

*   Models `Person`, `Admission` and `Registration`; enums `Gender` and `RegistrationStatus`; `TicketNumberSeries` renamed to `GlobalNumberSeries` with a `series` column and a composite key.
*   `Admission` has `@@unique([id, centreId])`, and `Registration` a compound relation on (admissionId, centreId) to it, so the composite foreign key is part of the schema.
*   Relations, all `onDelete: Restrict` like the ticket models: `Person.admissions`, `Admission.person`, `Admission.centre`, `Admission.registrations`, `Registration.admission` (the composite one) and `Registration.centre` (its own foreign key to `centre`), with the matching back-relation fields on `Centre`.
*   `GlobalNumberSeries` has `@@id([series, period])`, which Prisma names `global_number_series_pkey`.
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
    3.  Drop `ticket_number_series_pkey` and add `global_number_series_pkey` primary key (series, period).
*   **Hand-written part:**
    1.  **`app.person_match_key(given, family, dob, mobile)`**, an immutable SQL function returning text or null:
        *   `name` = `array_to_string(array(select w from regexp_split_to_table(lower(coalesce(given, '') || ' ' || coalesce(family, '')), '[^[:alpha:]\u0300-\u036f\u0900-\u0dff]+') w where w <> '' order by w), ' ')`; the class keeps Indic combining marks. CI runs the Malayalam case on the local database only; `lc_ctype` on Supabase may differ, so the evidence entry records one manual run there;
        *   the result is `name || '|' || yyyymmdd || '|' || mobile`, where `yyyymmdd` is `(extract(year from dob) * 10000 + extract(month from dob) * 100 + extract(day from dob))::int::text` (zero-padded by construction; `to_char` is not immutable) and `mobile` is the stored 10 digits;
        *   null when `name` is empty, the date of birth is null, or the mobile is not exactly 10 digits.

        A trigger function `app.person_set_match_key()` sets `match_key` on insert and on update of those fields.
    2.  A check on admission: `case when academic_year ~ '^\d{4}-\d{2}$' then right(academic_year, 2)::int = (left(academic_year, 4)::int + 1) % 100 else false end` (the `case` keeps a malformed value from reaching the casts, so it fails as a check violation, not 22P02).
    3.  RLS on `admission` and `registration` with the 0002 loop.
    4.  RLS on `person` (ENABLE and FORCE), with three policies:
        *   select and update: `exists (select 1 from app.admission a where a.person_id = person.id)`; `admission`'s own policy limits that subquery to the caller's centres, so no new privileged function is needed;
        *   insert: `(select cardinality(app.scoped_centre_ids('student.admit')) > 0)`;
        *   no delete policy.
    5.  Grants for `gems_app`:
        *   select and insert on the three tables;
        *   update on the six identity columns of `person` only;
        *   `global_number_series` keeps the grants the renamed table had (select, insert, update).
    6.  Permissions `student.view` and `student.admit` with the descriptions above and `sensitive = false`, `on conflict (key) do nothing`.
    7.  No seed for `REGISTER` or `ADMISSION` (the cutover script seeds them; DD-2, DD-7).

#### 5. `tests/fixtures.ts` (Modify)

*   `reset()`:
    *   truncates `person`, `admission`, `registration` and `global_number_series` (replacing `ticket_number_series` in the list);
    *   re-inserts the two student permissions (same descriptions and `sensitive = false`);
    *   adds role 17 `student_admin` (the next free role id after the ticket roles 10–16), with `student.view` and `student.admit`;
    *   adds four users holding it, exported as `ST = { sa, sb, sr, sh }` in the style of `TK`, with tokens `tok-stuA`, `tok-stuB`, `tok-stuR`, `tok-stuH`:
        *   `sa` (`…0000000000e1`) at centre A;
        *   `sb` (`…0000000000e2`) at centre B (region 2), the out-of-scope user for both moves;
        *   `sr` (`…0000000000e3`) at REGION 1, which covers A and A2 only (fixtures line 4), the regional case;
        *   `sh` (`…0000000000e4`) at ALL scope, the HO move case. `hoAll` is not used: `tests/audit.test.ts:54` asserts its exact roles;
    *   seeds `global_number_series ('REGISTER', 'ALL', 2064112)` and `('ADMISSION', '2026-27', 43887)`, as the cutover script would.
*   Existing users and assignments are unchanged.

#### 6. `tests/foundation.test.ts` (Modify)

*   T-RLS-002's table list gains `admission` and `registration`.
*   A new assertion checks that `person`, which has no `centre_id`, has RLS enabled and forced, with select, insert and update policies.
*   No change to the T-RLS-005 inventory: no new definer function.

#### 7. `src/server/people.ts` (Create)

*   **`PERSON_POLICY`** (PMC):
    *   `admissionPrefix(academicYear)` returns `GTEC` plus the two two-digit years (`2026-27` → `GTEC2627`, as legacy);
    *   `admissionPad: 0`, `registerPad: 0`.
*   **Allocation:**
    *   Admission No: `allocateGlobal(tx, "ADMISSION", academicYear, { previous: previousYear(academicYear) })` (`2026-27` → `2025-26`);
    *   Register No: `allocateGlobal(tx, "REGISTER", "ALL", { mustExist: true })`.
*   **Errors:**
    *   `PersonError(reason: "invalid" | "notfound", message?)`;
    *   `PossibleDuplicate(candidates: { id, givenName, familyName, dateOfBirth }[])`, which carries only in-scope persons.
*   **`admit`**, as in the Technical Plan.
    *   **Validation:**
        *   `given_name` 1–100 characters after trimming; `family_name` up to 100;
        *   date of birth, when given, a valid `'YYYY-MM-DD'` before today in Asia/Kolkata;
        *   mobile, when given, exactly 10 digits after removing spaces, `-` and a leading `+91` or `0`, stored as those digits;
        *   email, when given, contains one `@`;
        *   at least one course, each course code non-empty, and `joinDate <= endDate` when `endDate` is given.
    *   **`existingId`:** `select 1 from app.admission where person_id = $1 and centre_id = any(app.scoped_centre_ids('student.admit'))`; no row gives `PersonError("notfound")`.
    *   **Lock:** `select pg_advisory_xact_lock(hashtext(app.person_match_key(…)))` when the key is not null, before `findMatches`.
    *   **Returns** `{ personId, admissionId, admissionNo, registrations: [{ id, courseCode, registerNo }] }`.
    *   **Audit:** `targetType: "person"`, `targetId: personId`, detail `{ admissionId, admissionNo, registrations: [{ id, registerNo }], dismissedCandidates? }`; `dismissedCandidates` is omitted when empty.
*   **`personDb(fn)`**, in the style of `ticketDb()` (`src/server/tickets/engine.ts`): maps 22P02, the academic-year check (23514), the composite foreign key (23503) and the two unique number keys (23505) to `PersonError("invalid", …)`, and 42501 to `Forbidden`, so no raw Prisma error escapes.
*   **`assertAdmittedAt(tx, centreId, personId)`** (exported): `PersonError("notfound")` unless the person has an admission at `centreId` visible to the caller.
*   **`changeIdentity(tx, centreId, personId, changes)`**: `changes` is `Partial<{ givenName, familyName, gender, dateOfBirth, mobile, email }>`; `null` clears a field except `givenName`. It validates as above, calls `assertAdmittedAt`, locks the row (`for update`), updates only the given fields, and returns `{ before, after }`, each holding only the changed fields.
*   **`getPerson`**, as in the Technical Plan.
*   **Audit name:** `person.admit`, written as a string literal on the `action:` line, so the catalogue gate can read it.

#### 7a. `src/server/numbering.ts`, `src/server/tickets/engine.ts`, `tests/tickets.test.ts` (Modify; phase Q2)

*   `numbering.ts`: `allocateTicketNumber(tx, period)` becomes `allocateGlobal(tx, series, period, { mustExist?, previous? })` on `global_number_series`, plus `SeriesMissing`.
    *   With no option it is the same upsert as today.
    *   With `mustExist`, it updates an existing row and throws `SeriesMissing` when the row is missing.
    *   With `previous`:
        1.  `update app.global_number_series set current = current + 1 where series = $1 and period = $2 returning current`;
        2.  only if that returns no row: `insert into app.global_number_series (series, period, current) select $1, $2, 1 where exists (select 1 from app.global_number_series where series = $1 and period = $3) on conflict (series, period) do update set current = global_number_series.current + 1 returning current` (two first-of-year callers meet in the `on conflict`);
        3.  if that also returns no row, `SeriesMissing`.
    *   `SeriesMissing(series, period)` exposes both, so tests can assert on them.
*   `engine.ts`: calls `allocateGlobal(tx, "TICKET", TICKET_POLICY.numberPeriod)`.
*   `tests/tickets.test.ts`: the T-TKT-002 queries read `global_number_series where series = 'TICKET'`.

#### 8. `tests/people.test.ts` (Create)

T-PER-001…005 against the Docker database, plus:
*   two centres admitting in the same academic year get distinct, consecutive Admission Nos (in T-PER-003);
*   in this order: `2028-29` and `2025-26` throw `SeriesMissing`; then `2027-28` opens at 1 after the seeded `2026-27`; then `2028-29` opens at 1, showing the chain; a missing `REGISTER` row throws `SeriesMissing` (in T-PER-003);
*   T-NUM-010: with the fixture seeds, the first admission gets Register No `2064113` and Admission No `GTEC262743888`;
*   rollback (T-PER-003): the admin pre-inserts a registration with `register_no` `2064114`; an admit with two courses then fails on the unique key after both allocations. The `ADMISSION` and `REGISTER` `current` values are unchanged, and no person, admission or audit row exists;
*   moves (in T-PER-001), in this order: `sa` admits a person at A; `sb` cannot see the person, and passing it as `existingId` gives `PersonError("notfound")`; `sh` admits them at B, giving one person and two admissions, and the A registrations stay ACTIVE; `sr` admits them at A2;
*   raw scope (in T-PER-004): under `sb`, `select id from app.person` returns no centre-A person, and an update of a centre-A person changes 0 rows;
*   two concurrent admits of the same new learner, with `Promise.allSettled`: exactly one fulfils, the other rejects with `PossibleDuplicate`, and one person row exists (in T-PER-002);
*   matching with `family_name` null, with given and family names swapped, and with a Malayalam name; a bulk `insert … select` gets `match_key` (in T-PER-002);
*   `confirmNew` records `dismissedCandidates` in the audit row;
*   a registration whose `centre_id` differs from its admission's is refused by the composite foreign key;
*   an academic year in the wrong format, or with non-consecutive years, is refused by `admit` and, on a direct insert, by the database check;
*   `person.match_key` is null when the date of birth or mobile is missing, so no match is claimed;
*   `changeIdentity` inside another transaction (the handler path) returns before and after; with a centre where the person has no admission, it throws `PersonError("notfound")`, even for an HO user (in T-PER-005).

#### 9. `tests/audit-catalogue.ts` and `tests/audit.test.ts` (Modify)

*   The catalogue gains `person.admit`.
*   The T-AUD-009 gate in `tests/audit.test.ts` scans `src/server/people.ts` in the same way it scans `rbac.ts` and the ticket modules: the text of each line from `action:` up to `permission:`, with the pattern `/"(person\.[a-z0-9_.]+)"/`.

#### 10. `docs/STATUS.md` and `docs/audit/12-evidence-and-verification-log.md` (Modify)

*   An evidence entry with the CI run, the test counts, and the five mutation checks with the test that failed for each; STATUS completed items and test count.

### Verification Plan

*   **Build and static checks:** `bash scripts/ci.sh`: drift gate, unsafe-SQL ban, typecheck, build, bundle scan, real-server smoke (unchanged; no new pages).
*   **Tests:** `npx vitest run`, including `tests/people.test.ts`, the extended foundation and audit suites, and the catalogue gate.
*   **Mutation checks**, recorded in the evidence log:

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | Scope of persons | Make the person select policy `using (true)` | T-PER-004 |
    | Duplicates flagged | Skip `findMatches` in `admit()` | T-PER-002 |
    | Numbers released on rollback | Allocate the Register No in a separate transaction | T-PER-003 |
    | Centre binding of corrections | Drop the centre check in `changeIdentity` | T-PER-005 |
    | Years chain | Ignore `previous` in `allocateGlobal` | T-PER-003 |

*Drafted with EGM*
