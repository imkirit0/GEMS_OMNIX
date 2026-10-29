# Catalogue masters pages (Stage 3, fifth piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-4 and accepted DD-5…DD-10 on 2026-10-29; build approval follows the EGM review (steps 5–9).
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
| Centre class | `centre.centre_class_id`; no function sets it yet (catalogue DD-7) | migration 0012 |
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

### Data Model (migration `0017_centre_class_write`)

*   `grant update (centre_class_id) on app.centre to gems_app` (the only writable centre column).
*   `create policy catalogue_update on app.centre for update using ((select app.has_permission('catalogue.manage', null))) with check ((select app.has_permission('catalogue.manage', null)))`. The select policy (`visible_centre_ids()`) is unchanged; a catalogue manager holds an ALL-scope assignment, so sees every centre.
*   No other schema change: the masters and years already have their checks, RLS and grants (0012).

### Server (`src/server/catalogue.ts`)

*   **`listMasters(session, kind)`:** `{ rows: { id, code, name, active }[], canManage }`, every row ordered by code; an unknown kind → `kind: unknown` (the existing `table()` check). A plain `withScope` read.
*   **`listAcademicYears(session)`:** `{ years: { code, startsOn, endsOn, open }[], canManage }`, ordered by code descending.
*   **`listCentreClasses(session)`:** `{ centres: { id, code, name, classId, classCode }[], classes: { id, code, name, active }[], canManage }`: the centres the session sees (RLS), ordered by code; the classes active or in use by a listed centre.
*   **`setCentreClass(session, centreId, classId | null, reason)`:** `adminWrite` with action `catalogue.centre.class` (`targetType: "centre"`, `targetId: <id>`, `reason`). Validation before the database: `id`, `classId` a safe integer or `null` (else `classId: invalid`), `reason` required (DD-5). In the transaction: lock the centre (`select id, centre_class_id … for update`; none → `notfound` "centre not found"); same class → "nothing to change"; a class other than the current one must be active (`… and active for share`, else `classId: inactive or unknown`, DD-7); `update app.centre set centre_class_id = …`; audit `{ before: { classCode }, after: { classCode } }` (codes, `null` for none, DD-6).
*   The existing write functions are unchanged. `ADMIN_MESSAGES["catalogue.duplicate"]` becomes "A record with that code already exists." (DD-10; the course pages show the same text).

### Pages

| Route | What |
|---|---|
| `GET /admin/catalogue` | Links: Courses, Course categories, Course divisions, Centre classes, Academic years, Centres' classes |
| `GET /admin/catalogue/masters/[slug]` | `slug` ∈ `categories`, `divisions`, `classes` (else 404). The list (code, name, status); for managers a create form, a rename form per row, and activate/deactivate with a reason (DD-8) |
| `POST /admin/catalogue/masters/[slug]/save` | `op` = `create` (`code`, `name`), `update` (`id`, `name`), `active` (`id`, `active`, `reason`) |
| `GET /admin/catalogue/years` | The list; for managers a create form (`code`, `startsOn`, `endsOn`), a dates form per row, and open/close with a reason |
| `POST /admin/catalogue/years/save` | `op` = `create`, `update` (`code`, `startsOn`, `endsOn`), `open` (`code`, `open`, `reason`) |
| `GET /admin/catalogue/centres` | Centres the user sees with their class; for managers a class select (active classes, the current one even if inactive, and "(none)") and a reason per row |
| `POST /admin/catalogue/centres/save` | `op` = `class` (`centreId`, `classId` `''` → `null`, `reason`) |

*   Every POST goes through `adminPost` (same origin, step-up, `?error=&detail=`), returning to its page with `?saved=1`. Errors show "Some values were invalid. Check: <label>" from one label map (Code, Name, Reason, Start date, End date, Class, Kind) or the `ADMIN_MESSAGES` text.
*   The home page's "Courses" link becomes "Catalogue" (`/admin/catalogue`), still shown to catalogue managers only; the index page itself is readable by every signed-in user.

### Tests

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-MS-001 | G1, G2 | `listMasters` for each kind (inactive rows included, ordered); `listAcademicYears`; `canManage` true for a manager, false for a centre user; an unknown kind | As listed; `kind: unknown` |
| T-MS-002 | G3 | Set, change, clear a centre's class; set an inactive class (refused) and keep one deactivated after it was set; same class; missing reason; unknown centre and class; a non-manager by the app and by direct SQL (`update app.centre set centre_class_id` as `gems_app` with a centre user's session → 0 rows, value unchanged; `update app.centre set name` → 42501) | Audited codes and reason; refused; kept; "nothing to change"; `reason: required`; `notfound` / `classId: inactive or unknown`; Forbidden; as listed |
| T-MS-003 | G1–G3 | The routes: master create, rename, deactivate; year create, dates, close; centre class; a field error's `detail`; a duplicate code; foreign Origin; stale step-up; an unknown slug | Redirects and audit rows; `detail=<field>`; `error=catalogue.duplicate`; 403; step-up; 404 |
| T-MS-004 | G3 | With availability enforced (course-master), a class set through `setCentreClass` makes its courses admissible at that centre | `admit()` accepts the linked course |

Real-server smoke: the masters, years and centres pages return 200 for a non-manager without forms; a foreign-origin POST is 403; an unknown slug is 404.

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
| The update policy opens other centre columns | A manager could change centre data | Only `centre_class_id` is granted; other columns give 42501 | T-MS-002 |
| Duplicate-code text shared by every master | — | One generic message (DD-10) | T-MS-003 |

## Detailed Implementation Plan

Outline; the file-by-file plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| P1 Documents | T-MS-001…004 in audit 09; matrix links on R-033.06–.08, R-028 |
| P2 Server | Migration 0017; `listMasters`, `listAcademicYears`, `listCentreClasses`, `setCentreClass`; audit catalogue entry; message text; tests |
| P3 Pages | `/admin/catalogue` index, masters, years, centres pages and routes; home link; tests |
| P4 Evidence | Smoke additions; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
