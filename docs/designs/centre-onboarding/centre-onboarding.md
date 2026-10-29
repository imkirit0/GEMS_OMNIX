# Centre onboarding (Stage 3, eighth piece, WF3)

*   **Author:** gtm
*   **Status:** Approved for build on 2026-10-29 after the EGM review (steps 5–9), under the owner's standing instruction of 2026-10-29. DD-1…DD-5 are recommended options taken under the same instruction; DD-3 was corrected at steps 5–7. Reports: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md) (steps 5–7 in parallel), [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md), [`implementation_readiness_report.md`](implementation_readiness_report.md).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`; fixed lists are PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

WF3 (SRC, WF p. 6): "A centre goes live only after HO creates it, sets permissions and prefixes." Today centres arrive by SQL or migration only. This piece lets head office:

*   create and edit a centre with its identity, classification, GST and lifecycle fields;
*   add regions and areas;
*   activate or deactivate a centre with a reason and a checklist.

An inactive centre cannot take new admissions or enquiries. Setting a centre's class, giving its users logins and roles, and assigning its courses already exist (E-041, WF-X13, E-040/E-043); the centre page links to them.

## Goals

*   **G1:** a holder of `org.centre.manage` creates and edits centres, audited with before and after values. Every user with the existing centre view still sees only centres in scope [T-CO-001].
*   **G2:** regions and areas are added and renamed by the same holders [T-CO-002].
*   **G3:** activation needs a reason and a met checklist; deactivation needs a reason; both are audited [T-CO-003].
*   **G4:** with the centre inactive, `admit()` and `createEnquiry()` refuse at that centre, and existing records stay [T-CO-003].
*   **G5:** the pages and routes work with step-up, same origin, field errors and 404 parity [T-CO-004].

## Non-Goals

*   The ~60 centre permission flags (R-024, D-ORG-4) and the mobile settings.
*   Prefixes and counters (R-026; the numbering policy is unsigned).
*   Credentials resend (R-228): the existing user administration creates logins.
*   Logo and QR code (R-034; needs ADR-002 storage).
*   Board, affiliation, accreditation, website, parent centre, account number, and the country/state/district cascade: later fields.

## Technical Plan (Architecture)

One text: steps 5–7 (Z-, C-, D- findings in [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)) and step 8 (I- findings, [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md)) applied; nothing below is superseded.

### Data model (migration `0020_centre_onboarding`)

**`app.centre` gains these columns**, all nullable or defaulted, so existing rows stay valid:

| Column | Type | Named check |
|---|---|---|
| `email` | text | `centre_email_check`: `email ~ '^[^@]*@[^@]*$' and length(email) <= 200` (C11) |
| `phone` | text | `centre_phone_check`: `^[0-9]{10}$` (the detail phone rule) |
| `address` | text | `centre_address_check`: the multiline rule of `ownText` (0018 `ws` and `ctl_address` sets, redeclared in 0020, C10), 1–500 |
| `category` | text | `centre_category_check`: `in ('SCHOOL','COLLEGE')` |
| `gst_enabled` | boolean not null default false | |
| `gst_supply` | text | `centre_gst_supply_check`: `in ('STATE','INTERSTATE')` |
| `gstin` | text | `centre_gstin_check`: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` (15-character Indian GSTIN shape; PMC) |
| `ownership` | text | `centre_ownership_check`: `in ('FRANCHISE','OWN')` |
| `agreement_from`, `agreement_to` | date | `centre_agreement_check`: `agreement_to >= agreement_from` when both are set |
| `opened_on` | date | |

*   `centre_gst_check`: `gst_enabled or (gst_supply is null and gstin is null)`.
*   `centre_code_check`: the 0012 code rule (`code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30`) (C10).
*   `phone` stays nullable in the database because legacy rows lack it; the app requires it on create (DD-1, Z7).

**`app.region` and `app.area`** get RLS for the first time:

*   ENABLE and FORCE;
*   `geo_select` `using (true)`: everyone reads them, as today;
*   `geo_insert` and `geo_update` require `has_permission('org.centre.manage', null)` (ALL scope); there is no delete policy.
*   Checks: `region_code_check` (the 0012 code rule), `region_name_check` and `area_name_check` (`name = btrim(name)`, 1–100 characters) (C9).
*   Neither table has `centre_id`, so T-RLS-002 does not apply.

**Pre-checks (C10, C17, I6).** Before adding `region_code_check`, `region_name_check`, `area_name_check` and `centre_code_check`, a `do $$` block per check collects the failing rows (`string_agg`) and raises `'<table> rows fail <check>: %'`, following 0012's pre-check precedent.

**`app.centre` policies.** `centre_insert` (with check) and `centre_manage_update` (using and with check) require `has_permission('org.centre.manage', null)`. They sit beside 0017's `setup_update` (`catalogue.manage`); permissive policies are OR-ed, so column separation is enforced by the trigger below.

**`centre_write_guard` (D3, Z4, I5).** A `before update` trigger on `app.centre`, security invoker (so the T-RLS-005 definer inventory is unchanged), active only when `current_user = 'gems_app'` (owner and fixture writes are unaffected):

*   `new.centre_class_id is distinct from old.centre_class_id` and not `has_permission('catalogue.manage', null)` → raise 42501;
*   `to_jsonb(new) - 'centre_class_id'` differs from `to_jsonb(old) - 'centre_class_id'` and not `has_permission('org.centre.manage', null)` → raise 42501.

Inside `adminWrite` a 42501 becomes `Forbidden`, audited DENIED.

**Grants to `gems_app`:**

*   `insert (id, code, name, area_id, email, phone, address, category, gst_enabled, gst_supply, gstin, ownership, agreement_from, agreement_to, opened_on)` on `centre`. It includes `id` and excludes `status` and `centre_class_id`, so the column default keeps a new centre INACTIVE (C7, D6);
*   `update (name, area_id, status, email, phone, address, category, gst_enabled, gst_supply, gstin, ownership, agreement_from, agreement_to, opened_on)` on `centre`; the code never changes; `centre_class_id` stays 0017's grant;
*   `insert (code, name)`, `update (name)` on `region` (Z3, C12, D4);
*   `insert (region_id, name)`, `update (name)` on `area` (Z3, C12, D4);
*   usage on `app.region_id_seq`, `app.area_id_seq`, `app.centre_id_seq`.

**Sequences (Z2, C2, I8).** 0020 runs `select setval('app.<t>_id_seq', coalesce((select max(id) from app.<t>), 0) + 1, false)` for region, area and centre, so legacy explicit ids cannot collide.

**Permission.** `org.centre.manage` ("Create and edit centres, regions and areas; activate and deactivate centres", sensitive). The `system_admin` role holds it.

**Prisma.** The new `Centre` fields go in `schema.prisma`, so the drift gate agrees. Checks, policies, the trigger and the grants are hand-written.

### Server (`src/server/centres.ts`)

All writes go through `adminWrite` with `org.centre.manage` (ALL scope, fresh step-up). Validation runs before any database access. Messages are `RbacError("invalid", "<field>: <rule>")`.

```ts
type CentreInput = { code: string; name: string; areaId: number; email?: string | null; phone: string; address?: string | null;
  category?: "SCHOOL" | "COLLEGE" | null; gstEnabled: boolean; gstSupply?: "STATE" | "INTERSTATE" | null; gstin?: string | null;
  ownership?: "FRANCHISE" | "OWN" | null; agreementFrom?: string | null; agreementTo?: string | null; openedOn?: string | null };
type CentreChanges = Partial<Omit<CentreInput, "code" | "phone">> & { phone?: string | null };
createCentre(session, input: CentreInput): Promise<{ id: number; code: string }>;              // org.centre.create
updateCentre(session, id: number, changes: CentreChanges): Promise<void>;                     // org.centre.update
setCentreActive(session, id: number, active: boolean, reason: string): Promise<void>;          // org.centre.activate / .deactivate
createRegion(session, { code, name }): Promise<{ id: number }>;   updateRegion(session, id, { name }): Promise<void>;  // org.region.create / .update
createArea(session, { regionId, name }): Promise<{ id: number }>; updateArea(session, id, { name }): Promise<void>;    // org.area.create / .update
getCentre(session, id): Promise<CentreView | null>;   listGeography(session): Promise<{ regions; areas; canManage }>;
```

**Rules and messages, in this order (C6):** code, name, areaId, email, phone, address, category, gstSupply, gstin, ownership, agreementFrom, agreementTo, openedOn; then the GST combination; then agreementTo against agreementFrom.

| Field | Rule | Message |
|---|---|---|
| `code` (create only) | The catalogue code rule (`normCode`) | The catalogue code messages |
| `name` | 1–200 characters | `name: 1-200 characters` |
| `areaId` | Must exist (`area` has no active flag) | `areaId: unknown` |
| `email` | One `@`; at most 200 (C11) | `email: one @`, `email: at most 200` |
| `phone` | `phoneDigits` (I4): strips spaces, `-`, `+91` and one leading 0, so `0484 2300000` is stored as 10 digits (Z7, C5, D10) | `phone: 10 digits`; missing on create, or cleared when set: `phone: required` |
| `address` | `ownText(500, multiline)` | The `ownText` messages |
| `category`, `gstSupply`, `ownership` | The listed values | `<field>: one of the listed values` |
| `gstin` | Upper-cased, then the GSTIN shape | `gstin: 15 characters, GSTIN format` |
| Dates | `YYYY-MM-DD` | `<field>: YYYY-MM-DD` |
| GST combination (C6, D5) | With `gstEnabled` false on the merged row: a supply first, then a GSTIN | `gstSupply: only with GST`, then `gstin: only with GST` |
| GST while active (C6, D5) | On an ACTIVE row, enabled needs supply and GSTIN | `gstSupply: required while active`, `gstin: required while active` |
| Agreement | `agreementTo` not before `agreementFrom` | `agreementTo: not before agreementFrom` |

On update, a legacy null phone may stay null; a set phone cannot be cleared (Z7).

**Region and area rules (C9, D11):**

| Field | Rule | Message |
|---|---|---|
| Region `code` | The catalogue code rule | The catalogue code messages |
| Region and area `name` | btrim, 1–100 | `name: 1-100 characters` |
| `regionId` | Must exist | `regionId: unknown` |

**Duplicates (C8, I1).** Inside the `adminWrite` callback (the `personDb` pattern, because `adminWrite`'s `db()` turns every 23505 into the generic `duplicate`), 23505 is mapped by constraint name:

| Constraint | Key | Text |
|---|---|---|
| `centre_code_key` | `org.centre.duplicate` | "A centre with that code already exists." |
| `region_code_key` | `org.region.duplicate` | "A region with that code already exists." |
| `area_region_id_name_key` | `org.area.duplicate` | "That region already has an area with that name." |

Any other 23505 falls through to `adminWrite`'s generic `duplicate`.

**Writes:**

*   `createCentre` takes `nextval('app.centre_id_seq')` first (the audit's target id), then inserts with that explicit id and **no RETURNING** (the new row is not yet visible to the select policy). It returns `{ id, code }`. The status is the column default, INACTIVE (Z2, C2, D2, D7).
*   `createRegion` and `createArea` may use RETURNING (select policy `true`).
*   `updateCentre` locks the row `for no key update` (as `setCentreClass`), merges the changes and validates the merged row (GST combination; the GST-while-active rule when the locked row is ACTIVE). No change gives "nothing to change". An `areaId` change is allowed; it moves the centre between REGION scopes and is audited (Z3).
*   `updateRegion` and `updateArea` rename only; no re-parenting (Z3, C12, D4).
*   `setCentreActive` uses two literal `adminWrite` calls (`org.centre.activate`, `org.centre.deactivate`), needs a reason, locks the row `for no key update`, and refuses "already active" / "already inactive". Activation refuses an unmet checklist with `RbacError("invalid", "status: checklist", "org.centre.checklist")`: no class, or GST enabled without supply and GSTIN (DD-2). A class cleared on an active centre through `setCentreClass` is accepted (DD-2); the class page stays catalogue's (E-041).

**Audit shapes (Z6).** Centre data is not personal data, so values are recorded, as in the catalogue:

| Action | Target | Detail |
|---|---|---|
| `org.centre.create` | `centre`, id | `{ after }`: the values set |
| `org.centre.update` | `centre`, id | `{ before, after }` of the changed fields (including `areaId`) |
| `org.centre.activate` / `.deactivate` | `centre`, id, reason | `{ before: { status }, after: { status } }` |
| `org.region.create` / `org.area.create` | `region` / `area` | `{ after }` with the new id and fields |
| `org.region.update` / `org.area.update` | `region` / `area`, id | `{ before: { name }, after: { name } }` |

**Reads (Z5, I7):**

*   `getCentre` is extended; there is no `getCentreRecord`. It returns `{ id, code, name, status, areaId, area, region, classCode, …new fields, canManage }`, keeps its two gates (RLS and `has_permission('org.centre.view', c.id)`) and its null-for-404 parity. `/centres/[id]` keeps using it.
*   `listCentres` is unchanged.
*   `listGeography` returns regions, areas and `canManage` to every signed-in user (select is `true`).

### Sign-in (Z1, C1, D1; DD-3)

*   `app.account_usable` (0004) already refuses users whose only assignments are at centres that are not ACTIVE (T-AUTH-012), as WF3 wants ("If not, the centre's login is blocked"). `session_user_id()` calls it, so a new centre's staff can sign in only after activation, and deactivating a centre signs out its centre-only staff at their next request.
*   The trading gate below covers users with wider or other-centre scope.
*   The "Create a login" link carries the note "Staff can sign in once the centre is active".

### Trading gate (DD-3; C3, C4, D8, D9)

*   **`admit()`:** right after `if (used) throw new AdmissionExists()` and before the enquiry block: `select status::text from app.centre where id = $centre` (a plain read; RLS lets an admitter see the centre). Anything but ACTIVE gives `invalid("centreId", "centre is not active")`. `submitAdmission` checks for that field and rule before its `FORM_NAMES` branch and returns `formError: ADMIT_MESSAGES.centreInactive` ("This centre is not active yet.").
*   **`createEnquiry()`:** the same read and refusal as the first statement of the action callback, before `liveMaster` and the same-mobile check. `enquiry-form.ts` maps it to `formError: ENQUIRY_MESSAGES.centreInactive` ("This centre is not active yet.").
*   **`admitOptions`:** lists only ACTIVE centres (`and c.status = 'ACTIVE'`). A user whose admit centres are all inactive gets Forbidden, so the page is a 404, the same answer as having no admit scope.
*   **`enquiryOptions`:** `manage` becomes `c.id = any (app.scoped_centre_ids('enquiry.manage')) and c.status = 'ACTIVE'`; the view list is unchanged, so history stays filterable.
*   Existing records at an inactive centre stay readable and editable.
*   **Accepted race:** the gate is a plain read, like catalogue DD-13. An admission that read ACTIVE just before a deactivation commits completes.

### Pages and routes (C13)

| Route | What |
|---|---|
| `/centres` (existing) | Managers also see "New centre" and a link to Regions and areas |
| `/centres/new` | The centre form (managers; others get 404) |
| `/centres/[id]` (existing view) | Adds the new fields. Managers also get the edit form, Activate/Deactivate with a reason (the checklist text when refused), and links to "Set the class" (`/admin/catalogue/centres`) and "Create a login" (`/admin/users`, with the sign-in note) |
| `POST /centres/create` | `adminPost` + `safeRoute`; back `/centres/new`; success `/centres/{id}?saved=1` |
| `POST /centres/[id]/save` | Id from `params` (`^\d{1,9}$`, else 404); back `/centres/{id}`; success `/centres/{id}?saved=1`. `op=details` takes the `CentreInput` field names without `code`; `op=active` takes `active` (`flag()`) and `reason` |
| `/centres/geography` | Regions and areas: list for everyone; create and rename for managers |
| `POST /centres/geography/save` | Fields `op` (`region.create`, `region.update`, `area.create`, `area.update`), `id`, `code`, `name`, `regionId`; back and success `/centres/geography[?saved=1]` |

*   Any route: an unknown `op` gives `RbacError("invalid", "op: unknown")`.
*   Form mapping: `""` becomes `null`; the `gstEnabled` checkbox is `=== "1"`; `areaId`, `regionId` and `id` use `Number`; dates are posted as strings.
*   Errors use `AdminErrors` with a centre label map (`detail=<field>`).
*   `ADMIN_MESSAGES` gains `org.centre.duplicate`, `org.region.duplicate`, `org.area.duplicate` (texts above) and `org.centre.checklist` ("Set the centre's class and complete its GST details before activating it.").

### Tests (`tests/centre-onboarding.test.ts`)

Fixture holders (I2): `tok-coM` (role 25 `centre_manager`, `org.centre.manage`, ALL) and `tok-coR1` (the same role at REGION 1, refused for want of ALL scope).

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CO-001 | G1 | Create with every field; each message in order; phone normalisation and `phone: required` on clearing; duplicate code; update with the merged GST rules (including while active); `areaId` move; nothing to change; created INACTIVE; non-holders and `tok-coR1` refused (app; SQL insert 42501, update 0 rows); `centre_write_guard`: `tok-catA` changing `status` and `tok-coM` changing `centre_class_id` give 42501; a scoped viewer sees only scoped centres via `getCentre`; direct inserts breaking each named check | Audit `{ before, after }` values; messages; 23514 with constraint names; 42501 |
| T-CO-002 | G2 | Region and area create and rename; duplicates by constraint; no re-parenting (no `regionId` or region `code` update); a non-holder (app and SQL); ENABLE and FORCE on region and area with cmds `["INSERT","SELECT","UPDATE"]` | As listed |
| T-CO-003 | G3, G4 | Activate refused without a class and with GST incomplete; activate and deactivate with a reason; already active/inactive; at an inactive centre `admit()` and `createEnquiry()` refuse with `centreId: centre is not active` while existing admissions stay readable; `admitOptions` and `enquiryOptions.manage` drop it; a centre-only user of a new centre is refused sign-in until activation and again after deactivation | As listed |
| T-CO-004 | G5 | Routes: create, details, active, geography ops; step-up; foreign Origin 403; field `detail`; unknown `op`; non-numeric `[id]` 404; `/centres/new` 404 for non-holders | As listed |

**Existing tests that change (C14, C15, D11):**

*   **`tests/fixtures.ts`** (I2): adds the `org.centre.manage` permission row (sensitive), role 25 `centre_manager` with it, and the users and tokens `tok-coM` (ALL) and `tok-coR1` (REGION 1). Centres A, A2 and B stay ACTIVE, so existing suites stay green.
*   **T-SEC-007** (`tests/sec.test.ts`), as `hoAll` (neither permission), splits its loop: `insert into app.region` → 42501 (RLS); `update app.area set name` → 0 rows; `update app.centre set status` → 0 rows; permission and role statements → 42501, unchanged. Title: "HO-global masters: the app role writes them only with the owning permission (catalogue.manage 0017, org.centre.manage 0020)" (I9).
*   **T-RLS-002** (`tests/foundation.test.ts`): `needed` for `centre` becomes `["SELECT", "INSERT", "UPDATE"]`; the comment becomes "no delete; writes need org.centre.manage or, for the class, catalogue.manage (0017, 0020)" (I9). The table list is unchanged (`region` and `area` have no `centre_id`).
*   **T-RLS-005:** unchanged (`centre_write_guard` is security invoker).
*   **T-AUD-009** scans `["src/server/centres.ts", /"(org\.[a-z0-9_.]+)"/g]`; the audit catalogue gains `org.centre.create`, `.update`, `.activate`, `.deactivate`, `org.region.create`, `.update`, `org.area.create`, `.update`.

**Real-server smoke:**

*   `/centres/new` is 404 for the viewer;
*   a foreign-origin create gives 403;
*   the centre view shows the new fields for the viewer's centre.

## Decisions

1.  **DD-1: `org.centre.manage` (sensitive, ALL) creates and edits centres with identity, category, GST and lifecycle fields;** other R-023 fields later (recommended option, owner's standing instruction, 2026-10-29).
2.  **DD-2: New centres are INACTIVE; activation needs a reason and a checklist (class set; GST complete when enabled); deactivation needs a reason; while active, GST stays complete, but a class cleared through the class page is accepted** (D-ORG-1 default; recommended option, standing instruction).
3.  **DD-3 (corrected at steps 5–7): An inactive centre cannot take new admissions or enquiries; its centre-only staff already cannot sign in (0004 `account_usable`, T-AUTH-012), as WF3 wants; existing records stay** (D-ORG-3 default; recommended option, standing instruction).
4.  **DD-4: Regions and areas are added and renamed by `org.centre.manage`** (recommended option, standing instruction).
5.  **DD-5: Credentials, flags, prefixes, logo and QR are out of scope** (recommended option, standing instruction).

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Relax `account_usable` so centre staff can sign in before activation | Weakens a verified control (T-AUTH-012) and contradicts WF3 ("login is blocked") |
| An activation ticket with an approver (D-ORG-1's full default) | Ticket types are gated until the numbering policy is signed (correction-tickets DD-18); a reason plus audit now, a ticket later |
| One permission for catalogue and centres | Centre onboarding is Operations, the catalogue is Academics (audit 04 owners) |

## Risks and Limits

| Risk | Impact | Mitigation | Test |
|---|---|---|---|
| Legacy centres lack phone and GST data | Edits must fill them | The database keeps them nullable; the app requires a phone only on create | T-CO-001 |
| Existing centres are ACTIVE without a class | The checklist is not met for them | The checklist applies only when activating; already active centres stay active | T-CO-003 |
| Region and area gain RLS | Other readers break | `geo_select using (true)`; the select grant is unchanged | T-CO-002, existing suites |
| GSTIN format is PMC | A valid odd GSTIN is refused | One constant and one check | T-CO-001 |

## Detailed Implementation Plan

The file-by-file plan (O1–O4, each ending green) and the 42 mutation checks are in [`implementation_readiness_report.md`](implementation_readiness_report.md). These notes from that step are binding; they supersede the text above where they differ:

*   **New centre id (R1):** `createCentre` takes `nextval` in a pre-flight `withScope`, so `adminWrite` can use it as `targetId` (the enquiry pattern). A refused attempt uses up one id.
*   **Changed test (R2):** `catalogue-masters.test.ts` checks the sorted 15 UPDATE columns of `centre`.
*   **Enquiry pickers (R3):** `enquiryOptions.manage` stays as it is and gains `active`. Only the create paths filter on `manage && active`, so existing enquiries at an inactive centre keep their bulk actions.
*   **Managers see every centre (R4):** `getCentre` and `listCentres` also admit `org.centre.manage` (ALL), as `listCentreClasses` does.
*   **Shared helpers (R5, R6):**
    *   `catalogue.ts` exports `bad`, `code`, `name`, `reasonOf` and `date`.
    *   `details.ts` exports `phoneDigits`, used by `detailField`, enquiry and centres.
    *   `PersonError` from these helpers becomes `bad()` in `centres.ts`.
*   **Pre-checks (R7):** the do-blocks are written out in the report; 0012 has no such precedent.
*   **Existence checks (R8):** `areaId` and `regionId` are checked for shape before the database and for existence inside the callback.
*   **Dates and changes (R9):** dates are read as `::text`; "nothing to change" compares canonical values; the audit records changed keys only.
*   **More tests (R10):** T-CO-003 also covers the form messages and the resubmit-after-deactivation order.
*   **Small rules (R11–R14):**
    *   the trigger is `plpgsql security invoker` with `search_path`;
    *   region and area renames lock the row;
    *   the email is trimmed, and blank means null;
    *   the matrix tests are listed per row.

*Drafted with EGM (draft step followed manually)*
