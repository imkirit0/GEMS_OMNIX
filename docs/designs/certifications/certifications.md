# Certifications and special-case availability (Stage 3, seventh piece)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-4 were taken as the recommended options under the owner's standing instruction of 2026-10-29 ("agree on the recommended option and work on everything planned"); build approval follows the EGM review (steps 5–9). Steps 5–7 ran in parallel: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md) (no new decisions).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`. Statements in the Technical Plan without a class are PRO; every seeded or fixed list is PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

This piece finishes the Stage 3 part of WF2 (SRC, WF p. 3). It adds three things:

*   a **certification master** (R-092);
*   each course's **mandatory and optional certifications** (R-090);
*   **special-case availability** (R-090.01): a course offered only at named centres.

Exams (R-114, Stage 6) and fee heads (R-059, Stage 4) are later pieces.

## The Problem

1.  No certification body or voucher is recorded, so a course cannot say which certifications it carries. Stage 6 certificates and supply need them.
2.  Tie-up and KELTRON courses can be sold only by named centres. The class rule (course-master DD-2) cannot express that.

## Goals

*   **G1:** a `catalogue.manage` holder maintains certifications (code, name, type, description, active), audited. Everyone signed in reads them [T-CC-001].
*   **G2:** a course's mandatory and optional certifications are set on the course page, audited by codes [T-CC-002].
*   **G3:** a course's special-case centres are set on the course page, audited by codes. With availability enforced, a course that has named centres is offered only at those centres, and `admit()` and the form agree [T-CC-003].
*   **G4:** the pages and routes work with step-up, same origin, field errors and 404 parity [T-CC-004].

## Non-Goals

*   Exams, the exam-certification mapping, the registration form master (R-114, Stage 6).
*   Fee heads and fee assignment (R-059, Stage 4).
*   Special cases by region or area (R-090.01 also names them): later. Named centres cover the WF's "only named centres may offer".
*   Vouchers and licences as stock (R-140, Stage 6 supply).

## Technical Plan (Architecture)

### Data model (migration `0019_certifications`)

**`app.certification`:**

*   `id` serial, `code` (unique, `certification_code_check` = the 0012 code rule), `name` (`= btrim`, 1–200), `type` (`check (type in ('VOUCHER','LICENCE'))`), `description` (nullable, `= btrim`, 1–1000, no control characters except tab, LF and CR), `active` (default true), `created_at`.
*   RLS uses the 0012 setup pattern: `setup_select` with `using (true)`; `setup_insert` and `setup_update` require `catalogue.manage` at ALL scope; there is no delete policy.
*   `gems_app` gets `select, insert`, `update (name, type, description, active)`, and usage on the sequence.

**`app.course_certification`:**

*   `(course_id → course, certification_id → certification, mandatory boolean not null)`; primary key `(course_id, certification_id)`; Restrict/Restrict.
*   RLS as `course_centre_class` (0016): `setup_select` `true`; `setup_insert` and `setup_delete` require `catalogue.manage`.
*   `gems_app` gets `select, insert, delete`.

**`app.course_centre`** (the special-case centres):

*   `(course_id → course, centre_id → centre)`; primary key `(course_id, centre_id)`; Restrict/Restrict.
*   Because it has a `centre_id` column, T-RLS-002 requires ENABLE, FORCE and all four command policies:
    *   `course_centre_select` `using (true)`: catalogue data, readable by every session. Centre names still come through `app.centre`'s own RLS.
    *   `course_centre_insert` and `course_centre_delete` require `catalogue.manage` at ALL scope.
    *   `course_centre_update` uses the same expression, but `gems_app` has no update grant, so no update can happen.
*   `gems_app` gets `select, insert, delete`. The table joins the T-RLS-002 expected list.

**Prisma.** Three models and their back-relations (`Course`, `Centre`), so the drift gate agrees. Checks are hand-written.

### Server (`src/server/catalogue.ts`)

**Certifications.** These are their own functions, not the plain masters: they have type and description. Their audit actions reuse `catalogue.create`, `.update`, `.activate` and `.deactivate`, with `targetType: "certification"`.

*   `listCertifications(session)` returns `{ rows: { id, code, name, type, description, active }[], canManage }`, ordered by code, inactive rows included. Every signed-in user may read it.
*   `createCertification(session, { code, name, type, description? })` validates before the database:
    *   `code`: the catalogue code rule;
    *   `name: 1-200 characters`;
    *   `type: one of VOUCHER, LICENCE`;
    *   `description: 1-1000 characters` and `description: invalid characters`.

    It runs inside `unique()`, so a duplicate code is `catalogue.duplicate`. It audits the whole row.
*   `updateCertification(session, id, { name?, type?, description? })` locks the row `for update`. A `null` description clears it. No change is "nothing to change". It audits before and after.
*   `setCertificationActive(session, id, active, reason)` makes two literal `adminWrite` calls with a required reason, as `setMasterActive` does.

**`setCourseCertifications(session, courseId, items: { certificationId: number; mandatory: boolean }[])`** (action `catalogue.course.certifications`, on one line). This is the `setCourseClasses` pattern:

1.  Validate before the database. Each case raises its own message:
    *   not an array, more than 100 items, a non-integer id, or a non-boolean `mandatory`: `certifications: invalid`;
    *   a repeated id: `certifications: duplicate`.
2.  Lock the course.
3.  Read the current links.
4.  Read every id that is not currently linked with `… and active for share`. A count mismatch is `certifications: inactive or unknown`. An inactive certification that is already linked is kept, even when its `mandatory` flag changes.
5.  Compare the same set with the same flags: "nothing to change".
6.  Delete, then insert the new set.
7.  Audit `{ before: { mandatory: [codes], optional: [codes] }, after: { … } }`, with sorted codes.

**`setCourseCentres(session, courseId, centreIds: number[])`** (action `catalogue.course.centres`):

1.  Validate before the database:
    *   not an array, more than 500 ids, or a non-integer: `centres: invalid`;
    *   a repeated id: `centres: duplicate`.
2.  Lock the course.
3.  Every new id must exist in `app.centre`. A manager holds ALL scope and sees every centre. A mismatch is `centres: unknown`.
4.  Compare the same set: "nothing to change".
5.  Delete, then insert.
6.  Audit `{ before: { centres: [codes] }, after: { centres: [codes] } }`. The empty set returns the course to the class rule (DD-3).

**Reads:**

*   `getCourse` adds:
    *   `certifications: { id, code, name, type, mandatory, active }[]`;
    *   `centres: { id, code, name }[]`, the special-case centres, ordered by code;
    *   for managers only, two pickers: `certificationPicklist` (active certifications plus the course's own) and `centrePicklist` (every centre, ordered by code).
*   `listCourses` rows add `specialCase: boolean` (the course has named centres).

### Availability (`people.ts`, `course-offer.ts`; DD-3)

**The rule.** With `CATALOGUE_GATES.enforceAvailability` on, a course may be sold at centre C when either of these holds:

*   the course has named centres, and C is one of them;
*   it has none, and C's active class is linked to it (unchanged).

**`admit()`** replaces the availability query with this one, keeping the same message `not offered at this centre`:

```sql
select co.code from app.course co
where co.code = any ($codes::text[]) and case
  when exists (select 1 from app.course_centre x where x.course_id = co.id)
    then exists (select 1 from app.course_centre x where x.course_id = co.id and x.centre_id = $centre)
  else exists (select 1 from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active
               join app.centre ce on ce.centre_class_id = k.id where cc.course_id = co.id and ce.id = $centre) end
```

**`admitOptions()`.** Each course gains `centreIds: number[] | null`: the named centres, or `null` when the class rule applies.

**`offeredCourses()`.** The same rule in code, where `c.centreIds` selects the branch:

*   `c.centreIds` is not null: offer the course when `c.centreIds.includes(centre.id)`;
*   `c.centreIds` is null: use the class rule.

A centre without a class can therefore still sell a course that names it. The agreement test (`admit()` against `offeredCourses`) covers both branches.

### Pages

| Route | What |
|---|---|
| `/admin/catalogue/certifications` | List: code, name, type, status. Managers also get create, an edit form per row, and (de)activate with a reason |
| `POST /admin/catalogue/certifications/save` | `op` = `create`, `update` or `active` (`flag()`); `adminPost`, `safeRoute`; an unknown `op` is `invalid` |
| `/admin/catalogue/courses/[id]` | Two new manager sections, both posting to the existing save route: "Certifications" (`op=certifications`; per row a "Carries" checkbox `certificationId` and a "Mandatory" checkbox `mandatory:<id>`), and "Only these centres may sell it" (`op=centres`; checkboxes `centreId`). Non-managers see the lists read-only |
| `/admin/catalogue` | Adds a "Certifications" link |

*   **Errors.** `AdminErrors` with labels `certifications: "Certifications"`, `centres: "Special-case centres"`, `type: "Type"` and `description: "Description"`, added to the label maps.
*   **Mapping.** For `op=certifications`, the items are built from `data.getAll("certificationId")`, with `mandatory` set where `f["mandatory:<id>"] === "1"`. For `op=centres`, the ids are `data.getAll("centreId").map(Number)`.

### Contracts (steps 5–7: Z-, C- and D- findings; binding for the build)

Steps 5, 6 and 7 ran in parallel on commit `1f1043e`; their findings are merged here. See [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md) and [`critic_report.md`](critic_report.md).

*   **Course-master DD-7 is amended (Z2, C1, D1).**
    *   Old rule: a centre without a class sells nothing.
    *   New rule: such a centre sells exactly the courses that name it.
    *   Course-master DD-7 gets an "amended by certifications DD-3" note, and the comments in `people.ts` and `course-offer.ts` are updated.
    *   `OfferCourse` becomes `{ code; name; classCodes: string[]; centreIds: number[] | null }` (required).
    *   `offeredCourses` loses its early `return []`:

        ```ts
        if (!enforced || !centre) return courses;
        const k = centre.classCode;
        return courses.filter((c) => c.centreIds !== null ? c.centreIds.includes(centre.id) : k !== null && c.classCodes.includes(k));
        ```
*   **`admitOptions` (C2, D3, D4).** Both arrays become correlated subqueries; no extra join, so no fan-out:
    *   `classCodes`: `array(select k.code from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active where cc.course_id = co.id order by k.code)`.
    *   `centreIds`: `case when exists (select 1 from app.course_centre x where x.course_id = co.id) then array(select x.centre_id from app.course_centre x where x.course_id = co.id and x.centre_id = any (app.scoped_centre_ids('student.admit')) order by x.centre_id) else null end`.
    *   Only the caller's own named centres are sent to the browser. An empty array stays `[]`: the course is not sellable here. It never becomes `null`, which would mean the class rule applies.
*   **`getCourse` shape (C3, C4, Z1, C5, D2).** It returns:

    ```ts
    { course: CourseRow & { classes; certifications: { id, code, name, type, mandatory, active }[] (by code);
        centres: { id, code, name }[] (by code; the visible ones); specialCase: boolean; hiddenCentres: number },
      categories, divisions, classes, certificationPicklist: { id, code, name, type, active }[], centrePicklist: { id, code, name }[], canManage }
    ```

    *   `centres` joins `app.centre`, so it lists only centres visible under its RLS. Centre names are scope data.
    *   `specialCase` and `hiddenCentres` are counted from `course_centre`, which is readable by everyone: `hiddenCentres` is the named centres minus the visible ones.
    *   The page shows "Only named centres may sell it", the visible list, and "and N centres outside your scope" when `hiddenCentres > 0`.
    *   Non-managers get both picklists as `[]`.
    *   `COURSE_BASE` and `COURSE_COLS` do not change, so the whole-row audits stay as they are.
    *   `CourseListRow` gains `specialCase` via `exists (select 1 from app.course_centre x where x.course_id = co.id) as "specialCase"`.
    *   Existing tests stay green unchanged:
        *   T-CM-001 (audits);
        *   T-CM-003, whose counts stay [2, 8] because no fixture course has named centres;
        *   T-CM-005;
        *   T-ADM-001 (centres).
*   **Certification checks and messages (C8, Z3).**

    | Check | Rule |
    |---|---|
    | `certification_code_check` | The 0012 code rule |
    | `certification_name_check` | `name = btrim(name) and char_length(name) between 1 and 200` |
    | `certification_type_check` | `type in ('VOUCHER','LICENCE')` |
    | `certification_description_check` | `description = btrim(description)`, `char_length` 1–1000, and no characters in the 0015 `ctl_address` set |

    *   The app validates in the order code, name, type, description.
    *   For the description it trims, then checks the length (`description: 1-1000 characters`), then the characters (`description: invalid characters`, also for lone surrogates).
    *   One shared multiline-text helper replaces the copy in `enquiry.ts` (Z3): `ownText` and its character sets move to `src/server/text-rules.ts`, which imports nothing, and both modules import it.
    *   Prisma maps `type` as `String`.
*   **Shapes and returns (C10).**
    *   An item that is not a non-null object gives `certifications: invalid`.
    *   `createCertification` returns `{ id, code }`. The other writes return `undefined`.
    *   `updateCertification` audits the whole row before and after.
    *   `setCertificationActive` refuses with "already active" / "already inactive".
    *   It stays its own function (Z4: `createMaster` cannot fill `type`).
*   **Routes (C6, C7, D6).**
    *   `POST /admin/catalogue/certifications/save` takes the fields `op`, `id`, `code`, `name`, `type` (select), `description`, `active`, `reason`.

        | `op` | Call |
        |---|---|
        | create | `description` is `f.description?.trim() ? f.description : undefined` |
        | update | `{ name, type, description: trimmed ? f.description : null }`; an unchanged form gives "nothing to change" |
        | active | `flag("active", f.active)` |

    *   Course `op=certifications`: `items = data.getAll("certificationId").map((v) => ({ certificationId: Number(v), mandatory: f[\`mandatory:${v}\`] === "1" }))`. The Mandatory checkbox has `value="1"`. A Mandatory ticked without Carries is ignored.
    *   Course `op=centres`: `data.getAll("centreId").map(Number)`.
*   **Labels and parity (C11).**
    *   `MASTER_FIELD_LABELS` gains `type` and `description`; `COURSE_FIELD_LABELS` gains `certifications` and `centres`.
    *   An unknown certification id redirects with `?error=notfound`; the course page keeps its 404 parity.
    *   Centre ids are read without a lock: centres are never deleted, and the FK guards them.
    *   A non-manager's SQL insert into a link table gives 42501; their delete affects 0 rows.
*   **Caps (D7).** At most 500 named centres per course, against 386 legacy centres (E-021). A larger network raises the cap in one constant.
*   **RLS comment (D5).** Migration 0019 and the T-RLS-002 test say why `course_centre_select` is `using (true)`: it is catalogue data, and centre names stay gated by `app.centre`.
*   **Fixtures (Z5).** `reset()` adds only `app.certification` to its truncate; the link tables cascade from `course`.
*   **T-CC-003 setup (C9, D3, Z6).**
    *   Token: `ST_TOKEN.sr` (centres A and A2).
    *   Classes: A gets METRO; A2 has none.
    *   `course_centre_class`: (DCA, METRO) and (TALLY, METRO).
    *   Named centres: DCA → [A2]; PYTHON → [A]; CCNA → [B] (outside `sr`'s scope).
    *   `admitOptions` `centreIds` are `{ CCNA: [], DCA: [2], DTP: null, PYTHON: [1], TALLY: null }`.
    *   Agreement over A and A2 × the five courses: accepted 3 (DCA@A2, PYTHON@A, TALLY@A), refused 7. Each branch (named and class) has at least one accepted and one refused.
    *   DCA@A is refused although the class matches.
    *   `listCourses` marks DCA, PYTHON and CCNA `specialCase`.
    *   A user scoped to centre A sees DCA's centres as `[]` with `hiddenCentres: 1`.

### Tests (`tests/certifications.test.ts`, the course-master harness)

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CC-001 | G1 | Create with each field; each message; a duplicate code; update and clear the description; nothing to change; (de)activate with a reason; non-managers refused (app and SQL); direct inserts violating each named check | Audited rows; messages; `catalogue.duplicate`; 42501 or 23514 with the constraint name |
| T-CC-002 | G2 | Set mandatory and optional; flip a flag; clear; an inactive certification newly added refused, one already linked kept (also with its flag flipped); duplicate; invalid shapes; the same set; non-manager, also by SQL on a real row | Audit by codes; the messages; kept; "nothing to change"; Forbidden; 0 rows |
| T-CC-003 | G3 | Set and clear special-case centres; an unknown centre; with enforcement on: a named-centre course is admitted only at its centres (also at a centre without a class), refused elsewhere even when the class matches; `admitOptions` returns `centreIds`; `admit()` and `offeredCourses` agree on every fixture centre and course, with non-zero counts on both branches; RLS enabled and forced; a non-manager's SQL insert or delete refused | As listed |
| T-CC-004 | G4 | The routes: certification create, update, active (`flag()`), unknown op, a field `detail`, a duplicate, foreign Origin, stale step-up; course `op=certifications` and `op=centres` | Redirects, audit rows, `detail=<field>`, 403, step-up |

**Fixtures and gates.**

*   `reset()` truncates `course_centre` and `course_certification`; it cascades from `course`, but the tables are listed explicitly anyway.
*   It also truncates `certification` with `restart identity`.
*   The audit catalogue gains `catalogue.course.certifications` and `catalogue.course.centres`. T-AUD-009 already scans `catalogue.ts`.
*   T-RLS-002's list gains `course_centre`.

**Real-server smoke:**

*   `/admin/catalogue/certifications` returns 200 for a non-manager, with no `method="post"`;
*   a foreign-origin create returns 403;
*   the course page lists a special-case centre.

## Decisions

1.  **DD-1: Certifications are a master page with a fixed type list (VOUCHER, LICENCE),** behind `catalogue.manage` (recommended option, owner's standing instruction, 2026-10-29).
2.  **DD-2: One course–certification link with a `mandatory` flag,** edited on the course page and audited as codes (recommended option, standing instruction, 2026-10-29).
3.  **DD-3: Special cases are named centres; a course with named centres is offered only there (the class rule no longer applies to it);** region and area later; enforcement stays behind the existing switch; this amends course-master DD-7 (a centre without a class sells exactly the courses that name it) (recommended option, standing instruction, 2026-10-29).
4.  **DD-4: No exams or fees here** (recommended option, standing instruction, 2026-10-29).

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Two link tables (mandatory, optional) | The same rows twice; a flag is simpler and cannot list one certification as both |
| Special-case centres added to the class rule (union) | WF says "only named centres may offer"; a union would let every class-matched centre sell a tie-up course |
| Special cases by region and area now | Not needed for the WF wording; more scope rules to test; later |
| Certifications on the shared masters page | They need type and description, which the plain masters do not have |

## Risks and Limits

| Risk | Impact | Mitigation | Test |
|---|---|---|---|
| A tie-up course loses its named centres by mistake | It falls back to the class rule and may be sold more widely | Every change is audited by codes; enforcement is off until go-live | T-CC-003 |
| A centre is closed but still named | It is still listed for that course | Centre status is a centre-onboarding matter (WF3) | none |
| 57 legacy certifications to load | Manual entry until migration | Stage 0 (paused) | none |

## Detailed Implementation Plan

Outline; EGM step 9 writes the file-by-file plan:

| Phase | Items |
|---|---|
| K1 Documents | T-CC-001…004 in audit 09; matrix links on R-092, R-090, R-090.01 |
| K2 Server | Migration 0019; Prisma; certification functions; `setCourseCertifications`; `setCourseCentres`; reads; availability rule in `admit()`, `admitOptions`, `offeredCourses`; fixtures and gates; tests |
| K3 Pages | Certifications page and route; course page sections and route ops; index link; label maps; tests |
| K4 Evidence | Smoke; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
