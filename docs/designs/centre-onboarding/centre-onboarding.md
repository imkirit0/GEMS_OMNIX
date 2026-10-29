# Centre onboarding (Stage 3, eighth piece, WF3)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-5 were taken as the recommended options under the owner's standing instruction of 2026-10-29; build approval follows the EGM review (steps 5–9). Steps 5–7 ran in parallel: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md); DD-3 corrected (recommended option under the standing instruction).
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

*   **G1:** a holder of `org.centre.manage` creates and edits centres, audited by field names. Every user with the existing centre view still sees only centres in scope [T-CO-001].
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

### Data model (migration `0020_centre_onboarding`)

**`app.centre` gains these columns**, all nullable or defaulted, so existing rows stay valid:

| Column | Type | Named check |
|---|---|---|
| `email` | text | `centre_email_check`: one @, at most 200 |
| `phone` | text | `centre_phone_check`: `^[0-9]{10}$` (the detail phone rule) |
| `address` | text | `centre_address_check`: the multiline rule of `ownText` (0018 `ws` and `ctl_address` sets), 1–500 |
| `category` | text | `centre_category_check`: `in ('SCHOOL','COLLEGE')` |
| `gst_enabled` | boolean not null default false | |
| `gst_supply` | text | `centre_gst_supply_check`: `in ('STATE','INTERSTATE')` |
| `gstin` | text | `centre_gstin_check`: `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` (15-character Indian GSTIN shape; PMC) |
| `ownership` | text | `centre_ownership_check`: `in ('FRANCHISE','OWN')` |
| `agreement_from`, `agreement_to` | date | `centre_agreement_check`: `agreement_to >= agreement_from` when both are set |
| `opened_on` | date | |

*   `phone` is required by the app for new centres (DD-1). The database keeps it nullable, because legacy rows lack it.
*   `centre_gst_check`: `gst_enabled or (gst_supply is null and gstin is null)`. Supply and GSTIN only exist when GST is enabled. The checklist (DD-2) needs both when it is enabled.

**`app.region` and `app.area`** get RLS for the first time:

*   ENABLE and FORCE;
*   `geo_select` `using (true)`: everyone reads them, as today;
*   `geo_insert` and `geo_update` require `org.centre.manage` at ALL scope; there is no delete policy.

Neither table has `centre_id`, so T-RLS-002 does not apply. A `region_code_check` (the 0012 code rule) and an `area_name_check` (btrim, 1–100) are added. Existing data must pass them: the migration checks first and raises with the offending rows if any fail, as 0012 did.

**`app.centre` policies.** `centre_insert` and `centre_manage_update` require `org.centre.manage` at ALL scope; they sit beside 0017's `setup_update` (`catalogue.manage`). Permissive policies are OR-ed, so each permission still reaches only its own columns, enforced in the app. Column grants are per role, not per permission.

**Grants to `gems_app`:**

*   `insert (code, name, area_id, status, email, phone, address, category, gst_enabled, gst_supply, gstin, ownership, agreement_from, agreement_to, opened_on)` on `centre`;
*   `update (name, area_id, status, email, phone, address, category, gst_enabled, gst_supply, gstin, ownership, agreement_from, agreement_to, opened_on)` on `centre`; the code never changes;
*   `insert, update (code, name)` on `region`;
*   `insert, update (region_id, name)` on `area`;
*   usage on the three sequences.

**Permission.** `org.centre.manage` ("Create and edit centres, regions and areas; activate and deactivate centres", sensitive). The `system_admin` role holds it.

**Prisma.** The new `Centre` fields go in `schema.prisma`, so the drift gate agrees. Checks and policies are hand-written.

### Server (`src/server/centres.ts`)

All writes go through `adminWrite` with `org.centre.manage` (ALL scope, fresh step-up). Validation runs before any database access. Messages are `RbacError("invalid", "<field>: <rule>")`.

```ts
type CentreInput = { code: string; name: string; areaId: number; email?: string | null; phone: string; address?: string | null;
  category?: "SCHOOL" | "COLLEGE" | null; gstEnabled: boolean; gstSupply?: "STATE" | "INTERSTATE" | null; gstin?: string | null;
  ownership?: "FRANCHISE" | "OWN" | null; agreementFrom?: string | null; agreementTo?: string | null; openedOn?: string | null };
createCentre(session, input: CentreInput): Promise<{ id: number; code: string }>;                    // action org.centre.create
updateCentre(session, id: number, changes: Partial<Omit<CentreInput, "code">>): Promise<void>;       // action org.centre.update
setCentreActive(session, id: number, active: boolean, reason: string): Promise<void>;                // org.centre.activate / .deactivate
createRegion(session, { code, name }): Promise<{ id: number }>;  updateRegion(session, id, { name }): Promise<void>;   // org.region.*
createArea(session, { regionId, name }): Promise<{ id: number }>; updateArea(session, id, { name, regionId? }): Promise<void>; // org.area.*
getCentreRecord(session, id): Promise<CentreRecord>;   listGeography(session): Promise<{ regions; areas; canManage }>;
```

**Messages and rules:**

*   `code`: the catalogue code rule; a duplicate is `org.centre.duplicate` ("A centre with that code already exists.").
*   `name`: 1–200 characters.
*   `areaId`: `inactive or unknown`.
*   `email`: `one @` (identity rule).
*   `phone`: required; `10 digits`.
*   `address`: `ownText(500, multiline)`.
*   `category`, `gstSupply`, `ownership`: `one of the listed values`.
*   `gstin`: `15 characters, GSTIN format` (upper-cased first).
*   GST combination: supply or GSTIN without GST enabled is `gstSupply: only with GST`.
*   Dates: `YYYY-MM-DD`; `agreementTo: not before agreementFrom`.

**Writes:**

*   `createCentre` inserts with `status` INACTIVE.
*   `updateCentre` merges the changes onto the locked row (`for no key update`, as `setCentreClass`). It checks the GST combination on the merged row, so turning GST off requires clearing supply and GSTIN in the same call. No change is "nothing to change". The audit lists field names.
*   `setCentreActive`:
    *   uses two literal `adminWrite` calls, needs a reason, and locks the row `for no key update`;
    *   activation refuses an unmet checklist with `RbacError("invalid", "status: checklist", "org.centre.checklist")`: no class, or GST enabled without supply and GSTIN;
    *   "already active" / "already inactive";
    *   the audit records `{ before: { status }, after: { status } }`.

**Reads:**

*   `getCentreRecord` returns `{ id, code, name, status, areaId, area, region, classCode, …new fields, canManage }`. It is visible under the existing `org.centre.view` rule (`getCentre`'s two gates); otherwise null, which gives a 404.
*   `listCentres` rows gain `classCode`. The existing columns are unchanged.

### Trading gate (DD-3)

*   **`admit()`**, after the form lock and the `used` check, reads `select status from app.centre where id = $centre` (a plain read; RLS lets an admitter see the centre). Not `ACTIVE` gives `invalid("centreId", "centre is not active")`. `ADMIT_MESSAGES` adds `centreInactive: "This centre is not active yet."`, mapped on `field === "centreId"` with that rule.
*   **`createEnquiry()`** checks the same in its action and refuses with `centreId: centre is not active`.
*   **Fixtures** keep centres A, A2 and B ACTIVE, so existing tests stay green. `admitOptions` lists only ACTIVE centres, so the form never offers an inactive one.

### Pages

| Route | What |
|---|---|
| `/centres` (existing) | Managers also see "New centre" and links to Regions and Areas |
| `/centres/new` | The centre form (managers; others get 404) |
| `/centres/[id]` (existing view) | Adds the new fields. Managers also get the edit form, Activate/Deactivate with a reason (checklist text when refused), and links to "Set the class" (`/admin/catalogue/centres`) and "Create a login" (`/admin/users`) |
| `POST /centres/create`, `POST /centres/[id]/save` | `adminPost` + `safeRoute`; `op` = `details` or `active` (`flag()`) |
| `/centres/geography` | Regions and areas: list for everyone; create and rename for managers |
| `POST /centres/geography/save` | `op` = `region.create`, `region.update`, `area.create`, `area.update` |

*   Errors use `AdminErrors` with a centre label map.
*   `ADMIN_MESSAGES` gains `org.centre.duplicate`, `org.centre.checklist` ("Set the centre's class and complete its GST details before activating it."), `org.region.duplicate` and `org.area.duplicate`.
*   Form mapping: `""` becomes `null`. The `gstEnabled` checkbox is `=== "1"`. `areaId` uses `Number`. Dates are posted as strings.

### Contracts (steps 5–7: Z-, C- and D- findings; binding; they supersede the text above where they differ)

Steps 5, 6 and 7 ran in parallel on commit `a384097`. Reports: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md).

*   **Sign-in is already blocked (Z1, C1, D1).** DD-3 is corrected; the recommended option was taken under the standing instruction.
    *   `app.account_usable` (0004) already refuses users whose only assignments are at centres that are not ACTIVE; T-AUTH-012 asserts it. This matches WF3's "If not, the centre's login is blocked".
    *   So a new centre's staff can sign in only after activation, and deactivating a centre signs out its centre-only staff at their next request.
    *   The trading gate covers users with wider or other-centre scope.
    *   The "Create a login" link carries the note "Staff can sign in once the centre is active".
    *   T-CO-003 asserts that a centre-only user of a new centre is refused until it is activated, and refused again after deactivation.
*   **Create without RETURNING (Z2, C2, D2, D7).**
    *   `createCentre` takes `nextval('app.centre_id_seq')` first, then inserts with that explicit id and no RETURNING. Region and area may use RETURNING: their select policy is `true`.
    *   The insert grant includes `id` and excludes `status` (C7, D6); the column default keeps a new centre INACTIVE.
    *   0020 sets the region, area and centre sequences with `setval(..., (select coalesce(max(id), 1) from ...))`, so legacy explicit ids cannot collide.
    *   23505 is mapped by constraint name only:

        | Constraint | Key | Text |
        |---|---|---|
        | `centre_code_key` | `org.centre.duplicate` | "A centre with that code already exists." |
        | `region_code_key` | `org.region.duplicate` | "A region with that code already exists." |
        | `area_region_id_name_key` | `org.area.duplicate` | "That region already has an area with that name." |

        Any other 23505 is not a duplicate message (C8).
*   **Each permission keeps its own columns, in the database (D3, Z4).** A `before update` trigger `centre_write_guard` on `app.centre` (security invoker) applies when `current_user = 'gems_app'`, so the owner and fixture writes are unaffected:
    *   `centre_class_id` changed and `has_permission('catalogue.manage', null)` false → raise 42501;
    *   any other column changed (`to_jsonb(new) - 'centre_class_id'` against old) and `has_permission('org.centre.manage', null)` false → raise 42501.

    T-CO-001 asserts both: a catalogue manager (`tok-catA`) changing `status` is refused, and a centre manager changing `centre_class_id` is refused.
*   **No re-parenting (Z3, C12, D4).**
    *   `updateArea(session, id, { name })` renames only; the area update grant is `update (name)`.
    *   The region update grant is `update (name)`; the code never changes.
    *   A centre's `areaId` change is allowed. It moves the centre between REGION scopes, so the audit records the before and after `areaId`.
*   **Audit values (Z6).** Centre, region and area edits audit `{ before, after }` values of the changed fields. Centre data is not personal data, so this matches the catalogue.
*   **One read (Z5).** `getCentre` is extended instead of adding `getCentreRecord`. It returns the new fields, `classCode`, `areaId` and `canManage`, keeps its two gates and its 404 parity, and `/centres/[id]` keeps using it.
*   **Phone (Z7, C5, D10).**
    *   The phone uses the `detailField` phone normaliser (strips spaces, `-`, `+91` and a leading 0), so an STD landline such as `0484 2300000` is stored as 10 digits.
    *   The database check is `^[0-9]{10}$`.
    *   `phone` is required on create. On update, a null phone stays null on a legacy row, but a set phone cannot be cleared: `phone: required`.
    *   The type is `Partial<Omit<CentreInput, "code" | "phone">> & { phone?: string | null }`.
*   **GST (C6, D5).**
    *   With `gstEnabled` false on the merged row: a non-null `gstSupply` gives `gstSupply: only with GST`; otherwise a non-null `gstin` gives `gstin: only with GST`.
    *   When the locked row is ACTIVE, `updateCentre` also applies the checklist's GST rule to the merged row: enabled requires supply and GSTIN, `gstSupply: required while active` and `gstin: required while active`.
    *   A class cleared on an active centre through `setCentreClass` is accepted and recorded in DD-2. The class-per-centre page stays catalogue's (E-041).
*   **Message order (C6).** Code, name, areaId, email, phone, address, category, gstSupply, gstin, ownership, agreementFrom, agreementTo, openedOn; then the GST combination; then agreementTo against agreementFrom.
*   **Region and area rules and messages (C9, D11).**

    | Field | Rule | Message |
    |---|---|---|
    | Region `code` | The catalogue code rule | The catalogue code messages |
    | Region and area `name` | btrim, 1–100 | `name: 1-100 characters` |
    | `areaId` | Must exist (`area` has no active flag) | `areaId: unknown` |
    | `regionId` | Must exist | `regionId: unknown` |

*   **Checks and their pre-checks (C10, C11, C17).** 0020 redeclares the `ws` and `ctl_address` constants from 0018. Before it adds `region_code_check`, `region_name_check`, `area_name_check` and `centre_code_check` (the 0012 rule), a `do $$` block collects the failing rows (`string_agg`) and raises `'<table> rows fail <check>: %'`. `centre_email_check` is `email ~ '^[^@]*@[^@]*$' and length(email) <= 200`; the app messages are `email: one @` and `email: at most 200`.
*   **Trading gate placement (C3, C4, D8, D9).**
    *   **`admit()`:** the gate runs right after `if (used) throw new AdmissionExists()` and before the enquiry block: `select status::text from app.centre where id = $centre`. Anything but ACTIVE gives `invalid("centreId", "centre is not active")`. `submitAdmission` checks for that field and rule before its `FORM_NAMES` branch and returns `formError: ADMIT_MESSAGES.centreInactive` ("This centre is not active yet.").
    *   **`createEnquiry()`:** the gate is the first statement of the action callback, before `liveMaster` and before the same-mobile check, with the same refusal. `enquiry-form.ts` maps it to `formError: ENQUIRY_MESSAGES.centreInactive`.
    *   **`admitOptions`** lists only ACTIVE centres. A user whose admit centres are all inactive gets Forbidden, so the page is a 404. That is the same answer as having no admit scope, and such users cannot sign in anyway unless they have other scopes.
    *   **`enquiryOptions`:** `manage` becomes `c.id = any (scoped_centre_ids('enquiry.manage')) and c.status = 'ACTIVE'`. The view list is unchanged, so history stays filterable.
    *   **Accepted race:** the gate is a plain read, like catalogue DD-13. An admission that read ACTIVE just before a deactivation commits completes.
*   **Routes (C13).**
    *   **`POST /centres/create`:** back `/centres/new`; success `/centres/{id}?saved=1`.
    *   **`POST /centres/[id]/save`:** the id comes from `params` (`^\d{1,9}$`, else 404); back `/centres/{id}`; success `/centres/{id}?saved=1`.
        *   `op=details` takes the field names of `CentreInput` without `code`.
        *   `op=active` takes `active` (`flag()`) and `reason`.
    *   **`POST /centres/geography/save`:** fields `op`, `id`, `code`, `name`, `regionId`; back and success `/centres/geography[?saved=1]`.
    *   **Any route:** an unknown `op` gives `RbacError("invalid", "op: unknown")`.
*   **Gates and existing tests (C14, C15, D11).**
    *   **T-AUD-009** scans `["src/server/centres.ts", /"(org\.[a-z0-9_.]+)"/g]`.
    *   **T-SEC-007** splits its loop, as `hoAll` (neither permission):
        *   `insert into app.region` → 42501;
        *   `update app.area set name` → 0 rows;
        *   `update app.centre set status` → 0 rows;
        *   permission and role statements → 42501, unchanged.
    *   **`foundation.test.ts`:** the `centre` comment and its `needed` list now include INSERT and UPDATE.
    *   **T-CO-002** asserts ENABLE and FORCE on region and area, with cmds `["INSERT","SELECT","UPDATE"]`.

### Tests (`tests/centre-onboarding.test.ts`)

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CO-001 | G1 | Create with every field; each message; duplicate code; update and merged GST rule; nothing to change; created INACTIVE; non-holders refused (app, and SQL insert or update giving 42501 or 0 rows); a scoped viewer sees only scoped centres; direct inserts breaking each named check | Audit by field names; messages; 23514 with constraint names |
| T-CO-002 | G2 | Region and area create and rename; duplicates; a non-holder (app and SQL); the T-SEC-007 change (below) | As listed |
| T-CO-003 | G3, G4 | Activate refused without a class, and with GST incomplete; activate and deactivate with a reason; already; at an inactive centre `admit()` and `createEnquiry()` refuse, while existing admissions stay readable | As listed |
| T-CO-004 | G5 | Routes: create, details, active, geography ops; step-up; foreign Origin; field `detail`; unknown `op`; `/centres/new` 404 for non-holders | As listed |

**Existing tests that change:**

*   **T-SEC-007** (`tests/sec.test.ts`): `insert into app.region` and `update app.area` as `hoAll` (no `org.centre.manage`) now pass the grant check, so they give 42501 from RLS for the insert and 0 rows for the update. The same holds for `update app.centre set status` (0 rows). The title gains "(writes need org.centre.manage, 0020)".
*   **The T-RLS lists:** no change (`region` and `area` have no `centre_id`).
*   **The audit catalogue** gains `org.centre.create`, `.update`, `.activate`, `.deactivate`, `org.region.create`, `.update`, `org.area.create`, `.update`. T-AUD-009 scans `centres.ts`.

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

Outline; EGM step 9 writes the file-by-file plan:

| Phase | Items |
|---|---|
| O1 Documents | T-CO-001…004 in audit 09; matrix links on R-023, R-022, R-022.02 |
| O2 Server | Migration 0020; Prisma; `centres.ts` writes and reads; trading gate in `admit()` and `createEnquiry()`; audit catalogue; T-SEC-007; tests |
| O3 Pages | `/centres/new`, the view's forms, geography page, routes, labels, messages; tests |
| O4 Evidence | Smoke; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
