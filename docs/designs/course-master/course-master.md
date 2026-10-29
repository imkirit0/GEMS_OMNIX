# Course master (Stage 3, fourth piece)

*   **Author:** gtm
*   **Status:** Approved for build by the design owner on 2026-10-29, after the EGM review (steps 5–9); built the same day (evidence E-040). The design owner decided DD-1…DD-4 and accepted DD-5…DD-10 on 2026-10-29. Step 5: [`zoom_out_report.md`](zoom_out_report.md) (DD-11…DD-13); step 6: [`comprehension_report.md`](comprehension_report.md) (DD-14…DD-17); step 7: [`critic_report.md`](critic_report.md) (DD-18); step 8: [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (DD-13 revised); step 9: [`implementation_readiness_report.md`](implementation_readiness_report.md) (no new decisions).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO; every fixed list is PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

The catalogue skeleton (E-034) gave each course a code, a name, a category, a division and an active flag. This piece adds the rest of the **descriptive course record** (R-090), records **which centre classes may offer each course** (R-091), and gives head office **list and edit pages** for courses. Availability is recorded now and enforced by `admit()` only once a switch is turned on, because centres do not yet have a class (DD-2). Fees, exams and certifications are later pieces.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Catalogue | `course`, `course_category`, `course_division`, `centre_class`, `academic_year`; audited functions behind `catalogue.manage` | `docs/designs/catalogue-skeleton/`, `src/server/catalogue.ts` |
| Centre class | METRO, A++, A… (16 legacy values, R-033.06); `centre.centre_class_id` exists but no function sets it yet (catalogue DD-7) (set by `setCentreClass` since catalogue-masters DD-2) | migration 0012 |
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
*   **Setting a centre's class** (catalogue DD-7): the centre-creation piece. *(Superseded by catalogue-masters DD-2: `setCentreClass`, 2026-10-29.)*
*   **Approval tickets for new courses** (D-CAT-2): with fees in Stage 4 (DD-3).
*   **Versioning** (D-CAT-3): edits stay in place, audited.
*   **Migrating legacy courses** (Stage 0 legacy data).

## Technical Plan (Architecture)

Z-, C-, D- and I- ids are the findings of [`zoom_out_report.md`](zoom_out_report.md) (step 5), [`comprehension_report.md`](comprehension_report.md) (step 6), [`critic_report.md`](critic_report.md) (step 7) and [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (step 8).

### Data Model (migration `0016_course_master`)

New columns on `app.course`, all nullable or defaulted so existing rows stay valid:

| Column | Type | Rule (named check `course_<column>_check`) |
|---|---|---|
| `display_name` | text, null | `= btrim(...)`, 1–200 |
| `department` | text, null | `= btrim(...)`, 1–100 (free text, DD-5) |
| `duration_type` | text, null | `in ('MONTH','WEEK','DAY','NA')` |
| `duration_months`, `duration_weeks`, `duration_days`, `duration_hours` | int, null | 0–120, 0–520, 0–3650, 0–10000 |
| `capacity` | int, null | 1–100000 |
| `exam_min_days` | int, null | 0–3650 |
| `sort_order` | int, not null, default 0 | 0–100000 |
| `visible` | boolean, not null, default true | DD-12 |
| `materials_required`, `marklist_required`, `no_reg_fee`, `it_magic`, `keltron`, `internship_keltron`, `selected` | boolean, not null, default false | stored only in this piece |
| `keltron_share` | numeric(5,2), null | one check `course_keltron_share_check`: `(keltron and keltron_share is not null and keltron_share between 0 and 100) or (not keltron and keltron_share is null)` (DD-6, DD-11; I5; `is not null` added at build: without it a KELTRON course with no share makes the check null, and a null check passes, found by T-CM-001) |

*   **Grants (Z1):** `grant update (<the 19 new columns>) on app.course to gems_app`. The table-level select stays as it is.
*   **`app.course_centre_class`** (`course_id` → `course`, `centre_class_id` → `centre_class`, both restrict; primary key on the pair): RLS `setup_select` (`using (true)`), `setup_insert` and `setup_delete` on `catalogue.manage`, as 0009; `grant select, insert, delete` to `gems_app`.
*   **Prisma (Z7):** `Course` gains the 19 fields (`keltronShare Decimal? @db.Decimal(5,2)`) and `classes CourseCentreClass[]`; `CourseCentreClass` with `@@id([courseId, centreClassId])` and restrict relations; `CentreClass` gains the back-relation. Raw reads cast `keltron_share::float8`.

### Flags (I11)

| Column | Form label | Meaning in this piece |
|---|---|---|
| `visible` | Offered for admission | DD-12: an invisible course is not offered and `admit()` refuses it |
| `materials_required` | Materials required | stored |
| `marklist_required` | Marklist required | stored |
| `no_reg_fee` | No registration fee | stored (Stage 4 fees) |
| `it_magic` | IT MAGIC programme | stored (legacy programme flag) |
| `keltron` | KELTRON course | requires a share (DD-6) |
| `internship_keltron` | KELTRON internship | stored |
| `selected` | Selected course | stored (legacy "SELECTED COURSE" flag) |

### Types and Validation (`src/server/catalogue.ts`)

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
*   **`updateCourse(session, id, Partial<{ name, categoryId, divisionId } & CourseDetails>)`:** absent = unchanged; `null` clears a nullable field; `null` on a not-null field → `<field>: invalid`. Every rule, Keltron's included, is checked on the **merged** after-row; turning `keltron` off requires `keltronShare: null` in the same call. "Nothing to change" compares every field of the merged row.
*   **Messages** (`RbacError("invalid", "<field>: <rule>")`):

| Field | Rule text |
|---|---|
| `displayName` | `1-200 characters` |
| `department` | `1-100 characters` |
| `durationType` | `invalid` |
| `durationMonths` / `Weeks` / `Days` / `Hours` | `0-120` / `0-520` / `0-3650` / `0-10000` |
| `capacity` | `1-100000` |
| `examMinDays` | `0-3650` |
| `sortOrder` | `0-100000` |
| any flag | `invalid` (not a boolean) |
| `keltronShare` | `required with Keltron`, `only with Keltron`, `0-100, two decimals` |
| `classIds` | `duplicate`, `inactive or unknown` |

*   **Numbers (D2, I10):** every int field must be `Number.isSafeInteger` within its range, else its range message. The share passes when `Math.abs(x * 100 - Math.round(x * 100)) < 1e-6` and `0 <= x <= 100` (1.1, 1.15, 4.35 accepted; 12.345 refused, never rounded).
*   **Duration (DD-10):** counts stored as given, independent of the type; the summary is the non-null, non-zero counts joined as "6 months · 120 hours" (singular for 1; months, weeks, days, hours), `NA` or no counts → "—".
*   **Audit (Z2, DD-17):** create, update and activate/deactivate audit the whole row except `created_at`, the share included; `lockCourse` and the insert's `returning` list those columns.

### The Share (DD-13 revised at step 8, I3)

*   `getCourse` selects `case when app.has_permission('catalogue.manage', null) then keltron_share::float8 end as "keltronShare"`; `listCourses` never selects it; the course pages show it only to managers. Audit rows keep it (DD-17); the future audit viewer redacts it for non-managers (DD-18).

### Course Classes (`setCourseClasses`)

One `adminWrite` with the literal action `catalogue.course.classes` (`targetType: "course"`, `targetId: <id>`; in `tests/audit-catalogue.ts`, asserted by a test); locks the course row; duplicates → `classIds: duplicate`; an unknown or inactive class **newly added** → `classIds: inactive or unknown` (an assigned class deactivated later is kept, Z3); delete and insert the set; audit `{ before: { classes: [codes sorted] }, after: { classes: [...] } }`; equal sets → "nothing to change". Concurrent saves serialise on the course row lock.

### Reads

*   **`listCourses(session, { categoryId?, divisionId?, active?: boolean, q? })`** and **`getCourse(session, id)`:** plain `withScope` reads, no `authorize`; the list ordered by `sort_order, code`; `q` case-insensitive contains on code, name and display name, `%` and `_` escaped. Both return `classes` (codes), the picklists `{ categories, divisions, classes }` (active entries, plus a course's current inactive ones) and `canManage` (`app.has_permission('catalogue.manage', null)`). `getCourse` on an unknown id throws `Forbidden` (the page 404s).
*   **`canManageCatalogue(session)`** for the home link.

### Admission (`people.ts`, the admission form; DD-2, DD-12, DD-15, DD-16; I1, I2, I7)

*   `CATALOGUE_GATES = { enforceAvailability: false }`, exported from `people.ts`, mutable, committed `false` (a test asserts it; tests that switch it reset it in `afterEach`).
*   **`admit()`:** the existing course check becomes `… and active and visible` (same "no such course"). Then, when `CATALOGUE_GATES.enforceAvailability`, the codes this centre may sell are

    ```sql
    select co.code from app.course co
      join app.course_centre_class cc on cc.course_id = co.id
      join app.centre_class k on k.id = cc.centre_class_id and k.active
      join app.centre ce on ce.centre_class_id = k.id
    where ce.id = ${input.centreId} and co.code = any (${codes}::text[])
    ```

    and the first course not among them → `invalid("courses[i].courseCode", "not offered at this centre")`; a centre without a class matches nothing (DD-7). It runs before the duplicate-person lookup and takes no lock: an admission that read the set just before a change commits completes, as catalogue DD-13 accepts (D10).
*   **`admitOptions()`:** `where active and visible order by code`; each course also carries `classCodes` (its active allowed classes, from the same joins), each centre its `classCode`, and the result `enforced`.
*   **The form** (`app/students/new/form.tsx`): one exported pure function `offeredCourses(courses, centre, enforced)` (in `src/server/course-offer.ts`, client-safe) decides the list: enforcement off → all; no centre chosen → all; a centre without a class → none (DD-7); otherwise the courses whose `classCodes` include the centre's class. The form holds the selected centre in state (from the posted value), lists the offered courses, and clears a chosen course that becomes invalid. Before hydration every course is listed; the server check is the gate.
*   The migration rules are unchanged: they check course existence only (catalogue DD-11).

### Pages (`/admin/catalogue/courses`)

| Route | What |
|---|---|
| `GET /admin/catalogue/courses` | List with the GET filter form (`categoryId`, `divisionId`, `active` = `''` all, `'1'`, `'0'`, `q`); "New course" link for managers |
| `GET /admin/catalogue/courses/new` | The form (managers; others 404) |
| `GET /admin/catalogue/courses/[id]` | Read-only for non-managers; the form, the classes checkboxes and activate/deactivate for managers; the code shown read-only |
| `POST /admin/catalogue/courses/create` | `createCourse` |
| `POST /admin/catalogue/courses/[id]/save` | `op` = `details` (every field posted), `classes` (`classId` repeated), `active` (`active` = `1`/`0`, `reason`) |

*   **Form mapping:** trimmed `''` → `null`; whole-number fields must match `^\d+$` and the share `^\d{1,3}(\.\d{1,2})?$` before conversion (so `1e2` is refused with the field's message); checkboxes `=== "1"`; classes `data.getAll("classId").map(Number)`. One shared form component; an assigned inactive class shown ticked and labelled "(inactive)".
*   **Field errors (I8):** `adminPost()`, for an `RbacError` with reason `invalid` whose message matches `/^([A-Za-z]+):/`, appends `&detail=<prefix>`; other pages ignore it. The course pages show "Some values were invalid." and "Check: <label>" from `COURSE_FIELD_LABELS` (the form labels above); `ADMIN_MESSAGES` gains `"catalogue.duplicate"` ("A course with that code already exists."); `ADMIN_MESSAGES.invalid` is unchanged.
*   The home page shows a "Courses" link when `canManageCatalogue`.

### Tests

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CM-001 | G1 | Create and update with every field; absent vs null; each message; Keltron on/off on the merged row; shares 1.1, 1.15, 4.35, 100.00 (accepted) and 12.345 (refused); 1.5 and a value above the bound for an int field; direct inserts violating each check | Saved, whole-row audit incl. defaults; the listed messages; 23514 per check |
| T-CM-002 | G2 | Set, change, clear classes; add an inactive or unknown class; keep one deactivated after assignment; duplicates; the same set; a non-manager; direct SQL delete by a non-manager | Audited as codes; refused; kept; `duplicate`; "nothing to change"; Forbidden; 0 rows |
| T-CM-003 | G3 | Admit with enforcement off and on: allowed class, not allowed, centre without a class, assigned class deactivated; `admitOptions` returns `classCodes`, `classCode`, `enforced`; `offeredCourses` for off, no centre, centre without class, allowed, not allowed; for each test centre and course, `admit()` and `offeredCourses` agree; the committed default | As listed; agreement holds; `false` |
| T-CM-004 | G4 | The admin routes: create, details, classes, active; no step-up; foreign Origin; a field error's `detail` | Redirects and audit rows; step-up; 403; `detail=keltronShare` |
| T-CM-005 | G1 | The share: a manager's `getCourse` includes it; a centre user's gets null; `listCourses` never returns it | As listed |
| T-CM-006 | G3 | An invisible course | Not in `admitOptions`; `admit()` refuses "no such course"; an existing registration stays |

## Decisions

1.  **DD-1: Descriptive and duration fields with the legacy flags;** fees, certifications and exams wait (design owner, 2026-10-29).
2.  **DD-2: Availability is recorded now and enforced by `admit()` only when a switch is on** (design owner, 2026-10-29).
3.  **DD-3: `catalogue.manage` puts courses live,** as today; approval tickets wait for fees (design owner, 2026-10-29).
4.  **DD-4: Admin list and edit pages** (design owner, 2026-10-29).
5.  **DD-5: Department is free text** until a department master exists.
6.  **DD-6: A Keltron course must carry a share between 0 and 100;** other courses carry none.
7.  **DD-7: With enforcement on, a centre without a class may sell no course** (fail closed), so switching it on requires every centre to have a class. *(Amended by certifications DD-3, 2026-10-29: a centre without a class sells exactly the courses that name it.)*
8.  **DD-8: The pages live under `/admin/catalogue/courses`;** the course list is readable by any signed-in user, edits need `catalogue.manage`.
9.  **DD-9: Availability by centre class only;** special cases by region, area or centre (R-090.01) come later.
10. **DD-10: Duration fields are stored as given** (type plus up to four counts); the summary shown is computed, not stored.
11. **DD-11: The Keltron share has two decimals** (0.00–100.00) (design owner, 2026-10-29, Z7).
12. **DD-12: An invisible course is not offered on the admission form and `admit()` refuses it;** it stays active for existing learners (design owner, 2026-10-29, Z8).
13. **DD-13: Only catalogue managers see the Keltron share,** enforced in the app (`getCourse` returns it only to managers; the list never selects it) (design owner, 2026-10-29, Z9; revised at step 8, I3: the earlier column grant and definer function were dropped).
14. **DD-14: ~~The migration role may read the share~~:** moot since DD-13's revision (every role may read the column; the app shows it only to managers).
15. **DD-15: Only an active centre class allows a course to be sold;** an assignment to a class deactivated later stays on record (design owner, 2026-10-29, C9).
16. **DD-16: With enforcement on, the admission form offers only the courses the selected centre may sell** (design owner, 2026-10-29, C10).
17. **DD-17: Audit rows of course changes keep the share** (who changed it, from what to what) (design owner, 2026-10-29, C15).
18. **DD-18: The future audit viewer (T-AUD-010) shows the share inside course audit rows only to `catalogue.manage` holders;** others see it redacted (a constraint recorded for that piece) (design owner, 2026-10-29, D7).

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
| Free-text department | Spelling variants; must be cleaned before a department master can reference it | Accepted until a master (DD-5, D14) | none |
| The share moves to fee structures in Stage 4 | Its manager-only rule moves with it | Recorded for Stage 4 (D14) | none |
| Course edits change history in place | Reports change retroactively | Audited before/after (D-CAT-3 default) | T-CM-001 |

## Detailed Implementation Plan

The file-by-file plan (phases M1–M4, each ending with `bash scripts/ci.sh` exit 0) and the 25 mutation checks are in [`implementation_readiness_report.md`](implementation_readiness_report.md) (EGM step 9). Contract notes from that step, binding for the build:

*   **Existing tests (R1, R2):** T-CAT-003's course audit rows spread a test constant `COURSE_DEFAULTS` (the 19 fields at their defaults); its course activate/deactivate rows become whole rows. T-ADM-001 expects `classCode: null` on centres and `enforced: false`. The admission form's `Options` type is `Awaited<ReturnType<typeof admitOptions>>` (type-only import).
*   **Generated files (R3):** M1 runs `build_matrix.py` and `build_frd.py` and commits the matrix CSV and the FRD.
*   **Link table (R4):** both relations `onDelete: Restrict, onUpdate: Restrict`; the DDL is generated with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against a database at 0015, then checks, RLS (`enable` and `force`) and grants are added by hand.
*   **Labels (R5):** `COURSE_FIELD_LABELS`, exported from `app/admin/catalogue/courses/course-form.tsx`: Code, Name, Display name, Category, Division, Department, Duration type, Months, Weeks, Days, Hours, Capacity, Exam minimum days, Sort order, KELTRON share (%), Centre classes (`classIds`), Reason, and the flag labels above. An unknown `detail` shows no "Check:" line.
*   **Admission form (R6):** a `hydrated` flag set in `useEffect`; `offeredCourses(options.courses, hydrated ? centre : null, options.enforced)`; `centreId` in `useState` (from the posted value) with `onChange` on the centre select; each course select keyed `${n}:${centreId}` with a `defaultValue` kept only when still offered, so a remount clears an invalid choice.
*   **Read shapes (R7):** `listCourses` → `{ courses: { id, code, name, displayName, categoryId, divisionId, active, visible, sortOrder, durationType, durationMonths, durationWeeks, durationDays, durationHours, classes: string[] }[], categories, divisions, classes, canManage }` (active picklist entries, no share). `getCourse` → `{ course: { id, code, name, categoryId, divisionId, active, ...CourseDetails, classes: string[] }, categories, divisions, classes, canManage }`, picklist entries `{ id, code, name, active }` including the course's own inactive ones. `export function durationSummary(c)` in `catalogue.ts` ("6 months · 120 hours", "1 week", NA or no counts → "—"), tested in T-CM-001.
*   **Non-vacuous tests (R8):** T-CM-002 deletes a real link row as a non-manager (0 rows, row kept), inserts as one (42501), and asserts RLS enabled and forced; T-CM-005 sets a share of 37.5 first; T-CM-003 adds class `A++`, sets centre A to METRO, leaves A2 without a class, links DCA to METRO and TALLY to both, and asserts non-zero refused and accepted counts before checking agreement; T-CM-001 asserts `{ code: "23514", constraint: "course_<column>_check" }`; T-CM-006 admits before hiding; the committed default is checked on the value and on the source text of `people.ts`.
*   **Share (R9, R10, R12):** after the tolerance check the share is normalised with `Math.round(x * 100) / 100`; SQL writes `${share}::numeric`; every audited read casts `keltron_share::float8`. Direct-insert check cases use out-of-range shares (−1, 100.01, a share without Keltron, Keltron without a share); 12.345 is refused by the app only.
*   **Classes (R11):** a non-array or non-integer `classIds` → `classIds: invalid`; newly added ids are read `… and active for share`, a count mismatch → `classIds: inactive or unknown`.
*   **Form (R13):** `sortOrder` is required and pre-filled (0 on a new course).
*   **Accepted (R14, R15):** `ADMIN_MESSAGES["catalogue.duplicate"]` names a course while only course pages exist (revisit with the masters pages); prefix-less messages ("nothing to change") show the generic line, and T-CM-004 asserts they carry no `detail=`.
*   **Client safety (R16):** `src/server/course-offer.ts` has no imports; it defines `OfferCourse` and `OfferCentre`, which `people.ts` and the form import with `import type`.

*Drafted with EGM (draft step followed manually)*
