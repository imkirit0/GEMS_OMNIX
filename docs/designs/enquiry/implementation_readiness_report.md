# EGM Stage 9: Implementation readiness report (enquiry)

- **Target:** `docs/designs/enquiry/enquiry.md` (commit `ada38cf`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check). It read every file the design changes or depends on, plus `scripts/etl/reset.sql`, `etl/run.ts`, `tests/admin-http.test.ts` and `build_matrix.py`.
- **Date:** 2026-10-29
- **Result:** **1 Blocker (OWNER), 6 Major, 13 Nit** (R1–R20). Verdict: buildable once these are folded in.
- **Owner decision R1:** the recommended option (a) was taken under the owner's standing instruction of 2026-10-29 ("agree on the recommended option and work on everything planned"). `scripts/etl/reset.sql` clears enquiries with admissions; it disables and re-enables the follow-up truncate trigger around the truncate. This holds while no real enquiries exist before the legacy cutover.

## Resolution

**Status: resolved (2026-10-29).** R1–R20 are applied as the design's contract notes. The build plan and mutation table below are the build plan.

## Findings

| ID | Sev | Finding (evidence) | Fix |
|---|---|---|---|
| R1 | Blocker, OWNER | `scripts/etl/reset.sql:4-6` truncates `app.admission` without CASCADE. 0018 adds the FK `enquiry(admission_id, centre_id) → admission`, so Postgres refuses the truncate even when `enquiry` is empty. This is the same break as learner-details D6. `tests/etl.test.ts:19` and `tests/learner-details.test.ts:15` (T-LD-004) run this file. Adding `app.enquiry_followup` to the truncate fails too, because of the design's own `enquiry_followup_no_truncate` trigger (enquiry.md:103). | **Options:** (a) reset also clears enquiries. In reset.sql, which runs as the schema owner: `alter table app.enquiry_followup disable trigger enquiry_followup_no_truncate;` then add `app.enquiry_followup, app.enquiry` before `app.registration` in the truncate, then `alter table app.enquiry_followup enable trigger enquiry_followup_no_truncate;`. (b) reset refuses (`raise`) if any enquiry exists. **Recommend (a)** if no real enquiries are recorded before the legacy cutover (the system goes live at cutover; Stage 0 is paused). Only the owner can confirm that. Add a line to the design's Fixtures section. |
| R2 | Major | `created_by` and `by_user` default to `app.session_user_id()`, and `enquired_on` defaults to "today IST" (enquiry.md:77, 79, 90). No migration or `schema.prisma` uses a function default (grep for `dbgenerated` and `default app.` finds nothing). The drift gate (`ci.sh:40`) compares column defaults, so the implementer would have to guess a `dbgenerated()` string that matches `pg_get_expr`. | No DB function defaults. The insert guards set `new.created_by := coalesce(app.session_user_id(), new.created_by); new.created_at := now();` and, on follow-ups, `new.by_user := coalesce(app.session_user_id(), new.by_user); new.at := now();`. This is invisible to the gate and stronger for C17. The coalesce lets admin-connection seeding (smoke, tests) pass the value explicitly. `enquired_on` is `not null` with no default; the app always writes it (`istToday()` when absent). |
| R3 | Major | `enquiry_followup_guard` says "the parent enquiry's `admission_id` is null" (enquiry.md:102). The guard runs as the caller under RLS. A parent the caller cannot see reads as null and passes: it fails open. The 0009 precedent fails closed (`0009_tickets/migration.sql:342-348`). | Write it as `if not exists (select 1 from app.enquiry e where e.id = new.enquiry_id and e.centre_id = new.centre_id and e.admission_id is null) then raise …`. In `enquiry_guard`, compare the kind with `is distinct from` / `is not distinct from` so a null kind refuses. |
| R4 | Major | "Deactivating the last active status of a kind" (enquiry.md:185-189) has a race. The catalogue style locks only the target row (`catalogue.ts:79-82`). Two managers deactivating the last two OPEN statuses each count the other as active, both commit, and no OPEN status is left; `createEnquiry` then has no default status. | In `setEnquiryStatusActive`, lock the whole kind first: `select id, code, active from app.enquiry_status where kind = (select kind from app.enquiry_status where id = $id) order by id for update`, then decide. |
| R5 | Major | The form layer is unspecified for `/enquiries/new`, the record page (edit, status, counsellor, follow-up), the bulk form and the POST search (enquiry.md:354-364): no transport, state types, error mapping or redirects. `pageRead` maps only `PersonError("notfound")` (`page-read.ts:22`), so a `PersonError("invalid")` from a write reaches `app/error.tsx` as a generic failure. The `rateLimited` and same-mobile texts are not given. | Mirror `admission-form.ts`. Add a plain module `src/server/enquiry-form.ts` (no `next/*` imports) holding the submit functions, state types, `ENQUIRY_MESSAGES` and `enrolPrefill`, all listed in Q3 below. Add thin Server Actions in `app/enquiries/actions.ts` and `app/enquiries/[id]/actions.ts`. |
| R6 | Major | T-ADM-006 (`tests/admission-screens.test.ts:191-201`) asserts that the exports of every `app/**/actions.ts` equal exactly `["admitAction","saveDetailsAction","searchAction"]`. The new action files fail it. | Update the expected list to the sorted union with the new action names (Q3). |
| R7 | Major | The Prisma side of the FKs is unspecified. (1) `enquiry.centre_id` has no FK to `centre` (every centre table has one, e.g. `schema.prisma:609`, `:632`). (2) The composite `(admission_id, centre_id)` relation mixes a nullable and a required scalar; Prisma then demands a required relation field. (3) Three course FKs and three `app_user` FKs need named relations and back-relations. (4) The `admission_id` unique alone does not make `[admissionId, centreId]` unique, so `Admission` needs a list back-relation. | Use the model text in Q2. Run `npx prisma validate` and then generate the DDL with `migrate diff`. |
| R8 | Nit | The `gender` column type is not given. | `gender app."Gender" not null` (Prisma `Gender`). The admit form's values are the same. |
| R9 | Nit | "The free-text lengths, as 0015 does" (enquiry.md:86) does not list the columns. The rule for follow-up `note` characters is not given. | Use the check list in Q2. |
| R10 | Nit | `remark` (1-1000) is a textarea, but "no control characters" refuses newlines. | Use the address rule for `remark` and follow-up `note` (tab, LF and CR allowed). Mirror it in code with the `CONTROL_IN_ADDRESS` set. |
| R11 | Nit | Duplicate ids in a bulk call produce fewer locked rows and a misleading `ids: one centre`. | Dedupe first (`[...new Set(ids)]`), then apply `ids: 1-100`. |
| R12 | Nit | Audit detail shapes are not given. | OK rows `{ fields: string[] }`; bulk `{ ids: string[], fields: string[] }`. Duplicate FAILED row `{ reason: "duplicate", enquiries: string[], persons: string[] }`. `person.admit` OK row adds `enquiryId` only when given, so existing equality tests stay green. |
| R13 | Nit | Status master gaps: no key for a duplicate code, no rule for who may read the page, and a blank `sortOrder` reads as 0 through `Number("")`. | Reuse `catalogue.duplicate` (export `unique()` from `catalogue.ts`). Every signed-in user reads; `canManage = has_permission('enquiry.setup', null)`. The route parses `sortOrder` with `/^\d{1,4}$/`, otherwise `NaN`, which gives `sortOrder: 0-1000`. |
| R14 | Nit | "Unchanged course reference" is ambiguous when preferences are reordered. | A code already in any of the stored three counts as unchanged. |
| R15 | Nit | `followUpCalendar`, the statuses page and `getEnquiry` behaviour for a user with no scope is not given. | No `enquiry.view` scope gives `Forbidden`, which is a 404. |
| R16 | Nit | In `admit()`, `invalid("enquiry","other centre")` is reachable only when the user holds `enquiry.manage` at both centres. The lock needs the update policy, so a view-only other centre gives "not found". | State this in T-ENQ-004 so the test expects it. |
| R17 | Nit | The smoke inserts through the admin connection, which has no session. | Insert `created_by` explicitly (works with R2). Also add an Origin-less post to `/enquiries/new` (404, nothing written), as T-ADM-005 does. |
| R18 | Nit | `build_matrix.py:59-61` warns on test ids not defined in `docs/audit/*.md`. `ci.sh:19-27` fails if the CSV or FRD is stale. | Q1 defines the T-ENQ ids in 09 and commits the regenerated CSV and FRD. |
| R19 | Nit | The `/students/new` page takes no props (`app/students/new/page.tsx:8`), and `AdmitFormState` has no `enquiryId`. | `enquiryId?: string` (optional, so existing states stay valid). The page takes `searchParams: Promise<{ enquiry?: string \| string[] }>`; an array gives 404. |
| R20 | Nit | Bulk status change on a row already at the target status is not covered. | It is updated anyway (a no-op) and counted, and a given note is still stored. |

## Build plan

Each phase ends with `bash scripts/ci.sh` exiting 0.

### Q1 Documents

1. `docs/audit/09-test-strategy-and-acceptance-criteria.md`:
   - Add `### T-ENQ: enquiry to admission (docs/designs/enquiry/enquiry.md)` after the T-COR block, before `### T-FEE`.
   - Use the T-ADM table format, with rows T-ENQ-001…006 copied from enquiry.md:394-401.
   - Add the R1, R16 and R17 wording.
2. `docs/audit/data/matrix-03-academics-general1.tsv`, tests column (14th cell):
   - R-081: `T-E2E-001` → `T-E2E-001,T-ENQ-001,T-ENQ-002,T-ENQ-004,T-ENQ-005`.
   - R-084: `T-SEC-002` → `T-SEC-002,T-ENQ-002`.
3. `docs/audit/data/matrix-05-fees-nonacad-crm-hrms-api.tsv`, R-085: `T-E2E-X04` → `T-E2E-X04,T-ENQ-002,T-ENQ-003,T-ENQ-005,T-ENQ-006`.
4. Run `python -I docs/audit/tools/build_matrix.py docs/audit` and `python -I docs/requirements/tools/build_frd.py .`, then commit `02-requirements-traceability-matrix.csv` and `FRD-GEMS-OMNIX.md`.
5. enquiry.md: fold in R1–R20 and replace the "Detailed Implementation Plan" outline with this plan.

### Q2 Data and server

#### 1. `prisma/schema.prisma`

Back-relations to add on existing models:
- `Centre.enquiries Enquiry[]`
- `AppUser`: `enquiriesCounselled Enquiry[] @relation("enquiryCounsellor")`, `enquiriesCreated Enquiry[] @relation("enquiryCreatedBy")`, `enquiryFollowups EnquiryFollowup[] @relation("enquiryFollowupBy")`
- `Course`: `enquiries1 Enquiry[] @relation("enquiryCourse1")`, `enquiries2 … "enquiryCourse2"`, `enquiries3 … "enquiryCourse3"`
- `Admission.enquiries Enquiry[]`
- `Person`: `@@index([mobile])`

New models:

```prisma
model EnquiryPath {
  id        Int       @id @default(autoincrement())
  code      String    @unique
  name      String
  active    Boolean   @default(true)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  enquiries Enquiry[]
  @@map("enquiry_path")
  @@schema("app")
}
model EnquiryType { /* same fields as EnquiryPath */ @@map("enquiry_type") @@schema("app") }
model EnquiryStatus {
  id        Int       @id @default(autoincrement())
  code      String    @unique
  name      String
  kind      String
  colour    String
  sortOrder Int       @map("sort_order")
  active    Boolean   @default(true)
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz
  enquiries Enquiry[]
  @@map("enquiry_status")
  @@schema("app")
}
model Enquiry {
  id             BigInt    @id @default(autoincrement())
  centreId       Int       @map("centre_id")
  givenName      String    @map("given_name")
  familyName     String?   @map("family_name")
  dateOfBirth    DateTime  @map("date_of_birth") @db.Date
  gender         Gender
  mobile         String
  email          String?
  currentAddress String?   @map("current_address")
  currentPincode String?   @map("current_pincode")
  qualification  String?
  guardianName   String?   @map("guardian_name")
  guardianPhone  String?   @map("guardian_phone")
  whatsapp       String?
  landline       String?
  instagram      String?
  lastSchool     String?   @map("last_school")
  remark         String?
  pathId         Int       @map("path_id")
  typeId         Int       @map("type_id")
  statusId       Int       @map("status_id")
  courseCode1    String    @map("course_code_1")
  courseCode2    String?   @map("course_code_2")
  courseCode3    String?   @map("course_code_3")
  counsellorId   String?   @map("counsellor_id") @db.Uuid
  enquiredOn     DateTime  @map("enquired_on") @db.Date
  nextFollowUpOn DateTime? @map("next_follow_up_on") @db.Date
  lastContactAt  DateTime? @map("last_contact_at") @db.Timestamptz
  admissionId    String?   @unique @map("admission_id") @db.Uuid // written only by admit()
  version        Int       @default(1)
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  createdBy      String    @map("created_by") @db.Uuid // set by app.enquiry_guard()
  centre     Centre        @relation(fields: [centreId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  path       EnquiryPath   @relation(fields: [pathId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  type       EnquiryType   @relation(fields: [typeId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  status     EnquiryStatus @relation(fields: [statusId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  course1    Course        @relation("enquiryCourse1", fields: [courseCode1], references: [code], onDelete: Restrict, onUpdate: Restrict)
  course2    Course?       @relation("enquiryCourse2", fields: [courseCode2], references: [code], onDelete: Restrict, onUpdate: Restrict)
  course3    Course?       @relation("enquiryCourse3", fields: [courseCode3], references: [code], onDelete: Restrict, onUpdate: Restrict)
  counsellor AppUser?      @relation("enquiryCounsellor", fields: [counsellorId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  creator    AppUser       @relation("enquiryCreatedBy", fields: [createdBy], references: [id], onDelete: Restrict, onUpdate: Restrict)
  // required because centreId is required (Prisma rule); the column stays nullable; MATCH SIMPLE skips it while null
  admission  Admission     @relation(fields: [admissionId, centreId], references: [id, centreId], onDelete: Restrict, onUpdate: Restrict)
  followUps  EnquiryFollowup[]
  @@unique([id, centreId])
  @@index([centreId, mobile])
  @@index([nextFollowUpOn])
  @@map("enquiry")
  @@schema("app")
}
model EnquiryFollowup {
  id          BigInt    @id @default(autoincrement())
  enquiryId   BigInt    @map("enquiry_id")
  centreId    Int       @map("centre_id")
  at          DateTime  @default(now()) @db.Timestamptz
  kind        String
  durationMin Int?      @map("duration_min")
  note        String
  nextOn      DateTime? @map("next_on") @db.Date
  byUser      String    @map("by_user") @db.Uuid
  enquiry     Enquiry   @relation(fields: [enquiryId, centreId], references: [id, centreId], onDelete: Restrict, onUpdate: Restrict)
  author      AppUser   @relation("enquiryFollowupBy", fields: [byUser], references: [id], onDelete: Restrict, onUpdate: Restrict)
  @@index([enquiryId])
  @@map("enquiry_followup")
  @@schema("app")
}
```

#### 2. `prisma/migrations/0018_enquiry/migration.sql`

Generate the DDL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against a database at 0017. Then add the hand-written parts in this order:

1. **Tables (generated):** CREATE TABLE `enquiry_path`, `enquiry_type`, `enquiry_status`, `enquiry`, `enquiry_followup`.
2. **Indexes (generated):**
   - `*_code_key` on the three masters;
   - `enquiry_admission_id_key`, `enquiry_id_centre_id_key`, `enquiry_centre_id_mobile_idx`, `enquiry_next_follow_up_on_idx`;
   - `enquiry_followup_enquiry_id_idx`, `person_mobile_idx`.
3. **Checks (hand-written, named):**
   - Masters: `<t>_code_check` with 0012's exact expression; `<t>_name_check` as `name = btrim(name) and name <> ''`.
   - `enquiry_status_kind_check (kind in ('OPEN','ENROLLED','LOST','JUNK'))`.
   - `enquiry_status_colour_check (colour ~ '^#[0-9a-f]{6}$')`.
   - `enquiry_status_sort_order_check (sort_order between 0 and 1000)`.
   - `enquiry_status_enrolled_check (kind <> 'ENROLLED' or (code = 'ENROLLED' and active))`.
   - On `enquiry`, with the 0015 `ws`/`ctl` loop:
     - `given_name` (1–100, trimmed), `family_name` (1–100), `guardian_name` (100), `instagram` (100) and `last_school` (100): trimmed and control-free;
     - `current_address` (500) and `remark` (1000): address control set;
     - `mobile`, `whatsapp`, `landline`, `guardian_phone`: `^[0-9]{10}$`;
     - `current_pincode`: `^[1-9][0-9]{5}$`;
     - `qualification`: 0015's list;
     - `email`: `~ '^[^@]*@[^@]*$'`;
     - `enquiry_courses_check (course_code_3 is null or course_code_2 is not null) and (course_code_2 is null or course_code_2 <> course_code_1) and (course_code_3 is null or (course_code_3 <> course_code_1 and course_code_3 <> course_code_2))`.
   - `enquiry_followup_kind_check (kind in ('CALL_IN','CALL_OUT','VISIT','MESSAGE','NOTE'))`.
   - `enquiry_followup_duration_min_check (duration_min between 0 and 600)`.
   - `enquiry_followup_note_check`: trimmed, address control set, `char_length between 1 and 2000`.
4. **FKs (generated):** path, type, status, centre, course ×3, counsellor, created_by, `enquiry_admission_id_centre_id_fkey`, `enquiry_followup_enquiry_id_centre_id_fkey`, `enquiry_followup_by_user_fkey`. All Restrict/Restrict.
5. **Triggers.** Plain plpgsql, not security definer, `set search_path = pg_catalog, app`, as `ticket_guard`:
   - **`app.enquiry_guard()`, before insert or update on `app.enquiry`.** First `select kind into k from app.enquiry_status where id = new.status_id`.
     - On INSERT: set `created_by` / `created_at` (R2); raise unless `new.admission_id is null and k is not distinct from 'OPEN' and new.version = 1`.
     - On UPDATE, raise if `new.centre_id <> old.centre_id`.
     - Raise if `old.admission_id is not null`.
     - Raise if `(new.admission_id is not null) <> (k is not distinct from 'ENROLLED')`.
   - **`app.enquiry_followup_guard()`, before insert:** set `by_user` / `at` (R2), plus the fail-closed `not exists` from R3.
   - `enquiry_followup_no_update_delete` (before update or delete, for each row) and `enquiry_followup_no_truncate` (before truncate, for each statement), both executing `app.ticket_immutable()`.
6. **RLS.** For `enquiry` and `enquiry_followup`:
   - ENABLE and FORCE;
   - `<t>_select` using `centre_id = any ((select app.scoped_centre_ids('enquiry.view'))::int[])`;
   - `<t>_insert` (with check), `<t>_update` (using and with check) and `<t>_delete` (using) with `'enquiry.manage'`.

   For the three masters, the 0012 loop body with `'enquiry.setup'` (setup_select, setup_insert, setup_update; no delete policy).
7. **Grants.**
   - `grant select, insert on` the five tables `to gems_app`.
   - `grant update (name, active)` on path and type.
   - `grant update (name, active, colour, sort_order)` on status.
   - `grant update (given_name, family_name, date_of_birth, gender, mobile, email, current_address, current_pincode, qualification, guardian_name, guardian_phone, whatsapp, landline, instagram, last_school, remark, path_id, type_id, status_id, course_code_1, course_code_2, course_code_3, counsellor_id, enquired_on, next_follow_up_on, last_contact_at, admission_id, version) on app.enquiry`.
   - `grant usage on sequence` for the five `*_id_seq`.
   - No delete grants.
8. **Definer functions.** All three are `language sql stable security definer set search_path = pg_catalog, app`:
   - `enquiry_may_receive(p_centre int, p_user uuid) returns boolean`: `select coalesce(app.has_permission('enquiry.view', p_centre), false) and exists (select 1 from app.app_user u where u.id = p_user and u.status = 'ACTIVE') and coalesce(p_centre = any (app.user_centre_ids(p_user, 'enquiry.manage')), false)`.
   - `enquiry_counsellors(p_centre int)`: active users where `app.enquiry_may_receive(p_centre, u.id)`, ordered by `display_name, id`.
   - `enquiry_people(p_ids bigint[])`: users whose id is in `(select counsellor_id from app.enquiry e where e.id = any(p_ids) and e.centre_id = any(app.scoped_centre_ids('enquiry.view')) union select f.by_user from app.enquiry_followup f join app.enquiry e on e.id = f.enquiry_id and e.centre_id = f.centre_id where e.id = any(p_ids) and e.centre_id = any(app.scoped_centre_ids('enquiry.view')))`, ordered by `display_name, id`.
   - Then `revoke all … from public; grant execute … to gems_app`.
9. **Seeds.** These run as the migration role, which bypasses RLS (asserted by T-RLS-005 `owner_bypasses`). Insert in this order, so the ids are deterministic:
   - 14 paths;
   - 7 types;
   - 6 statuses, each with (code, name, kind, colour, sort_order) per enquiry.md:153-163.
10. **Permissions.**
    - `insert into app.permission … ('enquiry.view','View enquiries of a centre',false), ('enquiry.manage','Record and work enquiries of a centre',false), ('enquiry.setup','Maintain enquiry paths, types and statuses',true) on conflict (key) do nothing;`
    - `insert into app.role_permission (role_id, permission_key) select r.id, p.key from app.role r cross join app.permission p where r.key = 'system_admin' and p.key like 'enquiry.%' on conflict do nothing;`. The file must contain the text `system_admin` (checked at `admin-http.test.ts:146-150`).

#### 3. `scripts/etl/reset.sql`

Apply R1 option (a).

#### 4. `src/server/action.ts`

- `export class Forbidden extends Error { override name = "Forbidden"; constructor(message?: string, readonly permission?: string) { super(message); } }`
- In `authorize`, pass `permission` as the second argument.
- Line 55 becomes `{ permission: e.permission ?? meta.permission }`.

#### 5. `src/server/catalogue.ts`

- `MasterKind` adds `"enquiry_path" | "enquiry_type"`.
- `TABLES` becomes `MASTERS: Record<MasterKind, { table: Prisma.Sql; permission: string }>`.
- `table()` keeps the `Object.hasOwn` check and the "kind: unknown" message, and returns the entry.
- `createMaster`, `updateMaster` and `setMasterActive` use `MASTERS[kind].permission`.
- `listMasters.canManage` uses `has_permission(${perm}, null)`.
- Change `liveRef(tx, TABLES.x…)` to `MASTERS.x.table`.
- `canManage()` stays `catalogue.manage` for courses, years and centres.
- Export `unique`.

#### 6. `src/server/admin-http.ts`

Add to `ADMIN_MESSAGES`: `"enquiry.setup.keep": "This status cannot be switched off: it is the enrolled status or the last active one of its kind."`.

#### 7. `src/server/people.ts`

- `AdmitInput.enquiryId?: string`.
- Before the action: if defined and not matching `/^\d{1,18}$/`, `throw invalid("enquiry","not found")`.
- Inside the action, after the `used` check at line 301 and before the year read at line 304:
  - `authorize(tx, "enquiry.manage", input.centreId)`;
  - the lock query from enquiry.md:320;
  - the checks for not found, other centre, already enrolled and closed.
- After the admission insert at line 350: `update app.enquiry set admission_id = ${admissionId}::uuid, status_id = (select id from app.enquiry_status where kind = 'ENROLLED') where id = ${enquiryId}::bigint`.
- OK audit: `...(input.enquiryId ? { enquiryId: input.enquiryId } : {})`.

#### 8. `src/server/admission-form.ts`

- `AdmitFormState.enquiryId?: string`.
- In `submitAdmission`: `state.enquiryId = text("enquiryId") || undefined`, and pass it to `admit` only when non-empty.
- `ADMIT_MESSAGES` adds the 4 keys.
- In the `PersonError` branch, before the `admissionId` check: `if (e.field === "enquiry") return fail({ formError: ({ "not found": ADMIT_MESSAGES.enquiryNotFound, "other centre": …OtherCentre, "already enrolled": …Enrolled, "closed": …Closed })[e.rule!] ?? e.message })`.

#### 9. New `src/server/enquiry.ts`

- Exports: the types and the five writes as in enquiry.md:196-213.
- Reads: `listEnquiries`, `getEnquiry`, `followUpCalendar`, `canViewEnquiries`.
- Status master: `listEnquiryStatuses`, `createEnquiryStatus`, `updateEnquiryStatus`, `setEnquiryStatusActive` (R4 lock; R13 duplicate key).
- Errors: `class SameMobile extends Error { constructor(readonly warnings: Warning[]) }`.
- Validation helpers: own-field rules via `detailField`-style checks (R10); dedupe ids (R11).
- Every `action:` literal sits on one line, before `permission:`.
- `setEnquiryStatusActive` makes two literal `adminWrite` calls.

#### 10. `tests/fixtures.ts`

- Truncate list adds `app.enquiry_followup, app.enquiry, app.enquiry_status, app.enquiry_type, app.enquiry_path`.
- Export `ENQ_SEED`, and re-insert the seeds after the courses.
- Add the 3 permissions; roles 19 `enquiry_worker`, 20 `enquiry_viewer`, 21 `enquiry_setup` with their role_permission rows.
- Users `EQ = { wa: …0000000000b1, wb: …b2, va: …b3, ma: …b4, setup: …b5 }`, assigned per enquiry.md:384-388, with sessions `tok-eqA`, `tok-eqB`, `tok-eqView`, `tok-eqNoAdmit`, `tok-eqSetup`.

#### 11. Existing tests that change

- `tests/foundation.test.ts:51`: insert `"enquiry", "enquiry_followup"` after `"centre"`.
- `tests/foundation.test.ts:78`: insert `"enquiry_counsellors", "enquiry_may_receive", "enquiry_people"` after `"can_grant_permission"`.
- `tests/audit.test.ts:180`: add `["src/server/enquiry.ts", /"(enquiry\.[a-z0-9_.]+)"/g]`.
- `tests/audit-catalogue.ts`: add the 9 enquiry actions.

#### 12. New `tests/enquiry.test.ts`

- Server-level T-ENQ-001…006, including:
  - the guards by direct SQL;
  - the "manage implies view" role check (non-vacuous);
  - masters through `createMaster` with `enquiry.setup`, and `catalogue.manage` refused for enquiry kinds.
- Admit cases: link, twice, closed, other centre, DENIED row naming `enquiry.manage`, a failed admit leaves the enquiry open.

### Q3 Pages

1. `src/server/enquiry-form.ts`:
   - `submitEnquiry`, `submitEnquiryEdit`, `submitEnquiryStatus`, `submitCounsellor`, `submitFollowUp`, `submitBulk`. Each calls `hasOrigin` first; maps `PersonError("invalid")` to field or form errors; maps `SameMobile` to `warnings`; maps `RateLimited` to `rateLimited`; redirects on success to `/enquiries/<id>` (or `/enquiries?…` for bulk).
   - `ENQUIRY_MESSAGES = { rateLimited: "Too many searches or new enquiries in a minute. Wait a minute and try again.", stale: …, enrolled: "This enquiry is enrolled and can no longer change." }`.
   - `enrolPrefill(session, id)`: returns `{ values, also: { code, name, offered }[] }` or throws `PersonError("notfound")` in the four 404 cases.
2. `app/enquiries/actions.ts` exports `searchEnquiriesAction`, `bulkEnquiriesAction`, `createEnquiryAction`. `app/enquiries/[id]/actions.ts` exports `saveEnquiryAction`, `enquiryStatusAction`, `counsellorAction`, `followUpAction`. Both files start with `"use server"`, wrap with `pageRead`, and `redirect`.
3. Pages:
   - `app/enquiries/page.tsx`, a client `search.tsx` with bulk checkboxes;
   - `app/enquiries/new/page.tsx` and `form.tsx`;
   - `app/enquiries/[id]/page.tsx` and its forms;
   - `app/enquiries/calendar/page.tsx`;
   - `app/enquiries/statuses/page.tsx`;
   - `app/enquiries/statuses/save/route.ts` (`export const POST = safeRoute(handle)`, `adminPost`, its own label map).
4. `app/admin/catalogue/masters/slugs.ts`: add `"enquiry-paths": { kind: "enquiry_path", title: "Enquiry paths" }` and `"enquiry-types"`. Add both links in `app/admin/catalogue/page.tsx`.
5. `app/students/new/page.tsx` reads `searchParams.enquiry`. It runs `pageRead(enrolPrefill)`, merges the result into `initial.values` with `enquiryId`, and renders "Also interested in: …". `form.tsx` adds `{state.enquiryId && <input type="hidden" name="enquiryId" value={state.enquiryId} />}`.
6. `app/page.tsx` adds `canViewEnquiries(session)` to the `Promise.all` and an "Enquiries" link.
7. Tests:
   - `tests/admission-screens.test.ts:201` expects `["admitAction","bulkEnquiriesAction","counsellorAction","createEnquiryAction","enquiryStatusAction","followUpAction","saveDetailsAction","saveEnquiryAction","searchAction","searchEnquiriesAction"]`;
   - `tests/enquiry.test.ts` adds the form, prefill, status-route and slug cases.

### Q4 Evidence

1. `scripts/smoke-security.mjs`:
   - Seed the smoke student with a role holding `enquiry.view` and `enquiry.manage` at A.
   - Insert one enquiry at B as admin, with explicit `created_by` and `status_id = (select id from app.enquiry_status where code='NEW')`.
   - Check 404 parity: `/enquiries/<B id>` vs `/enquiries/999999999` vs `/enquiries/abc`.
   - Check `/students/new?enquiry=<B id>` vs a missing id: identical 404 bodies, no name leaked.
   - Origin-less post to `/enquiries/new`: 404, no `enquiry.create` row.
2. `evidence/mutation-enquiry-2026-10-29.txt` with the §4 table run.
3. E-entry in `docs/audit/12-evidence-and-verification-log.md`, with file hashes as the earlier entries have.

## Mutation checks

| # | Mutation | File | Test that must fail |
|---|---|---|---|
| 1 | Drop `force row level security` on `enquiry` | 0018 | T-RLS-002 (foundation) |
| 2 | Select policy uses `visible_centre_ids()` instead of `enquiry.view` | 0018 | T-ENQ-005 RLS by SQL (`uA` sees A) |
| 3 | Insert or update policy uses `'enquiry.view'` | 0018 | T-ENQ-005 (`EQ.va` insert succeeds) |
| 4 | Drop `enquiry_followup_delete` policy | 0018 | T-RLS-002 |
| 5 | `grant delete on app.enquiry` | 0018 | T-ENQ-005 no delete grant |
| 6 | Add `centre_id` to the update grant | 0018 | T-ENQ-005 column privileges |
| 7 | Add `code`/`kind` to the status update grant | 0018 | T-ENQ-006 kind and code fixed |
| 8 | Drop `enquiry_status_enrolled_check` | 0018 | T-ENQ-006 second ENROLLED row and deactivating ENROLLED by SQL |
| 9 | Drop `enquiry_courses_check` | 0018 | T-ENQ-001 preference rules by SQL |
| 10 | Drop the mobile, pincode or remark checks | 0018 | T-ENQ-001 app and DB refuse the same values |
| 11 | Guard: drop the insert OPEN-kind test | 0018 | T-ENQ-004 guard insert LOST refused |
| 12 | Guard: drop the `old.admission_id is not null` refusal | 0018 | T-ENQ-004 SQL update of an enrolled row |
| 13 | Guard: drop the admission/ENROLLED equivalence | 0018 | T-ENQ-004 SQL `status_id = ENROLLED` without admission |
| 14 | Guard: drop the `centre_id` change refusal | 0018 | T-ENQ-004 (as owner) |
| 15 | Guard: stop setting `created_by` | 0018 | T-ENQ-001 `created_by` = actor despite supplied value |
| 16 | Follow-up guard: `select admission_id … is null` (fail-open) | 0018 | T-ENQ-004 follow-up on an invisible or enrolled parent |
| 17 | Drop `enquiry_followup_no_update_delete` | 0018 | T-ENQ-002 follow-ups immutable |
| 18 | Drop `enquiry_followup_no_truncate` | 0018 | T-ENQ-002 truncate as owner refused |
| 19 | Composite follow-up FK made single-column | 0018 and schema | T-ENQ-004 follow-up naming another centre |
| 20 | Composite admission FK dropped | 0018 and schema | drift gate, and T-ENQ-004 other-centre admission by SQL |
| 21 | `enquiry_may_receive` without the caller `enquiry.view` check | 0018 | T-ENQ-005 definer refuses callers |
| 22 | `enquiry_may_receive` uses `user_centre_ids(p_user)` without permission | 0018 | T-ENQ-002 counsellor without manage refused |
| 23 | `enquiry_people` without the scope filter | 0018 | T-ENQ-005 names of other-centre ids |
| 24 | Definer function lacks `set search_path` or is not listed | 0018 | T-RLS-005 |
| 25 | `enquiry.setup` seeded non-sensitive | 0018 | T-ENQ-006 sensitive flag |
| 26 | Remove `system_admin` grant lines | 0018 | admin-http "later permission migrations" test |
| 27 | Seed ENROLLED as code `ENROLLED_X` | 0018 | migration fails its own check (deploy red) |
| 28 | reset.sql without the enquiry tables | `scripts/etl/reset.sql` | etl.test P8, T-LD-004 |
| 29 | `authorize()` no longer sets `permission` | `action.ts` | T-ENQ-004 DENIED row names `enquiry.manage` |
| 30 | `admit()` without `authorize(enquiry.manage)` | `people.ts` | T-ENQ-004 `ST.sa` (`EQ.ma` for the student.admit side) |
| 31 | `admit()` enquiry lock before the `used` check | `people.ts` | T-ENQ-004 resubmit reports "saved" |
| 32 | `admit()` skips the closed or already-enrolled check | `people.ts` | T-ENQ-004 closed and twice |
| 33 | `admit()` enquiry update outside the transaction, or also bumps `version` | `people.ts` | T-ENQ-004 failed admit leaves it open; version unchanged |
| 34 | `submitAdmission` drops the `enquiryId` pass-through | `admission-form.ts` | T-ENQ-004 link via form |
| 35 | `MASTERS.enquiry_path.permission = "catalogue.manage"` | `catalogue.ts` | T-ENQ-006 paths with `enquiry.setup`, catalogue admin refused |
| 36 | `listMasters.canManage` hard-coded to catalogue | `catalogue.ts` | T-ENQ-006 canManage per kind |
| 37 | Write lock without `and e.centre_id = $centreId` | `enquiry.ts` | T-ENQ-003 other-centre id gives `ids: one centre` |
| 38 | Write lock without `order by e.id` | `enquiry.ts` | T-ENQ-003 overlapping bulk without deadlock |
| 39 | Writes skip the enrolled refusal | `enquiry.ts` | T-ENQ-002 every write refuses enrolled |
| 40 | Bulk cap 101 / no dedupe | `enquiry.ts` | T-ENQ-003 101 refused, duplicates |
| 41 | `setEnquiryStatus` allows an ENROLLED target or a LOST target without a note | `enquiry.ts` | T-ENQ-002 status rules |
| 42 | `updateEnquiry` drops the version predicate | `enquiry.ts` | T-ENQ-002 stale version |
| 43 | New inactive path, course or status accepted | `enquiry.ts` | T-ENQ-001 and 002 inactive references |
| 44 | Duplicate lookup ignores `confirm` or uses `visible_centre_ids` for persons | `enquiry.ts` | T-ENQ-001 warnings, new unshown match; learner outside `student.view` hidden |
| 45 | `onFailure` copies names or mobile into the FAILED row | `enquiry.ts` | T-ENQ-001 FAILED row ids only |
| 46 | Audit detail carries values or the follow-up note | `enquiry.ts` | T-ENQ-001 and 002 field names only |
| 47 | Pre-flight `limitSearch` removed | `enquiry.ts` | T-ENQ-001 `rateLimited` on create |
| 48 | `listEnquiries` reads `q` from GET or returns `mobile` | `enquiry.ts`, `app/enquiries/page.tsx` | T-ENQ-005 POST-only q, row keys |
| 49 | Calendar cap or month regex removed | `enquiry.ts` | T-ENQ-005 calendar rule and cap |
| 50 | Deactivation locks only the target row | `enquiry.ts` | T-ENQ-006 concurrent last-two deactivation keeps one |
| 51 | `enquiry.setup.keep` check removed | `enquiry.ts` | T-ENQ-006 keep |
| 52 | `enrolPrefill` allows `canEnrol = false` or a LOST enquiry | `enquiry-form.ts` | T-ENQ-004 404 cases |
| 53 | Prefill copies preferences 2 and 3 into course rows | `enquiry-form.ts` | T-ENQ-004 pre-fill |
| 54 | `hasOrigin` removed from `submitEnquiry` | `enquiry-form.ts` | smoke Origin-less `/enquiries/new` |
| 55 | `/enquiries/[id]` page catches not-found and renders | `app/enquiries/[id]/page.tsx` | smoke 404 parity |
| 56 | `/students/new` ignores a bad `enquiry` param instead of 404 | `app/students/new/page.tsx` | smoke 404 parity `?enquiry=` |
| 57 | Extra export in an actions file | `app/enquiries/actions.ts` | T-ADM-006 |
| 58 | Status route not wrapped in `safeRoute` | `app/enquiries/statuses/save/route.ts` | T-SEC-012 |
| 59 | Action literal not on the `action:` line | `enquiry.ts` | T-AUD-009 coverage gate |
