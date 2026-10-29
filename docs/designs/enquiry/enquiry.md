# Enquiry to admission (Stage 3, sixth piece)

*   **Author:** gtm
*   **Status:** Approved for build on 2026-10-29 after the EGM review (steps 5–9). The approval was taken under the owner's standing instruction of 2026-10-29 to take the recommended option and continue (step 9 R1 likewise). The design owner decided DD-1…DD-4, accepted DD-5…DD-14 and decided DD-15 at step 6. Reports: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md), [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md), [`implementation_readiness_report.md`](implementation_readiness_report.md).
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

Z-, C-, D- and I- ids are the findings of [`zoom_out_report.md`](zoom_out_report.md) (step 5), [`comprehension_report.md`](comprehension_report.md) (step 6), [`critic_report.md`](critic_report.md) (step 7) and [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (step 8). This text is the single contract; it replaces every earlier version (I5).

### Data model (migration `0018_enquiry`)

**Masters (DD-4, Z7, Z8).**

*   `enquiry_path` and `enquiry_type` have exactly the catalogue master shape: `id`, `code` (unique, `<table>_code_check` as 0012), `name`, `active`, `created_at`.
*   `enquiry_status` has the same columns plus:
    *   `kind` text, `check (kind in ('OPEN','ENROLLED','LOST','JUNK'))`, fixed at creation (DD-6);
    *   `colour` (`check (colour ~ '^#[0-9a-f]{6}$')`);
    *   `sort_order` (0–1000; R-085 SRC).
*   **Exactly one ENROLLED status, the seeded one, always active** (Z8, C15, D5, I3). The rule is `enquiry_status_enrolled_check check (kind <> 'ENROLLED' or (code = 'ENROLLED' and active))`. `code` is unique, and neither `code` nor `kind` is in the update grant, so no second ENROLLED row can exist and no kind can change. The check is hand-written, like `<table>_code_check`, and invisible to the drift gate. There is no trigger and no partial index.

**`enquiry`.** `id` is a bigserial and serves as the Enquiry No (DD-7). The other columns are named after the detail keys where the data is the same (Z6):

| Group | Columns | Rule |
|---|---|---|
| Identity | `given_name` (req), `family_name`, `date_of_birth` (req), `gender` (req), `mobile` (req), `email` | `identityField` |
| Same as learner details | `current_address`, `current_pincode`, `qualification`, `guardian_name`, `guardian_phone` | `detailField`; a legacy "parent/guardian" maps to guardian |
| Own | `whatsapp`, `landline` (10-digit phone rule), `instagram`, `last_school` (1–100), `remark` (1–1000) | no control characters (I12) |
| Classification | `path_id`, `type_id`, `status_id` (req; FKs) | |
| Preferences (DD-11, Z4) | `course_code_1`, `course_code_2`, `course_code_3` (FK `course(code)`) | the first is required; they are distinct with no gaps (named check) |
| Work | `counsellor_id` (FK `app_user`), `enquired_on` (date, default today IST), `next_follow_up_on`, `last_contact_at` | |
| Conversion | `admission_id` (unique) | written only by `admit()` |
| Bookkeeping | `centre_id`, `version` (int, default 1), `created_at`, `created_by` (default `app.session_user_id()`, FK `app_user`; never an input, C17) | |

*   `unique (id, centre_id)` (C6).
*   **Composite FK** `enquiry (admission_id, centre_id) → admission (id, centre_id)`: the admission is at the enquiry's centre (D7). There is no separate single-column FK.
*   **Contact checks** `enquiry_<column>_check` mirror the code (D13):
    *   `mobile`, `whatsapp`, `landline` and `guardian_phone`: `^\d{10}$`;
    *   `current_pincode`: `^[1-9][0-9]{5}$`;
    *   the free-text lengths, as 0015 does.

**`enquiry_followup`** (DD-8):

*   **Columns:** `id`, `enquiry_id`, `centre_id`, `at` (`now()`), `kind`, `duration_min` (0–600), `note` (1–2000), `next_on` and `by_user` (default `app.session_user_id()`, FK `app_user`; C17).
*   **`kind`:** one of `CALL_IN`, `CALL_OUT`, `VISIT`, `MESSAGE`, `NOTE`.
*   **FK** `(enquiry_id, centre_id) → enquiry (id, centre_id)`, so a follow-up cannot name another centre (C6).

**Triggers (all refusals raise P0001; the app's checks run first, so a P0001 is a bug and surfaces as a generic error, as in the ticket engine; I6):**

*   **`enquiry_guard`, before insert or update** (C6, D1, D12):
    *   on insert: `admission_id` is null, the status kind is OPEN, and `version = 1`;
    *   on update:
        1.  `centre_id` never changes;
        2.  a row whose `old.admission_id` is not null takes no update at all (enrolled is frozen, DD-15). `admission_id` can therefore only go from null to a value;
        3.  `new.admission_id` is set exactly when the new status kind (read from `app.enquiry_status`) is ENROLLED.
*   **`enquiry_followup_guard`, before insert:** the parent enquiry's `admission_id` is null (D1).
*   **`enquiry_followup_immutable`** (`app.ticket_immutable()`, before update or delete) and **`enquiry_followup_no_truncate`**, as 0009 (Z1, C20).

**RLS (Z1, C1, I4).** `enquiry` and `enquiry_followup` have ENABLE and FORCE, four policies each, and join the T-RLS-002 expected list:

| Policy | Expression |
|---|---|
| `<table>_select` | `using (centre_id = any ((select app.scoped_centre_ids('enquiry.view'))::int[]))` |
| `<table>_insert`, `<table>_update`, `<table>_delete` | the same expression with `'enquiry.manage'`; update uses it in both `using` and `with check` |

An UPDATE, and the `for no key update` lock, also need the select policy. So every role that holds `enquiry.manage` must hold `enquiry.view`. The seeds and fixtures do, and a test asserts it, as T-ADM-001 does for `student.admit` (admission-screens DD-9; D16 is superseded by I4). `admit()` updates the enquiry under the enrolling user's session, so that user needs `enquiry.manage` at the centre (DD-3).

The masters follow the 0012 setup pattern: select for everyone, and insert and update with `(select app.has_permission('enquiry.setup', null))`.

**Grants (Z3, C15).**

*   `gems_app`:
    *   `select, insert` on `enquiry`, `enquiry_followup` and the three masters; **no delete grant** on anything;
    *   `update` on `enquiry` for every column except `id`, `centre_id` and `created_*`. `admission_id` is in the grant: only `admit()` writes it, and the guard enforces how;
    *   `update (name, active)` on paths and types, and `update (name, active, colour, sort_order)` on statuses;
    *   `usage` on every new sequence.
*   **Prisma:** the new models, uniques, FKs and indexes are in `schema.prisma`, so the drift gate agrees (C20). Checks and triggers are hand-written.

**Indexes** (`@@index` in `schema.prisma`; D14, I10):

*   `enquiry (centre_id, mobile)`: the duplicate lookup and the mobile search;
*   `enquiry (next_follow_up_on)`: the calendar;
*   `enquiry_followup (enquiry_id)`;
*   `person (mobile)`: the learner lookup.

**Definer functions** (Z2, C7, D15): `language sql stable security definer`, `set search_path = pg_catalog, app`, `revoke all … from public; grant execute … to gems_app`. They join the T-RLS-005 list in sorted order, after `can_grant_permission`. They follow `ticket_may_receive`, `ticket_forward_candidates` and `ticket_people` (0009).

*   `app.enquiry_may_receive(p_centre int, p_user uuid) boolean`: true when all of these hold:
    *   the caller has `app.has_permission('enquiry.view', p_centre)`;
    *   `p_user` is ACTIVE;
    *   `p_centre = any (app.user_centre_ids(p_user, 'enquiry.manage'))`.
*   `app.enquiry_counsellors(p_centre int) returns table (id uuid, display_name text)`: the active users for whom `enquiry_may_receive(p_centre, id)` holds, ordered by `display_name, id`. Without the caller check it returns nothing.
*   `app.enquiry_people(p_ids bigint[]) returns table (id uuid, display_name text)`: the counsellors and follow-up authors of those of `p_ids` whose centre is in the caller's `scoped_centre_ids('enquiry.view')`. One call per page.

**Permissions (DD-3, DD-13, C16).** The `system_admin` role holds all three (as 0013). Only `enquiry.setup` is sensitive, and sensitive permissions require TOTP (0013).

| Key | Description | Sensitive |
|---|---|---|
| `enquiry.view` | "View enquiries of a centre" | no |
| `enquiry.manage` | "Record and work enquiries of a centre" | no |
| `enquiry.setup` | "Maintain enquiry paths, types and statuses" | yes |

**Seeds (C3; codes satisfy `<table>_code_check`; all PMC).** Fourteen paths are seeded; the SPEC's other two are unknown.

| Table | code: name |
|---|---|
| `enquiry_path` | `SOCIAL_MEDIA` Social Media, `WALK_IN` Walk In, `DIRECT_CALL` Direct Call, `MESSAGE` Message, `TELE_CALLING` Tele Calling, `ALUMNI` Alumnus/Alumna, `FRIENDS` Friends, `GTEC_STUDENT` G-TEC Student's, `NOTICE_BOARD` Notice Boards/Hoardings, `TV_AD` TV Advertisements, `NEWSPAPER_AD` Newspaper Advertisements, `MAIL` Mail, `STAFF` Staff, `OTHER_REF` Other Ref |
| `enquiry_type` | `WALK_IN` Walk In, `ONLINE` Online, `WEBSITE` Website, `TELECALLER` TeleCaller, `PHONE` Phone Enquiry, `OTHER_REF` Other Ref, `DIRECT_CALL` Direct Call |

| `enquiry_status` code | Name | Kind | Colour | Order |
|---|---|---|---|---|
| `NEW` | New | OPEN | #1e88e5 | 10 |
| `CONTACTED` | Contacted | OPEN | #43a047 | 20 |
| `AFFORDABILITY` | Affordability | OPEN | #fb8c00 | 30 |
| `ENROLLED` | Enrolled | ENROLLED | #2e7d32 | 900 |
| `LOST` | Lost | LOST | #757575 | 950 |
| `JUNK` | Junk | JUNK | #b71c1c | 990 |

### Masters in code (Z7, C14)

*   **Paths and types reuse the catalogue code.** `catalogue.ts`'s registry becomes `MASTERS: Record<MasterKind, { table: Prisma.Sql; permission: string }>`:
    *   `enquiry_path` and `enquiry_type` are added with `enquiry.setup`; the catalogue kinds keep `catalogue.manage`;
    *   `createMaster`, `updateMaster`, `setMasterActive` and `listMasters` use the kind's permission, and `listMasters.canManage` is `has_permission(MASTERS[kind].permission, null)`;
    *   the audit actions stay `catalogue.create`, `catalogue.update`, `catalogue.activate` and `catalogue.deactivate`, with `targetType` = the kind.
*   **The shared masters page** gains the slugs `enquiry-paths` and `enquiry-types` (`/admin/catalogue/masters/enquiry-paths` and `…/enquiry-types`). They are linked from `/admin/catalogue`, and from `/enquiries` for holders of `enquiry.setup`.
*   **Statuses have their own code** in `src/server/enquiry.ts`, in the catalogue style:
    *   `listEnquiryStatuses`, `createEnquiryStatus`, `updateEnquiryStatus` (name, colour, sort order; never kind or code) and `setEnquiryStatusActive`;
    *   every write goes through `adminWrite` with `enquiry.setup` (ALL scope, fresh step-up, before/after audited);
    *   `setEnquiryStatusActive` is two calls with literal actions and a required reason, as `setMasterActive` (I11);
    *   the audit actions are `enquiry.setup.status.create`, `.update`, `.activate` and `.deactivate`;
    *   the page `/enquiries/statuses` posts to the route handler `/enquiries/statuses/save` through `adminPost`, with step-up.
*   **Status master messages** are `RbacError("invalid", "<field>: <rule>")` (catalogue `bad()`), mapped by `adminPost` (D6):
    *   `code: …` (the catalogue code rules);
    *   `name: 1-200 characters`;
    *   `colour: #rrggbb` (lower-cased first);
    *   `sortOrder: 0-1000`;
    *   `kind: one of OPEN, LOST, JUNK` (ENROLLED cannot be created);
    *   `reason: required`, `nothing to change`, `already active` and `already inactive`.
*   **Two refusals share the key** `enquiry.setup.keep` with one `ADMIN_MESSAGES` text, "This status cannot be switched off: it is the enrolled status or the last active one of its kind." (D18, I11). They are:
    *   deactivating the ENROLLED status;
    *   deactivating the last active status of a kind.

    The function checks both before the write. The check constraint backs up the ENROLLED case (I3).
*   **Master references in enquiry writes** are plain reads with no `for share` (Z9: the update policy would hide the rows from enquiry writers). A new or changed `pathId`, `typeId`, `statusId` or course must be active (courses: active and visible). An unchanged reference is kept even if it is now inactive (C18, I9).

### Server (`src/server/enquiry.ts`)

**Types** (C2, C12, D10, I8). Enquiry ids are strings everywhere: in signatures, URLs and audit rows (`returning id::text`). An id must match `^\d{1,18}$`; anything else gives `PersonError("notfound")`.

```ts
type EnquiryInput = {
  centreId: number; givenName: string; familyName?: string | null; dateOfBirth: string; gender: string; mobile: string;
  email?: string | null; currentAddress?: string | null; currentPincode?: string | null; qualification?: string | null;
  guardianName?: string | null; guardianPhone?: string | null; whatsapp?: string | null; landline?: string | null;
  instagram?: string | null; lastSchool?: string | null; remark?: string | null;
  pathId: number; typeId: number; statusId?: number; enquiredOn?: string; courseCodes: string[]; // 1–3
};
type Warning = { kind: "enquiry"; id: string; givenName: string; familyName: string | null }
             | { kind: "learner"; personId: string; givenName: string; familyName: string | null };
createEnquiry(session, input: EnquiryInput, confirm?: string[]): Promise<{ id: string }>; // throws SameMobile(warnings), RateLimited
updateEnquiry(session, centreId: number, id: string, version: number,
  changes: Partial<Omit<EnquiryInput, "centreId" | "statusId" | "enquiredOn">>): Promise<{ version: number; changed: string[] }>;
setEnquiryStatus(session, centreId: number, ids: string[], statusId: number, note: string | null): Promise<{ count: number }>;
setCounsellor(session, centreId: number, ids: string[], userId: string | null): Promise<{ count: number }>;
addFollowUp(session, centreId: number, id: string,
  f: { kind: string; durationMin?: number | null; note: string; nextOn?: string | null }): Promise<{ id: string }>;
```

**Every write follows these rules** (C4, D1, D9, DD-14, I8):

*   **Validation first.** The input is validated before any database access.
*   **The action.** Each write is one `scopedAction({ action: "enquiry.<x>", permission: "enquiry.manage", centreId, targetType: "enquiry", … })`, with the literal action on one line (D9). `targetId` is the id for single-id writes; it is omitted for bulk writes.
*   **The lock.** Each write except create starts with one ordered lock:

    ```sql
    select e.id, e.admission_id, s.kind from app.enquiry e join app.enquiry_status s on s.id = e.status_id
    where e.id = any ($ids::bigint[]) and e.centre_id = $centreId order by e.id for no key update of e
    ```

    *   Fewer rows than ids gives `PersonError("notfound")` for a single-id write (the 404 path of `pageRead`) and `ids: one centre` for a bulk write. Hidden and other-centre ids give the same answer.
    *   An enrolled row (`admission_id` set) gives `enquiry: enrolled` (DD-15).
    *   The ordered lock serialises a write with `admit()` and with overlapping bulk calls, so no deadlock is possible.
*   **Bulk writes** take 1–100 ids, all at the `centreId` of the list's centre filter, which the bulk form requires. They are all-or-nothing and write one audit row, whose detail holds the `ids` and the field names (DD-12).
*   **Audit rows** list field names, never values. Follow-up notes are never copied into audit rows (DD-14).
*   **Only `updateEnquiry` changes `version`.** `admit()` and the other writes leave it as it is (Z10).

**`createEnquiry` (`enquiry.create`; G1, DD-10, C5, D3, D10, DD-15, I1, I2):**

1.  **Validate** every field; see Messages.
2.  **Pre-flight transaction** (`withScope`): `limitSearch(tx)` (the existing search limit; every create counts one) and `select nextval('app.enquiry_id_seq')`. A `RateLimited` here gives the form's `rateLimited` message.
3.  **`scopedAction`** with `targetId` = that id. It:
    *   checks the master references;
    *   sets the status: OPEN-kind only, defaulting to the active OPEN status with the lowest `sort_order`;
    *   runs the duplicate lookup;
    *   inserts with the explicit id.
4.  **Duplicate lookup.** It finds:
    *   OPEN-kind enquiries at `centreId` with the same normalised mobile;
    *   persons with that mobile who have an admission in `scoped_centre_ids('student.view')`.

    `confirm` carries the ids that were shown; a match that was not shown warns again. An unconfirmed match throws `SameMobile(warnings)`, and the form shows the warnings with "Save anyway".
5.  **The `onFailure` hook** audits that throw, as `admit` audits `PossibleDuplicate`: a FAILED `enquiry.create` row with `reason: "duplicate"` and the matched ids only (no names, no mobile). The same mobile warns; it never blocks.
6.  **The OK audit** lists the field names that were set.

**`updateEnquiry` (`enquiry.update`; Z10):**

*   Covers the fields and preferences; never the status, counsellor, centre or `enquired_on`.
*   A stale `version` is refused, and the update increments `version`.
*   No real change gives `enquiry: nothing to change`.
*   LOST and JUNK enquiries may be edited (DD-15).

**`setEnquiryStatus` (`enquiry.status`; DD-6, DD-15, D11):**

*   The target may not be ENROLLED (`statusId: not by hand`).
*   LOST or JUNK targets need a note, and so does reopening a LOST or JUNK enquiry to an OPEN status.
*   A given note is stored as one NOTE follow-up on each enquiry.
*   Moving to LOST or JUNK clears `next_follow_up_on`; reopening leaves it empty.

**`setCounsellor` (`enquiry.counsellor`):** `userId` null clears the counsellor. Otherwise `app.enquiry_may_receive(centreId, userId)` must hold.

**`addFollowUp` (`enquiry.followup`; DD-8, C17, D11):**

*   Appends the follow-up, with `at = now()`.
*   For every kind except NOTE, `last_contact_at = at`.
*   `next_follow_up_on` changes only when `nextOn` is present: a date sets it, and an explicit `null` clears it. A NOTE without `nextOn` keeps it.
*   LOST and JUNK enquiries still take follow-ups (DD-15).

**Messages** (`invalid(field, rule)` → `PersonError`; C2, I12):

*   **Identity and detail fields** keep the `identityField` and `detailField` messages.
*   **Required:** `dateOfBirth: required`, `gender: required`, `mobile: required`.
*   **Own fields:**
    *   `whatsapp` and `landline`: `10 digits` (normalised like the detail phones);
    *   `instagram` and `lastSchool`: `1-100 characters`;
    *   `remark`: `1-1000 characters`;
    *   any of these three: `invalid characters` (control characters).
*   **Masters:** `pathId`, `typeId` and `statusId`: `inactive or unknown`; `statusId: open statuses only` on create.
*   **Courses:** `courseCodes: 1-3`, `courseCodes: distinct`, `courseCodes[i]: no such course`.
*   **Dates:** `enquiredOn: not in the future`.
*   **Updates:**
    *   stale version: `enquiry: changed since you opened it; reload the page`;
    *   nothing changed: `enquiry: nothing to change`;
    *   enrolled (every write): `enquiry: enrolled`.
*   **Status changes:** `statusId: not by hand`, `note: required`, `ids: 1-100`, `ids: one centre`.
*   **Follow-ups:** `kind: one of the listed values`, `durationMin: 0-600`, `note: 1-2000 characters`, `nextOn: not in the past` (IST).
*   **Counsellor:** `userId: cannot receive enquiries here`.

**Reads:**

*   **`listEnquiries(session, filters)`** (C13, Z5, D4):
    *   **Scope:** a user with no `enquiry.view` scope gets Forbidden.
    *   **GET filters:** `centre`, `status`, `kind` (default all), `counsellor`, `from` and `to` (YYYY-MM-DD, on `enquired_on`), and `due` (`next_follow_up_on <= due`). An invalid value matches no rows; it never raises an error.
    *   **Search `q`** comes only from a POST body (a Server Action, like `SearchState`), and only a `q` calls `limitSearch`; a rate-limited search returns the `rateLimited` state. One query ORs three conditions:
        *   `id = q` when `q` is 1–18 digits;
        *   `mobile = identityField("mobile", q)` when that succeeds;
        *   a name prefix on either name, escaped as `listAdmissions` does.
    *   **Row:** `{ id, enquiredOn, givenName, familyName, statusName, statusColour, kind, counsellorName, nextFollowUpOn, centreCode }`. It carries no mobile. Names come from `enquiry_people`.
    *   **Order:** `order by id desc limit 100`.
*   **`getEnquiry(session, id)`:**
    *   returns the record, the follow-ups, the names (`enquiry_people`), the linked Admission No when it is visible, `canManage` (`enquiry.manage` at the centre) and `canEnrol` (`enquiry.manage` and `student.admit` at the centre, Z11);
    *   not found and forbidden both give `PersonError("notfound")`, which is the 404 path.
*   **`followUpCalendar(session, month, centreId?)`** (C19):
    *   `month` must match `^\d{4}-(0[1-9]|1[0-2])$`; anything else is a 404;
    *   it selects OPEN-kind enquiries with `next_follow_up_on` in that month;
    *   it returns `{ day: string; rows: { id, givenName, familyName, statusName, counsellorName }[] }[]`, capped at 1000 rows.
*   **`canViewEnquiries(session)`:** `cardinality(scoped_centre_ids('enquiry.view')) > 0`. This drives the home link.

### Enroll (DD-9, C8, C9, D8, D17, Z12, I7)

**`admit()`** gains an optional `enquiryId`:

*   **Before the action:** `enquiryId` must match `^\d{1,18}$`; otherwise `invalid("enquiry", "not found")`.
*   **Inside the transaction**, after the form lock and the `used` check (so a resubmit still reports "saved") and before the catalogue checks:
    1.  `authorize(tx, "enquiry.manage", centreId)` → `Forbidden`. The DENIED row names `enquiry.manage` (I7), and a hand-crafted post gets the 404.
    2.  The lock: `select e.centre_id, e.admission_id, s.kind from app.enquiry e join app.enquiry_status s on s.id = e.status_id where e.id = $1::bigint for no key update of e`. No row → `invalid("enquiry", "not found")`.
    3.  The enquiry is at another centre → `invalid("enquiry", "other centre")`.
    4.  `admission_id` is already set → `invalid("enquiry", "already enrolled")`.
    5.  The kind is LOST or JUNK → `invalid("enquiry", "closed")`.
*   **After the admission insert:** `update app.enquiry set admission_id = …, status_id = (select id from app.enquiry_status where kind = 'ENROLLED')`. `version` is unchanged.
*   **The audit:** the OK `person.admit` row records `enquiryId`.

**`action.ts` (I7):** `Forbidden` gains an optional `permission`, which `authorize()` sets. The DENIED audit row records `e.permission ?? meta.permission`.

**`ADMIT_MESSAGES`** adds four texts, mapped in `submitAdmission` on `e.field === "enquiry"` by `e.rule`:

| Key | Text |
|---|---|
| `enquiryNotFound` | "This enquiry is no longer available." |
| `enquiryOtherCentre` | "This enquiry belongs to another centre." |
| `enquiryEnrolled` | "This enquiry is already enrolled." |
| `enquiryClosed` | "This enquiry is closed (lost or junk)." |

**The Enroll page: `/students/new?enquiry=<id>`.**

*   "Enroll" is shown on the record only when `canEnrol` (Z11). The id is the only value in the URL.
*   The page returns 404 in any of these cases:
    *   the id fails `^\d{1,18}$`;
    *   `getEnquiry` fails;
    *   `canEnrol` is false;
    *   the enquiry is enrolled, LOST or JUNK.
*   `initial.values` holds the keys below; empty ones are omitted:
    *   `nationality: DEFAULT_NATIONALITY` and `centreId`;
    *   `givenName`, `familyName`, `dateOfBirth`, `gender`, `mobile`, `email`;
    *   `course.1.courseCode` from preference 1 only, with the join date left blank;
    *   `currentAddress`, `currentPincode`, `qualification`, `guardianName`, `guardianPhone`, which copy straight across (Z6).
*   Preferences 2 and 3 are listed above the form as "Also interested in: …". A preference that is no longer offered is listed as "(no longer offered)".
*   `AdmitFormState` gains `enquiryId`, carried like `admissionId`. A hidden input `enquiryId` is read with `text("enquiryId")` and passed to `admit` only when it is not empty. The success redirect is unchanged.

### Pages

| Route | What |
|---|---|
| `/enquiries` | The list: GET filters; a POST search; "New enquiry"; a bulk form (checkboxes; status with note, or counsellor; needs a centre filter); links to the masters for `enquiry.setup` holders |
| `/enquiries/new` | The enquiry form (a Server Action); same-mobile warnings, then "Save anyway"; the `rateLimited` message |
| `/enquiries/[id]` | The record: an edit form carrying the version and centre; the status change; the counsellor picker (`enquiry_counsellors`); the follow-up form and log; Enroll |
| `/enquiries/calendar?month=YYYY-MM` | A month grid of the follow-ups due |
| `/enquiries/statuses` | The status master: list, create, rename, colour, order, (de)activate with a reason (`enquiry.setup`, step-up) |
| `/admin/catalogue/masters/enquiry-paths`, `…/enquiry-types` | Paths and types on the shared masters page |
| Home | "Enquiries" for `canViewEnquiries` |

### Fixtures and tests (C11)

*   **`reset()` changes:**
    *   add the three permissions;
    *   add `app.enquiry_followup` and `app.enquiry` to the truncate list;
    *   reset the three masters to the seeds above (a plain re-insert; there is no status trigger, I3).
*   **Roles:**

| Role | Permissions |
|---|---|
| 19 `enquiry_worker` | view, manage |
| 20 `enquiry_viewer` | view |
| 21 `enquiry_setup` | setup |

*   **Users:**

| User | Roles and scope | Token |
|---|---|---|
| `EQ.wa` | 19 and 17 at A | `tok-eqA` |
| `EQ.wb` | 19 at B | `tok-eqB` |
| `EQ.va` | 20 at A | `tok-eqView` |
| `EQ.ma` | 19 at A only | `tok-eqNoAdmit` |
| `EQ.setup` | 21 at ALL | `tok-eqSetup` |

*   `ST.sa` serves as a user with `student.admit` but no `enquiry.manage`.
*   `src/server/enquiry.ts` joins the T-AUD-009 scan list with `/"(enquiry\.[a-z0-9_.]+)"/g` (D9). Every audit action is listed in `tests/audit-catalogue.ts` and asserted in `tests/enquiry.test.ts` (Z12): `enquiry.create`, `enquiry.update`, `enquiry.status`, `enquiry.counsellor`, `enquiry.followup` and `enquiry.setup.status.create`, `.update`, `.activate`, `.deactivate`.
*   **Smoke (D18):** 404 parity for `/enquiries/<hidden id>` against a missing id, and for `/students/new?enquiry=<hidden id>`.

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-ENQ-001 | G1 | Create with every field; each field's message; preference rules; same-mobile warnings, then confirm, then a new unshown match; the FAILED duplicate row (ids only); the search limit on create; another centre; no permission | Saved and audited by field names; messages; warnings then saved; one FAILED row; `rateLimited`; Forbidden |
| T-ENQ-002 | G2 | Stale version; nothing to change; an unchanged inactive path or course is kept; status rules (note, ENROLLED refused, reopening, the next date cleared); counsellor without `enquiry.manage` refused; follow-ups set last contact and the next date (NOTE keeps it, explicit null clears it); every write refuses an enrolled enquiry; follow-up rows cannot be updated or deleted | As listed |
| T-ENQ-003 | G2 | Bulk on 100; one refused rolls back all; 101 refused; an id at another centre or hidden gives `ids: one centre`; overlapping bulk calls finish without deadlock | As listed |
| T-ENQ-004 | G3 | Enroll page: pre-fill (preference 1 only, others listed) and its 404 cases; link and status in one transaction; twice; other centre; closed; no `enquiry.manage` (DENIED names it); a failed admit leaves it open; concurrent enrol against edit, counsellor and follow-up; by direct SQL, `enquiry_guard` and `enquiry_followup_guard` refuse each forbidden insert and change | As listed |
| T-ENQ-005 | G4 | RLS by centre for select/insert/update by SQL; no delete grant; every role with `enquiry.manage` holds `enquiry.view` (non-vacuous); the definer functions refuse callers without `enquiry.view`; list filters, POST-only `q` (id, mobile, name in one query), limit; calendar month rule and cap | As listed |
| T-ENQ-006 | G4 | Paths and types through the shared masters with `enquiry.setup`; status master: kind and code fixed, a second ENROLLED row refused, the ENROLLED row renamed but never deactivated, the last active of a kind kept (`enquiry.setup.keep`), reason required; non-holders refused | As listed |

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
15. **DD-15: An enrolled enquiry is read-only; a lost or junk one may be reopened to an open status (with a note) and still takes follow-ups; new enquiries start open** (design owner, 2026-10-29, C10).

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

The file-by-file plan (Q1–Q4, each ending green) and the 59 mutation checks are in [`implementation_readiness_report.md`](implementation_readiness_report.md). These contract notes from step 9 are binding.

*   **Reset (R1, recommended option taken):** `scripts/etl/reset.sql` truncates `app.enquiry_followup` and `app.enquiry` with the admissions. Around the truncate it disables and re-enables `enquiry_followup_no_truncate`.
*   **No database function defaults (R2):**
    *   the insert guards set `created_by` / `created_at` and `by_user` / `at`, with `coalesce(app.session_user_id(), new.x)`;
    *   `enquired_on` is not null with no default; the app writes it.
*   **Fail closed (R3):** the follow-up guard uses `not exists (… e.admission_id is null)`, and the enquiry guard compares kinds with `is distinct from`.
*   **Deactivation race (R4):** `setEnquiryStatusActive` locks every row of the kind (`order by id for update`) before deciding.
*   **Form layer (R5):** a plain module `src/server/enquiry-form.ts` (submit functions, states, `ENQUIRY_MESSAGES`, `enrolPrefill`) plus thin Server Actions in `app/enquiries/actions.ts` and `app/enquiries/[id]/actions.ts`.
*   **T-ADM-006 (R6):** the action-export list grows to the sorted union.
*   **Prisma (R7):** the model text in the report. The composite admission relation is required in Prisma; the column stays nullable (MATCH SIMPLE).
*   **Columns and checks (R8–R10):**
    *   `gender` uses `app."Gender"`;
    *   the named checks are listed in the report;
    *   `remark` and the follow-up `note` allow tab, LF and CR.
*   **Bulk and audit (R11, R12):**
    *   bulk ids are deduped first;
    *   audit detail shapes: OK `{ fields }`, bulk `{ ids, fields }`, duplicate FAILED `{ reason, enquiries, persons }`;
    *   `person.admit` adds `enquiryId` only when given.
*   **Status master (R13):** a duplicate code is `catalogue.duplicate`; every signed-in user reads; `sortOrder` is parsed with `^\d{1,4}$`.
*   **Unchanged references (R14):** a preference code already among the stored three counts as unchanged.
*   **No scope (R15):** no `enquiry.view` scope gives Forbidden (404) on the calendar, the statuses page and `getEnquiry`.
*   **Other centre (R16):** "other centre" is reachable only with `enquiry.manage` at both centres; T-ENQ-004 expects "not found" otherwise.
*   **Smoke (R17):** the smoke inserts `created_by` explicitly, and an Origin-less post to `/enquiries/new` is 404.
*   **Generated documents (R18):** Q1 commits the regenerated CSV and FRD.
*   **Admission page (R19):** `AdmitFormState.enquiryId` is optional; the page takes `searchParams.enquiry`, and an array gives 404.
*   **Bulk no-op (R20):** a bulk status change to the current status is counted; a given note is still stored.

*Drafted with EGM (draft step followed manually)*
