# Catalogue masters pages (Stage 3, fifth piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-4 and accepted DD-5…DD-10 on 2026-10-29; build approval follows the EGM review (steps 5–9). Step 5: [`zoom_out_report.md`](zoom_out_report.md) (no new decisions); step 6: [`comprehension_report.md`](comprehension_report.md) (no new decisions); step 7: [`critic_report.md`](critic_report.md) (no new decisions); step 8: [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (no new decisions).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

The catalogue skeleton (E-034) built the course category, course division, centre class and academic year tables with audited write functions, but no screens. The course pages (E-040) pick from those masters, so today a new category or class can be added only by SQL. This piece gives head office **pages for the four masters** and an **audited way to set a centre's class**, which course availability (course-master DD-2) needs.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Master | `course_category`, `course_division`, `centre_class` (code, name, active) | migration 0012, `src/server/catalogue.ts` |
| Academic year | `academic_year` (code `2026-27`, `starts_on`, `ends_on`, `open`) | R-028, migration 0012 |
| Centre class | `centre.centre_class_id`; no function sets it before this piece (catalogue DD-7, superseded here by DD-2) | migration 0012 |
| `adminWrite()` / `adminPost()` | Permission, fresh step-up, change and audit in one transaction / the form-POST wrapper with `detail=<field>` | `src/server/rbac.ts`, `src/server/admin-http.ts` |

## The Problem

1.  **No screen maintains the masters** (R-033.06–.08, R-028); the course pages depend on them.
2.  **No one can set a centre's class** (catalogue DD-7), so course availability cannot be switched on.

## Goals

*   **G1: Any signed-in user lists the three code/name masters and the academic years, inactive entries included; a `catalogue.manage` holder creates, renames, activates and deactivates them** through the existing audited functions [T-MS-001, T-MS-003].
*   **G2: A catalogue manager creates academic years, changes their dates and opens or closes them** [T-MS-001, T-MS-003].
*   **G3: A catalogue manager sets, changes or clears a centre's class, audited with a reason;** the database refuses anyone else [T-MS-002, T-MS-003].

## Non-Goals

*   **The other R-020 masters** (religion, caste, blood group, mother tongue, student category, section…): later (DD-1).
*   **Academic year sort order and an "active year"** (R-028): not now (DD-3).
*   **A class-revision ticket** (D-ORG-2): the audit rows are the history for now (DD-2).
*   **Centre creation and the rest of the centre record** (R-023).
*   **Deleting masters:** rows are deactivated, never deleted (catalogue skeleton).

## Technical Plan (Architecture)

Z-, C-, D- and I- ids are the findings of [`zoom_out_report.md`](zoom_out_report.md) (step 5), [`comprehension_report.md`](comprehension_report.md) (step 6), [`critic_report.md`](critic_report.md) (step 7) and [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (step 8).

### What this changes elsewhere (Z1, C10, I3)

*   **Superseded designs:** catalogue-skeleton DD-7 ("no Stage 2 write path for a centre's class; set by the Stage 3 centre form or the class-revision ticket") and the course-master non-goal "Setting a centre's class: the centre-creation piece". DD-2 here gives the write path. A note is added to both designs at build.
*   **T-CAT-003** (`tests/catalogue.test.ts`) expects `update app.centre set centre_class_id` as the catalogue manager to fail with 42501. After 0017 it succeeds, so the centre statement is dropped from that loop. The class write is covered by T-MS-002. That other centre columns stay closed is already T-SEC-007's `set status` case (I3).
*   **Comment and title updates:**
    *   T-RLS-002's comment "centre is read-only to the app so far" (`tests/foundation.test.ts`) becomes "the app may only change a centre's class (0017)". The `toContain` assertion is unchanged.
    *   T-SEC-007's title (`tests/sec.test.ts`) gains "(except a centre's class, 0017)".

### Data Model (migration `0017_centre_class_write`)

*   `grant update (centre_class_id) on app.centre to gems_app`. It is the only writable centre column.
*   `create policy setup_update on app.centre for update using ((select app.has_permission('catalogue.manage', null))) with check ((select app.has_permission('catalogue.manage', null)))`. The name and body follow 0012 (I4).
*   The select policy (`visible_centre_ids()`) is unchanged. A catalogue manager holds an ALL-scope assignment, so sees every centre.
*   No other schema change: the masters and years already have their checks, RLS and grants (0012).

### Server (`src/server/catalogue.ts`)

*   **`listMasters(session, kind)`** returns `{ rows: { id, code, name, active }[], canManage }`.
    *   Every row, ordered by code.
    *   `table(kind)` runs before `withScope`, so an unknown kind fails with `kind: unknown` and needs no session (C7).
*   **`listAcademicYears(session)`** returns `{ years: { code, startsOn, endsOn, open }[], canManage }`.
    *   Ordered by code descending.
    *   Dates are read as `starts_on::text`, `ends_on::text` (ISO strings, C6).
*   **`listCentreClasses(session)`** returns `{ centres: { id, code, name, classId, classCode }[], classes: { id, code, name, active }[], canManage }`.
    *   Centres are filtered by RLS plus the centre list's second gate (D1, I5): `where app.has_permission('catalogue.manage', null) or c.id in (select unnest(app.scoped_centre_ids('org.centre.view')))`. A user with a role at a centre but no `org.centre.view` sees no centres there.
    *   Centres are ordered by code. Classes are the active ones, plus any in use by a listed centre.
*   **`setCentreClass(session, centreId, classId | null, reason)`** (C1, C5, C11, D2, I1): one `adminWrite` with action `catalogue.centre.class`.
    *   **Audit target:** `targetType: "centre"`, `targetId: String(centreId)`, `reason`. It is a network-wide action, so `target_centre_id` is null.
    *   **Validation before the database**, with the existing helpers: `id("centreId", …)`, then `classId` `null` or `id("classId", …)`, then `reasonOf()` (`reason: required`, DD-5).
    *   **In the transaction:**
        1.  Lock the centre with `select c.centre_class_id as "classId", (select code from app.centre_class where id = c.centre_class_id) as "classCode" from app.centre c where c.id = ${centreId} for no key update`. If there is no row, throw `notfound` "centre not found".
            *   A scalar subquery, not a left join, because a row lock cannot cover the nullable side of an outer join.
            *   `no key update`, not `update`, because it still serialises two managers but does not block the `for key share` lock that an admission insert at that centre takes. Otherwise admissions everywhere would stall behind the global ADMISSION counter; `people.ts` uses `no key update` for the same reason.
        2.  The same class → "nothing to change".
        3.  A class other than the current one must be active. The existing `liveRef(tx, TABLES.centre_class, "classId", classId)` now returns the row's code (`select code … and active for share`); its existing callers ignore it. No row → `classId: inactive or unknown` (DD-7).
        4.  `update app.centre set centre_class_id = …`.
        5.  Audit `{ before: { classCode }, after: { classCode } }`: codes, `null` for none (DD-6).
    *   **Result:** returns `undefined` (`.then(done)`).
*   The existing write functions are unchanged. `ADMIN_MESSAGES["catalogue.duplicate"]` becomes "A record with that code already exists." (DD-10).

### Pages

| Route | What |
|---|---|
| `GET /admin/catalogue` | Links to everyone: Courses, Course categories, Course divisions, Centre classes, Academic years, Class per centre (I6). `pageRead(canManageCatalogue)` only requires a session |
| `GET /admin/catalogue/masters/[slug]` | Table Code, Name, Status ("Active"/"Inactive"). For managers: a create form, a rename form per row, and activate/deactivate with a reason (DD-8) |
| `GET /admin/catalogue/years` | Table Code, Start date, End date, Status ("Open"/"Closed"). For managers: a create form, a dates form per row, and open/close with a reason |
| `GET /admin/catalogue/centres` | Table Code, Name, Class (`code name`, "(inactive)" when inactive, "—" when none). For managers, per row: a select of `classes.filter(k => k.active \|\| k.id === c.classId)` plus `(none)`, defaulting to the current class, and a reason |

*   **Slugs (C3):** `SLUGS = { categories: { kind: "course_category", title: "Course categories" }, divisions: { kind: "course_division", title: "Course divisions" }, classes: { kind: "centre_class", title: "Centre classes" } }`, checked with `Object.hasOwn`.
    *   An unknown slug gets `notFound()` on the page.
    *   On the POST it gets `new Response("Not found", { status: 404 })` inside `handle` but before `adminPost`, so it is 404 whatever the Origin.
*   **Routes (C2, D3, D5):** each is `export const POST = safeRoute(handle)` (request id and IP on the audit rows, the generic error page) and goes through `adminPost`.
    *   `back` is its GET page; success goes to `<page>?saved=1`, shown as `<p role="status">Saved.</p>`.
    *   An unknown `op` throws `RbacError("invalid", "unknown operation")`.
    *   Toggles post the opposite of the current state as `"1"` or `"0"`. Any other value throws `active: invalid` / `open: invalid`; the course route keeps its existing mapping.

| Route | `op` | Call |
|---|---|---|
| `POST /admin/catalogue/masters/[slug]/save` | `create` | `createMaster(s, kind, { code: f.code, name: f.name })` |
| | `update` | `updateMaster(s, kind, Number(f.id), { name: f.name })` |
| | `active` | `setMasterActive(s, kind, Number(f.id), f.active === "1", f.reason ?? "")` |
| `POST /admin/catalogue/years/save` | `create` | `openAcademicYear(s, { code: f.code, startsOn: f.startsOn, endsOn: f.endsOn })` |
| | `update` | `updateAcademicYear(s, f.code, { startsOn: f.startsOn, endsOn: f.endsOn })` |
| | `open` | `setAcademicYearOpen(s, f.code, f.open === "1", f.reason ?? "")` |
| `POST /admin/catalogue/centres/save` | `class` | `setCentreClass(s, Number(f.centreId), f.classId === "" ? null : Number(f.classId), f.reason ?? "")` |

*   **Errors (Z2, Z3, C9, C13, D4, D8):**
    *   One shared component, `AdminErrors({ error, detail, labels }: { error?: string; detail?: string; labels: Record<string, string> })`, in `app/admin/catalogue/admin-errors.tsx`. It looks values up with `Object.hasOwn`, so `?error=__proto__` cannot render `Object.prototype`.
    *   It shows the `ADMIN_MESSAGES` text, or for `invalid` "Some values were invalid." plus " Check: <label>".
    *   The file also exports `MASTER_FIELD_LABELS`: `code` Code, `name` Name, `reason` Reason, `startsOn` Start date, `endsOn` End date, `classId` Class, `centreId` Centre, `active` Status, `open` Status.
    *   `CourseErrors` is removed and the course pages use `AdminErrors` with `COURSE_FIELD_LABELS`, which stays in `course-form.tsx`.
    *   Refusals without a field prefix ("nothing to change", "already …") and a tampered `id` show the generic line. There is no "Kind" label: an unknown slug is a 404 before any call.
*   **Who sees what:** non-managers get the same tables with no forms. The home page's "Courses" link becomes "Catalogue" (`/admin/catalogue`), still shown to catalogue managers only.

### Tests (`tests/catalogue-masters.test.ts`, the `course-master.test.ts` harness; C4, D9)

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-MS-001 | G1, G2 | Insert category `IT` and division `OLD`, deactivate `OLD`; `listMasters` for each kind; `listAcademicYears`; `canManage` for `tok-catA` and `T.uA`; an unknown kind without a session | Divisions `[GEN active, OLD inactive]`; years `2028-29 … 2024-25`; true / false; `kind: unknown` |
| T-MS-002 | G3 | See the setup list below | See the setup list below |
| T-MS-003 | G1–G3 | The routes: master create, rename, deactivate; year create, dates, close; centre class set and clear (`classId=''`); `active=x`; a duplicate code; foreign Origin on a valid slug; stale step-up; an unknown slug (GET and POST) | Redirects and audit rows; `detail=active`; `error=catalogue.duplicate`; 403; step-up; 404 |

**T-MS-002 setup and checks:**

*   **Fixtures:** classes `A++` (id 2) and `OLD` (id 3, inactive) are inserted by admin SQL.
*   **Set, change, clear:** set (null→METRO), change (METRO→A++) and clear (A++→null), audited as `{ target_type: "centre", target_id: "1", reason, before: { classCode }, after: { classCode } }`.
*   **Refusals:**
    *   An inactive class → `classId: inactive or unknown`.
    *   The same class → "nothing to change".
    *   No reason → `reason: required`.
    *   An unknown centre → `notfound`.
    *   An unknown class → `classId: inactive or unknown`.
*   **Kept class:** a class deactivated with `setMasterActive` after it was set is kept, and `listCentreClasses` lists it with `active: false`.
*   **Availability:** with the course-master gate on (reset in `afterEach`) and DCA linked to METRO, one `admit(ST_TOKEN.sa, …)` succeeds after C.A is set to METRO.
*   **Non-manager:** `T.uA` is Forbidden, with one DENIED audit row.
*   **Direct SQL:** `update app.centre set centre_class_id` as `gems_app` with `T.uA`'s session matches 0 rows and leaves the value unchanged.
*   **Visibility:** `tok-tkViewer` sees no centres, `T.uA` sees only KL2-25, and the manager sees all three.

**Audit coverage:** the literal `"catalogue.centre.class"` appears in the test, on an `action:` line in `catalogue.ts`, and in `tests/audit-catalogue.ts`.

**Real-server smoke (C12):** the masters, years and centres pages return 200 for a non-manager, with no `method="post"` in the body. A foreign-origin POST returns 403. GET `/admin/catalogue/masters/nope` returns 404.

## Decisions

1.  **DD-1: The four existing masters only** (design owner, 2026-10-29).
2.  **DD-2: A catalogue manager sets a centre's class through an audited edit with step-up;** the audit rows are its history; D-ORG-2's ticket stays possible later (design owner, 2026-10-29).
3.  **DD-3: Academic years: dates and open/closed only** (design owner, 2026-10-29).
4.  **DD-4: Any signed-in user reads the pages; only `catalogue.manage` changes them** (design owner, 2026-10-29).
5.  **DD-5: A centre class change needs a reason,** like activate/deactivate (catalogue DD-9): it changes which courses a centre may sell (accepted by the design owner, 2026-10-29).
6.  **DD-6: A centre's class may be cleared** (no class: the centre sells nothing once availability is enforced, course-master DD-7) (accepted by the design owner, 2026-10-29).
7.  **DD-7: An inactive class cannot be newly set;** a centre keeps a class deactivated after it was set (as course-master Z3) (accepted by the design owner, 2026-10-29).
8.  **DD-8: One shared page for the three code/name masters,** chosen by slug; years and centres' classes have their own pages (accepted by the design owner, 2026-10-29).
9.  **DD-9: Lists show inactive entries,** marked "Inactive", ordered by code (years newest first) (accepted by the design owner, 2026-10-29).
10. **DD-10: The duplicate-code message names "a record"** now that masters and years have pages (course-master R14) (accepted by the design owner, 2026-10-29).

## Open Questions

*   **D-ORG-2** (Operations): whether class changes later need an approval ticket. Until signed, `catalogue.manage` with step-up and a reason is enough (PMC).

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Set the class in the centre-creation piece | Leaves availability unusable until then; the owner chose an edit now (DD-2) |
| A class-revision ticket now (D-ORG-2) | D-ORG-2 is unsigned; the engine's ticket types are gated until the numbering policy is signed (correction-tickets DD-18) |
| A definer function for the class write instead of a column grant and policy | The grant and policy match how every other catalogue write is protected (0012); the function would hide the rule from RLS tests |
| One page per master kind | Three identical pages; one page with a slug is the same code once |

## Risks and Limits

| Risk | Impact | Mitigation | Test |
|---|---|---|---|
| A class change during an admission | The admission uses the class read when it ran | Accepted, as catalogue DD-13 (no admission lock) | none |
| The update policy opens other centre columns | A manager could change centre data | Only `centre_class_id` is granted; other columns give 42501 | T-SEC-007 |
| Duplicate-code text shared by every master | — | One generic message (DD-10) | T-MS-003 |
| Deactivating a class stops its centres selling once availability is enforced (D6) | Every centre on that class refused at admission | The deactivate form carries a reason and step-up; the course-master switch stays off until classes are set | T-CM-003 |
| No centre has a class at cutover (D7) | Enforcing availability would refuse every admission | The ETL imports no class; enforcement stays off until every ACTIVE centre has an active class (a go-live check query in the runbook) | none |
| Year codes and dates are not cross-checked (D10) | A typo such as `2026-27` from `2062-06-01` is accepted | Accepted: dates are reference data (catalogue DD-6, DD-3 here) | none |

## Detailed Implementation Plan

Outline; the file-by-file plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| P1 Documents | T-MS-001…003 in audit 09; matrix links on R-033.06–.08, R-028 |
| P2 Server | Migration 0017; `listMasters`, `listAcademicYears`, `listCentreClasses`, `setCentreClass`, `liveRef` returning the code; audit catalogue entry; message text; T-CAT-003's centre statement dropped, the T-RLS-002 comment and T-SEC-007 title (Z1); superseded notes in the two earlier designs; tests |
| P3 Pages | `/admin/catalogue` index, masters, years, centres pages and routes; the shared `AdminErrors`; home link; tests |
| P4 Evidence | Smoke additions; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
