# Enquiry to admission (Stage 3, sixth piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-4 and accepted DD-5…DD-14 on 2026-10-29; build approval follows the EGM review (steps 5–9).
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

### Data Model (migration `0018_enquiry`)

| Table | Columns | Notes |
|---|---|---|
| `enquiry_path`, `enquiry_type` | `id`, `code` (unique, `normCode` rule), `name`, `sort_order`, `active`, `created_at` | Masters (DD-4); seeded with the legacy values (PMC) |
| `enquiry_status` | Same columns, plus `kind` (`OPEN`/`ENROLLED`/`LOST`/`JUNK`, fixed per row) and `colour` (`#rrggbb`) | Seeded: New (OPEN), Contacted (OPEN), Affordability (OPEN), Enrolled (ENROLLED), Lost (LOST), Junk (JUNK). Exactly one active ENROLLED status (DD-6) |
| `enquiry` | `id` (bigserial; shown as the Enquiry No, DD-7) and `centre_id` | Fields and checks listed below the table; RLS by centre |
| `enquiry_course` | `enquiry_id`, `position` 1–3, `course_code` (FK course), `centre_id` | Preferences (DD-11) |
| `enquiry_followup` | `id`, `enquiry_id`, `centre_id`, `at` (timestamptz, default now), `kind` (`CALL_IN`, `CALL_OUT`, `VISIT`, `MESSAGE`, `NOTE`), `duration_min` 0–600 nullable, `note` 1–2000, `next_on` date nullable, `by_user` | Append-only (DD-8) |

The `enquiry` table's fields and checks:

| Group | Columns | Rules |
|---|---|---|
| Identity | `given_name`, `family_name`, `date_of_birth`, `gender`, `mobile` | Same rules as person identity (`identityField`); DOB, gender and mobile required |
| Contact | `whatsapp`, `landline`, `email`, `address`, `pincode`, `parent_name`, `parent_mobile`, `instagram` | Optional; existing rules where they exist (mobile, pincode, email); free text 1–200 |
| Background | `qualification`, `last_school` | `qualification` is a learner-details list key (DD-5) |
| Classification | `path_id`, `type_id`, `status_id` | Required; FKs to the masters |
| Work | `counsellor_id` (FK `app_user`, nullable), `enquired_on` (date, default today IST), `remark` | |
| Follow-up | `next_follow_up_on`, `last_contact_at` | Maintained by the follow-up write (DD-8) |
| Conversion | `admission_id` | Unique, nullable, FK `admission` |
| Bookkeeping | `version`, `created_at`, `created_by` | `version` guards concurrent edits (DD-12) |

*   **RLS:** `enquiry`, `enquiry_course` and `enquiry_followup` carry `centre_id`, with ENABLE and FORCE, as T-RLS-002 requires. Policies:
    *   select needs `enquiry.view` at the centre;
    *   insert and update need `enquiry.manage` at the centre;
    *   there are no delete policies, except replacing an enquiry's `enquiry_course` rows (`enquiry.manage`).
    *   The masters use the 0012 setup pattern: everyone selects; insert and update need `enquiry.setup` at ALL scope (DD-13).
*   **Grants:** `gems_app` gets select, insert and update on the enquiry tables (not `id`, `centre_id`, `created_*` or `admission_id` for update except through the enroll path, see Enroll) and select, insert and update on the masters.
*   **Permissions:** `enquiry.view`, `enquiry.manage` and `enquiry.setup`; the `system_admin` role holds all three (as 0013).

### Server (`src/server/enquiry.ts`)

*   **`createEnquiry(session, input)`:** a `scopedAction` (`enquiry.create`, `enquiry.manage` at `centreId`).
    *   Validation reuses `identityField`, `detailField` and the master FKs.
    *   It returns `{ id, warnings }`. `warnings` lists the open enquiries at the centre with the same mobile, and the learners the caller may view with the same mobile (by Admission No). These are warnings, not refusals (DD-10).
*   **`updateEnquiry(session, id, version, changes)`:** the fields, preferences and counsellor (DD-12: stale `version` is refused).
    *   A status change goes through `setEnquiryStatus`.
    *   The audit records field names only (as learner-details DD-14; DD-14 here).
*   **`setEnquiryStatus(session, ids[], statusId, note)`:** one enquiry or up to 100 (bulk, DD-9).
    *   The target status may not be of kind ENROLLED (only Enroll sets it), and an enrolled enquiry cannot be moved.
    *   LOST and JUNK need a note.
    *   Each enquiry gets its own audit row in one transaction; any refusal rolls back the whole set.
*   **`setCounsellor(session, ids[], userId | null)`:** bulk too.
    *   The counsellor must hold `enquiry.manage` at each enquiry's centre.
*   **`addFollowUp(session, id, followUp)`:**
    *   Appends a follow-up row.
    *   Sets `last_contact_at` for a contact kind (not NOTE).
    *   Sets `next_follow_up_on` to the new `next_on` (null clears it).
*   **Reads:**
    *   **`listEnquiries(session, filters)`:** filters on centre, enquiry date range, status, status kind, counsellor, "due by" date, and `q` (Enquiry No exact, mobile exact, name prefix). It counts against the search rate limit and returns at most 100, newest first.
    *   **`getEnquiry(session, id)`:** the record, preferences, follow-ups and the linked admission's number. Forbidden maps to 404.
    *   **`followUpCalendar(session, month, centreId?)`:** open enquiries whose `next_follow_up_on` falls in that month, grouped by day.
*   **Masters:** `listEnquiryMasters`, `createEnquiryMaster`, `updateEnquiryMaster` and `setEnquiryMasterActive`, through `adminWrite` (step-up). The kind of a status is set at creation and never changes. The last active ENROLLED status cannot be deactivated.

### Enroll (DD-9)

1.  "Enroll" on the enquiry page links to `/students/new?enquiry=<id>`.
2.  The admission page reads the enquiry (it needs `enquiry.view`; anything else gives a 404). It pre-fills the form's initial values: names, DOB, gender, mobile, email, centre, the first preference, address as the current address, pincode, qualification, parent name. A hidden `enquiryId` field carries the link. Only the id appears in the URL, no personal data (admission-screens DD-4).
3.  `admit()` gains an optional `enquiryId`. Inside its transaction, before the admission insert:
    *   lock the enquiry `for no key update`;
    *   it must be at the same centre (`enquiry: other centre`);
    *   it must not already be enrolled (`enquiry: already enrolled`);
    *   it must not be LOST or JUNK (`enquiry: closed`);
    *   the caller needs `enquiry.manage` there.
    After the insert, set `admission_id` and the active ENROLLED status. The admit audit row records `enquiryId`. One enquiry enrols once; another course for the same learner is a new registration on the admission, not a second enrol.
4.  The `admit()` refusals above become form messages through `ADMIT_MESSAGES`.

### Pages

| Route | What |
|---|---|
| `/enquiries` | List with GET filters; "New enquiry"; a bulk form (checkboxes, status with note, counsellor) |
| `/enquiries/new` | The enquiry form (Server Action, like the admit form): warnings shown before a second submit confirms |
| `/enquiries/[id]` | The record, edit form (version), status change, follow-up form and log, "Enroll" when the enquiry is open and the user holds `student.admit` there |
| `/enquiries/calendar?month=YYYY-MM` | A month grid of follow-ups due, linking to enquiries |
| `/admin/enquiry-setup/[slug]` | `paths`, `types` and `statuses`: list, create, rename, reorder, (de)activate, plus the colour for statuses |
| Home | "Enquiries" when the user holds `enquiry.view` anywhere |

### Tests

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-ENQ-001 | G1 | Create with every field; each field's message; three preferences; warnings for the same mobile (open enquiry, learner); another centre; no permission | Saved and audited; messages; warnings, not refusals; Forbidden |
| T-ENQ-002 | G2 | Edit with a stale version; status changes (LOST/JUNK need a note, ENROLLED refused, enrolled enquiry frozen); counsellor without `enquiry.manage` refused; follow-ups set last contact and next date | As listed |
| T-ENQ-003 | G2 | Bulk status and counsellor on 100 enquiries; one refused rolls back all; 101 refused; an out-of-scope id | Audited each; rollback; refused; Forbidden |
| T-ENQ-004 | G3 | Enroll: pre-fill; admit links and marks enrolled in one transaction; twice; other centre; closed; a failed admit leaves the enquiry open; concurrent enrolls | As listed; exactly one admission |
| T-ENQ-005 | G4 | RLS: another centre's enquiries invisible and unwritable by SQL; list filters and limit; the calendar by month | As listed |
| T-ENQ-006 | G4 | Masters: create, rename, colour, deactivate; status kind fixed; the last ENROLLED status kept; non-holders refused | As listed |

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
| Q2 Data and server | Migration 0018; `enquiry.ts`; `admit()` enquiry link; audit catalogue; tests |
| Q3 Pages | Enquiry list, form, record, calendar; setup pages; admission pre-fill; home link; tests |
| Q4 Evidence | Smoke additions; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
