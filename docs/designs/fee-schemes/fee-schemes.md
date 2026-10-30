# Schemes and concessions (Stage 4, F5; WF5; R-053, R-054, R-060 part; D-SCH-1/2/3)

*   **Author:** gtm
*   **Status:** Proposed. Revised after EGM steps 5–7, which ran in parallel: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md) and [`critic_report.md`](critic_report.md). Every finding is resolved below. DD-1…DD-12 are recommended options under the owner's standing instruction (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs:
*   [`input-brief.md`](input-brief.md);
*   `docs/audit/revisions/v1.6-fee-dues-model.md`;
*   `docs/designs/fee-holds/fee-holds.md`, which defines `fee_due_balance`;
*   the patterns in `prisma/migrations/0025_fee_structure` (maker guard, `for share`) and `0031_fee_holds` (lock in guard, view).

--------------------------------------------------------------------------------

## Overview

Head office builds a **scheme**: a dated discount with **rules** per fee type and **targets**. The rules are PERCENT, or AMOUNT, which is a total per fee type. The targets are courses, plus centres if any are listed.

A different person approves the scheme, and only then does it go live. The database enforces this, including step-up.

At admission, before anything is paid on the affected fees, a centre assigns one live scheme to a registration. The database then stamps one **concession** per affected plan due. Concessions reduce what is owed through `fee_due_balance`. They never change, they post no journal on a cash basis, and they appear in a **concession register**.

## Goals

*   **G1: scheme master, maker and checker (D-SCH-1).**
    *   A holder of `scheme.manage` (sensitive, step-up) creates and edits a DRAFT: code, name, `valid_from`/`valid_to`, rules, courses (at least one) and centres (optional). Every edit stamps `updated_by`.
    *   A holder of `scheme.approve` (sensitive, step-up) makes it LIVE. That holder must be neither the creator nor the last editor.
    *   A LIVE scheme never changes. It can be RETIRED with a reason, which stops new assignments.
    *   **The database checks the permission, the step-up and the persons on every transition** (Z4, D3, D4, C13).
    *   Every action is audited [T-SC-001].
*   **G2: assigning a scheme (D-SCH-2, D-SCH-3).**
    *   **Who:** a holder of `fee.concession` and `student.view` at the registration's centre.
    *   **Conditions:**
        *   the registration is ACTIVE and has PLAN dues;
        *   the centre is active;
        *   **nothing has been paid yet on any due whose fee type has a rule** (D1);
        *   the registration has no scheme yet.
    *   **Scheme conditions:**
        *   the scheme is LIVE and valid on the admission's `admitted_on`;
        *   it targets the registration's course (`course.code = registration.course_code`, C1);
        *   it targets the centre, or lists no centres.
    *   **Concession per PLAN due of a ruled fee type** (Z1, D2):
        *   **PERCENT:** `round(gross × pct / 100, 2)`, half-up.
        *   **AMOUNT** (a total per fee type): the total is spread over that type's dues, latest `(due_on, id)` first. Each due's share is `least(gross, greatest(0, value − Σ gross of the same type's later dues))`. That depends only on the dues, never on the order of insertion.
    *   A zero share writes no row. The assignment must give at least one concession. It is audited with the count and total [T-SC-002].
*   **G3: owed counts concessions.** `fee_due_balance` gains `concession` (Σ per due, at the end). `outstanding`, `owed` and `collectable` are each reduced by it. Collection, holds and the learner page follow, and the identity **gross = paid + concession + outstanding** holds for every PLAN due [T-SC-002].
*   **G4: the database proves it** [T-SC-003]:
    *   **Scheme flow:** permissions, step-up and maker ≠ checker on every transition; a LIVE or RETIRED scheme and its parts are frozen.
    *   **Assignments:**
        *   one per registration, enforced by a guard under the `fee-dues:` lock;
        *   only while nothing is paid on ruled dues;
        *   valid date and targets.
    *   **Concessions:** stamped by the database, only in the assignment's own transaction, under the lock, never changing.
    *   **RLS:** four commands on each table that has `centre_id`.
*   **G5: the concession register (D6).** It lists a centre's concessions for an IST date range of at most 92 days: date, learner, course, scheme, fee type, instalment, gross and concession, with a total. It can be filtered by scheme [T-SC-004].

## Non-Goals (DD-11)

*   **Variable natures.** These are amounts chosen at assignment.
*   **Changing or removing a scheme after assignment.** This needs a ticket (D-FEE-2, D-SCH-2). Its shape is recorded now so that no constraint is reworked later (Z2):
    *   an append-only `fee_scheme_reversal(assignment_id, …)` row voids the assignment and its concessions inside `fee_due_balance`;
    *   "one assignment per registration" becomes "one unreversed assignment" in the guard;
    *   concessions are already unique on `(assignment_id, due_id)`.
*   **Targeting by category, division, region or area.**
*   **Scheme targets (R-099).**
*   **Legacy import (paused).** Its path is recorded now (Z3, Z5):
    *   a later migration adds `source text default 'APP'` to schemes, assignments and concessions;
    *   `IMPORT` rows skip the approval, validity and computed-amount checks but keep targets and immutability;
    *   region and area targets expand to centre lists;
    *   rules that vary by centre or year split into one scheme per variant;
    *   variable natures import as AMOUNT.

## Technical Plan

### Migration `0032_fee_schemes`

The migration head comes from `prisma migrate diff`. `schema.prisma` gains models `FeeScheme`, `FeeSchemeRule`, `FeeSchemeCourse`, `FeeSchemeCentre`, `FeeSchemeAssignment` and `FeeConcession`, plus back-relations (C9).

| Table | Columns (NOT NULL unless marked) | Keys and checks |
|---|---|---|
| `fee_scheme` | `id` serial; `code`; `name`; `valid_from` date; `valid_to` date; `status` default `'DRAFT'`; `created_at`, `created_by`; `updated_at`, `updated_by`; `approved_at`, `approved_by` (nullable); `retired_at`, `retired_by`, `retired_reason` (nullable) | `code` unique; code rule as `fee_type_code_check`; name 1–200 characters, trimmed; `valid_to >= valid_from`; status in DRAFT/LIVE/RETIRED; `(status <> 'DRAFT') = (approved_at, approved_by not null)`; `(status = 'RETIRED') = (retired_at, retired_by, retired_reason not null)`; reason 1–500 characters, trimmed (C5) |
| `fee_scheme_rule` | `scheme_id`; `fee_type_id`; `kind`; `value` numeric(14,2) | pk `(scheme_id, fee_type_id)`; kind in PERCENT/AMOUNT; PERCENT 0.01–100, AMOUNT > 0 |
| `fee_scheme_course` | `scheme_id`; `course_id` | pk `(scheme_id, course_id)` |
| `fee_scheme_centre` | `scheme_id`; `centre_id` | pk `(scheme_id, centre_id)` |
| `fee_scheme_assignment` | `id` bigserial; `registration_id`; `centre_id`; `scheme_id`; `created_at`, `created_by` | FK `(registration_id, centre_id)` → registration; FK `scheme_id`; index `(registration_id)` |
| `fee_concession` | `id` bigserial; `assignment_id`; `due_id`; `centre_id`; `amount` numeric(14,2) > 0; `created_at` | FKs `assignment_id`, `due_id`; unique `(assignment_id, due_id)` (D11); index `(centre_id, created_at)` (D6) |

**Guards.** They follow the 0031 conventions: invoker, rules-only, nested ifs, `errcode 23514` with `constraint "<name>"`. Dates are IST (`(now() at time zone 'Asia/Kolkata')::date`).

*   **`fee_scheme_guard`** (insert, update, delete):
    *   **Insert:** requires `has_permission('scheme.manage', null)`. Forces DRAFT and stamps the created and updated pairs.
    *   **Update of a DRAFT** that stays DRAFT: requires `scheme.manage`. Every column except `name`, `valid_from` and `valid_to` stays unchanged (a `to_jsonb` diff, as `fee_plan_guard`). Stamps `updated_at` and `updated_by`.
    *   **DRAFT → LIVE:** requires `scheme.approve` and `session_step_up_fresh(300)`. The approver differs from `created_by` and from `updated_by`. The scheme has at least one rule and one course, and `valid_to` is not before IST today. Stamps the approval pair.
    *   **LIVE → RETIRED:** requires `scheme.approve`, step-up and a reason. Stamps the retirement pair.
    *   Anything else on LIVE or RETIRED raises `fee_scheme_guard`.
    *   **Delete:** DRAFT only, with `scheme.manage`.
*   **`fee_scheme_part_guard`** (rule, course and centre tables):
    *   Reads the scheme `for update`. It must be DRAFT and the caller must hold `scheme.manage`.
    *   Then it sets the scheme's `updated_at`/`updated_by` with an update that `fee_scheme_guard` allows (D4).
*   **`fee_scheme_assignment_guard`** (insert):
    1.  Reads the registration: status, course id by code, admission `admitted_on` and centre.
    2.  Takes the `fee-dues:` lock and stamps the row.
    3.  Refuses unless ACTIVE at `new.centre_id`.
    4.  Refuses an existing assignment for the registration (`fee_scheme_assignment_guard`).
    5.  Reads the scheme `for share` (D9). It must be LIVE, with `admitted_on` within the validity, the course among its targets, and the centre targeted or no centres listed.
    6.  Refuses if any PLAN due of the registration whose fee type has a rule has `paid > 0` (`fee_scheme_paid_guard`, D1).
*   **`fee_concession_guard`** (insert):
    1.  Reads the assignment and takes the lock (C3).
    2.  Requires the assignment's `created_at = now()`, meaning the same transaction (D5, C4).
    3.  Requires the due to be PLAN, of the assignment's registration and centre, with a rule for its fee type.
    4.  **Stamps `new.amount`** with the G2 formula (D7) and `created_at`.
    5.  **Returns NULL when the amount is 0**, which skips the row. The app then inserts every ruled due without computing anything.
*   **Constraint trigger `fee_scheme_assignment_given`** (deferred, on assignment insert). At commit, the assignment must have at least one concession; otherwise it raises `fee_scheme_given_guard`.

**Immutability.** Assignments and concessions carry `ticket_immutable` triggers: `*_no_update_delete` and `*_no_truncate` (C10).

**`fee_due_balance`** is replaced with `create or replace … with (security_invoker = true)` (C2, D10):
*   The inner select adds `coalesce((select sum(c.amount) from app.fee_concession c where c.due_id = d.id), 0) as concession`.
*   `outstanding` and `owed` subtract it. `held` and `collectable` stay derived as in 0031.
*   `concession` is added as the last column.
*   Concessions are read under `student.view`, the same as receipts (the D6 note in 0031).

**RLS (C6).** Each table is ENABLE + FORCE.

| Table | select | insert | update, delete |
|---|---|---|---|
| `fee_scheme`, `fee_scheme_rule`, `fee_scheme_course` | `true` | `scheme.manage` or `scheme.approve`; the guard decides which | same as insert |
| `fee_scheme_centre` | `true` | same as above | same as above |
| `fee_scheme_assignment`, `fee_concession` | `student.view` at the centre | `fee.concession` at the centre | `false` |

`fee_scheme_centre`'s policies are expressed with `centre_id` so that T-RLS-002 covers it.

**Grants (C7).**

| Table | Grant |
|---|---|
| `fee_scheme` | `select`; `insert (id, code, name, valid_from, valid_to)`; `update (name, valid_from, valid_to, status, retired_reason)`; `delete` |
| `fee_scheme_rule` | `select`; `insert (scheme_id, fee_type_id, kind, value)`; `update (kind, value)`; `delete` |
| `fee_scheme_course` | `select, insert, delete` |
| `fee_scheme_centre` | `select, insert, delete` |
| `fee_scheme_assignment` | `select, insert (id, registration_id, centre_id, scheme_id)` |
| `fee_concession` | `select, insert (assignment_id, due_id, centre_id)` |

Grant `usage` on every sequence.

**Permissions.**

| Key | Description | Sensitive |
|---|---|---|
| `scheme.manage` | Create and edit fee schemes | yes |
| `scheme.approve` | Approve or retire fee schemes | yes |
| `fee.concession` | Assign a fee scheme to a learner | no |

`system_admin` holds all three.

**ETL reset (C10).** It lifts `fee_concession_no_truncate` and `fee_scheme_assignment_no_truncate`, and clears both tables before `fee_due` and `registration`. The scheme masters stay, as the fee masters do.

### Server

*   **`src/server/schemes.ts`**
    *   **Read** (everyone): `listSchemes`, `getScheme`.
    *   **Write**, each through `adminWrite` with step-up:
        *   `createScheme` (reserves the id first), `updateScheme`, `setSchemeRule` (`null` removes it), `setSchemeCourses`, `setSchemeCentres`, `deleteScheme`: permission `scheme.manage`;
        *   `approveScheme`, `retireScheme`: permission `scheme.approve`.
    *   **Audit actions:** `fee.scheme.create`, `.update`, `.rule`, `.courses`, `.centres`, `.delete`, `.approve`, `.retire`.
    *   **Error mapping** (C8) uses a `GUARD_KEY` inside the callback:

        | Guard | Key |
        |---|---|
        | `fee_scheme_guard` | `fee.scheme.locked` |
        | `fee_scheme_part_guard` | `fee.scheme.locked` |
        | self-approval branch | `fee.scheme.self` |
        | approval without rules or courses | `fee.scheme.incomplete` |
        | approval of an expired scheme | `fee.scheme.expired` |
        | 23505 | `fee.duplicate` |
*   **`src/server/concessions.ts`**
    *   **`assignScheme(session, personId, registrationId, schemeId)`.** The pre-flight ties the registration to the person in scope. Then, inside `scopedAction(fee.concession)`:
        1.  check `student.view`;
        2.  check that the centre is ACTIVE (the trading gate);
        3.  take the lock;
        4.  insert the assignment;
        5.  run `insert into fee_concession (assignment_id, due_id, centre_id) select … from the registration's PLAN dues with a rule`;
        6.  if no row was written, throw `fee.scheme.nothing` before commit;
        7.  audit `{ schemeId, schemeCode, concessions, total }`.

        Errors map as follows:

        | Error | Key |
        |---|---|
        | `fee_scheme_paid_guard` | `fee.scheme.paid` |
        | `fee_scheme_assignment_guard` (exists) | `fee.scheme.exists` |
        | validity or targets | `fee.scheme.notfor` |
        | `fee_scheme_given_guard` | `fee.scheme.nothing` |
        | other 23514 | `fee.scheme.mismatch` |
        | 42501 | `Forbidden` |
    *   **`schemesFor(session, registrationId)`.** Returns the LIVE schemes valid on the admission date for the course and centre.
    *   **`concessionRegister(session, centreId, from, to, schemeId?)`.** Authorizes `student.view`, allows at most 92 days, returns rows plus a total.
*   **`duesForPerson`.** Each due gains `concession`. Each registration gains `scheme` (`{ code, name } | null`) and `canConcede` (the centre is ACTIVE and the user has `fee.concession`).
*   **Messages and labels.** Every new key gets an entry in `ADMIN_MESSAGES`, plus labels.

### Pages and routes

*   **`/admin/fees/schemes`** (list and create) and **`/admin/fees/schemes/[id]`** (draft editor for rules, courses and centres, with Approve, Retire and Delete), with routes as for fee plans.
*   **Learner page.** The dues table gains a Concession column, so it shows gross, concession, paid and outstanding (D8). The Fees row shows the scheme. Where `canConcede` applies, there are no scheme and no payments yet, it shows a Scheme picker (`schemesFor`).
*   **`POST /students/[personId]/scheme`.**
*   **`/fees/concessions?centre=&from=&to=&scheme=`**, the register. It is linked from home for `fee.concession` holders (`concessionCentres`).

### Tests

*   **`tests/fee-schemes.test.ts`.**
*   **Fixtures (C9, C11):**
    *   `export const SC = { maker: "…00fe", checker: "…0100", concede: "…0101" }`, with tokens `tok-schM`, `tok-schA` and `tok-feeK`;
    *   roles 34 `scheme_maker` (`scheme.manage`, ALL), 35 `scheme_checker` (`scheme.approve`, ALL) and 36 `fee_concession` (`fee.concession` and `student.view`, CENTRE 1);
    *   permission rows and the truncate list.

    Roles created from the sequence in other tests move to id 37+. That is harmless, because they use the sequence.
*   **`FEE_GATES.collectionLive`** is toggled around collection, as in other suites.

| ID | Goal | What it does |
|---|---|---|
| T-SC-001 | G1 | **Lifecycle:** draft, rules, courses, centres; approval by another user; LIVE frozen; retire with a reason. **Refusals:** self-approval by the creator or by the last editor; no rules or courses; expired; editing LIVE; deleting LIVE; no step-up. **Audit:** every action. |
| T-SC-002 | G2, G3 | **PERCENT:** 25% of 0.10 = 0.03, half-up; 12000.50 → 3000.13. **AMOUNT** over 2 instalments: latest first, capped. **Identity:** gross = paid + concession + outstanding. Collection then posts less. **Refusals:** something already paid on a ruled due; a second scheme; a date out of validity; another course; an untargeted centre; retired or draft; nothing to give; a viewer; out of scope; an inactive centre. |
| T-SC-003 | G4 | **By name, as raw SQL:** a manager approving; an approver editing a draft; self-approval; part edits on LIVE; a concession in a later transaction; a concession on another registration's due; a non-PLAN due; the amount is stamped regardless of what is supplied. **Also:** immutability, RLS, the deferred "given" check. |
| T-SC-004 | G5 | **Register:** rows, total, scheme filter, range limit, scope. **Routes:** origin and 404s. |

**Existing tests:**
*   T-RLS-002's list adds `fee_concession`, `fee_scheme_assignment` and `fee_scheme_centre`.
*   T-AUD-009 adds the scheme and concession actions, and the `schemes.ts` and `concessions.ts` scans.
*   T-FD-001 adds `scheme: null, canConcede: false`.
*   `fee-receipts` expectations do not change: with no concessions, owed is the same.

**Smoke.** The schemes page renders. The register is 404 without permission. A foreign-origin post is refused.

## Decisions (recommended options)

1.  **DD-1: maker and checker are enforced by the database.** Permission, step-up, maker and last editor all differ from the approver (D-SCH-1). LIVE is frozen; RETIRED is final.
2.  **DD-2: rules per fee type.** PERCENT applies to each due. **AMOUNT is a total per fee type**, spread latest first and capped at gross (Z1, D2). This is PMC: Accounts confirms that legacy "Constant Amount" means a total.
3.  **DD-3 (PMC): targets.** Courses are required; centres are optional (none means all).
4.  **DD-4: one scheme per registration**, assigned once at admission, before anything is paid on ruled dues (D-SCH-2, D-SCH-3, D1).
5.  **DD-5: concessions.** Append-only, stamped by the database, and they reduce owed. On a cash basis they post no journal. The register makes them visible (D6).
6.  **DD-6: rounding.** PERCENT rounds half-up per due. Discounts apply to the GST-inclusive gross, so receipts tax only what is paid (pre-supply discount, D8).
7.  **DD-7 (PMC):** `fee.concession` is not sensitive. Schemes are sensitive.
8.  **DD-8:** A zero share writes no row, and an assignment that gives nothing is refused.
9.  **DD-9:** The concession register covers at most 92 days (PMC).
10. **DD-10:** The reversal and import shapes are recorded (Z2, Z3) and are not built now.
11. **DD-11:** Out of scope; see Non-Goals.
12. **DD-12:** The learner page shows gross, concession, paid and outstanding per due.

## Risks and Limits

*   A registration that leaves ACTIVE keeps its concessions. A course change (WF7) re-evaluates through the ticket.
*   A held due with owed 0 stays held, which is harmless.
*   The policies let either scheme permission write. The guard decides which transition needs which permission (C13).
