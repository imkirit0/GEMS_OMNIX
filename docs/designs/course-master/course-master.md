# Course master (Stage 3, fourth piece)

*   **Author:** gtm
*   **Status:** Draft. DD-1…DD-4 were decided by the design owner on 2026-10-29; DD-5…DD-10 are proposed here and need the owner's acceptance before the EGM review (steps 5–9).
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

*   **G1: A `catalogue.manage` holder creates and edits courses with the descriptive fields**, each change audited with before and after [T-CM-001].
*   **G2: The allowed centre classes of a course are recorded and edited**, audited [T-CM-002].
*   **G3: With the availability switch on, `admit()` refuses a course the centre's class does not allow;** with it off (the committed default), nothing changes [T-CM-003].
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

### Data Model (migration `0016_course_master`)

New columns on `app.course`, all nullable or defaulted so existing rows stay valid:

| Column | Type | Rule (named check `course_<column>_check`) |
|---|---|---|
| `display_name` | text, null | trimmed, 1–200 |
| `department` | text, null | trimmed, 1–100 (free text until a department master exists, DD-5) |
| `duration_type` | text, null | `in ('MONTH','WEEK','DAY','NA')` (SRC: Month, Week, Day, Not Applicable) |
| `duration_months`, `duration_weeks`, `duration_days`, `duration_hours` | int, null | `>= 0`; at most 120 months, 520 weeks, 3,650 days, 10,000 hours |
| `capacity` | int, null | `> 0` |
| `exam_min_days` | int, null | `>= 0` |
| `sort_order` | int, not null, default 0 | `>= 0` |
| `visible` | boolean, not null, default true | course visibility |
| `materials_required`, `marklist_required`, `no_reg_fee`, `it_magic`, `keltron`, `internship_keltron`, `selected` | boolean, not null, default false | the legacy flags (SRC) |
| `keltron_share` | numeric(5,2), null | `between 0 and 100`; required when `keltron`, null otherwise (DD-6) |

New table **`app.course_centre_class`** (`course_id` → `course`, `centre_class_id` → `centre_class`, both restrict; primary key on the pair). RLS and grants as the other catalogue tables (setup-table policy with `catalogue.manage`; select for every signed-in user), plus `delete` (an assignment can be removed).

### Functions (`src/server/catalogue.ts`)

*   **`createCourse` and `updateCourse` take the new fields** (`CourseDetails`: camelCase keys of the columns above), validated in TypeScript with the same rules before the transaction; `updateCourse` audits before and after of the changed keys, as today. A `keltron` course without a share, or a share on a non-`keltron` course → `RbacError("invalid", "keltronShare: required with Keltron")`.
*   **`setCourseClasses(session, courseId, classIds: number[])`** (new): one `adminWrite` with the literal action `catalogue.course.classes`; refuses unknown or inactive classes (`classIds: inactive or unknown`) and duplicates; replaces the course's set; audits before and after as sorted class codes; "nothing to change" when equal.
*   **`listCourses(session, { categoryId?, divisionId?, active?, q? })`** and **`getCourse(session, id)`** (new reads): for every signed-in user, as the catalogue tables are readable; ordered by `sort_order`, then code.

### Availability in `admit()` (DD-2, DD-7)

*   `CATALOGUE_POLICY.enforceAvailability` in `src/server/catalogue-policy.ts`, a mutable field like `TICKET_GATES`, committed `false`; a test asserts the committed value.
*   When true, `admit()` (after the course-active check) refuses each course whose allowed classes do not include the centre's class: `invalid("courses[i].courseCode", "not offered at this centre")`; a centre without a class refuses every course with the same message. When false, no check.

### Pages (`/admin/catalogue/courses`, DD-8)

*   **List:** filters (category, division, active, text on code or name) as a GET form (no personal data), the course rows with code, name, display name, duration summary, allowed classes; a "New course" link. Needs `catalogue.manage` to show the edit links; readable by any signed-in user.
*   **New and edit:** server-rendered forms posting to route handlers through `adminPost()` (step-up and errors as the other admin pages); the edit page also has the allowed-classes checkboxes posting to `setCourseClasses`, and the existing activate/deactivate with a reason.
*   The home page's administration links gain "Courses" for `catalogue.manage` holders.

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-CM-001 | Create and update a course with every field; invalid values (negative duration, share without Keltron, unknown duration type); direct inserts violating each check | Saved and audited before/after; field errors; 23514 per check |
| T-CM-002 | Set, change and clear a course's classes; an inactive or unknown class; the same set again; a user without `catalogue.manage` | Saved and audited as codes; refused; "nothing to change"; Forbidden |
| T-CM-003 | Admit with the switch off and on: course allowed at the centre's class, not allowed, centre without a class | Off: admitted; on: admitted / "not offered at this centre" / refused |
| T-CM-004 | The admin routes: create, edit, classes, activate; no step-up; foreign Origin | Redirects and audit rows; step-up redirect; 403 |

## Decisions

1.  **DD-1: Descriptive and duration fields with the legacy flags;** fees, certifications and exams wait (design owner, 2026-10-29).
2.  **DD-2: Availability is recorded now and enforced by `admit()` only when a switch is on** (design owner, 2026-10-29).
3.  **DD-3: `catalogue.manage` puts courses live,** as today; approval tickets wait for fees (design owner, 2026-10-29).
4.  **DD-4: Admin list and edit pages** (design owner, 2026-10-29).
5.  **DD-5 (proposed): Department is free text** until a department master exists.
6.  **DD-6 (proposed): A Keltron course must carry a share between 0 and 100;** other courses carry none.
7.  **DD-7 (proposed): With enforcement on, a centre without a class may sell no course** (fail closed), so switching it on requires every centre to have a class.
8.  **DD-8 (proposed): The pages live under `/admin/catalogue/courses`;** the course list is readable by any signed-in user, edits need `catalogue.manage`.
9.  **DD-9 (proposed): Availability by centre class only;** special cases by region, area or centre (R-090.01) come later.
10. **DD-10 (proposed): Duration fields are stored as given** (type plus up to four counts); the summary shown is computed, not stored.

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
| M1 Documents | T-CM-001…004 in audit 09; matrix links on R-090, R-091 |
| M2 Server | Migration 0016; `catalogue.ts` fields, `setCourseClasses`, reads; `catalogue-policy.ts`; `admit()` check; audit catalogue; tests |
| M3 Pages | `/admin/catalogue/courses` list, new, edit; routes; home link; tests |
| M4 Evidence | Smoke additions; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
