# Centre onboarding (Stage 3, eighth piece, WF3)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-5 were taken as the recommended options under the owner's standing instruction of 2026-10-29; build approval follows the EGM review (steps 5–9).
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
*   Blocking sign-in for inactive centres: they cannot trade (DD-3), which is the outcome WF3 needs.

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
2.  **DD-2: New centres are INACTIVE; activation needs a reason and a checklist (class set; GST complete when enabled); deactivation needs a reason** (D-ORG-1 default; recommended option, standing instruction).
3.  **DD-3: An inactive centre cannot take new admissions or enquiries; sign-in is not blocked; existing records stay** (D-ORG-3 default; recommended option, standing instruction).
4.  **DD-4: Regions and areas are added and renamed by `org.centre.manage`** (recommended option, standing instruction).
5.  **DD-5: Credentials, flags, prefixes, logo and QR are out of scope** (recommended option, standing instruction).

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Block sign-in for inactive centres | Users can hold roles at several centres; blocking trade at the centre is the effective control, without touching authentication |
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
