# Centre and catalogue skeleton (Stage 2)

*   **Author:** gtm
*   **Status:** Proposed. The design owner accepted every section on 2026-10-28; build approval follows the EGM review (steps 5–9). Decisions taken before drafting (2026-10-28): DD-1 tables, DD-2 course identity, DD-3 academic-year master, DD-4 write path.
*   **Date:** 2026-10-28

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source), INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its decision owner to sign). Statements in the Technical Plan without a class are PRO. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

GEMS sells about 1,200 courses through 325-plus centres. Which centre may sell which course depends on the centre's class (METRO, A++, A…; D-CAT-1), fees are set per course and academic year (Stage 4, D-CAT-3), and every learner's course registration names a course. Today the rebuilt system has none of these as records: `registration.course_code` and `centre.centre_class` are free text, and the academic year is a checked text value.

This design adds the **skeleton** that roadmap Stage 2 lists ("centre/catalogue skeleton", `docs/audit/10-implementation-roadmap.md` row 2): five small reference tables with only their identity fields, links from the existing tables to them, and audited server functions to maintain them. The course master's other ~30 fields, the centre master's fields, centre-course assignment and every screen are Stage 3 (R-022, R-023, R-090, R-090.01, R-091), and arrive by expand migrations on this skeleton.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Stage *n* | A roadmap stage | `docs/audit/10-implementation-roadmap.md` |
| EGM review step | One of the review steps 5–9 this document goes through | `docs/designs/` |
| Master | A small reference table of codes and names (course category, course division, centre class) | R-033.06–.08 |
| Normalised code | A code trimmed and upper-cased, with runs of spaces collapsed to one | this design |
| Expand migration | A Prisma migration that only adds tables, columns or constraints | — |
| Setup-table policy | The RLS pattern of the ticket setup tables: every signed-in user may read; only a holder of the manage permission at ALL scope may write | Prisma migration 0009 |
| `adminWrite()` | Permission check, fresh step-up, the change and its audit row in one transaction | `src/server/rbac.ts` |
| Person core | `person`, `admission`, `registration`, `admit()` | `docs/designs/person-core/person-core.md` |
| Migration framework | The ETL runner, mapping rules and P8 | `docs/designs/migration-framework/migration-framework.md` |
| R-xxx, D-xxx, X*n* | Requirements, open business decisions, discrepancies | audit 02, 04, 03 |
| DD-*n*, G*n* | Decisions and goals of this document; other documents' ids keep their prefix | [Decisions](#decisions) |

## The Problem

1.  **Free text where records are needed.** A registration can name a course that does not exist, and a centre can carry any string as its class. Typos become permanent, and Stage 4 cannot attach fees to "whatever was typed".
2.  **The legacy catalogue is inconsistent** (X5, DQR): 1,200 to 1,375 courses depending on the source, 196 codes with more than one name, codes with surrounding spaces, `/` and `&`, empty codes, courses named "-delete"; 22 or 23 divisions, 11 or 12 categories, 15 or 16 centre classes. A code must mean one course.
3.  **The academic year has no master** (R-028, a Stage 2 requirement): nothing says which years exist, when they start and end, or which are open for admissions.
4.  **Course changes affect money and history** (D-CAT-2, D-CAT-3): who may add or change a course must be controlled and every change recorded.

## Goals

Each goal is met when the tests named in brackets pass in `bash scripts/ci.sh`.

*   **G1: One record per course, category, division, centre class and academic year,** each with a unique normalised code [T-CAT-001].
*   **G2: Registrations name a real, active course; admissions a real, open academic year; centres a real class.** The database refuses anything else, and `admit()` reports it as a field error [T-CAT-002].
*   **G3: Only a catalogue manager changes the catalogue, and every change is audited** with before and after [T-CAT-003].
*   **G4: Everyone signed in can read the catalogue;** it is not scoped by centre [T-CAT-004].
*   **G5: The migration framework and the person core keep working:** their suites pass, and the P8 fixture's course codes and years exist in the catalogue [T-PER-*, T-MIG-*].

## Non-Goals

*   **Screens** for any of these tables (Stage 3).
*   **The course master's other fields** (display name, duration, certifications, capacity, department, curriculum, fees split…; R-090) and **the centre master's fields** (board, type, category, address, lifecycle; R-023, D-ORG-6).
*   **Availability by centre class and special cases** (D-CAT-1, R-090.01, R-091). The class becomes a record now; the course-class assignment comes with Stage 3.
*   **Fees** (Stage 4, G-FIN) and **course versioning** (D-CAT-3): Stage 2 audits edits in place, which is D-CAT-3's proposed default.
*   **Approval tickets for new courses** (D-CAT-2). Stage 2 restricts writes to one permission; a ticket handler can call the same functions in Stage 3.
*   **Centre-class history** (D-ORG-2). A class change is audited with before and after; a history table comes with the class-revision ticket.
*   **Name aliases** for the 196 multi-name codes (DD-2): the migration's merge maps (D-MIG-4) resolve them.
*   **A catalogue mapping rule** for the ETL. It needs legacy catalogue data (Stage 0).

## Technical Plan (Architecture)

### Data Model (Prisma migration `0012_catalogue`)

| Table | Columns | Notes |
|---|---|---|
| `course_category` | id (serial), code (text, unique), name, active (default true), created_at | R-033.07 |
| `course_division` | same | R-033.08 |
| `centre_class` | same | R-033.06 |
| `course` | id (serial), code (text, unique), name, category_id, division_id (both required), active (default true), created_at | R-090, identity fields only |
| `academic_year` | code (text, primary key, `YYYY-YY`, consecutive years), starts_on, ends_on (dates), open (default true), created_at | R-028 |

*   **Codes** are normalised (DD-2): a check constraint `code = upper(regexp_replace(btrim(code), '\s+', ' ', 'g')) and code <> ''` on every code column, so the database refuses an un-normalised code instead of silently changing it. The server functions normalise input before writing. `/`, `&` and other characters stay allowed, because legacy codes use them.
*   **Codes never change** after creation: rows reference them, so `update` grants exclude `code`. A wrong code is deactivated and a new row created.
*   **No deletes.** Rows are deactivated (`active = false`; for a year, `open = false`), so history keeps pointing at them.
*   **`academic_year`:** the same check as `admission.academic_year` (consecutive years), plus `ends_on > starts_on`. Its code is the primary key, so `admission.academic_year` references it directly. Opening a year is inserting its row; `open = false` stops new admissions in that year.

### Links From Existing Tables (Expand)

*   **`registration.course_code`** gains a foreign key to `course(code)` (DD-5). `admit()` normalises each `courseCode` and, before writing, checks that every code names an **active** course, failing with `PersonError("invalid", "courses[i].courseCode: no such course")` otherwise. The foreign key refuses an unknown code from any other path; deactivation is an application check, so existing registrations of a deactivated course stay valid.
*   **`admission.academic_year`** gains a foreign key to `academic_year(code)`. `admit()` checks the year exists and is open (`academicYear: not open`). The chained Admission No series (person-core DD-7) is independent of this table: opening a year here does not create its counter.
*   **`centre.centre_class`** (text, unused by any code, empty in every database) is replaced by `centre_class_id` with a foreign key to `centre_class(id)`, nullable until the Stage 3 centre form makes it required (R-023 marks it required). The replacement is a drop-and-add on an empty column, done in this migration.

### Access

*   **RLS:** the setup-table policy of Prisma migration 0009 on all five tables, with permission `catalogue.manage`: `select using (true)`; insert and update need `app.has_permission('catalogue.manage', null)` (ALL scope); no delete policy.
*   **Grants** (`gems_app`): `select, insert` on the five tables; `update (name, active)` on the masters and `update (name, category_id, division_id, active)` on `course`; `update (starts_on, ends_on, open)` on `academic_year`; `usage` on the four id sequences. `gems_etl`: `select` on `app.course` and `app.academic_year` (the mapping rules check against them).
*   **Permission** `catalogue.manage` ("Maintain the course catalogue and academic years"), `sensitive = true` like `ticket.type.manage`, so writes need a fresh step-up.

### Writes (`src/server/catalogue.ts`)

All go through `adminWrite()` with `catalogue.manage`, so each is authorised, step-up checked, and audited with before and after in one transaction (G3):

*   `createMaster(session, kind, { code, name })`, `updateMaster(session, kind, id, { name })`, `setMasterActive(session, kind, id, active, reason)`, where `kind` is `course_category`, `course_division` or `centre_class`;
*   `createCourse(session, { code, name, categoryId, divisionId })`, `updateCourse(session, id, { name?, categoryId?, divisionId? })`, `setCourseActive(session, id, active, reason)`;
*   `openAcademicYear(session, { code, startsOn, endsOn })`, `updateAcademicYear(session, code, { startsOn?, endsOn? })`, `setAcademicYearOpen(session, code, open, reason)`;
*   `setCentreClass(session, centreId, classId)`.

Audit actions: `catalogue.create`, `catalogue.update`, `catalogue.activate`, `catalogue.deactivate`, `centre.class.set`, with `targetType` the table name and `targetId` the id or code. Errors map through `rbac.ts`'s `db()`: a duplicate code gives `RbacError("duplicate")`, an un-normalisable or empty code `RbacError("invalid")`.

Stage 2 has **no read functions**: `admit()` reads through its own query, tests read with SQL, and Stage 3 adds the list functions its screens need.

### The Migration Framework

*   **The registration rule** adds a check: the normalised `course_code` names a course in `app.course` (`course_code: no such course`); the **admission rule** adds: the academic year exists in `app.academic_year` (`academic_year: not in the academic year master`). Both read through two new `ctx` fields (`courses`, `academicYears`), loaded by the runner in step 4, so rules still do no I/O. Changing the rules changes their code hash (migration-framework DD-10).
*   **P8:** `tests/fixtures.ts` seeds the five courses (`DCA`, `TALLY`, `PYTHON`, `DTP`, `CCNA`), one category, one division, and the academic years `2024-25`…`2028-29`, so the fixture's rows import as before. One new planted defect, a course row with code `XYZ`, is REJECTED (`course_code: no such course`).
*   The catalogue itself is not migrated in Stage 2 (Non-Goals); before a real run, the catalogue must be loaded, by a future catalogue mapping rule or the catalogue functions.

## Decisions

Taken by the design owner on 2026-10-28, before drafting; each stays PRO until the design is approved.

1.  **DD-1: Five tables with identity fields only:** course, course category, course division, centre class, academic year. Stage 3 adds fields by expand migrations.
2.  **DD-2: Course identity is a unique normalised code** with a surrogate id and one name; multi-name legacy codes are resolved by the migration's merge maps (D-MIG-4), not stored as aliases.
3.  **DD-3: The Academic Year Master is a table now**, referenced by `admission.academic_year`; opening a year is inserting its row.
4.  **DD-4: Audited server functions behind one permission** (`catalogue.manage`), no screens; approval tickets for new courses come with Stage 3 (D-CAT-2).
5.  **DD-5: `registration.course_code` references the code, not the id** (proposed while drafting): the column already holds codes, the code never changes, and the foreign key needs no data move.

## Open Questions

| ID | Decision owner | What it affects here | Default used now |
|---|---|---|---|
| D-CAT-1 | Academics | Course availability by class; special cases | Class is a record; assignment in Stage 3 |
| D-CAT-2 | Academics, Accounts | Who approves new courses | `catalogue.manage` only |
| D-CAT-3 | Academics | Versioning vs edit in place | Edit in place, audited |
| D-ORG-2 | Operations | Centre class revisable; history | Audited change; no history table |
| D-MIG-4 | Owners | Multi-name course codes | Resolved at migration |
| D-YEAR-3 | Accounts | AY vs FY | AY master only; FY stays computed (`financialYear()`) |
| X5 | Academics | True course, division, category counts | Not seeded from legacy |

## Alternatives Considered

### Alternative A: The Course Code as Primary Key

*   **Pros:** One identifier everywhere; registrations already store it.
*   **Cons:** Stage 3 and 4 tables (fees, batches, syllabus) would all key on a text code; any correction of a code would cascade.
*   **Reason for Rejection:** A surrogate id keeps later foreign keys small and stable, while the code stays unique and immutable for references that already use it (DD-2, DD-5).

### Alternative B: Name Aliases Now

*   **Pros:** Search and migration could match all 196 multi-name codes by any legacy name.
*   **Cons:** Which names are aliases and which are different courses is exactly the unsigned D-MIG-4 question; storing them now records a guess.
*   **Reason for Rejection:** The merge maps decide it, at migration (DD-2).

### Alternative C: Keep the Academic Year as Checked Text

*   **Pros:** Nothing to change in the person core.
*   **Cons:** R-028 is a Stage 2 requirement; nothing would say which years are open, and fee structures (Stage 4) need a year record.
*   **Reason for Rejection:** DD-3.

### Alternative D: Seeds and Migration Only, No Write Path

*   **Pros:** Less code in Stage 2.
*   **Cons:** Opening the next academic year or adding a course before Stage 3 would need hand-written SQL, unaudited.
*   **Reason for Rejection:** Unaudited catalogue changes are the risk D-CAT-2 names (DD-4).

### Alternative E: Normalise Codes Silently in a Trigger

*   **Pros:** Any writer gets a normalised code.
*   **Cons:** The stored code then differs from what the writer sent, and two different inputs map to one code without anyone noticing.
*   **Reason for Rejection:** A check constraint refuses the un-normalised code, and the server functions normalise visibly.

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| Existing rows with codes not in the catalogue | The new foreign keys fail on deploy | Only test and rehearsal databases hold registrations; fixtures seed the catalogue; the hosted database has none | CI on a fresh database |
| A course deactivated while learners are registered | Their registrations would be refused if checked by the database | Deactivation is checked only by `admit()`; the foreign key checks existence | T-CAT-002 |
| `catalogue.manage` holders change names and categories | Reports change retroactively | **Accepted (D-CAT-3 default):** every change is audited with before and after | T-CAT-003 |
| Code normalisation differs from the legacy system's | The migration matches wrong courses | The normalisation is one SQL expression, reused by the migration's course rule when it is written | n/a |
| The academic-year master and the Admission No counters drift (a year open without a counter, or the reverse) | `admit()` fails with `SeriesMissing` or `not open` | **Accepted:** both are explicit; the counter chain is person-core DD-7 | T-CAT-002 |

## Detailed Implementation Plan

### Build phases

`bash scripts/ci.sh` must be green at the end of each phase.

| Phase | Items | Why they go together |
|---|---|---|
| C1 Documents | 1 | T-CAT tests and matrix links stay consistent (T-DOC-001) |
| C2 Schema | 2, 3, 4 | The foreign keys need the fixtures' catalogue rows in the same change |
| C3 Server and migration rules | 5, 6, 7 | `admit()`, the ETL rules and their tests change together |
| C4 Evidence | 8 | After CI is green |

### Target Files to Create/Modify

#### 1. `docs/audit/09-test-strategy-and-acceptance-criteria.md`, matrix (Modify)

*   A T-CAT group: T-CAT-001 one record per code, codes normalised and unique; T-CAT-002 foreign keys and `admit()` checks; T-CAT-003 writes need `catalogue.manage` and are audited before and after; T-CAT-004 everyone signed in reads the catalogue.
*   T-CAT-001…004 on R-090; T-CAT-001/004 on R-033.06, R-033.07, R-033.08; T-CAT-001/002 on R-028. Regenerate the CSV and FRD.

#### 2. `prisma/schema.prisma`, `prisma/migrations/0012_catalogue/migration.sql` (Modify, Create)

*   Models for the five tables; `Registration.course` relation on `course_code` → `Course.code`; `Admission.year` relation on `academic_year` → `AcademicYear.code`; `Centre.centreClass` text replaced by `centreClassId` with a relation.
*   Generated DDL plus the hand-written code checks, the academic-year checks, RLS, grants and the permission row.

#### 3. `tests/fixtures.ts` (Modify)

*   `reset()` truncates the five tables, re-inserts `catalogue.manage`, seeds the catalogue rows above, and adds role 18 `catalogue_admin` with `catalogue.manage`, held at ALL by a new user `ca` (`tok-catA`).

#### 4. `scripts/etl/setup.sql` (Modify)

*   `grant select on app.course, app.academic_year to gems_etl`.

#### 5. `src/server/catalogue.ts` (Create), `src/server/people.ts` (Modify)

*   The functions of [Writes](#writes-srcservercatalogue-ts).
*   `admit()`: normalise course codes; check active courses and an open year before writing.

#### 6. `etl/run.ts`, `etl/types.ts`, `etl/rules/admission.ts`, `etl/rules/registration.ts`, `etl/fixture.ts` (Modify)

*   `ctx.courses`, `ctx.academicYears`; the two rule checks; the `XYZ` defect.

#### 7. Tests (Create/Modify)

*   `tests/catalogue.test.ts`: T-CAT-001…004 (normalised and duplicate codes refused; un-normalised code refused by the database; deactivated course refused by `admit()` while existing registrations stay; closed year refused; unknown course refused by the foreign key; writes without the permission DENIED; step-up required; before/after audited; a centre user reads every course).
*   `tests/etl.test.ts`: the `XYZ` defect; P8 otherwise unchanged.
*   `tests/audit-catalogue.ts`, `tests/audit.test.ts`: the five actions; T-AUD-009 scans `src/server/catalogue.ts`.

#### 8. `docs/STATUS.md`, `docs/audit/12-evidence-and-verification-log.md` (Modify)

*   Evidence entry with CI counts and mutation checks.

### Verification Plan

*   **CI:** `bash scripts/ci.sh`; `npx vitest run` including `tests/catalogue.test.ts`.
*   **Mutation checks:**

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | Code normalised | Drop the code check on `course` | T-CAT-001 |
    | Real courses | Drop the `registration.course_code` foreign key and the `admit()` check | T-CAT-002 |
    | Controlled writes | Setup-table insert policy `with check (true)` | T-CAT-003 |
    | Audited | Skip the audit in `adminWrite` for catalogue actions | T-CAT-003 |

*Drafted with EGM*
