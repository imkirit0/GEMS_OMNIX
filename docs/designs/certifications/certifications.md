# Certifications and special-case availability (Stage 3, seventh piece)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-4 were taken as the recommended options under the owner's standing instruction of 2026-10-29 ("agree on the recommended option and work on everything planned"); build approval follows the EGM review (steps 5–9). Steps 5–7 ran in parallel: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md) (no new decisions); step 8: [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (no new decisions).
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

This section merges the base plan with the step 5–7 resolutions (Z-, C-, D- findings: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)) and the step 8 resolutions (I-findings: [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md)). It is binding for the build.

### Data model (migration `0019_certifications`)

**`app.certification`:**

*   Columns: `id` serial, `code` text unique, `name` text, `type` text, `description` text nullable, `active` boolean default true, `created_at`.
*   Checks:

    | Check | Rule |
    |---|---|
    | `certification_code_check` | The 0012 code rule (`code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30`) |
    | `certification_name_check` | `name = btrim(name) and char_length(name) between 1 and 200` |
    | `certification_type_check` | `type in ('VOUCHER','LICENCE')` |
    | `certification_description_check` | The 0018 multiline form, as `enquiry_followup_note_check`: `description !~ '^'‖ws`, `description !~ ws‖'$'`, `description !~ ctl_address` (tab, LF, CR allowed), `char_length(description) between 1 and 1000` (I2) |

*   RLS uses the 0012 setup pattern: `setup_select` `using (true)`; `setup_insert` and `setup_update` require `catalogue.manage` at ALL scope; there is no delete policy.
*   `gems_app` gets `select, insert`, `update (name, type, description, active)`, and usage on the sequence. `code` is never updated.

**`app.course_certification`:**

*   `(course_id → course, certification_id → certification, mandatory boolean not null)`; primary key `(course_id, certification_id)`; Restrict/Restrict.
*   RLS as `course_centre_class` (0016): `setup_select` `using (true)`; `setup_insert` and `setup_delete` require `catalogue.manage` at ALL scope.
*   `gems_app` gets `select, insert, delete`.

**`app.course_centre`** (the special-case centres):

*   `(course_id → course, centre_id → centre)`; primary key `(course_id, centre_id)`; Restrict/Restrict.
*   It has a `centre_id` column, so T-RLS-002 requires ENABLE, FORCE and all four command policies:
    *   `course_centre_select` `using (true)`. Migration 0019 and the T-RLS-002 test carry a comment saying why: it is catalogue data, readable by every session, and centre names stay gated by `app.centre`'s own RLS (D5).
    *   `course_centre_insert` and `course_centre_delete` require `catalogue.manage` at ALL scope.
    *   `course_centre_update` uses the same expression, but `gems_app` has no update grant, so no update can happen.
*   `gems_app` gets `select, insert, delete`. The table joins the T-RLS-002 expected list.

**Prisma.** Three models plus back-relations on `Course` and `Centre`, so the drift gate agrees. `type` maps as `String`. The checks are hand-written in the migration.

### Shared text rule (Z3, I1)

`ownText(field, v, max, multiline)` and its regexes (`CONTROL`, `CONTROL_MULTILINE`, `LONE_SURROGATE`) move unchanged from `enquiry.ts` to `src/server/details.ts`, which imports only `person-rules.ts` (`invalid`) and is client-safe; not `person-rules.ts` itself, whose contents are hashed by the ETL rules. `enquiry.ts` imports it from there. `catalogue.ts` calls it through a small wrapper that converts `PersonError` to its `bad()` RbacError, as `date()` does. No new module.

Its behaviour, in this order:

1.  `null`/`undefined` gives `null`.
2.  A non-string gives `<field>: invalid`.
3.  A control character outside tab/LF/CR, or a lone surrogate, gives `<field>: invalid characters`.
4.  It trims; blank gives `null`.
5.  More than `max` code points gives `<field>: 1-<max> characters`.

### Server (`src/server/catalogue.ts`)

**Certifications.** These are their own functions, not the plain masters: `createMaster` cannot fill `type` (Z4). The audit actions reuse `catalogue.create`, `.update`, `.activate` and `.deactivate`, with `targetType: "certification"`.

*   `listCertifications(session)` returns `{ rows: { id, code, name, type, description, active }[], canManage }`, ordered by code, inactive rows included. Every signed-in user may read it.
*   `createCertification(session, { code, name, type, description? })` returns `{ id, code }`.
    *   It validates before the database, in this order:
        *   `code`: the catalogue `code()` rule;
        *   `name`: `name()`, giving `name: 1-200 characters`;
        *   `type`: `type: one of VOUCHER, LICENCE`;
        *   `description`: `ownText("description", v, 1000, true)` (I1).
    *   It runs inside `unique()`, so a duplicate code gives `catalogue.duplicate`.
    *   It audits `{ after: whole row }`.
*   `updateCertification(session, id, { name?, type?, description? })` returns `undefined`.
    *   Each field: `undefined` means unchanged; a `null` or blank description clears it.
    *   It locks the row `for update`. An unknown id gives `notfound`.
    *   No change gives "nothing to change".
    *   It audits the whole row before and after.
*   `setCertificationActive(session, id, active, reason)` returns `undefined`.
    *   The reason is required.
    *   It makes two literal `adminWrite` calls (activate/deactivate), as `setMasterActive` does.
    *   Same state gives "already active" / "already inactive".

**`setCourseCertifications(session, courseId, items: { certificationId: number; mandatory: boolean }[])`** returns `undefined`. Its action is `catalogue.course.certifications`, written as one literal. It follows the `setCourseClasses` pattern:

1.  Validate before the database:
    *   not an array, more than 100 items, an item that is not a non-null object, a non-integer id, or a non-boolean `mandatory`: `certifications: invalid` (C10);
    *   a repeated id: `certifications: duplicate`.
2.  Lock the course (`lockCourse`). This serialises the three link writers.
3.  Read the current links with their codes and flags.
4.  Read every id not currently linked with `… and active for share`. A count mismatch gives `certifications: inactive or unknown`. An inactive certification that is already linked is kept, even when its `mandatory` flag changes.
5.  Same set with the same flags: "nothing to change".
6.  Delete, then insert the new set.
7.  Audit `{ before: { mandatory: [codes], optional: [codes] }, after: { … } }`, with codes sorted.

**`setCourseCentres(session, courseId, centreIds: number[])`** returns `undefined`. Its action is `catalogue.course.centres`.

1.  Validate before the database:
    *   not an array, more than 500 ids, or a non-integer: `centres: invalid`;
    *   a repeated id: `centres: duplicate`.
2.  Lock the course.
3.  Every new id must exist in `app.centre`. A manager holds ALL scope and sees every centre. A mismatch gives `centres: unknown`. Centres are read without a lock: they are never deleted, and the FK guards them (C11).
4.  Same set: "nothing to change".
5.  Delete, then insert.
6.  Audit `{ before: { centres: [codes] }, after: { centres: [codes] } }`, with codes sorted. The empty set returns the course to the class rule (DD-3).

**Caps (D7, I8).** At most 100 certifications per course (57 legacy certifications) and 500 named centres per course (386 legacy centres, E-021). Each cap is one constant.

**Reads (C3, C4, C5, Z1, D2).**

*   `getCourse` returns:

    ```ts
    { course: CourseRow & { classes; certifications: { id, code, name, type, mandatory, active }[] /* by code */;
        centres: { id, code, name }[] /* by code; visible ones only */; specialCase: boolean; hiddenCentres: number },
      categories, divisions, classes,
      certificationPicklist: { id, code, name, type, active }[], centrePicklist: { id, code, name }[], canManage }
    ```

    *   `centres` joins `app.centre`, so it lists only the centres visible under that table's RLS. Centre names are scope data.
    *   `specialCase` and `hiddenCentres` are counted from `course_centre`, which everyone can read. `hiddenCentres` is the named centres minus the visible ones.
    *   `certificationPicklist` holds the active certifications plus the course's own. `centrePicklist` holds every centre, by code. Both are `[]` for non-managers.
    *   An unknown course id stays Forbidden, so the page keeps its 404 parity.
    *   `COURSE_BASE` and `COURSE_COLS` do not change, so the whole-row course audits stay as they are.
*   `CourseListRow` gains `specialCase`, read as `exists (select 1 from app.course_centre x where x.course_id = co.id) as "specialCase"`.
*   Existing tests stay green unchanged:
    *   T-CM-001 (audits);
    *   T-CM-003, which stays at [2, 8] because no fixture course has named centres;
    *   T-CM-005;
    *   T-ADM-001 (centres).

### Availability (`people.ts`, `course-offer.ts`; DD-3)

**The rule.** With `CATALOGUE_GATES.enforceAvailability` on, a course may be sold at centre C when either of these holds:

*   the course has named centres, and C is one of them;
*   it has none, and C's active class is linked to it (unchanged).

So a centre without a class sells exactly the courses that name it. This amends course-master DD-7 (Z2, C1, D1). Course-master DD-7 gets an "amended by certifications DD-3" note, and the DD-7 comments in `people.ts` and `course-offer.ts` are updated.

**`admit()`** replaces its availability query with this one. The message stays `not offered at this centre`.

```sql
select co.code from app.course co
where co.code = any ($codes::text[]) and case
  when exists (select 1 from app.course_centre x where x.course_id = co.id)
    then exists (select 1 from app.course_centre x where x.course_id = co.id and x.centre_id = $centre)
  else exists (select 1 from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active
               join app.centre ce on ce.centre_class_id = k.id where cc.course_id = co.id and ce.id = $centre) end
```

**`admitOptions()` (C2, D3, D4, I5).** The courses query becomes `select co.code, co.name, <classCodes>, <centreIds> from app.course co where co.active and co.visible order by co.code`. There is no `group by` and no extra join, so no fan-out. The two arrays:

*   `classCodes`: `array(select k.code from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active where cc.course_id = co.id order by k.code)`.
*   `centreIds`: `case when exists (select 1 from app.course_centre x where x.course_id = co.id) then array(select x.centre_id from app.course_centre x where x.course_id = co.id and x.centre_id = any (app.scoped_centre_ids('student.admit')) order by x.centre_id) else null end`.
    *   Only the caller's own named centres reach the browser.
    *   An empty array stays `[]`, meaning not sellable here. It never becomes `null`, which would mean the class rule applies.

**`offeredCourses()` (C1).** `OfferCourse` becomes `{ code: string; name: string; classCodes: string[]; centreIds: number[] | null }`, with `centreIds` required. The early `return []` goes:

```ts
if (!enforced || !centre) return courses;
const k = centre.classCode;
return courses.filter((c) => c.centreIds !== null ? c.centreIds.includes(centre.id) : k !== null && c.classCodes.includes(k));
```

### Pages and routes

| Route | What |
|---|---|
| `/admin/catalogue/certifications` | List: code, name, type, status. Managers also get a create form, an edit form per row (name, type select, description), and (de)activate with a reason. Non-managers get no forms |
| `POST /admin/catalogue/certifications/save` | `adminPost` + `safeRoute`. Fields: `op`, `id`, `code`, `name`, `type`, `description`, `active`, `reason`. An unknown `op` is `invalid`; an unknown certification id redirects with `?error=notfound` |
| `/admin/catalogue/courses/[id]` | Two new manager sections, both posting to the existing save route (below). Non-managers see the certifications and, for a special-case course, "Only named centres may sell it", the visible centres, and "and N centres outside your scope" when `hiddenCentres > 0` |
| `/admin/catalogue` | Adds a "Certifications" link |
| `/admin/catalogue/courses` | Marks `specialCase` rows |

**Certifications route mapping (C6, I7):**

| `op` | Call |
|---|---|
| `create` | `createCertification(session, { code: f.code ?? "", name: f.name ?? "", type: f.type ?? "", description: f.description })` (blank → `null` in `ownText`) |
| `update` | `updateCertification(session, Number(f.id), { name: f.name ?? "", type: f.type ?? "", description: f.description ?? null })`; an unchanged form gives "nothing to change" |
| `active` | `setCertificationActive(session, Number(f.id), flag("active", f.active), f.reason ?? "")` |

**Course save route, new ops (C7, D6):**

*   `op=certifications`: section "Certifications". Per row there is a "Carries" checkbox (`name="certificationId"`) and a "Mandatory" checkbox (`name="mandatory:<id>" value="1"`). The route maps it as:

    ```ts
    data.getAll("certificationId").map((v) => ({ certificationId: Number(v), mandatory: f[`mandatory:${v}`] === "1" }))
    ```

    A Mandatory ticked without Carries is ignored.
*   `op=centres`: section "Only these centres may sell it", checkboxes `centreId`, mapped as `data.getAll("centreId").map(Number)`.

**Errors and labels (C11).** Errors go through `AdminErrors`. `MASTER_FIELD_LABELS` gains `type: "Type"` and `description: "Description"`. `COURSE_FIELD_LABELS` gains `certifications: "Certifications"` and `centres: "Special-case centres"`.

**SQL refusals.** A non-manager's SQL insert into a link table gives 42501, and their delete affects 0 rows.

### Tests (`tests/certifications.test.ts`, the course-master harness)

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CC-001 | G1 | Create with each field; each message in the stated order; a duplicate code; update and clear the description; nothing to change; (de)activate with a reason, and already active/inactive; non-managers refused (app and SQL); direct inserts violating each named check | Audited rows; messages; `catalogue.duplicate`; 42501 or 23514 with the constraint name |
| T-CC-002 | G2 | Set mandatory and optional; flip a flag; clear; an inactive certification newly added is refused, one already linked is kept (also with its flag flipped); duplicate; invalid shapes (non-object item, bad id, non-boolean flag, over 100); the same set; non-manager, also by SQL on a real row | Audit by sorted codes; the messages; kept; "nothing to change"; Forbidden; 42501 / 0 rows |
| T-CC-003 | G3 | Set and clear special-case centres; an unknown centre; with enforcement on, the setup below; RLS enabled and forced on `course_centre`; a non-manager's SQL insert or delete refused | As listed below |
| T-CC-004 | G4 | The routes: certification create, update, active (`flag()`), unknown op, unknown id (`notfound`), a field `detail`, a duplicate, foreign Origin, stale step-up; course `op=certifications` and `op=centres` | Redirects, audit rows, `detail=<field>`, 403, step-up |

**T-CC-003 setup (C9, D3, Z6, I6):**

*   Token: `ST_TOKEN.sr` (centres A and A2).
*   Classes: A gets METRO; A2 has none.
*   `course_centre_class`: (DCA, METRO) and (TALLY, METRO).
*   Named centres: DCA → [A2]; PYTHON → [A]; CCNA → [B] (outside `sr`'s scope).
*   `admitOptions` `centreIds`: `{ CCNA: [], DCA: [2], DTP: null, PYTHON: [1], TALLY: null }`.
*   Agreement over A and A2 × the five courses: `admit()` and `offeredCourses` agree; accepted 3 (DCA@A2, PYTHON@A, TALLY@A), refused 7. Each branch (named and class) has at least one accepted and one refused.
*   DCA@A is refused although the class matches. DCA@A2 is accepted at a centre without a class.
*   `listCourses` marks DCA, PYTHON and CCNA `specialCase`.
*   `getCourse` as `ST_TOKEN.sa` (centre A only):
    *   DCA: `centres: []`, `specialCase: true`, `hiddenCentres: 1`;
    *   PYTHON: `centres: [A]`, `hiddenCentres: 0`;
    *   both picklists `[]`.

**Fixtures and gates (Z5, I3):**

*   `reset()` adds only `app.certification` to its truncate. The statement already has `restart identity cascade`, and both link tables cascade.
*   The audit catalogue gains `catalogue.course.certifications` and `catalogue.course.centres`. T-AUD-009 already scans `catalogue.ts`.
*   T-RLS-002's list gains `course_centre`, with the D5 comment.

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
