# Fee dues (Stage 4, F2; WF4)

*   **Author:** gtm
*   **Status:** Approved. This is the recommended option, taken under the owner's standing instruction of 2026-10-29 and "yes do the next step" of 2026-10-30. It is not an owner signature.
*   **Reviews:** EGM steps 5–7 ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)), step 8 ([`zoom_out_step8_report.md`](zoom_out_step8_report.md)) and step 9 ([`readiness_report.md`](readiness_report.md)). Every finding is resolved below.
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Input: [`input-brief.md`](input-brief.md). Financial rules: `docs/audit/07-financial-invariants-and-transactions.md`, as revised by `docs/audit/revisions/v1.6-fee-dues-model.md` (Z6, Z8-1). Fee plans: `docs/designs/fee-structure/fee-structure.md` (E-050).

--------------------------------------------------------------------------------

## Overview

A learner owes money only once dues exist. This piece copies one registration's dues from the published fee plan that prices its course, at its centre, in its year. There is one due per fee type and instalment, holding the amount, the due date and the currency.

A due is an immutable row holding only the gross amount. Later pieces never rewrite a due (DD-3). Each adds its own append-only rows that reference `fee_due.id`:
*   collection (F3) adds allocations;
*   corrections (F4) add holds and adjustments;
*   schemes (F5) add concessions.

Outstanding is computed: gross − Σ concessions ± Σ adjustments − Σ active allocations.

## Goals

*   **G1:** A user holding `fee.dues` and `student.view` at the registration's centre can create dues for an ACTIVE registration at an active centre. The dues come from the plan that `resolvePlan` returns. This happens once per registration and is audited [T-FD-001].
*   **G2:** The database proves that each due belongs to its registration. Every check fails closed, and a due never changes or disappears [T-FD-002]. The checks are:
    *   the plan is PUBLISHED;
    *   the plan prices the registration's course and year, at its centre or at its centre's class;
    *   the amount and due date equal the plan line and its instalment;
    *   the currency equals the plan's;
    *   the registration is ACTIVE;
    *   the registration has no dues from another plan, enforced under a lock that the guard takes.
*   **G3:** Anyone holding `student.view` at the centre sees the dues on the learner page, with a total per registration [T-FD-001, smoke].
*   **G4:** The route checks the origin. A registration that does not belong to the person in the URL, or that is outside the caller's `student.view` scope, returns 404 [T-FD-003].

## Non-Goals

*   **Ad-hoc dues.** DD-7 records the table shape F3 will use.
*   **Other fee changes:** concessions (F5), holds and adjustments (F4), fines (D-FEE-6) and carry-forward (R-063).
*   **Bulk creation** and **import** (import is paused).
*   **Dues created inside `admit()`.** Admission must not depend on a plan.
*   **`centre.currency`.** Every plan is in INR, so a currency check could never fail. This arrives with D-CUR-1 (Z3).

## Technical Plan

### Data model (migration `0026_fee_dues`)

The head comes from `prisma migrate diff`.

**`schema.prisma` edits:**
*   `Registration` gains `@@unique([id, centreId])` and `dues FeeDue[]`.
*   `FeePlan`, `FeeType`, `FeeCaption`, `FeePlanLine` and `AppUser` each gain a `dues FeeDue[]` back-relation. The one on `AppUser` is named.
*   A new model `FeeDue`, mapped to `fee_due`:
    *   `id BigInt @id @default(autoincrement())`;
    *   `createdAt @default(now())`;
    *   relation `registration`, fields `[registrationId, centreId]` → `[id, centreId]`;
    *   relation `line`, fields `[planId, feeTypeId, captionId]` → `[planId, feeTypeId, captionId]`;
    *   both of those use `onDelete: Restrict, onUpdate: Restrict` (R3);
    *   plain relations to `plan`, `feeType`, `caption` and `creator`;
    *   `@@unique([registrationId, feeTypeId, captionId])`.

The new key `registration_id_centre_id_key` on `app.registration` conflicts with nothing.

**`app.fee_due`.** Every column is NOT NULL (Z8-2).

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | Primary key. F3 allocations reference it. |
| `registration_id` | uuid | Composite FK `(registration_id, centre_id)` → registration(id, centre_id). |
| `centre_id` | int | |
| `plan_id` | int | FK → fee_plan. |
| `fee_type_id` | int | FK → fee_type. |
| `caption_id` | int | FK → fee_caption. |
| `due_on` | date | |
| `gross` | numeric(14,2) | Named check `fee_due_gross_check`: `gross >= 0`. |
| `currency` | char(3) | Must equal the plan's currency (guard). The format is already checked by `fee_plan_currency_check` (Z8-6). |
| `created_at` | timestamptz | Stamped by the guard. |
| `created_by` | uuid | FK → app_user. Stamped by the guard. |

**Keys.** Every FK is `restrict`.
*   Composite FK `(plan_id, fee_type_id, caption_id)` → `fee_plan_line(plan_id, fee_type_id, caption_id)`.
*   Unique key `(registration_id, fee_type_id, caption_id)`.

**Guard `fee_due_guard` (BEFORE INSERT).**
*   It runs with invoker rights and holds rules only.
*   Its ifs are nested, and every comparison uses `is distinct from`.
*   When a source row is missing or hidden, it raises.
*   Every raise uses `errcode = '23514'` with `constraint "<name>"` in the message, as in 0025.

Its steps run in this order:
1.  Take the lock: `perform pg_advisory_xact_lock(hashtext('fee-dues:' || new.registration_id::text))`. The app takes the same key (Z8-3).
2.  Stamp the row: `created_at := now()` and `created_by := coalesce(app.session_user_id(), new.created_by)`.
3.  Read the registration:

    ```sql
    select r.status::text, co.id, a.academic_year, ce.centre_class_id
    from app.registration r
      join app.admission a on a.id = r.admission_id
      join app.course co on co.code = r.course_code
      join app.centre ce on ce.id = r.centre_id
    where r.id = new.registration_id and r.centre_id = new.centre_id
    ```

    No row raises `fee_due_match_guard`. A status other than ACTIVE raises `fee_due_registration_guard` (D7). The year is the admission's year, which holds while registrations are created only inside `admit()` (D11).
4.  Read the plan. Every role can read published plans.

    ```sql
    select status, course_id, academic_year, centre_id, centre_class_id, currency
    from app.fee_plan where id = new.plan_id
    ```

    A plan that is not found, or not PUBLISHED, raises `fee_due_plan_guard`.
5.  **The plan belongs to the registration (C1, D1).** The plan's course and year must not be distinct from the registration's. Its centre must also match: `plan.centre_id = new.centre_id or (plan.centre_id is null and ce.centre_class_id is not null and plan.centre_class_id = ce.centre_class_id)`. Otherwise it raises `fee_due_match_guard`. Choosing the current version stays in the app (`resolvePlan`).
6.  **The copy is exact (R6).**

    ```sql
    select l.amount, c.due_on
    from app.fee_plan_line l join app.fee_caption c on c.id = l.caption_id
    where l.plan_id = new.plan_id and l.fee_type_id = new.fee_type_id and l.caption_id = new.caption_id
    ```

    It raises `fee_due_match_guard` if no row comes back, or if `new.gross`, `new.due_on` or `new.currency` is distinct from the line's amount, the caption's due date or `plan.currency`.
7.  **One plan per registration (C11).** If `exists (select 1 from app.fee_due d where d.registration_id = new.registration_id and d.plan_id <> new.plan_id)`, it raises `fee_due_plan_guard`. Under step 1's lock this check is safe against concurrent inserts. Together with the unique key, "once per registration" becomes a database invariant (D9).

**Immutability.** `fee_due_no_update_delete` (a row trigger) and `fee_due_no_truncate` (a statement trigger) execute `app.ticket_immutable()`, as `call_log` does (0022).

**Centre transfers (D6).** Moving an admission's centre cascades into `registration.centre_id`. Once dues exist, this table's composite FK aborts that move. This is intended: a centre transfer is a new registration (`TRANSFER`), never an in-place move of money. T-FD-002 tests it as the owner, because gems_app cannot update admission.

**RLS.** ENABLE and FORCE, with policies for four commands (T-RLS-002):

| Command | Policy |
|---|---|
| `select` | `centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])` |
| `insert` | the same, with `fee.dues` |
| `update`, `delete` | `using (false)` |

**Permission.** `('fee.dues', 'Create a learner''s fee dues from the fee plan', false)`, plus the `system_admin` grant.

**Grants.**
*   `select, insert (registration_id, centre_id, plan_id, fee_type_id, caption_id, due_on, gross, currency)` on `app.fee_due`.
*   `usage` on its sequence.

**Lock contract for F3, F4 and F5 (Z1).** gems_app cannot lock dues with `FOR UPDATE`. Instead, every writer of a registration's money first takes `pg_advisory_xact_lock(hashtext('fee-dues:' || registrationId))`. The guard takes the same lock.

**Order (D5).** Dues are inserted `order by c.sort_order, c.due_on, t.sort_order, t.code`. F3 allocates oldest first by `(due_on, id)`.

### Server (`src/server/dues.ts`)

```ts
type DueRow = { id: string; feeTypeName: string; captionName: string; dueOn: string; gross: string; currency: string };
type RegistrationDues = { registrationId: string; dues: DueRow[]; total: string | null; canCreate: boolean; noPlan: boolean }; // Z8-5, R7
export duesForPerson(session, personId): Promise<RegistrationDues[]>
export createDues(session, personId, registrationId): Promise<{ count: number; total: string }>   // audit action fee.dues.create
createDuesTx(tx, registrationId, centreId): Promise<{ planId; version; count; total }>   // not exported (Z8-4)
```

**`createDues`:**

1.  **Pre-flight (C2, R1, R2).** Both ids must be UUIDs. A `withScope` read must return the registration's centre:

    ```sql
    select r.centre_id from app.registration r join app.admission a on a.id = r.admission_id
    where r.id = $reg and a.person_id = $person
      and r.centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])
    ```

    If no row comes back, it throws `PersonError("notfound")`.
2.  **The scoped action.** It runs `scopedAction({ action: "fee.dues.create", permission: "fee.dues", centreId, targetType: "registration", targetId: registrationId })`. Inside `duesDb`, it does three things:
    1.  Calls `authorize(tx, "student.view", centreId)`.
    2.  Applies the trading gate (`centreId: centre is not active`).
    3.  Calls `createDuesTx`.
3.  **`createDuesTx`.** In order, it:
    1.  Takes the advisory lock, with the key built in TS.
    2.  Reads the registration, joining the course on its code and the admission for the year (C4).
    3.  Throws `registrationId: not active` if the registration is not ACTIVE.
    4.  Throws `RbacError("duplicate", …, "fee.dues.exists")` if any dues already exist.
    5.  Calls `resolvePlan`. If it returns null, it throws `RbacError("invalid", …, "fee.dues.noplan")`.
    6.  Reads the plan's version.
    7.  Inserts one due per plan line, in the D5 order.
    8.  Returns the count and `sum(gross)::text`.
4.  **Audit detail.** `{ after: { planId, version, count, total } }`. DD-5 is PMC (D10).
5.  **`duesDb` (C7).** It maps database errors as follows:

    | SQLSTATE | Becomes |
    |---|---|
    | 23505 | `fee.dues.exists` |
    | 23514 or 23503 | `fee.dues.mismatch` |
    | 42501 | `Forbidden` |

**`duesForPerson`.** It runs one `withScope`, using the same `scoped_centre_ids('student.view')` filter on registrations as `getPerson` (R2). For each registration it returns:
*   **`dues`**, ordered `(due_on, id)`, with `gross::text`.
*   **`total`**, as `sum(gross)::text`.
*   **`canCreate`**, which is true when all of these hold: there are no dues, the registration is ACTIVE, the centre is ACTIVE, and `app.has_permission('fee.dues', r.centre_id)`.
*   **`noPlan`**, which is `resolvePlan(...) is null`. It is computed only when `canCreate` is true.

**`adminPost` (R1).** It gains `if (e instanceof PersonError && e.reason === "notfound") return 404`, next to the `TicketNotFound` branch.

**`ADMIN_MESSAGES`.**

| Key | Message |
|---|---|
| `fee.dues.exists` | "This course already has its dues." |
| `fee.dues.noplan` | "No published fee plan prices this course at this centre for that year." |
| `fee.dues.mismatch` | "The dues did not match the fee plan; nothing was saved." |

Field errors render through `AdminErrors` with the labels "Course registration" and "Centre".

### Page and route

**`/students/[personId]` page:**
*   It reads `searchParams` (`error`, `detail`, `saved`) and renders `AdminErrors`.
*   It runs `duesForPerson` together with `getPerson` (`Promise.all` in the same `pageRead`), then maps the result by `registrationId`.
*   After each registration's `<tr>` it renders a full-width `<tr><td colSpan={5}>` "Fees" row (R8). The row shows the first that applies:
    *   if there are dues: the dues table (fee type, instalment, due date, amount via `inr()`) and the total;
    *   if `canCreate && !noPlan`: the "Create dues" form;
    *   if `canCreate && noPlan`: "No fee plan for this course yet";
    *   otherwise: nothing.

**`app/students/[personId]/dues/route.ts`:**
*   It exports `export const POST = safeRoute(handle)`.
*   A UUID check runs first and returns 404 on failure.
*   `adminPost` then handles the `registrationId` field. On success it redirects to `/students/<personId>?saved=1`.

### Tests (`tests/fee-dues.test.ts`)

**Fixture changes in `tests/fixtures.ts` (R5):**
1.  The `fee.dues` permission row.
2.  Role `(29, 'fee_dues', 'Fee dues')`.
3.  Role grants `(29, 'fee.dues')` and `(29, 'student.view')`.
4.  `export FD = { a: "…00f7" }`, plus its `app_user` row.
5.  An assignment for that user at centre 1.
6.  The session `tok-feeD`.
7.  `app.fee_due` in the truncate list.

The holder of `student.view` without `fee.dues` is `tok-stuA`.

**Seed helpers (R4), in `tests/fee-seed.ts`:**
*   `seedMasters()` combines today's fee-structure `beforeEach` body with `masters()`. It returns `{ catId, course, reg, i1, i2 }`. `tests/fee-structure.test.ts` switches to it.
*   `seedFeePlan()` calls `seedMasters()`, then creates a DCA/METRO 2026-27 class plan with fixed lines: two fee types × two instalments. It publishes the plan as `tok-feeS` after `setStepUp`, and returns `{ planId, lines, total }`.

The test admits a learner at centre A for DCA 2026-27 as `tok-stuA`.

| ID | Goal | What it does |
|---|---|---|
| T-FD-001 | G1, G3 | **Create:** one due per line, in order, with exact amounts and the plan's currency. The audit row has the count and total.<br>**Refusals:** a second create; a course with no plan (`noplan`); an inactive centre; a registration set to DROP as the owner; `tok-stuA` (Forbidden); another person's registration (`PersonError` notfound); `tok-uA` (notfound).<br>**No repricing:** a newer plan does not change existing dues.<br>**`duesForPerson`:** `canCreate`, `noPlan` and totals are right; `tok-uA` sees nothing. |
| T-FD-002 | G2 | **Guard (raw SQL as gems_app):** it refuses each of these by name: another course's plan; another centre's override; another year; a wrong amount, due date or currency; a draft plan; a DROP registration; a second plan.<br>**Permission:** a viewer's insert is refused.<br>**Immutability (as owner):** update, delete and truncate are refused. Moving the admission's centre cascades, and is refused (D6).<br>**Stamps:** who and when are stamped by the database. |
| T-FD-003 | G4 | **Route:** success with `saved=1`; an error shown on the page; a foreign Origin returns 403; another person's registration returns 404; a non-UUID person returns 404. |

**Existing tests:** T-RLS-002 covers `fee_due` automatically. T-AUD-009 gains the `dues.ts` scan and `fee.dues.create`.

**Smoke:**
*   The learner page renders the "Fees" row for a viewer.
*   A dues post from a foreign origin returns 403.

## Decisions

All of these are the recommended options.

1.  **DD-1:** There is one due per registration, fee type and instalment, copied from the resolved published plan. A due is never repriced.
2.  **DD-2:** A `fee.dues` holder at the centre creates the dues explicitly, once per registration. Admission never depends on a plan.
3.  **DD-3:** A due is immutable and holds only the gross amount. Concessions, holds, adjustments and allocations are separate append-only rows that reference `fee_due.id`, and outstanding is computed from them (D4, Z6). Re-issuing dues would need a generation column.
4.  **DD-4:** The currency is copied from the plan. A centre's own currency arrives with D-CUR-1.
5.  **DD-5 (PMC):** Anyone holding `student.view` at the centre sees the dues. A separate `fee.view` permission can come later (D10).
6.  **DD-6:** Out of scope: ad-hoc dues, carry-forward, schemes, fines, bulk creation and import.
7.  **DD-7:** Plan dues and ad-hoc dues will share one table (Z2, D3, Z8-2), so allocations reference a single table. F3 will make these changes, each a cheap ALTER:
    *   add `source text not null default 'PLAN'`, with a check;
    *   make `plan_id` and `caption_id` nullable (the composite FK then matches PLAN rows only, under MATCH SIMPLE);
    *   open ADHOC in the guard.

## Alternatives Considered

*   **Create dues inside `admit()`.** Rejected; see DD-2.
*   **Compute dues on the fly.** Rejected. Allocations need rows to reference, and a newer plan would change what is owed.
*   **A separate table for ad-hoc dues.** Rejected; see DD-7.

## Risks and Limits

*   **Plan published after admission.** The registration needs "Create dues" later. The page says so.
*   **Registration leaves ACTIVE.** It keeps its dues. Crediting them is F4's job.
*   **Plan version choice.** Choosing the current version happens only in the app. The database proves only that the chosen plan is valid for the registration.
