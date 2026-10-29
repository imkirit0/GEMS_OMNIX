# EGM Stage 9: Implementation readiness report (course master)

- **Target:** `docs/designs/course-master/course-master.md` (commit `566e7e9`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check). Read the design and every file it changes or depends on (`catalogue.ts`, `people.ts`, `person-rules.ts`, `admission-form.ts`, `admin-http.ts`, `rbac.ts`, `app/students/new/*`, migrations 0002, 0009, 0012, `prisma/schema.prisma`, `tests/catalogue.test.ts`, `tests/admission-screens.test.ts`, `tests/admin-http.test.ts`, `tests/foundation.test.ts`, `tests/audit*.ts`, `tests/fixtures.ts`, `scripts/ci.sh`, `scripts/smoke-security.mjs`, `scripts/scan-client-bundle.mjs`, `scripts/etl/setup.sql`, audit 09, the R-090/R-091 matrix rows).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 8 Major, 8 Nit** (R1–R16); no OWNER items. Verdict: buildable as written once the Majors are in the design.
- **Confirmed against the code:** 0009 has `setup_delete` to copy; `has_permission(p, null)` means an ALL-scope holder; the fixtures' `truncate … cascade` already empties the link table; only `tests/admission-screens.test.ts` and `app/students/new/page.tsx` call `admitOptions`; the `adminPost` detail change breaks no existing test (no current message matches `/^([A-Za-z]+):/`); a one-line `action:` meta passes the T-AUD-009 scan; the drift gate compares FK names and actions but not checks or grants; a raw `numeric` read is a Prisma `Decimal`, so audited reads cast `::float8`; `build_matrix.py` only warns on unknown test ids.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | Major | T-CAT-003 breaks in five places (whole-row course audit, and `setCourseActive` moves to whole rows) | `COURSE_DEFAULTS` spread into the expected rows; activate/deactivate rows become whole rows |
| R2 | Major | T-ADM-001 breaks on the new `classCode`; the form's `Options` type | Expected row gains `classCode: null`, `enforced` asserted false; `Options` from `admitOptions` (type-only) |
| R3 | Major | M1 misses the generated matrix CSV and FRD | Both generators run and their outputs committed |
| R4 | Major | Prisma's default `onUpdate` would drift from "restrict" | `onDelete: Restrict, onUpdate: Restrict`; DDL generated with `prisma migrate diff --script` |
| R5 | Major | `COURSE_FIELD_LABELS` incomplete | Full map fixed in the design |
| R6 | Major | Form mechanics left open | `hydrated` flag, `centreId` state, keyed course selects |
| R7 | Major | Read shapes and the duration summary unnamed | Exact `listCourses`/`getCourse` shapes; `durationSummary()` tested |
| R8 | Major | Several tests could pass vacuously | Real link rows, a share of 37.5, classed fixture centres, constraint names, source-text default check |
| R9 | Nit | Tolerated share differs from what is stored | Normalised with `Math.round(x * 100) / 100` |
| R10 | Nit | Share parameter type implicit | `${share}::numeric` |
| R11 | Nit | Bad `classIds` and a class deactivated while added | `classIds: invalid`; added classes read `for share` |
| R12 | Nit | `numeric(5,2)` rounds 12.345, so only the app refuses it | Direct-insert cases use out-of-range shares |
| R13 | Nit | Blank sort order | Pre-filled and `required` |
| R14 | Nit | `catalogue.duplicate` text says "course" for every master | Accepted; revisit with the masters pages |
| R15 | Nit | Prefix-less messages show the generic line | Accepted; T-CM-004 asserts no `detail=` |
| R16 | Nit | `course-offer.ts` client-safe only without imports | No imports; types imported with `import type` |

## Resolution

**Status: resolved (2026-10-29).** All sixteen applied to the design as contract notes (R14, R15 accepted). The plan below is the build plan.

## File-by-file plan (each phase ends with `bash scripts/ci.sh` exit 0)

### M1 Documents
1. **`docs/audit/09-test-strategy-and-acceptance-criteria.md`:** after T-LD (line 160), add a section `### T-CM: course master (docs/designs/course-master/course-master.md)` with T-CM-001…006. Each "Expected" is the design's Tests row plus the R8 tightenings.
2. **`docs/audit/data/matrix-03-academics-general1.tsv`:** in the tests column, append to R-090 (line 29) `,T-CM-001,T-CM-002,T-CM-004,T-CM-005`, and to R-091 (line 35) `,T-CM-002,T-CM-003,T-CM-006`. Keep 17 tab-separated cells.
3. Run `build_matrix.py` and `build_frd.py`, then commit `02-requirements-traceability-matrix.csv` and `FRD-GEMS-OMNIX.md` (R3).

### M2 Server
4. **`prisma/schema.prisma`**
   - `Course` gains the 19 fields:
     - `displayName String? @map("display_name")`, `department String?`, `durationType String? @map("duration_type")`
     - `durationMonths`, `durationWeeks`, `durationDays`, `durationHours`: `Int?` with snake maps
     - `capacity Int?`, `examMinDays Int? @map("exam_min_days")`, `sortOrder Int @default(0) @map("sort_order")`, `visible Boolean @default(true)`
     - seven flags as `Boolean @default(false)` with snake maps
     - `keltronShare Decimal? @db.Decimal(5,2) @map("keltron_share")`
     - `classes CourseCentreClass[]`
   - New model `CourseCentreClass` as in R4, with `@@id([courseId, centreClassId])`, `@@map("course_centre_class")`, `@@schema("app")`.
   - `CentreClass` gains `courses CourseCentreClass[]`.
5. **`prisma/migrations/0016_course_master/migration.sql`**
   - Header comment.
   - The generated `ALTER TABLE "app"."course" ADD COLUMN …` statements, `CREATE TABLE "app"."course_centre_class"` with its PK, and both FKs with `ON DELETE RESTRICT ON UPDATE RESTRICT` (R4).
   - 17 named checks:
     - `course_display_name_check`: `display_name = btrim(display_name) and char_length(display_name) between 1 and 200`
     - `course_department_check`: the same rule, 1–100
     - `course_duration_type_check`
     - `course_duration_{months,weeks,days,hours}_check`
     - `course_capacity_check`, `course_exam_min_days_check`, `course_sort_order_check`
     - `course_keltron_share_check` (the Data Model table)
   - The remaining checks, the ones for `visible` and the seven flags, are covered by NOT NULL boolean.
   - `alter table app.course_centre_class enable row level security` and `force row level security`. Policies: `setup_select … for select using (true)`, plus `setup_insert` (with check) and `setup_delete` (using) on `(select app.has_permission('catalogue.manage', null))`.
   - `grant select, insert, delete on app.course_centre_class to gems_app`.
   - `grant update (display_name, department, duration_type, duration_months, duration_weeks, duration_days, duration_hours, capacity, exam_min_days, sort_order, visible, materials_required, marklist_required, no_reg_fee, it_magic, keltron, internship_keltron, selected, keltron_share) on app.course to gems_app`.
6. **`src/server/course-offer.ts`** (new, no imports)
   - `export type OfferCourse = { code: string; name: string; classCodes: string[] }`
   - `export type OfferCentre = { id: number; code: string; name: string; classCode: string | null }`
   - `export function offeredCourses<T extends OfferCourse>(courses: T[], centre: OfferCentre | null | undefined, enforced: boolean): T[]`: return everything when `!enforced || !centre`; return `[]` when `centre.classCode === null`; otherwise filter on `classCodes.includes(centre.classCode)`.
7. **`src/server/catalogue.ts`**
   - Import `withScope`.
   - Add `DurationType`, `CourseDetails`, `COURSE_DEFAULTS` and the `COURSE_KEYS` list.
   - Add an `int(field, v, min, max)` validator. It uses `Number.isSafeInteger` with the range message; `null` is allowed only for nullable fields, otherwise `<field>: invalid`.
   - Add `text(field, v, max)`: trim, empty → refuse with the length message; `null` clears.
   - Add `share(v)` per the design plus R9.
   - Add `details(partial, base)`, which validates the given keys, merges, then checks Keltron (`required with Keltron`, `only with Keltron`).
   - Add one SQL fragment `COURSE_COLS`: `id, code, name, category_id as "categoryId", …, keltron_share::float8 as "keltronShare"`. Use it in `lockCourse` (`:84`) and the insert's `returning` (`:150`). `CourseRow` becomes `{ id, code, name, categoryId, divisionId, active } & CourseDetails`.
   - **`createCourse`:** merge with `COURSE_DEFAULTS` and insert every column.
   - **`updateCourse`:** merged row; "nothing to change" over `COURSE_KEYS ∪ {name, categoryId, divisionId}`; keep the existing `liveRef` calls; update every column.
   - **`setCourseActive`:** audit `{ before: row, after: { ...row, active: a } }`.
   - **`setCourseClasses(session, courseId, classIds)`** follows the design plus R11:
     - action `catalogue.course.classes` written on one line with `action:`
     - lock the course
     - read the current links joined to codes
     - compute the added ids and lock them `for share`
     - delete, then insert with `unnest(${ids}::int[])`
     - audit the sorted codes before and after
   - **`listCourses`** and **`getCourse`** as in R7. `q` uses the `listAdmissions` escape (`people.ts:229`) with `%…%` and `ilike`. `getCourse` reads the share with the `case when` expression and throws `new Forbidden("course")` on an unknown id.
   - `durationSummary`, and `canManageCatalogue` (the same shape as `rbac.ts:150`).
8. **`src/server/people.ts`**
   - `export const CATALOGUE_GATES = { enforceAvailability: false }` (mutable, no `as const`).
   - **`admit`:** `:295` gets `and active and visible`. After `:297`, add the availability query (the Admission section's SQL) behind the switch, with `invalid(\`courses[${i}].courseCode\`, "not offered at this centre")`.
   - **`admitOptions`:**
     - centres: `left join app.centre_class k on k.id = c.centre_class_id`, plus `k.code as "classCode"`
     - courses: `select co.code, co.name, coalesce(array_agg(k.code order by k.code) filter (where k.id is not null), '{}') as "classCodes" from app.course co left join app.course_centre_class cc on cc.course_id = co.id left join app.centre_class k on k.id = cc.centre_class_id and k.active where co.active and co.visible group by co.id order by co.code`
     - return `{ centres, years, courses, today, enforced: CATALOGUE_GATES.enforceAvailability }`
     - type with `import type { OfferCentre, OfferCourse } from "./course-offer"`
9. **`tests/audit-catalogue.ts`:** add `"catalogue.course.classes"` at line 22.
10. **`tests/catalogue.test.ts`:** apply the R1 fixes.
11. **`tests/admission-screens.test.ts`:** apply the R2 fix at `:55`.
12. **`tests/course-master.test.ts`** (new): T-CM-001, 002, 003, 005, 006 (server-level, using fixtures `CA` = `tok-catA`, `T.uA`, `ST_TOKEN.sr`), with the R8 setups and `afterEach(() => { CATALOGUE_GATES.enforceAvailability = false })`. Include the literal `"catalogue.course.classes"` in an audit-row assertion.
13. `tests/fixtures.ts`: no change needed (truncate CASCADE covers the link table).

### M3 Pages
14. **`src/server/admin-http.ts`:** in the `RbacError` branch (`:33`), add `const f = e.reason === "invalid" ? /^([A-Za-z]+):/.exec(e.message)?.[1] : undefined;` and return `withError(...) + (f ? \`&detail=${f}\` : "")`. `ADMIN_MESSAGES` gains `"catalogue.duplicate": "A course with that code already exists."`.
15. **`app/admin/catalogue/courses/course-form.tsx`** (server component, no "use client"):
    - `COURSE_FIELD_LABELS` (R5)
    - `CourseForm({ action, course?, picklists })` with all fields; the share input is shown only when `canManage`
    - inactive picklist entries labelled "(inactive)"
    - `export function CourseErrors({ error, detail })` renders `ADMIN_MESSAGES[error]` for keys other than `invalid`. For `invalid` it renders "Some values were invalid." and "Check: <label>".
16. **`app/admin/catalogue/courses/page.tsx`:** GET filters from `searchParams`; `active` `'1'` → true, `'0'` → false, anything else → all; `categoryId`/`divisionId` only when `/^\d+$/`. Call `pageRead(s => listCourses(s, f))`, render the table with `durationSummary`, and show "New course" when `canManage`.
17. **`app/admin/catalogue/courses/new/page.tsx`:** `notFound()` unless `canManage` (reuse `listCourses` for picklists and `canManage`).
18. **`app/admin/catalogue/courses/[id]/page.tsx`:** check `/^\d+$/` else `notFound()`; call `getCourse`; managers get the form, the classes checkboxes (`name="classId"`) and the activate/deactivate form with `reason`; everyone else gets a read-only view (no share).
19. **`app/admin/catalogue/courses/form-fields.ts`** (or inline in the routes): `courseFields(f)` maps:
    - trimmed `''` → `null`
    - `int = s => s === "" ? null : /^\d+$/.test(s) ? Number(s) : NaN`, which makes the server give the range message
    - share `/^\d{1,3}(\.\d{1,2})?$/` → Number, else `NaN`
    - checkboxes `=== "1"`
    - `durationType` `''` → `null`
20. **`app/admin/catalogue/courses/create/route.ts`:** `adminPost(req, "/admin/catalogue/courses/new", …)` calls `createCourse` and returns `/admin/catalogue/courses/${id}?saved=1`. Export with `safeRoute`, as in the ticket-types routes.
21. **`app/admin/catalogue/courses/[id]/save/route.ts`:** switch on `op`:
    - `details` → `updateCourse` (every field)
    - `classes` → `setCourseClasses(session, id, data.getAll("classId").map(Number))`
    - `active` → `setCourseActive(session, id, f.active === "1", f.reason ?? "")`
    - default → `RbacError("invalid", "unknown operation")`
22. **`app/students/new/form.tsx`:** apply R6. Import `offeredCourses` from `@/server/course-offer`; take the `Options` type from admitOptions.
23. **`app/page.tsx`:** add `canManageCatalogue(session)` to the `Promise.all` (`:13`); show `<a href="/admin/catalogue/courses">Courses</a>` when true.
24. **`tests/course-master.test.ts`:** add T-CM-004, using route imports in the `tests/admin-http.test.ts` style. Cover:
    - create, details, classes and active, each with redirect and audit row
    - stale step-up → `/stepup?next=…`
    - foreign Origin → 403
    - `keltron=1` with an empty share → location contains `error=invalid&detail=keltronShare`
    - "nothing to change" → no `detail=`

### M4 Evidence
25. **`scripts/smoke-security.mjs`:** after `:131`, set SMKC to `keltron=true, keltron_share=37.5` by SQL. Then check:
    - `viewer` GET `/admin/catalogue/courses` → 200 and contains SMKC
    - GET `/admin/catalogue/courses/<SMKC id>` → 200 and does not contain `37.5`, in both HTML and RSC payload
    - `/admin/catalogue/courses/987654321` and `/admin/catalogue/courses/new` → both 404 for viewer
    - POST `/admin/catalogue/courses/create` with `origin: https://evil.example` → 403
    - existing admission smoke still passes (SMKC is visible by default)
26. Run the mutation checks below, then save `evidence/ci-course-master-2026-10-29.txt`.
27. **`docs/audit/12-evidence-and-verification-log.md`:** add E-040.
28. **`docs/STATUS.md`:** add the row and update the "Last updated" line.
29. **The design:** status update and links to the reports.

## Mutation checks

| # | Mutation | File | Test that must fail |
|---|---|---|---|
| 1 | Drop `and visible` from the `admit` course check | people.ts | T-CM-006 |
| 2 | Drop `and visible` from `admitOptions` | people.ts | T-CM-006 |
| 3 | Drop `and k.active` from the availability join | people.ts | T-CM-003 (deactivated assigned class) |
| 4 | Commit `enforceAvailability: true` | people.ts | T-CM-003 (committed default) and T-ADM-001 `enforced` |
| 5 | `offeredCourses` returns all when `classCode === null` | course-offer.ts | T-CM-003 (no class; agreement) |
| 6 | Remove the `::float8` cast in `COURSE_COLS` | catalogue.ts | T-CM-001 (whole-row audit with a share) |
| 7 | Omit `keltron_share` from `COURSE_COLS` | catalogue.ts | T-CM-001 audit, T-CAT-003 |
| 8 | `getCourse` selects `keltron_share::float8` without the `case` | catalogue.ts | T-CM-005 |
| 9 | Add the share to `listCourses` | catalogue.ts | T-CM-005 |
| 10 | Validate Keltron on the input instead of the merged row | catalogue.ts | T-CM-001 (turning Keltron off with the share left set) |
| 11 | Share check rounds instead of refusing | catalogue.ts | T-CM-001 (12.345) |
| 12 | Allow an inactive class when newly added | catalogue.ts | T-CM-002 |
| 13 | Refuse an assigned class that was deactivated later | catalogue.ts | T-CM-002 (kept) |
| 14 | Rename the action to a computed string | catalogue.ts | T-AUD-009 coverage gate |
| 15 | Drop `setup_delete`'s permission check (`using (true)`) | 0016 | T-CM-002 (direct delete) |
| 16 | Drop `force row level security` on the link table | 0016 | T-CM-002 RLS assertion |
| 17 | Drop `course_capacity_check` (and each other check in turn) | 0016 | T-CM-001 (23514 with that constraint name) |
| 18 | Drop `keltron_share` from the column grant | 0016 | T-CM-001 (update with a share → Forbidden) |
| 19 | `onUpdate: Cascade` on `CourseCentreClass` | schema.prisma | drift gate (ci.sh step) |
| 20 | `adminPost` without `detail` | admin-http.ts | T-CM-004 |
| 21 | `adminPost` adds a detail for every reason | admin-http.ts | T-CM-004 ("nothing to change" has none) |
| 22 | The `[id]` page shows the share to non-managers | [id]/page.tsx | smoke "no 37.5" |
| 23 | `/new` reachable by a non-manager | new/page.tsx | smoke 404 |
| 24 | Wrong pluralisation in `durationSummary` | catalogue.ts | T-CM-001 summary cases |
| 25 | Remove the `int()` range check for `durationHours` | catalogue.ts | T-CM-001 (`durationHours: 0-10000`) |
