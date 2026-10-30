# Schemes and concessions (Stage 4, F5; WF5; R-053, R-054, R-060 part; D-SCH-1/2/3)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-9 are recommended options under the owner's standing instruction (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. The inputs are:
*   [`input-brief.md`](input-brief.md);
*   `docs/audit/revisions/v1.6-fee-dues-model.md`;
*   `docs/designs/fee-holds/fee-holds.md`, for `fee_due_balance`;
*   `docs/designs/fee-structure/fee-structure.md`, for the maker and `fee.setup` patterns.

--------------------------------------------------------------------------------

## Overview

Head office creates a **scheme**: a dated discount with **rules** per fee type (a percentage or an amount) and **targets** (courses, and optionally centres). A second person approves it, and only then is it live. A centre assigns one live scheme to a learner's registration. The database then writes one **concession** per affected plan due, and that reduces what is owed. Concessions never change, and they post no journal on a cash basis.

## Goals

*   **G1: the scheme master (D-SCH-1).** A holder of `scheme.manage` (sensitive, step-up) works on schemes as follows:
    *   creates and edits a DRAFT scheme: code, name, valid from and valid to;
    *   sets its rules per fee type (PERCENT 0.01–100, or AMOUNT > 0);
    *   sets its course targets (at least one) and its centre targets (optional).

    A **different** holder of `scheme.approve` (sensitive, step-up) makes it LIVE. A live scheme never changes. It can be RETIRED with a reason, which stops new assignments. Every action is audited [T-SC-001].
*   **G2: assigning a scheme (D-SCH-2, D-SCH-3).** A holder of `fee.concession` and `student.view` at the registration's centre assigns one scheme to an ACTIVE registration with PLAN dues, at an active centre, once. The scheme must:
    *   be LIVE and valid on the admission date;
    *   target the registration's course;
    *   target the registration's centre, or list no centres.

    One concession is written per PLAN due whose fee type has a rule:
    *   **PERCENT:** `round(gross × pct / 100, 2)`;
    *   **AMOUNT:** the rule's amount.

    Each concession is capped at that due's current owed amount, and is written only if above 0. The assignment is audited with the total concession [T-SC-002].
*   **G3: owed counts concessions.** `fee_due_balance.owed` (PLAN) = gross − Σ concessions − Σ ACTIVE allocations. `outstanding` (allocatable) is reduced the same way. Collection, holds and the learner page all follow automatically [T-SC-002].
*   **G4: the database proves it** [T-SC-003]:
    *   **Schemes:** a LIVE scheme's fields, rules and targets never change; approval needs a different user and at least one rule and one course.
    *   **Assignment:** at most one assignment per registration (unique), under the `fee-dues:` lock.
    *   **Concessions:** each must belong to the assignment's registration, a PLAN due whose fee type has a rule, and equal the rule's computed amount capped at owed. Every check fails closed. Concessions never change.
    *   **RLS:** concessions are read with `student.view`; assignments are written with `fee.concession`; schemes are read by everyone and written by `scheme.manage` or `scheme.approve`.

## Non-Goals (DD-8)

*   Variable natures, where the amount is chosen at assignment.
*   Scheme change or removal after assignment; this needs a ticket (D-FEE-2, D-SCH-2).
*   Category, division, region and area targeting.
*   Scheme targets (R-099) and scheme reports.
*   Legacy import (paused).

## Technical Plan

### Migration `0032_fee_schemes`

**Tables.**

| Table | Columns | Notes |
|---|---|---|
| `fee_scheme` | `id` serial; `code` (unique, the code rule); `name`; `valid_from` date; `valid_to` date (`valid_to >= valid_from`); `status` (DRAFT, LIVE or RETIRED); `created_at`, `created_by`; `approved_at`, `approved_by`; `retired_at`, `retired_reason` | Check: `(status <> 'DRAFT') = (approved_by is not null and approved_at is not null)`. |
| `fee_scheme_rule` | `scheme_id`, `fee_type_id`, `kind` (PERCENT or AMOUNT), `value` numeric(14,2) | Key `(scheme_id, fee_type_id)`. Check: PERCENT is 0.01–100; AMOUNT is above 0. |
| `fee_scheme_course` | `scheme_id`, `course_id` | Key `(scheme_id, course_id)`. |
| `fee_scheme_centre` | `scheme_id`, `centre_id` | Key `(scheme_id, centre_id)`. |
| `fee_scheme_assignment` | `id` bigserial; `registration_id` (unique: D-SCH-2); `centre_id`; `scheme_id`; `created_at`, `created_by` | FK `(registration_id, centre_id)` → `registration`. |
| `fee_concession` | `id` bigserial; `assignment_id`; `due_id`; `centre_id`; `amount` numeric(14,2) > 0; `created_at` | Unique `(due_id)`, since one scheme gives one concession per due. |

**Guards.** All are invoker, rules-only, use nested ifs, and carry the constraint name in the message.
*   **`fee_scheme_guard`** (insert, update, delete on `fee_scheme`):
    *   An insert must be DRAFT. It stamps `created_by`.
    *   Updates while DRAFT may change any field except the status flow.
    *   DRAFT → LIVE requires all of: `approved_by` (stamped from the session) differs from `created_by`; at least one rule; at least one course; `valid_to >= current date`.
    *   LIVE → RETIRED requires a reason and stamps the time. RETIRED is final.
    *   Every other change to a LIVE or RETIRED scheme is refused (`fee_scheme_guard`).
    *   A DRAFT scheme can be deleted; any other scheme cannot.
*   **`fee_scheme_part_guard`** (`rule`, `course`, `centre` tables): a change is allowed only while the scheme is DRAFT. The guard reads the scheme `for share` (the fee-plan line pattern).
*   **`fee_scheme_assignment_guard`** (insert):
    1.  Takes the `fee-dues:` lock and stamps the row.
    2.  Checks the registration: ACTIVE, at this centre, with its course and its admission's `admitted_on`.
    3.  Checks the scheme: LIVE, with `admitted_on` between `valid_from` and `valid_to` (D-SCH-3).
    4.  Checks the targets: a course row for the registration's course, and either a centre row for this centre or no centre rows.
*   **`fee_concession_guard`** (insert): the assignment's registration matches the due's, and the due is PLAN at the centre. It finds the rule for the due's fee type and computes `round(gross * value / 100, 2)` (PERCENT) or `value` (AMOUNT), capped at the due's owed (from `fee_due_balance`, under the same lock). It refuses unless `new.amount` equals that computed amount and is above 0.
*   **Constraint trigger `fee_scheme_assignment_paid`** (deferred, on assignment insert): at commit the assignment must have at least one concession, otherwise the scheme gave nothing and is refused.

**Immutability.** Assignments and concessions are append-only (`ticket_immutable`). Scheme parts follow the scheme guard.

**`fee_due_balance`** (`create or replace` with `security_invoker`): it subtracts `Σ fee_concession.amount` from `outstanding`, `owed` and `collectable` for each due. `paid` is unchanged.

**RLS and grants.**
*   **Schemes and their parts:** select is open to everyone. Insert, update and delete need `has_permission('scheme.manage', null)`; the LIVE transition and retirement need `scheme.approve`. These are checked in `scheme.ts`. The policy allows either permission, and the guard enforces the flow.
*   **Assignment:** select needs `student.view` at the centre; insert needs `fee.concession` at the centre.
*   **Concession:** select needs `student.view` at the centre; insert needs `fee.concession` at the centre.
*   **Column grants:** given per table.

**Permissions.** System admin holds all three:

| Permission | Description | Sensitive |
|---|---|---|
| `scheme.manage` | Create and edit fee schemes | yes |
| `scheme.approve` | Approve or retire fee schemes | yes |
| `fee.concession` | Assign a fee scheme to a learner | no |

### Server

*   **`src/server/schemes.ts`:**
    *   `listSchemes` and `getScheme` are open to everyone.
    *   `createScheme`, `updateScheme`, `setSchemeRule` (where `null` removes the rule), `setSchemeCourses`, `setSchemeCentres`, `deleteScheme`, `approveScheme` and `retireScheme` all run through `adminWrite` (step-up). They are audited as `fee.scheme.create` … `fee.scheme.retire`.
    *   Errors are mapped by guard name.
*   **`src/server/concessions.ts`:**
    *   `assignScheme(session, personId, registrationId, schemeId)`. The pre-flight ties the registration to the person in scope. Inside `scopedAction(fee.concession)` it then:
        1.  checks `student.view`;
        2.  checks the trading gate;
        3.  takes the lock;
        4.  inserts the assignment;
        5.  inserts the concessions in one `insert … select` over the PLAN dues with rules, computing the capped amount in SQL;
        6.  audits `{ schemeId, schemeCode, concessions: n, total }`.
    *   `schemesFor(session, registrationId)` returns the LIVE schemes this registration can take, for the picker.
*   **`duesForPerson`** adds each due's `concession`, plus the registration's `scheme` (code and name) and `canConcede`.

### Pages and routes

*   **`/admin/fees/schemes`** (list) and **`/admin/fees/schemes/[id]`** (draft editor with rules, courses and centres; Approve, Retire and Delete actions), with routes. These follow the fee plans pages.
*   **Learner page.** Each registration's Fees row shows its scheme. When the user may concede and the registration has no scheme yet, it shows a "Scheme" picker listing `schemesFor`. The dues table gains a Concession column.
*   **`POST /students/[personId]/scheme`.**

### Tests (`tests/fee-schemes.test.ts`)

**Fixtures:**
*   role 34 `scheme_maker` (`scheme.manage`, ALL) with user `…00fe` and token `tok-schM`;
*   role 35 `scheme_checker` (`scheme.approve`, ALL) with user `…00ff`… no, a fresh UUID `…0100`, and token `tok-schA`;
*   role 36 `fee_concession` (`fee.concession`, `student.view`, centre A) with user `…0101` and token `tok-feeS2`.

| ID | Goal | What it does |
|---|---|---|
| T-SC-001 | G1 | **Lifecycle:** draft, then edit, rules, courses and centres; approval by another user; LIVE frozen; retire with a reason. **Refusals:** a self-approval; no rules; no courses; a past `valid_to`; edits to a LIVE scheme; deleting a LIVE scheme. **Access:** step-up required; actions audited. |
| T-SC-002 | G2, G3 | **Amounts:** PERCENT and AMOUNT concessions per due, with exact rounding and the cap at owed when part is already paid. **Effects:** owed and collectable are reduced, collection follows, and receipts post a smaller amount. **Refusals:** a second assignment; a scheme not valid on the admission date; another course; a non-targeted centre; a retired or draft scheme; a viewer; out of scope; an inactive centre; no matching rule (nothing to give). |
| T-SC-003 | G4 | **Database refusals by name, via raw SQL:** a wrong concession amount; a concession on another registration's due; an assignment outside the date or targets; a part edit on a LIVE scheme; a self-approval. **Integrity:** immutability, RLS, the deferred "gave nothing" check. |

**Existing tests that change:**
*   T-RLS-002 adds the assignment and concession tables.
*   T-AUD-009 adds the scheme and concession actions and the scans.
*   T-FD-001 adds the `duesForPerson` fields.
*   The ETL reset clears concessions and assignments.

## Decisions (recommended options)

1.  **DD-1:** Maker-checker. `scheme.manage` drafts and `scheme.approve` makes the scheme LIVE; the approver must be a different person (D-SCH-1). A LIVE scheme never changes and can be RETIRED.
2.  **DD-2:** Rules are per fee type, PERCENT or AMOUNT, applied to each PLAN due of that type. The legacy "nature" becomes the rule's kind.
3.  **DD-3 (PMC):** Targets are courses (required) and centres (optional; none means all). Category, division, region and area targeting comes later.
4.  **DD-4:** One scheme per registration, assigned once, with validity checked on the admission date (D-SCH-2, D-SCH-3).
5.  **DD-5:** Concessions are append-only per due, capped at owed when assigned, and reduce `owed`, `outstanding` and `collectable`. They post no journal (cash basis).
6.  **DD-6:** PERCENT concessions round half-up per due.
7.  **DD-7 (PMC):** `fee.concession` is not sensitive. Schemes are sensitive and need step-up.
8.  **DD-8:** Out of scope; see Non-Goals.
9.  **DD-9:** An assignment that gives no concession is refused, because nothing would be recorded.

## Risks and Limits

*   A due that is already fully paid gets no concession: it is capped at owed 0. Refunds remain D-FIN-5.
*   Changing the course of a registration (WF7) will need to re-evaluate its scheme by ticket.
