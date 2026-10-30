# Fee dues (Stage 4, F2; WF4)

*   **Author:** gtm
*   **Status:** Proposed, revised after EGM steps 5–7 ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md), in parallel; every finding resolved below). DD-1…DD-7 are recommended options under the owner's instruction ("yes do the next step", 2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Input: [`input-brief.md`](input-brief.md). Financial rules: `docs/audit/07-financial-invariants-and-transactions.md`. Fee plans: `docs/designs/fee-structure/fee-structure.md` (E-050).

--------------------------------------------------------------------------------

## Overview

A learner owes money only once dues exist. This piece copies one registration's dues from the published fee plan that prices its course at its centre in its year. There is one due per fee type and instalment, holding the amount, the due date and the currency.

A due is a gross-only, immutable row. Later pieces add their own append-only rows and never rewrite a due (DD-3):
*   collection (F3): allocations;
*   corrections (F4): holds and adjustments;
*   schemes (F5): concessions.

Outstanding is computed: gross − Σ concessions ± Σ adjustments − Σ active allocations (audit 07 F4/F17, now without columns on the due).

## Goals

*   **G1:** a holder of `fee.dues` (and `student.view`) at the registration's centre creates the dues of an ACTIVE registration at an active centre. The dues come from the plan that `resolvePlan` returns. This happens once per registration, and the creation is audited [T-FD-001].
*   **G2:** the database proves that each due belongs to its registration (G2 is restated after C1/D1):
    *   the plan is PUBLISHED;
    *   the plan prices the registration's course at its centre, or at its centre's class, in the registration's year;
    *   the amount and due date equal the plan line and its instalment, and the currency equals the plan's;
    *   the registration is ACTIVE;
    *   the registration has no dues from another plan.

    Every check fails closed. A due never changes or disappears [T-FD-002].
*   **G3:** anyone with `student.view` at the centre sees the dues on the learner page, with a total per registration [T-FD-001, smoke].
*   **G4:** the route checks the origin. A registration that does not belong to the person in the URL, or that the caller cannot see, gives 404 [T-FD-003].

## Non-Goals

*   Ad-hoc dues: F3 creates them with their receipt. The table already allows them (DD-7), but F2's guard refuses them.
*   Concessions (F5); hold and adjustments (F4); fines (D-FEE-6); balance carry-forward (R-063); bulk creation; import (paused).
*   Dues inside `admit()`, because admission must not depend on a plan.
*   `centre.currency` (Z3). With every plan in INR, the check could never fail. It arrives with the D-CUR-1 piece that lets a currency be set.

## Technical Plan

### Data model (migration `0026_fee_dues`)

The head comes from `prisma migrate diff`. The `schema.prisma` edits (C10) are:
*   `Registration` gains `@@unique([id, centreId])` and `dues FeeDue[]`;
*   `FeePlan`, `FeeType`, `FeeCaption` and `AppUser` gain back-relations;
*   there is a new model `FeeDue`.

The `app.registration` key `registration_id_centre_id_key` is new. It conflicts with nothing (C-confirmed).

**`app.fee_due`:**

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | bigserial | no | primary key; F3 allocations reference it |
| `registration_id` | uuid | no | composite FK `(registration_id, centre_id)` → registration(id, centre_id), restrict |
| `centre_id` | int | no | |
| `source` | text | no | `PLAN` or `ADHOC`, default `'PLAN'` (DD-7) |
| `plan_id` | int | yes | FK → fee_plan, restrict |
| `fee_type_id` | int | no | FK → fee_type, restrict |
| `caption_id` | int | yes | FK → fee_caption, restrict |
| `due_on` | date | no | |
| `gross` | numeric(14,2) | no | |
| `currency` | char(3) | no | |
| `created_at` | timestamptz | no | stamped by the guard |
| `created_by` | uuid | no | FK → app_user; stamped by the guard |

**Keys:**
*   A composite FK `(plan_id, fee_type_id, caption_id)` → `fee_plan_line(plan_id, fee_type_id, caption_id)`, restrict. With MATCH SIMPLE it applies to PLAN rows only.
*   Unique `(registration_id, fee_type_id, caption_id)`. NULL captions are distinct, so ADHOC rows may repeat.

**Named checks:**
*   `fee_due_gross_check`: `gross >= 0`;
*   `fee_due_currency_check`: `currency ~ '^[A-Z]{3}$'`;
*   `fee_due_source_check`: `source in ('PLAN', 'ADHOC') and ((source = 'PLAN') = (plan_id is not null and caption_id is not null))`.

**Guard `fee_due_guard`, BEFORE INSERT.** It has invoker rights and holds rules only, so it binds every role. The ifs are nested and every comparison is `is distinct from`, so a missing or hidden source row fails closed (D2, C3). Each message carries its constraint name.

1.  `created_at := now()` and `created_by := coalesce(app.session_user_id(), new.created_by)`.
2.  `if new.source <> 'PLAN'`: raise `fee_due_source_guard`. ADHOC rows wait for F3.
3.  It reads the registration with its year and course, refusing with `fee_due_match_guard` when no row comes back:

    ```sql
    select r.status::text, co.id as course_id, a.academic_year, ce.centre_class_id
    from app.registration r
      join app.admission a on a.id = r.admission_id
      join app.course co on co.code = r.course_code
      join app.centre ce on ce.id = r.centre_id
    where r.id = new.registration_id and r.centre_id = new.centre_id
    ```

    *   The year is the admission's. That holds while registrations are created only inside `admit()` (D11). If a course can later join an existing admission, `registration` needs its own year.
    *   A status other than ACTIVE raises `fee_due_registration_guard` (D7).
4.  It reads the plan, refusing when it is not found or not PUBLISHED (`fee_due_plan_guard`). Published plans are visible to every role:

    ```sql
    select status, course_id, academic_year, centre_id, centre_class_id, currency
    from app.fee_plan where id = new.plan_id
    ```

5.  **The plan is the registration's (C1, D1)**, otherwise `fee_due_match_guard`:
    *   `plan.course_id` is not distinct from the registration's course;
    *   `plan.academic_year` is not distinct from its year;
    *   the plan matches its centre or its class: `plan.centre_id = new.centre_id or (plan.centre_id is null and plan.centre_class_id is not distinct from ce.centre_class_id and ce.centre_class_id is not null)`.

    Choosing the current version stays in the app: `resolvePlan` picks it, and the database proves only that the plan is a valid one.
6.  **The copy is exact**, otherwise `fee_due_match_guard`. Each of these must not be distinct:
    *   `new.gross` and the line's amount;
    *   `new.due_on` and the caption's `due_on`;
    *   `new.currency` and `plan.currency`.
7.  **One plan per registration (C11)**: `exists (select 1 from app.fee_due d where d.registration_id = new.registration_id and d.plan_id is distinct from new.plan_id and d.source = 'PLAN')` raises `fee_due_plan_guard`.

**Immutability:** `fee_due_no_update_delete` and `fee_due_no_truncate` execute `app.ticket_immutable()`, as `call_log` does. The test fixtures truncate under replica.

**Centre transfers (D6).** An admission's centre can move through `ON UPDATE CASCADE` into `registration.centre_id`. That move is aborted by this table's composite FK (restrict) once the registration has dues. This is intended: a centre transfer is a new registration (status `TRANSFER`), never an in-place move of money. T-FD-002 covers it.

**RLS:** ENABLE and FORCE. T-RLS-002 applies, so the table has four commands:
*   `select`: `centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])`;
*   `insert`: `centre_id = any ((select app.scoped_centre_ids('fee.dues'))::int[])`;
*   `update` and `delete`: `using (false)`.

**Permission:** `('fee.dues', 'Create a learner''s fee dues from the fee plan', false)` plus the `system_admin` grant.

**Grants:**
*   `select, insert (registration_id, centre_id, plan_id, fee_type_id, caption_id, due_on, gross, currency) on app.fee_due`. `source` keeps its default.
*   `usage` on its sequence.

**The lock contract for F3 (Z1).** `select … for update` on dues needs UPDATE privilege and an update policy, and dues have neither. Every writer of a registration's money therefore takes `pg_advisory_xact_lock(hashtext('fee-dues:' || registrationId))`, here and in F3/F4/F5. "Once per registration" is enforced by the app under that lock; the database enforces once per line and one plan per registration (D9).

**Order (D5).** The dues are inserted `order by c.sort_order, c.due_on, t.sort_order, t.code`. F3 allocates oldest first by `(due_on, id)` (D-FEE-4).

### Server (`src/server/dues.ts`)

```ts
type DueRow = { id: string; feeTypeCode: string; feeTypeName: string; captionName: string; dueOn: string; gross: string; currency: string };
type RegistrationDues = { registrationId: string; centreId: number; courseCode: string; courseName: string; academicYear: string; status: string;
  dues: DueRow[]; total: string | null;            // null when there are no dues
  planId: number | null;                           // the dues' plan when dues exist; else the plan that would apply now; null when none
  canCreate: boolean; noPlan: boolean };           // C8, Z4
duesForPerson(session, personId): Promise<RegistrationDues[]>
createDues(session, personId, registrationId): Promise<{ count: number; total: string }>   // audit action fee.dues.create
createDuesTx(tx, registrationId, centreId): Promise<{ planId; version; count; total }>   // Z7: no auth; for F3 and bulk later
```

**`createDues`:**
1.  **Pre-flight (C2).** Both ids must be UUIDs. A `withScope` read must find the registration:

    ```sql
    select r.centre_id from app.registration r join app.admission a on a.id = r.admission_id
    where r.id = $reg and a.person_id = $person
    ```

    It runs under RLS. When there is no row, it throws `RbacError("notfound")`.
2.  **The action.** `scopedAction({ action: "fee.dues.create", permission: "fee.dues", centreId, targetType: "registration", targetId })` runs the following, all inside `duesDb`:
    1.  `authorize(tx, "student.view", centreId)`;
    2.  the trading gate (`centreId: centre is not active`);
    3.  `createDuesTx`.
3.  **`createDuesTx`:**
    1.  Take the advisory lock.
    2.  Read the registration with `join app.course co on co.code = r.course_code` and `join app.admission a` (C4). A status other than ACTIVE throws `registrationId: not active`.
    3.  If the registration already has dues, throw `RbacError("duplicate", …, "fee.dues.exists")`.
    4.  `resolvePlan`. If it returns null, throw `RbacError("invalid", …, "fee.dues.noplan")`.
    5.  Read the plan's version.
    6.  Insert from the plan's lines in the D5 order.
    7.  Return the count and `sum(gross)::text`.
4.  **Audit.** `{ after: { planId, version, count, total } }`. Fee amounts tied to a learner are personal financial data, shown and audited like other learner data (D10; DD-5 is PMC).
5.  **`duesDb` (C7)** maps errors as follows:

    | Error | Becomes |
    |---|---|
    | 23505 | `fee.dues.exists` |
    | 23514 (guards) or 23503 (keys) | `fee.dues.mismatch` |
    | 42501 | `Forbidden` |

**`duesForPerson` (C6, C8).** It runs in one `withScope`. It reads the person's registrations visible under `student.view`, ordered `a.created_at, r.created_at`. For each registration:
*   **its dues**, ordered `(due_on, id)`, with each amount as `gross::text` and the total as `sum(gross)::text`;
*   **`canCreate`**: no dues, the registration is ACTIVE, the centre is ACTIVE, and `app.has_permission('fee.dues', r.centre_id)`;
*   **`noPlan`**: computed only when `canCreate` is true, as `resolvePlan(...) is null`. The button is then shown, or "No fee plan for this course yet".

`createDues` reports every other refusal itself (Z4).

**`ADMIN_MESSAGES` (C7):**

| Key | Message |
|---|---|
| `fee.dues.exists` | "This course already has its dues." |
| `fee.dues.noplan` | "No published fee plan prices this course at this centre for that year." |
| `fee.dues.mismatch` | "The dues did not match the fee plan; nothing was saved." |

Field errors (`registrationId: not active`, `centreId: centre is not active`) show through `AdminErrors` with the labels "Course registration" and "Centre". `forbidden` already has a message.

### Page and route

*   **`/students/[personId]`.**
    *   The page now reads `searchParams` (`error`, `detail`, `saved`) and renders `AdminErrors` (C6).
    *   It calls `duesForPerson` in the same `pageRead` (`Promise.all`) and joins the dues to each registration by `registrationId`.
    *   Under each registration it shows a "Fees" block:
        *   the dues table (fee type, instalment, due date, amount via `inr()`) and the total;
        *   the "Create dues" form when `canCreate && !noPlan`;
        *   or "No fee plan for this course yet" when `canCreate && noPlan`;
        *   or nothing.
*   **`POST /students/[personId]/dues`.**
    *   It runs through `adminPost` (same origin, session). The fields are `registrationId`.
    *   On success it goes to `/students/<personId>?saved=1`; on an error it comes back with `error`/`detail`.
    *   A personId that is not a UUID gives 404. The route catches `RbacError` `notfound` and returns a 404 Response, as tickets do (C2).

### Tests (`tests/fee-dues.test.ts`)

**Fixtures (C9):**
*   Role 29 `fee_dues` holds `fee.dues` and `student.view`. Its user `…00f7` holds it at centre A, with token `tok-feeD`.
*   The holder of `student.view` without `fee.dues` is `tok-stuA`.
*   A shared `tests/fee-seed.ts` exports `seedFeePlan()`, moved out of the fee-structure test's local helpers. It places centre A in METRO with DCA offered there, creates the fee masters, and publishes a DCA class plan as `tok-feeS` after `setStepUp`.
*   The test admits a learner at A for DCA 2026-27 as `tok-stuA`.

| ID | Goal | What it does |
|---|---|---|
| T-FD-001 | G1, G3 | Creating dues: one per line, in order, exact amounts, the plan's currency; the audit row has the count and total. Refusals: a second create, a course without a plan (`noplan`), an inactive centre, a DROP registration, `tok-stuA` (Forbidden), a registration of another person (`notfound`). A newer plan does not reprice. `duesForPerson`: `canCreate`, `noPlan`, totals; `tok-uA` sees nothing. |
| T-FD-002 | G2 | By SQL as gems_app, the guard refuses each case by name: another course's plan, another centre's override, another year, a wrong amount, a wrong due date, a wrong currency, a draft plan, a DROP registration, a second plan, an ADHOC row. A viewer's insert is refused (42501 or 23514). As the owner: update, delete and truncate are refused, and the admission centre move cascades and is refused (D6). The database stamps who and when. RLS has four commands. |
| T-FD-003 | G4 | The route: success and `saved=1`; an error shows on the page; a foreign Origin gives 403; another person's registration gives 404. |

**Existing tests that change:**
*   T-RLS-002 adds `fee_due`;
*   T-AUD-009 gains the `dues.ts` scan and `fee.dues.create`;
*   the fixtures change;
*   `tests/fee-structure.test.ts` uses `tests/fee-seed.ts`.

**Smoke:**
*   the learner page renders its "Fees" block for its viewer;
*   a foreign-origin dues post gives 403.

## Decisions

All seven are recommended options.

1.  **DD-1:** One due per registration, fee type and instalment, copied from the resolved published plan. A due is never repriced.
2.  **DD-2:** Dues are created explicitly by `fee.dues` at the centre, once per registration. Admission never depends on a plan.
3.  **DD-3:** A due is immutable and gross-only. Concessions, holds, adjustments and allocations are separate append-only rows, each referencing `fee_due.id`, and outstanding is computed (D4, Z6). Re-issuing dues would need a generation column.
4.  **DD-4:** The currency is copied from the plan. The centre's own currency arrives with D-CUR-1 (Z3).
5.  **DD-5 (PMC):** Dues are visible to anyone with `student.view` at the centre. A separate `fee.view` can come later (D10).
6.  **DD-6:** Out of scope: ad-hoc dues, carry-forward, schemes, fines, bulk creation, import.
7.  **DD-7:** Plan and ad-hoc dues share one table, with `source`. F3 opens ADHOC in the guard (Z2, D3), so allocations reference a single table.

## Alternatives Considered

*   **Dues inside `admit()`.** Rejected (DD-2).
*   **Dues computed on the fly.** Rejected: allocations need rows to reference, and a newer plan would change what a learner owes.
*   **A separate ad-hoc dues table.** Rejected (DD-7): two allocation targets would break the single oldest-first order and the single outstanding query.

## Risks and Limits

*   A registration admitted before its plan was published needs "Create dues" later. The page says so.
*   A registration that leaves ACTIVE keeps its dues. Crediting them is F4.
*   The current-version choice is app-only. The database proves only that the plan is a valid one for the registration.
