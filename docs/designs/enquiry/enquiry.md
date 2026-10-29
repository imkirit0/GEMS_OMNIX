# Enquiry to admission (Stage 3, sixth piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-4 and accepted DD-5…DD-14 on 2026-10-29; build approval follows the EGM review (steps 5–9). Step 5: [`zoom_out_report.md`](zoom_out_report.md) (no new decisions).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO. Every seeded list value is PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

WF1 (SRC, WF p. 2) says "an enquiry becomes an admission only when the centre enrols it". The admission half is built (E-037, E-038). This piece builds the enquiry half as **one enquiry record** that merges the legacy Enquiry Form (R-081) and the CRM lead (R-085), per D-ADM-1. It covers:

*   capturing an enquiry at a centre;
*   working it through statuses with a counsellor, a follow-up log and reminders;
*   bulk changes and a follow-up calendar;
*   **Enroll**, which opens the admission form pre-filled and links the admission back to the enquiry in the same transaction.

Fees, schemes and discounts on the course preferences wait for Stage 4.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Enquiry | A prospective learner at a centre; the merged legacy enquiry and CRM lead | this design |
| Path / type / status | Editable masters (DD-4): how they heard of G-TEC, how the enquiry arrived, where it stands | R-081, R-085 |
| Status kind | The fixed meaning behind a status: `OPEN`, `ENROLLED`, `LOST`, `JUNK` (DD-6) | this design |
| Follow-up | One logged contact (call, visit, message, note) with an optional next follow-up date | R-084 |
| `admit()` | Person core's admission write; the admit form's Server Action calls it | `src/server/people.ts`, `src/server/admission-form.ts` |

## The Problem

1.  **No enquiry is recorded** in the new system, so the front of WF1 is missing.
2.  **The legacy system has two lead pipelines** (the Enquiry Form and the CRM, SPEC p. 54), which double count.
3.  **Conversion cannot be measured**: no admission links back to the enquiry it came from.

## Goals

*   **G1: A centre user with `enquiry.manage` records an enquiry** with the R-081 fields and up to three course preferences, and is warned about an open enquiry or a learner with the same mobile [T-ENQ-001].
*   **G2: Enquiries are worked through statuses with a counsellor, a follow-up log, a next follow-up date and bulk changes;** every change is audited [T-ENQ-002, T-ENQ-003].
*   **G3: Enroll opens the admission form pre-filled; a saved admission links the enquiry and marks it enrolled,** atomically, once per enquiry [T-ENQ-004].
*   **G4: The list, the calendar and the masters pages** work with centre scope, filters and step-up where needed [T-ENQ-005, T-ENQ-006].

## Non-Goals

*   **Fees, schemes, discounts, batches and installments** on preferences (R-081 preference table): Stage 4 (G-FIN gate).
*   **Export, the conversion report, the CRM ticket and the CRM profile and timesheets** (R-085, R-214, R-215): later.
*   **The front-office masters** for visitor purpose and complaint type (R-080) and a general call log not tied to an enquiry (R-084 standalone).
*   **Migrating legacy enquiries and leads** (Stage 0, paused by the owner).
*   **Sending reminders** by SMS, e-mail or push (WF-X3, D-COMM-1).

## Technical Plan (Architecture)

Z- ids are the findings of [`zoom_out_report.md`](zoom_out_report.md) (step 5).

### Data Model (migration `0018_enquiry`)

**Masters (DD-4, Z7, Z8):**

*   `enquiry_path` and `enquiry_type` have exactly the catalogue master shape: `id`, `code` (unique, `<table>_code_check` as 0012), `name`, `active`, `created_at`. RLS follows the 0012 setup pattern (select all; insert and update need `enquiry.setup` at ALL scope). They are seeded with the legacy values (PMC):
    *   Paths: Social Media, Walk In, Direct Call, Message, Tele Calling, Alumnus/Alumna, Friends, G-TEC Student's, Notice Boards/Hoardings, TV Advertisements, Newspaper Advertisements, Mail, Staff, Other Ref.
    *   Types: Walk In, Online, Website, TeleCaller, Phone Enquiry, Other Ref, Direct Call.
*   `enquiry_status` has the same columns plus:
    *   `kind`, one of `OPEN`, `ENROLLED`, `LOST` or `JUNK`, fixed at creation;
    *   `colour` (`^#[0-9a-f]{6}$`);
    *   `sort_order` (0–1000; R-085 SRC).
    *   Seeded: New, Contacted, Affordability (all OPEN), Enrolled (ENROLLED), Lost (LOST), Junk (JUNK).
    *   **Exactly one ENROLLED row exists.** It is seeded; a partial unique index `on (kind) where kind = 'ENROLLED'` stops a second one, and a check in the functions refuses deactivating it.

**`enquiry`** has `id` (bigserial; the Enquiry No, DD-7) and `centre_id`. Its columns, named after the detail keys where the data is the same (Z6):

| Group | Columns | Rule |
|---|---|---|
| Identity | `given_name` (req), `family_name`, `date_of_birth` (req), `gender` (req), `mobile` (req), `email` | `identityField` |
| Same as learner details | `current_address`, `current_pincode`, `qualification`, `guardian_name`, `guardian_phone` | `detailField`; a legacy "parent/guardian" maps to guardian |
| Own | `whatsapp`, `landline` (10-digit phone rule), `instagram`, `last_school` (1–100, no control characters), `remark` (1–1000) | new, small |
| Classification | `path_id`, `type_id`, `status_id` (req; FKs) | |
| Preferences (DD-11, Z4) | `course_code_1`, `course_code_2`, `course_code_3` (FK `course(code)`) | at least the first; distinct; no gaps (named check) |
| Work | `counsellor_id` (FK `app_user`), `enquired_on` (date, default today IST), `next_follow_up_on`, `last_contact_at` | |
| Conversion | `admission_id` (unique, FK `admission`) | written only by `admit()` |
| Bookkeeping | `version` (int, default 1), `created_at`, `created_by` | |

**`enquiry_followup`:**

*   Columns: `id`, `enquiry_id`, `centre_id`, `at` (default now), `kind` (`CALL_IN`, `CALL_OUT`, `VISIT`, `MESSAGE` or `NOTE`), `duration_min` (0–600), `note` (1–2000), `next_on`, `by_user`.
*   It is append-only: the existing generic `app.ticket_immutable()` trigger refuses update and delete (Z1, DD-8).

**RLS (Z1):**

*   `enquiry` and `enquiry_followup` use the 0002/0009 scope loop: select, insert, update and delete policies.
    *   Select needs `enquiry.view` at the centre.
    *   The write policies need `enquiry.manage` at the centre.
*   Both tables join the T-RLS-002 expected list.
*   `gems_app` gets **no delete grant**.
*   `enquiry` is also updated by `admit()`, which runs as `gems_app` under the enrolling user's session. That user must therefore hold `enquiry.manage` there; DD-3 already requires it.

**Grants (Z3):**

*   `gems_app`: `select, insert` on both tables.
*   On `enquiry`, `update` on every column except `id`, `centre_id` and `created_*`.
*   `admission_id` is in the grant. Only `admit()` writes it, and the guard below enforces how.

**`enquiry_guard` trigger** (before update; the `ticket_guard` style, 0009) puts DD-6 into the database:

1.  `centre_id` never changes.
2.  `admission_id` changes only from null to a value.
3.  The status is of kind ENROLLED exactly when `admission_id` is set.
4.  Once enrolled, `status_id` and `admission_id` never change.

**Definer functions (Z2; each added to T-RLS-005, fixed `search_path`, executable by `gems_app` only):**

*   `app.enquiry_may_receive(p_centre int, p_user uuid) boolean`: the user is ACTIVE and `p_centre = any (app.user_centre_ids(p_user, 'enquiry.manage'))`.
*   `app.enquiry_counsellors(p_centre int) returns table (id uuid, display_name text)`: the active users who may receive enquiries at that centre. It returns nothing unless the caller holds `enquiry.view` there (`has_permission`).
*   `app.enquiry_people(p_centre int) returns table (id uuid, display_name text)`: the names of counsellors and follow-up authors on that centre's enquiries, for lists and records. It has the same caller check.

**Permissions:** `enquiry.view`, `enquiry.manage` and `enquiry.setup` (sensitive). The `system_admin` role holds all three (as 0013).

### Masters in code (Z7)

*   **Shared code for paths and types.** `catalogue.ts`'s master registry becomes `MASTERS: Record<MasterKind, { table: Prisma.Sql; permission: string }>`. `enquiry_path` and `enquiry_type` are added with `enquiry.setup`; the catalogue kinds keep `catalogue.manage`.
*   `createMaster`, `updateMaster`, `setMasterActive` and `listMasters` use the kind's permission. Their audit actions stay `catalogue.create` / `update` / `activate` / `deactivate`, with `targetType` = the kind.
*   The shared masters page gains the slugs `enquiry-paths` and `enquiry-types`; `canManage` comes from the kind's permission.
*   **Statuses have their own code**, in `src/server/enquiry.ts`:
    *   `listEnquiryStatuses`, `createEnquiryStatus`, `updateEnquiryStatus` (name, colour, sort order; never kind) and `setEnquiryStatusActive`;
    *   writes go through `adminWrite` with `enquiry.setup`;
    *   audit actions: `enquiry.setup.status.create`, `.update`, `.activate`, `.deactivate`;
    *   creating an ENROLLED status, or deactivating the ENROLLED one, is refused (Z8).
*   **Master foreign keys are plain reads that refuse inactive rows,** with no `for share` (Z9: the update policy would hide them from enquiry writers).

### Server (`src/server/enquiry.ts`)

**Writes** (audit actions in brackets; each is a `scopedAction` with `enquiry.manage` at the enquiry's centre, and every audit row names fields, never values, DD-14):

*   **`createEnquiry(session, input, { confirm })` (`enquiry.create`):**
    *   Validates, then looks for the same mobile among open enquiries at the centre and learners the caller may view.
    *   Any found and not `confirm`: returns `{ warnings }` and writes nothing (the admit form's show-then-confirm pattern, DD-10).
    *   Otherwise inserts and returns `{ id }`.
*   **`updateEnquiry(session, id, version, changes)` (`enquiry.update`):**
    *   Covers the fields and preferences, not status or counsellor (Z10).
    *   A stale `version` is refused; the update increments `version`.
    *   Only this function changes `version`.
*   **`setEnquiryStatus(session, ids[], statusId, note)` (`enquiry.status`):**
    *   Takes 1–100 ids, all or nothing.
    *   The target may not be ENROLLED, and an enrolled enquiry is refused. The guard enforces both as well.
    *   LOST and JUNK need a note, which is stored as a NOTE follow-up.
*   **`setCounsellor(session, ids[], userId | null)` (`enquiry.counsellor`):**
    *   Takes 1–100 ids, all or nothing.
    *   Requires `app.enquiry_may_receive(centre, userId)` for each enquiry.
*   **`addFollowUp(session, id, f)` (`enquiry.followup`):**
    *   Appends the follow-up.
    *   Sets `last_contact_at` (for every kind except NOTE) and `next_follow_up_on` (`next_on`; null clears it).

**Reads:**

*   **`listEnquiries(session, filters)`:**
    *   The GET filters are centre, date range, status, kind, counsellor and due-by.
    *   `q` (Enquiry No exact, mobile exact, name prefix) comes **only from a POST body** (a Server Action, like `SearchState`). Only a `q` counts against the search limit (Z5).
    *   It returns at most 100, newest first, with counsellor names from `enquiry_people`.
*   **`getEnquiry(session, id)`:** the record, the follow-ups, the names, the linked Admission No, and the caller's `canManage` and `canEnrol` (both `enquiry.manage` and `student.admit` at the centre, Z11). Not found and forbidden both give the 404 path.
*   **`followUpCalendar(session, month, centreId?)`:** open enquiries with `next_follow_up_on` in the month, grouped by day.

### Enroll (DD-9)

1.  "Enroll" (shown only when `canEnrol`, Z11) links to `/students/new?enquiry=<id>`. The id is the only value in the URL.
2.  The admission page reads the enquiry with `getEnquiry`; failures give a 404. It pre-fills the form's initial `values`:
    *   the names, DOB, gender, mobile and email;
    *   the centre;
    *   the preferred courses into course rows 1–3;
    *   the detail keys (`currentAddress`, `currentPincode`, `qualification`, `guardianName`, `guardianPhone`), which copy straight across (Z6).
3.  `AdmitFormState` gains `enquiryId`, carried like `admissionId` (Z12).
4.  `admit()` gains an optional `enquiryId`. Inside its transaction, before the admission insert, it locks the enquiry `for no key update`. Each condition below is refused with the message shown:
    *   the enquiry is at another centre: `enquiry: other centre`;
    *   it is already enrolled: `enquiry: already enrolled`;
    *   its status kind is LOST or JUNK: `enquiry: closed`;
    *   the caller lacks `enquiry.manage` at the centre: Forbidden.
5.  After the insert, `admit()` sets `admission_id` and the ENROLLED status. The admit audit row records `enquiryId`.
6.  The refusals become form messages in `ADMIT_MESSAGES`.

### Pages

| Route | What |
|---|---|
| `/enquiries` | The list: GET filters, a POST search, "New enquiry", and a bulk form (checkboxes; status with note, or counsellor) |
| `/enquiries/new` | The enquiry form (a Server Action); same-mobile warnings, then "Save anyway" |
| `/enquiries/[id]` | The record; an edit form carrying the version; the status change; the counsellor picker (`enquiry_counsellors`); the follow-up form and log; Enroll |
| `/enquiries/calendar?month=YYYY-MM` | A month grid of the follow-ups due |
| `/enquiries/statuses` | Status master: list, create, rename, colour, order, (de)activate (`enquiry.setup`) |
| Masters page | `enquiry-paths`, `enquiry-types` (shared slug page) |
| Home | "Enquiries" for holders of `enquiry.view` anywhere |

### Tests

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-ENQ-001 | G1 | Create with every field; each field's message; preference rules; same-mobile warnings then confirm; another centre; no permission | Saved and audited by field names; messages; warnings then saved; Forbidden |
| T-ENQ-002 | G2 | Stale version; status rules (note, ENROLLED refused, enrolled frozen); counsellor without `enquiry.manage` refused; follow-ups set last contact and next date; follow-up rows cannot be updated or deleted | As listed |
| T-ENQ-003 | G2 | Bulk on 100; one refused rolls back all; 101 refused; an out-of-scope id | As listed |
| T-ENQ-004 | G3 | Enroll: pre-fill; link and status in one transaction; twice; other centre; closed; a failed admit leaves it open; concurrent enrolls; the guard refuses each forbidden change by direct SQL | As listed |
| T-ENQ-005 | G4 | RLS by centre for select/insert/update by SQL; no delete grant; the definer functions refuse callers without `enquiry.view`; list filters, POST-only `q`, limit; calendar | As listed |
| T-ENQ-006 | G4 | Paths and types through the shared masters with `enquiry.setup`; status master: kind fixed, the ENROLLED row neither duplicated nor deactivated; non-holders refused | As listed |

Every audit action above is listed in `tests/audit-catalogue.ts` and asserted in `tests/enquiry.test.ts` (Z12).

## Decisions

1.  **DD-1: One merged enquiry entity** (D-ADM-1 default); no separate CRM (design owner, 2026-10-29).
2.  **DD-2: Core funnel plus bulk changes and a follow-up calendar;** export later (design owner, 2026-10-29).
3.  **DD-3: `enquiry.view` and `enquiry.manage`, centre-scoped;** enrolling also needs `student.admit` there; the system administrator holds them (design owner, 2026-10-29).
4.  **DD-4: Enquiry path, enquiry type and status are editable masters** (design owner, 2026-10-29).
5.  **DD-5: Qualification reuses the learner-details list** (fixed in code), so an enquiry pre-fills the admission's details without mapping (accepted by the design owner, 2026-10-29).
6.  **DD-6: Each status has a fixed kind** (`OPEN`, `ENROLLED`, `LOST`, `JUNK`) that the rules use; names, colours and order are editable. Only Enroll sets an ENROLLED status (accepted by the design owner, 2026-10-29).
7.  **DD-7: The Enquiry No is the record id,** not a numbering series. Enquiries are not financial documents; NP stays out of it (PMC) (accepted by the design owner, 2026-10-29).
8.  **DD-8: Follow-ups are an append-only log;** the enquiry keeps the latest next follow-up date and last contact for lists and the calendar (accepted by the design owner, 2026-10-29).
9.  **DD-9: Enroll pre-fills the admission form, and the admission links back in the same transaction;** one enquiry enrols once (accepted by the design owner, 2026-10-29).
10. **DD-10: The same mobile warns, it does not block** (an enquiry may be a sibling or a returning learner) (accepted by the design owner, 2026-10-29).
11. **DD-11: Up to three course preferences, courses only;** fees and schemes wait for Stage 4 (accepted by the design owner, 2026-10-29).
12. **DD-12: Edits carry a version** (as learner-details DD-8); bulk actions cap at 100 and are all-or-nothing (accepted by the design owner, 2026-10-29).
13. **DD-13: The masters need a third permission, `enquiry.setup` at ALL scope,** separate from day-to-day work (accepted by the design owner, 2026-10-29).
14. **DD-14: Audit rows of enquiry edits list field names only** (contact data is PII, as learner-details DD-14); follow-up notes are not copied into audit rows (accepted by the design owner, 2026-10-29).

## Open Questions

*   **D-ADM-4** (Admissions + MIS): which date counts an admission for conversion reports. The link stores both the enquiry and admission dates, so either rule can be reported later.
*   **D-SEC-4** (IT): whether enquiry contact data is "sensitive" for export. Export is a later piece.

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Separate CRM leads and enquiries (legacy) | Double counting; the owner chose one entity (DD-1) |
| A numbering series for Enquiry No | Needs NP sign-off and a counter for no financial reason (DD-7) |
| Create the person at enquiry time | Most enquiries never enrol; persons would fill with non-learners and duplicates |
| Enroll converts without the admission form | The admit form already checks duplicates, details and courses; reusing it keeps one admission path |

## Risks and Limits

| Risk | Impact | Mitigation | Test |
|---|---|---|---|
| Enquiry PII visible to too many people | Privacy | Centre scope plus `enquiry.view`; audit by field names | T-ENQ-005 |
| A bulk change touches the wrong centres | Data errors | Each id checked in scope; all-or-nothing; 100 cap | T-ENQ-003 |
| Enroll races with a second Enroll | Two admissions | Enquiry row lock and unique `admission_id` | T-ENQ-004 |
| Statuses renamed until they lose meaning | Reports wrong | Rules use the fixed kind (DD-6) | T-ENQ-006 |

## Detailed Implementation Plan

Outline; the file-by-file plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| Q1 Documents | T-ENQ-001…006 in audit 09; matrix links on R-081, R-085, R-084 |
| Q2 Data and server | Migration 0018 (tables, guard, definer functions, seeds); master registry with per-kind permission; `enquiry.ts`; `admit()` enquiry link; T-RLS-002/005 lists; audit catalogue; tests |
| Q3 Pages | Enquiry list, form, record, calendar; status page and master slugs; admission pre-fill; home link; tests |
| Q4 Evidence | Smoke additions; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
