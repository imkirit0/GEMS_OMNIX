# EGM Stage 9: Implementation readiness report (centre onboarding)

- **Target:** `docs/designs/centre-onboarding/centre-onboarding.md` (commit `d256f01`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major, 6 Minor, 4 Nit** (R1–R14); no OWNER items.

## Resolution

**Status: resolved (2026-10-29).** All applied as the design's step-9 notes. Build approved under the owner's standing instruction of 2026-10-29.

## Findings

| ID | Severity | Finding (evidence) | Fix |
|---|---|---|---|
| R1 | Major | **The created centre's id cannot reach the audit row.** `createCentre` "takes `nextval` first (the audit's target id)" (design :151). But `adminWrite` fixes `meta.targetId` before its callback runs (`rbac.ts:43-48`, `action.ts:47-50`), so a `nextval` taken inside the callback cannot become the target id. | Use the enquiry pre-flight pattern (`enquiry.ts:170-175`): `const id = await withScope(session, tx => select nextval('app.centre_id_seq')::int)`, then `adminWrite(..., targetId: String(id))`. A refused attempt burns one id; that is acceptable. |
| R2 | Major | **An existing test breaks and is not in the "Existing tests that change" list.** `tests/catalogue-masters.test.ts:97-98` asserts that `gems_app`'s UPDATE column privileges on `centre` equal `["centre_class_id"]`, with no `order by`. 0020 adds 14 columns. | Change that query to `... order by column_name` and expect the sorted 15 columns: `address, agreement_from, agreement_to, area_id, category, centre_class_id, email, gst_enabled, gst_supply, gstin, name, opened_on, ownership, phone, status`. Add this to the design's list. |
| R3 | Major | **Changing `enquiryOptions.manage` hides bulk actions on existing enquiries.** `manage` also drives the list page's bulk actions and counsellor list (`app/enquiries/page.tsx:16`, `:19`). Once it excludes inactive centres, existing enquiries at an inactive centre lose bulk status and counsellor actions. That contradicts design :185 ("Existing records … stay … editable"). | Leave `manage` as it is and add a column `c.status = 'ACTIVE' as active`. Filter only the create paths on `c.manage && c.active`: `app/enquiries/enquiry-fields.tsx:22-24`, `app/enquiries/new/page.tsx:9`, `app/enquiries/page.tsx:26` (the "New enquiry" link). T-CO-003 then asserts that `active` drops and `manage` stays. |
| R4 | Major | **A manager without `org.centre.view` cannot see the centre view or list.** `getCentre` and `listCentres` require `org.centre.view` (`centres.ts:18`, `:33`). The fixture role 25 holds only `org.centre.manage` (design :207, :218). So `tok-coM` gets a 404 at `/centres/{id}?saved=1` after creating a centre, cannot reach the edit forms, and sees an empty `/centres` list. | Widen both gates the way `listCentreClasses` already does (`catalogue.ts:473`): `(app.has_permission('org.centre.view', c.id) or app.has_permission('org.centre.manage', null))` in `getCentre`, and `(c.id in (...) or app.has_permission('org.centre.manage', null))` in `listCentres`. A manager can already update any centre, so hiding the view protects nothing. Change design :170 ("listCentres is unchanged") accordingly. |
| R5 | Minor | **The validation helpers are not reachable as specified.** `code`, `name`, `reasonOf`, `date` and `bad` in `catalogue.ts:30-68` are not exported. `ownText`, `isoDate` and `invalid` throw `PersonError` (`details.ts:83-90`, `person-rules.ts:18`). `adminPost` does not handle `PersonError` (`admin-http.ts:30-46`), so the user would get a 500. | Export `bad`, `code`, `name`, `reasonOf` and `date` from `catalogue.ts`. In `centres.ts`, wrap every `ownText` and `phoneDigits` call so `PersonError` becomes `bad(e.message)` (the pattern at `catalogue.ts:511-516`). |
| R6 | Minor | **`phoneDigits` (design :120, I4) does not exist.** The same logic is duplicated at `details.ts:56-59` and `enquiry.ts:46-53`. | Add `export function phoneDigits(field: string, s: string): string` to `details.ts`. It strips with `replace(/[\s-]/g,"").replace(/^(\+91|0)/,"")`, then requires `^\d{10}$`, else throws `invalid(field,"10 digits")`. Call it from `detailField` and from enquiry's `phone()`; the existing tests guard the refactor. |
| R7 | Minor | **The pre-check precedent is mis-cited.** "following 0012's pre-check precedent" (design :70) does not match the file: 0012 adds its checks without any pre-check (`0012:99-111`). | Use the do-block text given in section 3. |
| R8 | Minor | **`areaId` and `regionId` existence cannot be checked before database access.** "Validation runs before any database access" (design :97) conflicts with "areaId must exist" (:118). | Before the database: the value must be a safe integer ≥ 1, else `areaId: unknown`. Inside the callback, after the lock: `select 1 from app.area where id = $1`, and if there is no row, `bad("areaId: unknown")`. Treat `regionId` the same way. |
| R9 | Minor | **Two read and comparison details are unspecified.** `$queryRaw` returns date columns as `Date` objects, and "nothing to change" needs a canonical comparison. | Select `agreement_from::text`, `agreement_to::text` and `opened_on::text`. Compare the validated canonical values (upper-cased GSTIN, phone digits, trimmed text) with the locked row, key by key. Audit only the keys that changed. |
| R10 | Minor | **Two acceptance checks have no test owner.** The form-level messages (`ADMIT_MESSAGES.centreInactive`, `ENQUIRY_MESSAGES.centreInactive`) and the resubmit order (a form already saved, resubmitted after deactivation, must still answer "saved", because the gate sits after `if (used)`) are not in T-CO-003. | Add both to T-CO-003 (section 4, rows 28-31). |
| R11 | Nit | **The trigger function's settings are unstated.** | Declare it `language plpgsql security invoker set search_path = pg_catalog, app`. |
| R12 | Nit | **Region and area renames take no lock** (two renames could interleave). | `select name from app.region where id=$1 for no key update`; the same on `area`. |
| R13 | Nit | **Email whitespace is unspecified.** | Trim, and treat `""` as `null`. Add no other rule (the database check allows anything with one `@`). |
| R14 | Nit | **The matrix links are not itemised per row.** | R-023 tests: `T-E2E-003,T-CO-001,T-CO-002,T-CO-003`. R-022: `T-SEC-001,T-AUTH-012,T-CO-001,T-CO-004`. R-022.02: `T-SEC-001,T-CO-001`. |

Checked and correct as designed:
- No RETURNING on the centre insert: the select policy is the statement-snapshot `visible_centre_ids()` (`0002:102`).
- `for no key update` works for both update policies.
- T-SEC-007 expectations: 42501 on the region insert, 0 rows on the area and centre updates.
- T-RLS-005 is unchanged: the trigger is invoker.
- T-AUTH-012 is unaffected: the trigger skips the admin role.
- `admin-http.test.ts:149` only needs the literal `system_admin` in 0020.
- The fixture and smoke codes (`KL2-25`, `PG-1`, `SMK-A`, `SR1`) pass the code check.
- `exports.test.ts:132` writes as admin, so the trigger skips it.
- Role 25 is free.
- T-AUD-009 (`audit.test.ts:178-187`) needs each `org.*` action as a literal on an `action:` line, before `permission:`.

## Build plan (each phase ends with `bash scripts/ci.sh` exiting 0, outputs committed)

**O1 Documents**
1. `docs/audit/09-test-strategy-and-acceptance-criteria.md`: after T-CC-004 (:178), add T-CO-001…T-CO-004. Use the "What it does" text from design :211-214, plus R3 (`active` drops, `manage` stays), R10, and the INSERT privilege assertion.
2. `docs/audit/data/matrix-02-masters-accounts.tsv` rows 17, 18 and 19: set the tests column as in R14.
3. Run `python -I docs/audit/tools/build_matrix.py docs/audit` and `python -I docs/requirements/tools/build_frd.py .`, then commit the CSV and the FRD.

**O2 Server**
1. `prisma/schema.prisma`, `model Centre`: add after `status` (line 55):
```
  email         String?
  phone         String?
  address       String?
  category      String?
  gstEnabled    Boolean   @default(false) @map("gst_enabled")
  gstSupply     String?   @map("gst_supply")
  gstin         String?
  ownership     String?
  agreementFrom DateTime? @map("agreement_from") @db.Date
  agreementTo   DateTime? @map("agreement_to") @db.Date
  openedOn      DateTime? @map("opened_on") @db.Date
```
2. `prisma/migrations/0020_centre_onboarding/migration.sql`, in this order:
   1. **Pre-checks.** One do-block per check, for example:
      `do $$ declare bad text; begin select string_agg(code, ', ' order by code) into bad from app.centre where not (code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30); if bad is not null then raise exception 'centre rows fail centre_code_check: %', bad; end if; end $$;`
      Repeat for `region_code_check` (region.code, same rule), `region_name_check` and `area_name_check` (`not (name = btrim(name) and char_length(name) between 1 and 100)`).
   2. **Columns.** `ALTER TABLE "app"."centre" ADD COLUMN "email" TEXT, ADD COLUMN "phone" TEXT, ADD COLUMN "address" TEXT, ADD COLUMN "category" TEXT, ADD COLUMN "gst_enabled" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "gst_supply" TEXT, ADD COLUMN "gstin" TEXT, ADD COLUMN "ownership" TEXT, ADD COLUMN "agreement_from" DATE, ADD COLUMN "agreement_to" DATE, ADD COLUMN "opened_on" DATE;`
   3. **Centre checks:** `centre_code_check`, `centre_email_check`, `centre_phone_check`, `centre_category_check`, `centre_gst_supply_check`, `centre_gstin_check`, `centre_ownership_check`, `centre_gst_check`, `centre_agreement_check` (`agreement_from is null or agreement_to is null or agreement_to >= agreement_from`). Then a do-block that redeclares the `ws` and `ctl_address` constants from `0018:176-178` and runs `execute format('alter table app.centre add constraint centre_address_check check (address !~ %L and address !~ %L and address !~ %L and char_length(address) between 1 and 500)', '^'||ws, ws||'$', ctl_address)`.
   4. **Region and area checks:** `region_code_check`, `region_name_check`, `area_name_check`.
   5. **Region and area RLS:** `alter table app.region enable row level security; ... force ...`, the same for `area`. Policies `geo_select` for select `using (true)`; `geo_insert` for insert `with check ((select app.has_permission('org.centre.manage', null)))`; `geo_update` for update with the same expression in `using` and `with check`. Create all three on both tables.
   6. **Centre policies:** `create policy centre_insert on app.centre for insert with check ((select app.has_permission('org.centre.manage', null)));` and `create policy centre_manage_update on app.centre for update using (same) with check (same);`.
   7. **Trigger:** `create function app.centre_write_guard() returns trigger language plpgsql security invoker set search_path = pg_catalog, app as $$ begin if current_user = 'gems_app' then if new.centre_class_id is distinct from old.centre_class_id and not app.has_permission('catalogue.manage', null) then raise exception 'centre class needs catalogue.manage' using errcode = '42501'; end if; if (to_jsonb(new) - 'centre_class_id') is distinct from (to_jsonb(old) - 'centre_class_id') and not app.has_permission('org.centre.manage', null) then raise exception 'centre fields need org.centre.manage' using errcode = '42501'; end if; end if; return new; end $$;` then `create trigger centre_write_guard before update on app.centre for each row execute function app.centre_write_guard();`.
   8. **Permission:** `insert into app.permission (key, description, sensitive) values ('org.centre.manage', 'Create and edit centres, regions and areas; activate and deactivate centres', true) on conflict (key) do nothing;` then `insert into app.role_permission (role_id, permission_key) select id, 'org.centre.manage' from app.role where key = 'system_admin' on conflict do nothing;`.
   9. **Grants:** the column grants from design :83-86, plus `grant usage on sequence app.region_id_seq, app.area_id_seq, app.centre_id_seq to gems_app;`.
   10. **Sequences:** three `select setval('app.<t>_id_seq', coalesce((select max(id) from app.<t>), 0) + 1, false);` statements (region, area, centre).
3. `src/server/details.ts`: add `phoneDigits` (R6). Use it in `detailField` and in `enquiry.ts` `phone()`.
4. `src/server/catalogue.ts`: export `bad`, `code`, `name`, `reasonOf` and `date` (R5).
5. `src/server/centres.ts`:
   - Types `CentreInput`, `CentreChanges` and `CentreView`.
   - Validators in the order of design :112.
   - A `centreDb` wrapper inside each callback mapping 23505 by constraint name (design :141-147, regex from `people.ts:70`).
   - `createCentre` with the R1 pre-flight and an insert without RETURNING; `updateCentre` (R8, R9); `setCentreActive` with two literal `adminWrite` calls and `action: "org.centre.activate"` / `action: "org.centre.deactivate"` before `permission:`; the region and area create and update functions (R12).
   - `getCentre` extended (R4, R9); `listGeography`; `listCentres` gate widened (R4).
6. `src/server/people.ts`:
   - `admit()`: after line 311, `const [st] = await tx.$queryRaw<{s:string}[]>\`select status::text as s from app.centre where id = ${input.centreId}\`; if (st?.s !== "ACTIVE") throw invalid("centreId", "centre is not active");`.
   - `admitOptions` line 208: add `and c.status = 'ACTIVE'`.
7. `src/server/admission-form.ts`: add `centreInactive: "This centre is not active yet."` to `ADMIT_MESSAGES` (:50). Before line 126, add `if (e.field === "centreId" && e.rule === "centre is not active") return fail({ formError: ADMIT_MESSAGES.centreInactive });`.
8. `src/server/enquiry.ts`:
   - Same read and refusal as the first statement inside `enquiryDb(async () => {` (line 177, before `liveMaster`).
   - `enquiryOptions` (:428): add the column `c.status = 'ACTIVE' as active` and the type field `active: boolean` (R3).
9. `src/server/enquiry-form.ts`: add `centreInactive` to `ENQUIRY_MESSAGES` (:13). In `routeError` before :45: `if (e.field === "centreId" && e.rule === "centre is not active") return { formError: ENQUIRY_MESSAGES.centreInactive };`.
10. `tests/audit-catalogue.ts`: add the 8 `org.*` actions.
11. `tests/audit.test.ts:181`: add `["src/server/centres.ts", /"(org\.[a-z0-9_.]+)"/g]`.
12. `tests/fixtures.ts`:
    - `:95` add `('org.centre.manage', 'Create and edit centres, regions and areas; activate and deactivate centres', true)`.
    - `:101` add `(25, 'centre_manager', 'Centre manager')`.
    - `:110` add `(25, 'org.centre.manage')`.
    - Users `coM` (ALL) and `coR1` (REGION 1), with tokens `tok-coM` and `tok-coR1`.
13. `tests/sec.test.ts:51-65` (T-SEC-007): new title. Region insert → 42501. Area update and centre status update → `rowCount` 0. Permission insert and role update → 42501.
14. `tests/foundation.test.ts:56`: `needed` for `centre` = `["SELECT","INSERT","UPDATE"]`, new comment.
15. `tests/catalogue-masters.test.ts:97-98`: the R2 change.
16. New file `tests/centre-onboarding.test.ts`: T-CO-001 to T-CO-003, including section 4 rows 1-36. Also assert the INSERT column privileges exclude `status` and `centre_class_id`, and that `org.centre.manage` has `sensitive` = true.
17. Enquiry pickers: `app/enquiries/enquiry-fields.tsx:22-24`, `app/enquiries/new/page.tsx:9`, `app/enquiries/page.tsx:26` change to `c.manage && c.active` (R3). These are app files, but they must move with the server change to stay green.

**O3 Pages**
1. `src/server/admin-http.ts` `ADMIN_MESSAGES` (:50): add the three duplicate keys and `org.centre.checklist`.
2. `app/centres/page.tsx`: call `listGeography(s)` for `canManage`; show the "New centre" and "Regions and areas" links when true.
3. `app/centres/new/page.tsx`: call `listGeography`; `notFound()` unless `canManage`; the form; `AdminErrors` with a `CENTRE_LABELS` map.
4. `app/centres/[id]/page.tsx`: the new fields; when `canManage`, the edit form, the Activate/Deactivate form with a reason, and links to `/admin/catalogue/centres` and `/admin/users` with the sign-in note.
5. `app/centres/create/route.ts`: `safeRoute(adminPost(req, "/centres/new", …))`.
6. `app/centres/[id]/save/route.ts`: the courses route shape (`app/admin/catalogue/courses/[id]/save/route.ts`). The id must match `^\d{1,9}$`, else a 404 Response. `op` is `details` or `active` (using `flag` from `app/admin/catalogue/masters/slugs.ts:16`); anything else throws `RbacError("invalid","op: unknown")`.
7. `app/centres/geography/page.tsx` and `app/centres/geography/save/route.ts`.
8. Add T-CO-004 (routes) to `tests/centre-onboarding.test.ts`.

**O4 Evidence**
1. `scripts/smoke-security.mjs`, after the T-SEC-001 block (:67): `/centres/new` returns 404 for the viewer; a foreign-origin POST to `/centres/create` returns 403; the `/centres/${ids.A}` body contains the new labels.
2. Run the section 4 mutations; record them in an E-entry (E-044) with the GitHub run.

## Mutation checks

| # | Mutation | File | Test that must fail |
|---|---|---|---|
| 1 | `centre_insert` with check → `true` | 0020 | T-CO-001 (`tok-coR1` SQL insert 42501) |
| 2 | `centre_manage_update` using → `true` | 0020 | T-CO-001 (non-holder update 0 rows); T-SEC-007 |
| 3 | Delete the trigger's class branch | 0020 | T-CO-001 (`tok-coM` changes `centre_class_id` → 42501) |
| 4 | Delete the trigger's other-columns branch | 0020 | T-CO-001 (`tok-catA` changes `status` → 42501) |
| 5 | Trigger guard `current_user = 'gems_app'` → `true` | 0020 | T-AUTH-012 (admin status update raises) |
| 6 | Trigger compares full `to_jsonb` (class not removed) | 0020 | T-MS (`catalogue-masters.test.ts`, `setCentreClass` by `tok-catA`) |
| 7 | Add `status` to the insert grant | 0020 | T-CO-001 (INSERT column-privilege assertion) |
| 8 | Add `code` to the centre update grant | 0020 | `catalogue-masters.test.ts:97` sorted list |
| 9 | `geo_insert` → `true` | 0020 | T-SEC-007 (region insert 42501); T-CO-002 |
| 10 | `geo_update` → `true` | 0020 | T-SEC-007 (area update 0 rows); T-CO-002 |
| 11 | Remove FORCE on region or area | 0020 | T-CO-002 (ENABLE+FORCE) |
| 12 | Add a delete policy on region or area | 0020 | T-CO-002 (cmds `["INSERT","SELECT","UPDATE"]`) |
| 13 | `grant update (region_id)` on area, or `(code)` on region | 0020 | T-CO-002 (no re-parenting, 42501) |
| 14 | Drop any named check (gst, gstin, phone, email, address, agreement, code, category, ownership, supply, region and area names) | 0020 | T-CO-001 / T-CO-002 (direct insert, 23514 with that constraint name) |
| 15 | Omit the `system_admin` grant | 0020 | `admin-http.test.ts:149` and `:125` |
| 16 | `sensitive` → false | 0020 | T-CO-001 (sensitive assertion) |
| 17 | `setval` omitted | 0020 | Review only: fixtures `setval` themselves (`fixtures.ts:155`); say so in the E-entry |
| 18 | `adminWrite` permission → another key | centres.ts | T-CO-001 (non-holder and `tok-coR1` refused, DENIED audited) |
| 19 | Centre insert gains RETURNING | centres.ts | T-CO-001 (create succeeds) |
| 20 | Swap two validators' order | centres.ts | T-CO-001 (message order) |
| 21 | `phoneDigits` stops stripping `0` / `+91` | details.ts | T-CO-001 (`0484 2300000` stored as 10 digits); learner-details tests |
| 22 | Allow clearing a set phone | centres.ts | T-CO-001 (`phone: required`) |
| 23 | Remove the merged-row GST combination rule | centres.ts | T-CO-001 (`gstSupply: only with GST`) |
| 24 | Remove the GST-while-active rule | centres.ts | T-CO-001 (`gstSupply: required while active`) |
| 25 | Checklist without the class condition, or without the GST condition | centres.ts | T-CO-003 (activate refused, key `org.centre.checklist`) |
| 26 | Reason optional, or "already active" check removed | centres.ts | T-CO-003 |
| 27 | Duplicate map ignores the constraint name | centres.ts | T-CO-001 / T-CO-002 (keys `org.centre.duplicate`, `org.region.duplicate`, `org.area.duplicate`) |
| 28 | Remove the `admit()` gate | people.ts | T-CO-003 (`centreId: centre is not active`) |
| 29 | Move the `admit()` gate above `if (used)` | people.ts | T-CO-003 (resubmit after deactivation still "saved", R10) |
| 30 | Remove the `createEnquiry` gate | enquiry.ts | T-CO-003 |
| 31 | Remove the form mappings | admission-form.ts, enquiry-form.ts | T-CO-003 (formError "This centre is not active yet.", R10) |
| 32 | Drop `c.status = 'ACTIVE'` from `admitOptions` | people.ts | T-CO-003 |
| 33 | `active` column always true, or `manage` narrowed instead | enquiry.ts | T-CO-003 (`active` drops, `manage` stays, R3) |
| 34 | `getCentre` gate drops `org.centre.view` | centres.ts | T-SEC-001 (`sec.test.ts:25-37`); smoke T-SEC-001 |
| 35 | `getCentre` manager branch uses a centre id instead of `null` | centres.ts | T-CO-001 (`tok-coR1` sees no out-of-region centre) |
| 36 | Audit `before`/`after` omitted, or values wrong | centres.ts | T-CO-001 / T-CO-002 / T-CO-003 |
| 37 | Remove an `org.*` action literal or a catalogue entry | centres.ts, audit-catalogue.ts | T-AUD-009 coverage gate |
| 38 | Route skips `sameOrigin` (via `adminPost`) | app/centres/**/route.ts | T-CO-004 (foreign Origin 403); smoke |
| 39 | Remove step-up (`requireFreshStepUp`) | rbac.ts (shared) | T-CO-004 (redirect to `/stepup`) |
| 40 | `[id]` regex removed | app/centres/[id]/save/route.ts | T-CO-004 (non-numeric 404) |
| 41 | Unknown `op` accepted | routes | T-CO-004 |
| 42 | `/centres/new` without `notFound()` | app/centres/new/page.tsx | smoke (viewer 404); T-CO-004 |
