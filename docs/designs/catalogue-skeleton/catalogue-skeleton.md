# Centre and catalogue skeleton (Stage 2)

*   **Author:** gtm
*   **Status:** Proposed. The design owner accepted every section on 2026-10-28; build approval follows the EGM review (steps 5–9). Reviews so far: [`zoom_out_report.md`](zoom_out_report.md) (step 5), [`comprehension_report.md`](comprehension_report.md) (step 6). Decisions taken before drafting (2026-10-28): DD-1 tables, DD-2 course identity, DD-3 academic-year master, DD-4 write path.
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
| Normalised code | The output of `normCode()`: ASCII whitespace runs collapsed to one space, trimmed, upper-cased | [Data Model](#data-model-prisma-migration-0012_catalogue) |
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

Prisma models (generated DDL comes from these):

```prisma
model CourseCategory {
  id        Int      @id @default(autoincrement())
  code      String   @unique
  name      String
  active    Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  courses   Course[]
  @@map("course_category")
  @@schema("app")
}
// CourseDivision (course_division) and CentreClass (centre_class): the same columns;
// CourseDivision has `courses Course[]`, CentreClass has `centres Centre[]`.

model Course {
  id            Int            @id @default(autoincrement())
  code          String         @unique
  name          String
  categoryId    Int            @map("category_id")
  divisionId    Int            @map("division_id")
  active        Boolean        @default(true)
  createdAt     DateTime       @default(now()) @map("created_at") @db.Timestamptz
  category      CourseCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  division      CourseDivision @relation(fields: [divisionId], references: [id], onDelete: Restrict)
  registrations Registration[]
  @@map("course")
  @@schema("app")
}

model AcademicYear {
  code       String      @id
  startsOn   DateTime    @map("starts_on") @db.Date
  endsOn     DateTime    @map("ends_on") @db.Date
  open       Boolean     @default(true)
  createdAt  DateTime    @default(now()) @map("created_at") @db.Timestamptz
  admissions Admission[]
  @@map("academic_year")
  @@schema("app")
}
```

Changes to existing models: `Registration.course Course @relation(fields: [courseCode], references: [code], onDelete: Restrict)`; `Admission.year AcademicYear @relation(fields: [academicYear], references: [code], onDelete: Restrict)`; `Centre.centreClass String?` is replaced by `centreClassId Int? @map("centre_class_id")` and `centreClass CentreClass? @relation(fields: [centreClassId], references: [id], onDelete: Restrict)`.

Every column is `not null` except `centre.centre_class_id`.

**Hand-written checks** (named, so errors can be mapped):

| Constraint | On | Rule |
|---|---|---|
| `<table>_code_check` | `course_category`, `course_division`, `centre_class`, `course` | `code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code)`: printable ASCII (DD-8), single spaces only between words, no leading or trailing space, upper case |
| `<table>_name_check` | the same four | `name = btrim(name) and name <> ''` |
| `academic_year_code_check` | `academic_year` | the person-core rule: `case when code ~ '^\d{4}-\d{2}$' then right(code, 2)::int = (left(code, 4)::int + 1) % 100 else false end` |
| `academic_year_dates_check` | `academic_year` | `ends_on > starts_on` |

*   **Codes are normalised** (DD-2) by one TypeScript function in `src/server/people.ts`, which every writer and the ETL rules import (`people.ts` is hashed with every mapping rule, migration-framework DD-10):

    ```ts
    /** Trim, collapse runs of ASCII whitespace to one space, upper-case. Returns "" for a blank input. */
    export const normCode = (v: string | null | undefined): string => (v ?? "").replace(/[\t\n\v\f\r ]+/g, " ").trim().toUpperCase();
    ```

    The database never changes a code: it refuses one that breaks `<table>_code_check`. "Agree" (T-CAT-001) means: for every sample `s` in a fixed list (lower case, tabs, newlines, inner double spaces, leading/trailing spaces, `/`, `&`, NBSP, `É`), the check accepts `normCode(s)` whenever `normCode(s)` is ASCII and non-empty, and accepts `s` exactly when `normCode(s) === s` and `s` is ASCII and non-empty.
*   The existing `normCode` in `etl/rules/centre.ts` (trim and upper-case only) is removed; the centre and admission rules and `etl/checks.ts` import `people.ts`'s. Centre outcomes in P8 do not change (`' kl2-25 '` still matches `KL2-25`).
*   **Codes never change** after creation: rows reference them, so no update grant covers `code`. A wrong code is deactivated and a new row created.
*   **No deletes.** Rows are deactivated (`active = false`; for a year, `open = false`), so history keeps pointing at them.
*   **`academic_year`:** its code is the primary key, so `admission.academic_year` references it directly. Opening a year is inserting its row; `open = false` stops new admissions in that year. `starts_on` and `ends_on` are reference data (R-028; DD-6): `admittedOn` is **not** checked against them, so admissions for next year taken before it starts stay possible; the comment in `people.ts` that awaited this design is updated to say so.

### Links From Existing Tables

*   **`registration.course_code`** gains a foreign key to `course(code)` (DD-5). It refuses an unknown code from any writer; deactivation is checked only by `admit()`, so existing registrations of a deactivated course stay valid.
*   **`admission.academic_year`** gains a foreign key to `academic_year(code)`. The chained Admission No series (person-core DD-7) is independent of this table: opening a year here does not create its counter.
*   **`centre.centre_class`** (text, unused by any code) is replaced by `centre_class_id`, nullable until the Stage 3 centre form makes it required (R-023). This is a drop-and-add, a contract step justified because no code reads the column. Before Prisma's generated `DROP COLUMN`, the migration runs:

    ```sql
    do $$ begin
      if exists (select 1 from app.centre where centre_class is not null) then
        raise exception 'centre.centre_class holds values; migrate them before 0012';
      end if;
    end $$;
    ```

    No Stage 2 function sets the new column (DD-7); the Stage 3 centre form or the class-revision ticket (D-ORG-2) does.

### Access

*   **RLS** on all five tables, ENABLE and FORCE, with the 0009 setup-table pattern and permission `catalogue.manage`:

    ```sql
    create policy setup_select on app.<t> for select using (true);
    create policy setup_insert on app.<t> for insert with check ((select app.has_permission('catalogue.manage', null)));
    create policy setup_update on app.<t> for update using ((select app.has_permission('catalogue.manage', null)))
      with check ((select app.has_permission('catalogue.manage', null)));
    -- no delete policy
    ```

    Reads need a `gems_app` connection, and the app reaches the database only through `withScope`, which requires a session; so "everyone signed in can read" (G4). Session-less access is out of scope.
*   **Grants** (`gems_app`): `select, insert` on the five tables; `update (name, active)` on the three masters; `update (name, category_id, division_id, active)` on `course`; `update (starts_on, ends_on, open)` on `academic_year`; `usage` on `app.course_category_id_seq`, `app.course_division_id_seq`, `app.centre_class_id_seq`, `app.course_id_seq`. No update grant or policy on `app.centre` is added. The `gems_etl` grant (`select` on `app.course` and `app.academic_year`) lives in `scripts/etl/setup.sql`, never in a Prisma migration (migration-framework G6).
*   **Permission** row `('catalogue.manage', 'Maintain the course catalogue and academic years', true) on conflict (key) do nothing`. `sensitive = true`, like `ticket.type.manage`, so writes need a fresh step-up.

### Writes (`src/server/catalogue.ts`)

Every function validates its input first, then makes exactly one `adminWrite()` call with `catalogue.manage` and a **literal** action name (one call per action, as `tickets/setup.ts` does, so the T-AUD-009 scan finds it). Inside the transaction it locks the row it changes (`select … for update`), refuses if needed, writes, and returns. A refusal inside the transaction rolls back and writes no audit row; a missing permission gives `Forbidden`, audited as DENIED; a stale step-up gives `StepUpRequired`.

**Common rules**

*   `kind` is one of `course_category`, `course_division`, `centre_class`, checked against a fixed map of `Prisma.sql` table fragments; anything else gives `RbacError("invalid", "kind: unknown")` before any database access. No caller-supplied text reaches SQL as an identifier.
*   `code`: `normCode()`; empty gives `RbacError("invalid", "code: required")`. `name`: trimmed, 1–200 characters, else `RbacError("invalid", "name: 1-200 characters")`. Ids: safe integers, else `"id: invalid"`. `reason` (set functions): trimmed, non-empty, else `RbacError("invalid", "reason: required")` (DD-9).
*   An unknown id or code gives `RbacError("notfound", "<table> not found")`. An update with nothing to change gives `RbacError("invalid", "nothing to change")`. Setting the state a row already has gives `RbacError("invalid", "already <active|inactive|open|closed>")`.
*   A duplicate code gives `RbacError("duplicate", "a record with that code already exists", "catalogue.duplicate")` (re-wrapping `db()`'s 23505, as `setup.ts` does). A check-constraint failure (for example a non-ASCII code) gives `db()`'s `RbacError("invalid", "invalid value")`.

**Functions**

| Function | Returns | Action, target | Audit before / after |
|---|---|---|---|
| `createMaster(session, kind, { code, name })` | `{ id }` | `catalogue.create`, `targetType` = kind, no `targetId` (the id does not exist yet) | after = `{ id, code, name, active }` |
| `updateMaster(session, kind, id, { name })` | `void` | `catalogue.update`, kind, id | before/after = `{ id, code, name, active }` |
| `setMasterActive(session, kind, id, active, reason)` | `void` | `catalogue.activate` or `catalogue.deactivate` (two literal calls), kind, id | `{ active }`; reason |
| `createCourse(session, { code, name, categoryId, divisionId })` | `{ id }` | `catalogue.create`, `course`, no `targetId` | after = `{ id, code, name, categoryId, divisionId, active }` |
| `updateCourse(session, id, { name?, categoryId?, divisionId? })` | `void` | `catalogue.update`, `course`, id | before/after = the same shape |
| `setCourseActive(session, id, active, reason)` | `void` | `catalogue.activate` / `deactivate`, `course`, id | `{ active }`; reason |
| `openAcademicYear(session, { code, startsOn, endsOn })` | `{ code }` | `catalogue.create`, `academic_year`, code | after = `{ code, startsOn, endsOn, open }` |
| `updateAcademicYear(session, code, { startsOn?, endsOn? })` | `void` | `catalogue.update`, `academic_year`, code | before/after = the same shape |
| `setAcademicYearOpen(session, code, open, reason)` | `void` | `open = true` → `catalogue.activate`, `false` → `catalogue.deactivate`; `academic_year`, code | `{ open }`; reason |

*   `createCourse` and `updateCourse` (when the category or division changes) refuse an inactive or unknown category or division: `RbacError("invalid", "categoryId: inactive or unknown")` (DD-10). Existing courses keep a category or division that is later deactivated.
*   `openAcademicYear` checks `academicYearOk(code)` (`code: YYYY-YY, consecutive years`), `isoDate()` on both dates, and `endsOn > startsOn` (`endsOn: after startsOn`); a year that already exists, open or closed, gives the duplicate error.
*   Stage 2 has **no read functions**: `admit()` reads through its own query, tests read with SQL, and Stage 3 adds the list functions its screens need.

### Changes to `admit()`

In this order (the existing steps are unchanged otherwise):

1.  **Before the action**, course codes are normalised: `courseCode` = `normCode(c.courseCode)`; empty gives the existing `courses[i].courseCode: required`. The stored and returned code is the normalised one.
2.  **First thing inside the action's transaction** (after `scopedAction` has authorised): `select open from app.academic_year where code = $1`; missing or `open = false` gives `PersonError("invalid", "academicYear: not open")`.
3.  Then `select code from app.course where active and code = any($1)`; the first course (by index) not in the result gives `PersonError("invalid", "courses[i].courseCode: no such course")`. The same course twice in one admission stays allowed, as today.
4.  Then the duplicate-person logic and numbering, as today (so `SeriesMissing` can only follow an open year).

A failed check rolls back and writes no audit row (no `onFailure`), as `PersonError` does today.

### The Migration Framework

*   **Runner (step 4):** two new `ctx` fields, `courses: Set<string>` from `select code from app.course` and `academicYears: Set<string>` from `select code from app.academic_year`, **all** rows: the migration checks existence only, because legacy history legitimately names retired courses and closed years (DD-11).
*   **Registration rule:** after the existing `course_code: required` check and only when the code is non-empty, `normCode(course_code)` must be in `ctx.courses` (`course_code: no such course`); the rule writes the normalised code. Error order: `admission_key`, `course_code`, `join_date`, `status`, `register_no`.
*   **Admission rule:** after `academicYearOk` passes, the trimmed year must be in `ctx.academicYears` (`academic_year: not in the academic year master`); a year that fails the format gets only the format error. Error order unchanged otherwise: identity, `centre_code`, `academic_year`, `admitted_on`, `admission_no`.
*   **Versions:** because `people.ts` changes and is hashed with every rule, **all three rules move to version 2** (centre included); on a database that keeps approved rules, version 2 needs a new approval (migration-framework DD-10).
*   **P8 fixture:** one new defect, appended at the very end of `buildFixture()` (after the `Completed` row, so `last` and the existing defects are unchanged): a course row under the imported duplicate-number twin admission, `course_code` `XYZ`, a fresh Register No, its admission's date and status `Active`. Its only error is `course_code: no such course`.
*   The catalogue itself is not migrated in Stage 2 (Non-Goals); before a real run, the catalogue must be loaded, by a future catalogue mapping rule or the catalogue functions.

## Decisions

Accepted by the design owner on 2026-10-28; each stays PRO until the design is approved.

1.  **DD-1: Five tables with identity fields only:** course, course category, course division, centre class, academic year. Stage 3 adds fields by expand migrations.
2.  **DD-2: Course identity is a unique normalised code** with a surrogate id and one name; multi-name legacy codes are resolved by the migration's merge maps (D-MIG-4), not stored as aliases.
3.  **DD-3: The Academic Year Master is a table now**, referenced by `admission.academic_year`; opening a year is inserting its row.
4.  **DD-4: Audited server functions behind one permission** (`catalogue.manage`), no screens; approval tickets for new courses come with Stage 3 (D-CAT-2).
5.  **DD-5: `registration.course_code` references the code, not the id:** the column already holds codes, the code never changes, and the foreign key needs no data move.
6.  **DD-6: Academic-year dates are reference data** in Stage 2; `admittedOn` is not checked against them.
7.  **DD-7: No Stage 2 write path for a centre's class;** the column and its foreign key exist, set by the Stage 3 centre form or the class-revision ticket.
8.  **DD-8: Codes are printable ASCII,** so the database check and `normCode()` normalise identically whatever the database locale.
9.  **DD-9: Deactivating or reactivating** a catalogue row, or closing or reopening a year, **requires a reason**, stored in the audit row.
10. **DD-10: A course cannot be created in, or moved to, an inactive category or division;** existing courses keep theirs.
11. **DD-11: The migration checks existence only** for courses and academic years, not `active` or `open`: legacy history names retired courses and closed years.

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
| Code normalisation differs between the database and the code | A code passes one and fails the other | One TypeScript function (`normCode()`), checked against the SQL check constraint in T-CAT-001 | T-CAT-001 |
| The academic-year master and the Admission No counters drift (a year open without a counter, or the reverse) | `admit()` fails with `SeriesMissing` or `not open` | **Accepted:** both are explicit; the counter chain is person-core DD-7 | T-CAT-002 |
| After deploy no role holds `catalogue.manage`, and no year or course exists | `admit()` refuses every admission (`academicYear: not open`) on a new database | An RBAC administrator creates a role with `catalogue.manage`; its holder opens the year and creates courses before the first admission (or the migration loads them) | n/a |
| Legacy codes with non-ASCII characters | Refused by the code check | **Accepted (DD-8):** legacy codes seen so far are ASCII with `/` and `&`; Stage 0 data decides | T-CAT-001 |

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

#### 1. `docs/audit/09-test-strategy-and-acceptance-criteria.md`, `docs/audit/data/matrix-*.tsv` (Modify)

*   A T-CAT group after T-PER, in the same table format: T-CAT-001 one record per code, codes normalised (`normCode()` agrees with the checks) and unique; T-CAT-002 foreign keys and the `admit()` checks; T-CAT-003 writes need `catalogue.manage` and a fresh step-up and are audited before and after; T-CAT-004 every signed-in user reads the catalogue.
*   Tests columns: T-CAT-001…004 on R-090; T-CAT-001 and 004 on R-033.06, R-033.07, R-033.08; T-CAT-001 and 002 on R-028. Then `python -I docs/audit/tools/build_matrix.py docs/audit` and `python -I docs/requirements/tools/build_frd.py .`, committing the CSV and FRD.

#### 2. `prisma/schema.prisma`, `prisma/migrations/0012_catalogue/migration.sql` (Modify, Create)

*   The models of [Data Model](#data-model-prisma-migration-0012_catalogue).
*   The migration: generated DDL, with the `centre_class` guard placed before the generated `DROP COLUMN`; then the named checks, RLS, grants and the permission row of [Access](#access).

#### 3. `tests/fixtures.ts` (Modify)

*   `reset()` truncates the five tables (with `restart identity`), inserts `catalogue.manage`, and seeds:
    *   category `GEN` "General", division `GEN` "General";
    *   courses `DCA` "Diploma in Computer Applications", `TALLY` "Tally", `PYTHON` "Python", `DTP` "Desktop Publishing", `CCNA` "CCNA", all in `GEN`/`GEN`;
    *   academic years `2024-25` … `2028-29`, each `YYYY-06-01` to `YYYY+1-05-31`, all open (T-PER-003 still expects `SeriesMissing` for 2025-26, not `not open`).
*   Role 18 `catalogue_admin` with `catalogue.manage`, held at ALL by a new user exported as `CA = { ca: "00000000-0000-0000-0000-0000000000f1" }` (login `ca`, "Catalogue admin", token `tok-catA`). Tests that write call `setStepUp("tok-catA", 0)` first.

#### 4. `scripts/etl/setup.sql` (Modify)

*   `grant select on app.course, app.academic_year to gems_etl`.

#### 5. `src/server/people.ts` (Modify), `src/server/catalogue.ts` (Create)

*   `people.ts`: export `normCode()`; `admit()` as in [Changes to `admit()`](#changes-to-admit); the `admittedOn` comment updated (DD-6).
*   `catalogue.ts`: the functions of [Writes](#writes-srcservercatalogue-ts).

#### 6. `etl/run.ts`, `etl/types.ts`, `etl/checks.ts`, `etl/rules/*.ts`, `etl/fixture.ts` (Modify)

*   `Ctx.courses`, `Ctx.academicYears`, loaded in step 4; the two rule checks; `normCode` imported from `people.ts` in the centre and admission rules and `checks.ts` (the one in `centre.ts` removed); all three rules at version 2; the `XYZ` defect.

#### 7. Tests (Create/Modify)

*   `tests/catalogue.test.ts`:
    *   **T-CAT-001:** `normCode()` agrees with the check on the fixed sample list; creating `" dca "` gives a duplicate; a direct insert (as the admin) of an un-normalised code into each of the four code tables fails with 23514; a non-ASCII code is refused.
    *   **T-CAT-002:** a direct registration insert with an unknown course code fails with 23503 on the course foreign key; `admit()` with a deactivated course gives `courses[0].courseCode: no such course` while an existing registration of that course stays; a closed or unknown year gives `academicYear: not open`; a lower-case course code is stored upper-case.
    *   **T-CAT-003:** with step-up, `ca` creates, updates, deactivates (reason required) and reactivates a course, a master and a year, each audited with the before/after of the table above; `ST_TOKEN.sa` (no `catalogue.manage`) gets `Forbidden` and a DENIED row; without a fresh step-up, `StepUpRequired`; an inactive category is refused; an unknown `kind` is refused before any database access.
    *   **T-CAT-004:** through `withScope(T.uA, …)` (a centre user without catalogue rights), every seeded course, master and year is readable.
*   `tests/etl.test.ts`: the unit test's `ctx` gains `courses` and `academicYears`; the changed-code message reads `rule centre v2: …`; a new assertion that the `XYZ` row is REJECTED with `course_code: no such course`.
*   `tests/people.test.ts`: the composite-foreign-key insert uses course `DCA` instead of `X`, so it still tests the centre foreign key.
*   `tests/audit-catalogue.ts`, `tests/audit.test.ts`: the four actions `catalogue.create`, `catalogue.update`, `catalogue.activate`, `catalogue.deactivate`; T-AUD-009 scans `src/server/catalogue.ts` with `/"(catalogue\.[a-z0-9_.]+)"/g` on `action:` lines.

#### 8. `docs/STATUS.md`, `docs/audit/12-evidence-and-verification-log.md` (Modify)

*   Evidence entry E-034 with CI counts and the mutation checks.

### Verification Plan

*   **CI:** `bash scripts/ci.sh`; `npx vitest run` including `tests/catalogue.test.ts`.
*   **Mutation checks:**

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | Code normalised | Drop `course_code_check` | T-CAT-001 |
    | Real courses | Drop the `registration.course_code` foreign key and the `admit()` check | T-CAT-002 |
    | Controlled writes | Setup-table insert policy `with check (true)` | T-CAT-003 |
    | Audited | Skip the audit in `adminWrite` for catalogue actions | T-CAT-003 |

*Drafted with EGM*
