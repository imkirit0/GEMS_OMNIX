# Course master (Stage 3, fourth piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-4 and accepted DD-5…DD-10 on 2026-10-29; build approval follows the EGM review (steps 5–9). Step 5: [`zoom_out_report.md`](zoom_out_report.md) (DD-11…DD-13); step 6: [`comprehension_report.md`](comprehension_report.md) (DD-14…DD-17).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO; every fixed list is PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

The catalogue skeleton (E-034) gave each course a code, a name, a category, a division and an active flag. This piece adds the rest of the **descriptive course record** (R-090), records **which centre classes may offer each course** (R-091), and gives head office **list and edit pages** for courses. Availability is recorded now and enforced by `admit()` only once a switch is turned on, because centres do not yet have a class (DD-2). Fees, exams and certifications are later pieces.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Catalogue | `course`, `course_category`, `course_division`, `centre_class`, `academic_year`; audited functions behind `catalogue.manage` | `docs/designs/catalogue-skeleton/`, `src/server/catalogue.ts` |
| Centre class | METRO, A++, A… (16 legacy values, R-033.06); `centre.centre_class_id` exists but no function sets it yet (catalogue DD-7) | migration 0012 |
| Availability | Which centre classes may sell a course (D-CAT-1) | this design |
| `adminWrite()` | Permission check, fresh step-up, the change and its audit row in one transaction | `src/server/rbac.ts` |
| R-, D-, T- ids | Requirements, decisions, tests | `docs/audit/` |

## The Problem

1.  **A course record has no description.** Duration, department, capacity and the legacy flags exist only in the legacy system.
2.  **Nothing records where a course may be sold.** D-CAT-1 keeps centre class as the rule; the legacy assignment screen crashes (R-091, REC).
3.  **Head office has no screen** for courses; changes need code.

## Goals

*   **G1: A `catalogue.manage` holder creates and edits courses with the descriptive fields**, each change audited with before and after; only managers see the Keltron share [T-CM-001, T-CM-005].
*   **G2: The allowed centre classes of a course are recorded and edited**, audited [T-CM-002].
*   **G3: With the availability switch on, `admit()` refuses a course the centre's active class does not allow, and the form offers only allowed courses;** with it off (the committed default), nothing changes; invisible courses are never offered [T-CM-003, T-CM-006].
*   **G4: Head office lists, filters, creates and edits courses on admin pages** [T-CM-004].

## Non-Goals

*   **Fee rows and fee types** (R-090 "fee rows per Fee Type"): Stage 4, behind the finance gate.
*   **Certifications, exams, curriculum, subjects** (R-090, R-092, R-152.01, R-033.09): their own masters, later.
*   **Special-case availability by region, area or centre** (R-090.01): later; this piece records availability by centre class only.
*   **Setting a centre's class** (catalogue DD-7): the centre-creation piece.
*   **Approval tickets for new courses** (D-CAT-2): with fees in Stage 4 (DD-3).
*   **Versioning** (D-CAT-3): edits stay in place, audited.
*   **Migrating legacy courses** (Stage 0 legacy data).

## Technical Plan (Architecture)

Z- and C- ids are the findings of [`zoom_out_report.md`](zoom_out_report.md) (step 5) and [`comprehension_report.md`](comprehension_report.md) (step 6).

### Data Model (migration `0016_course_master`)

New columns on `app.course`, all nullable or defaulted so existing rows stay valid:

| Column | Type | Rule (named check `course_<column>_check`) |
|---|---|---|
| `display_name` | text, null | `= btrim(...)`, 1–200 |
| `department` | text, null | `= btrim(...)`, 1–100 (free text, DD-5) |
| `duration_type` | text, null | `in ('MONTH','WEEK','DAY','NA')` |
| `duration_months`, `duration_weeks`, `duration_days`, `duration_hours` | int, null | 0–120, 0–520, 0–3650, 0–10000 |
| `capacity` | int, null | `> 0` |
| `exam_min_days` | int, null | `>= 0` |
| `sort_order` | int, not null, default 0 | `>= 0` |
| `visible` | boolean, not null, default true | DD-12 |
| `materials_required`, `marklist_required`, `no_reg_fee`, `it_magic`, `keltron`, `internship_keltron`, `selected` | boolean, not null, default false | stored only in this piece (Z8) |
| `keltron_share` | numeric(5,2), null | `between 0 and 100`; `course_keltron_share_check`: `(keltron and keltron_share is not null) or (not keltron and keltron_share is null)` (DD-6, DD-11) |

*   **Grants (Z1):** `grant update (<the 19 new columns>) on app.course to gems_app`.
*   **The share for managers only (DD-13, C1–C3):** `revoke select on app.course from gems_app; grant select (<every column except keltron_share>) on app.course to gems_app`. No app query names `keltron_share` except in `insert` and `update … set`. Reads go through

    ```sql
    create function app.course_keltron_share(p_course_id int) returns numeric
    language sql volatile security definer set search_path = pg_catalog, app as $$
      select case when app.has_permission('catalogue.manage', null)
        then (select keltron_share from app.course where id = p_course_id) end $$;
    revoke all on function app.course_keltron_share(int) from public;
    grant execute on function app.course_keltron_share(int) to gems_app;
    ```

    `volatile`, so it sees rows written earlier in the same statement's transaction; added to the T-RLS-005 inventory between `can_grant_permission` and `has_permission`. Read back as `app.course_keltron_share(id)::float8 as "keltronShare"`.
*   **Checked queries (C3):** every current `gems_app` query on `course` names its columns (`catalogue.ts` `lockCourse` and the insert's `returning`; `people.ts` `getPerson`, `admitOptions`, `admit`); tests as other users read `code`. The Prisma model API (`tx.course.findMany()`) must not be used from `gems_app`: it selects every column. The migration role `gems_etl` keeps its table-level select and may read the share (accepted, DD-14).
*   **`app.course_centre_class`** (`course_id` → `course`, `centre_class_id` → `centre_class`, both restrict; primary key on the pair): RLS `setup_select` (`using (true)`), `setup_insert` and `setup_delete` on `catalogue.manage`, as 0009; `grant select, insert, delete` to `gems_app`.
*   **Prisma (Z7):** `Course` gains the 19 fields (`keltronShare Decimal? @db.Decimal(5,2)`) and `classes CourseCentreClass[]`; `CourseCentreClass` with `@@id([courseId, centreClassId])` and restrict relations; `CentreClass` gains the back-relation.

### Types and Validation (`src/server/catalogue.ts`; C4–C6)

```ts
export type DurationType = "MONTH" | "WEEK" | "DAY" | "NA";
export type CourseDetails = {
  displayName: string | null; department: string | null; durationType: DurationType | null;
  durationMonths: number | null; durationWeeks: number | null; durationDays: number | null; durationHours: number | null;
  capacity: number | null; examMinDays: number | null; sortOrder: number;
  visible: boolean; materialsRequired: boolean; marklistRequired: boolean; noRegFee: boolean; itMagic: boolean;
  keltron: boolean; internshipKeltron: boolean; selected: boolean; keltronShare: number | null;
};
```

*   **`createCourse(session, { code, name, categoryId, divisionId } & Partial<CourseDetails>)`:** absent keys take the column defaults.
*   **`updateCourse(session, id, Partial<{ name, categoryId, divisionId } & CourseDetails>)`:** absent = unchanged; `null` clears a nullable field; `null` on a not-null field → `<field>: invalid`. Every rule, including Keltron's, is checked on the **merged** after-row; turning `keltron` off requires `keltronShare: null` in the same call. "Nothing to change" compares every field of the merged row.
*   **Messages** (`RbacError("invalid", "<field>: <rule>")`):

| Field | Rule text |
|---|---|
| `displayName` | `1-200 characters` |
| `department` | `1-100 characters` |
| `durationType` | `invalid` |
| `durationMonths` / `Weeks` / `Days` / `Hours` | `0-120` / `0-520` / `0-3650` / `0-10000` (whole numbers) |
| `capacity` | `more than 0` |
| `examMinDays`, `sortOrder` | `0 or more` |
| any flag | `invalid` (not a boolean) |
| `keltronShare` | `required with Keltron`, `only with Keltron`, `0-100, two decimals` (a third decimal is refused, never rounded) |
| `classIds` | `duplicate`, `inactive or unknown` |

*   **Duration (C8, DD-10):** the counts are stored as given, independent of the type; the summary shown is the non-null, non-zero counts joined as "6 months · 120 hours" (singular for 1, in the order months, weeks, days, hours); `NA` or no counts → "—".
*   **Audit (Z2, C14, DD-17):** `createCourse`, `updateCourse` and the activate/deactivate functions audit the whole row except `created_at`, the share included (`lockCourse` reads it through the definer function; `createCourse`'s `after` takes it from the validated input).

### Course Classes (`setCourseClasses`; C16)

`setCourseClasses(session, courseId, classIds: number[])`: one `adminWrite` with the literal action `catalogue.course.classes`, `targetType: "course"`, `targetId: <id>`; locks the course row (`lockCourse`); duplicates → `classIds: duplicate`; an unknown or inactive class **newly added** → `classIds: inactive or unknown` (an assigned class deactivated later is kept, Z3); delete and insert the set; audit `{ before: { classes: [codes sorted] }, after: { classes: [...] } }`; equal sets → "nothing to change".

### Reads (C11, C17, C19)

*   **`listCourses(session, { categoryId?, divisionId?, active?: boolean, q? })`** and **`getCourse(session, id)`**: plain `withScope` reads, no `authorize` (every signed-in user). They return the courses (with `classes` as codes, and `keltronShare` from the definer function, so null for non-managers), the picklists `{ categories, divisions, classes }` (active entries, plus a course's current inactive ones), and `canManage` from `app.has_permission('catalogue.manage', null)`. `q`: case-insensitive contains on code, name and display name, `%` and `_` escaped. `getCourse` on an unknown id throws `Forbidden`, so `pageRead` answers 404.
*   **`canManageCatalogue(session)`** (new, like `canAdminister`) for the home link.

### Admission (`people.ts`; C9, C10, DD-12, DD-15, DD-16)

*   `CATALOGUE_GATES = { enforceAvailability: false }`, exported from `people.ts`, mutable, committed `false` (a test asserts it).
*   **`admit()`:** the existing course check becomes `… and active and visible` (same "no such course"). Then, when `CATALOGUE_GATES.enforceAvailability`:

    ```sql
    select co.code from app.course co
      join app.course_centre_class cc on cc.course_id = co.id
      join app.centre_class k on k.id = cc.centre_class_id and k.active
      join app.centre ce on ce.centre_class_id = cc.centre_class_id
    where ce.id = ${centreId} and co.code = any (${codes}::text[])
    ```

    the first course not in the result → `invalid("courses[i].courseCode", "not offered at this centre")`; a centre without a class matches nothing (DD-7). This runs before the duplicate-person lookup.
*   **`admitOptions()`:** `where active and visible order by code` (order unchanged); with enforcement on it returns, per offered centre, only the courses that pass the same rule (`courses` becomes `{ code, name, centreIds }`, and the form lists a course only for the selected centre's ids).
*   The migration rules are unchanged: they check course existence only (catalogue DD-11), never visibility or availability.

### Pages (`/admin/catalogue/courses`; C7, C12, C13; DD-8)

| Route | What |
|---|---|
| `GET /admin/catalogue/courses` | List with the GET filter form (`categoryId`, `divisionId`, `active` = `''` all, `'1'`, `'0'`, `q`); "New course" link for managers |
| `GET /admin/catalogue/courses/new` | The form (managers; others 404) |
| `GET /admin/catalogue/courses/[id]` | Read-only for non-managers; the form, the classes checkboxes and activate/deactivate for managers; the code is shown read-only (codes never change) |
| `POST /admin/catalogue/courses/create` | `createCourse` |
| `POST /admin/catalogue/courses/[id]/save` | `op` = `details` (every field posted), `classes` (`classId` repeated), `active` (`active` = `1`/`0`, `reason`) |

*   **Form mapping:** trimmed `''` → `null` for text and number fields; numbers by `Number()` (NaN → that field's message); checkboxes `=== "1"`; classes `data.getAll("classId").map(Number)`. One shared form component for new and edit; an assigned inactive class is shown ticked and labelled "(inactive)".
*   **Field errors (Z4):** `adminPost()`, for an `RbacError` with reason `invalid` whose message matches `/^([A-Za-z]+(\[\d+\])?):/`, appends `&detail=<prefix>` (URL-encoded); other errors get no detail. The course pages hold `COURSE_FIELD_LABELS` in the shared form module and show "Check: <label>"; an unknown detail shows nothing extra. `ADMIN_MESSAGES` gains `"catalogue.duplicate"`; the generic `invalid` text becomes "Some values were invalid." (the users pages' scope hint moves into those pages).
*   The home page shows a "Courses" link when `canManageCatalogue`.

### Tests

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CM-001 | G1 | Create and update with every field; absent vs null; each message; Keltron on/off on the merged row; a third decimal; direct inserts violating each check | Saved, whole-row audit incl. defaults; the listed messages; 23514 per check |
| T-CM-002 | G2 | Set, change, clear classes; add an inactive or unknown class; keep one deactivated after assignment; duplicates; the same set; a non-manager; direct SQL delete by a non-manager | Audited as codes; refused; kept; `duplicate`; "nothing to change"; Forbidden; 0 rows |
| T-CM-003 | G3 | Admit with enforcement off and on: allowed class, not allowed, centre without a class, assigned class deactivated; `admitOptions` with enforcement on; the committed default | Off: admitted; on: admitted / refused / refused / refused; options filtered; `false` |
| T-CM-004 | G4 | The admin routes: create, details, classes, active; no step-up; foreign Origin; a field error's `detail` | Redirects and audit rows; step-up; 403; `detail=keltronShare` |
| T-CM-005 | G1 | The share: a manager's reads include it; a centre user's omit it; direct `select keltron_share` as `gems_app`; the create audit's `after` | Present; null; 42501; the given share |
| T-CM-006 | G3 | An invisible course | Not in `admitOptions`; `admit()` refuses "no such course"; an existing registration stays |

## Decisions

1.  **DD-1: Descriptive and duration fields with the legacy flags;** fees, certifications and exams wait (design owner, 2026-10-29).
2.  **DD-2: Availability is recorded now and enforced by `admit()` only when a switch is on** (design owner, 2026-10-29).
3.  **DD-3: `catalogue.manage` puts courses live,** as today; approval tickets wait for fees (design owner, 2026-10-29).
4.  **DD-4: Admin list and edit pages** (design owner, 2026-10-29).
5.  **DD-5: Department is free text** until a department master exists.
6.  **DD-6: A Keltron course must carry a share between 0 and 100;** other courses carry none.
7.  **DD-7: With enforcement on, a centre without a class may sell no course** (fail closed), so switching it on requires every centre to have a class.
8.  **DD-8: The pages live under `/admin/catalogue/courses`;** the course list is readable by any signed-in user, edits need `catalogue.manage`.
9.  **DD-9: Availability by centre class only;** special cases by region, area or centre (R-090.01) come later.
10. **DD-10: Duration fields are stored as given** (type plus up to four counts); the summary shown is computed, not stored.
11. **DD-11: The Keltron share has two decimals** (0.00–100.00) (design owner, 2026-10-29, Z7).
12. **DD-12: An invisible course is not offered on the admission form and `admit()` refuses it;** it stays active for existing learners (design owner, 2026-10-29, Z8).
13. **DD-13: Only catalogue managers see the Keltron share,** enforced by a column grant and a definer function (design owner, 2026-10-29, Z9).
14. **DD-14: The migration role may read the share** (an operator tool; accepted) (design owner, 2026-10-29, C3).
15. **DD-15: Only an active centre class allows a course to be sold;** an assignment to a class deactivated later stays on record (design owner, 2026-10-29, C9).
16. **DD-16: With enforcement on, the admission form offers only the courses the selected centre may sell** (design owner, 2026-10-29, C10).
17. **DD-17: Audit rows of course changes keep the share** (who changed it, from what to what) (design owner, 2026-10-29, C15).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| D-CAT-1 | Academics | Availability by centre class | Recorded; enforcement off |
| D-CAT-2 | Academics, Accounts | Who approves new courses | `catalogue.manage` |
| D-CAT-3 | Academics | Versioning | Edit in place, audited |
| D-ORG-2 | Operations | Centre class revisable | Not set here |
| X5 | Academics | Course counts | Not seeded from legacy |

## Alternatives Considered

### Alternative A: Enforce Availability Now

*   **Pros:** Centres cannot sell a course their class does not allow.
*   **Cons:** No centre has a class yet; every admission would be refused.
*   **Reason for Rejection:** DD-2.

### Alternative B: A Separate Course-Details Table

*   **Pros:** The skeleton table stays as it was.
*   **Cons:** The fields have no different write path or permission; a join for nothing.
*   **Reason for Rejection:** Columns on `course` (the skeleton was designed for expand migrations).

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| Switching enforcement on before centres have classes | Every admission refused | DD-7 makes this visible; the switch is one constant | T-CM-003 |
| Free-text department | Spelling variants | Accepted until a master (DD-5) | none |
| Course edits change history in place | Reports change retroactively | Audited before/after (D-CAT-3 default) | T-CM-001 |

## Detailed Implementation Plan

Outline; the file-by-file plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| M1 Documents | T-CM-001…006 in audit 09; matrix links on R-090, R-091 |
| M2 Server | Migration 0016 (columns, checks, grants, share column grant and definer function, link table); `schema.prisma`; `catalogue.ts` fields, `setCourseClasses`, reads; `CATALOGUE_GATES` and the visible/availability checks in `people.ts`; audit catalogue entry and test literal; T-RLS-005 inventory; tests |
| M3 Pages | `/admin/catalogue/courses` list, new, edit; routes; home link; tests |
| M4 Evidence | Smoke additions; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
