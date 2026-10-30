# Fee holds (Stage 4, F4b; WF4; R-067, D-FEE-5)

*   **Author:** gtm
*   **Status:** Proposed. Revised after EGM steps 5–7, which ran in parallel; the reports are [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md) and [`critic_report.md`](critic_report.md). Every finding is resolved below. DD-1…DD-8 are recommended options taken under the owner's standing instruction (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs: [`input-brief.md`](input-brief.md), `docs/audit/revisions/v1.6-fee-dues-model.md`, `docs/designs/fee-receipts/fee-receipts.md`, `docs/designs/adhoc-fees/adhoc-fees.md` and `docs/designs/fee-ledger/fee-ledger.md`.

--------------------------------------------------------------------------------

## Overview

A centre can put one plan due **on hold** with a reason, and later **release** it. Each hold or release is stored as an append-only event, and the current state is the latest event, ordered by an id assigned under the lock.

A held due is still **owed**, but it is not **collectable**. Both figures are defined once, in `fee_due_balance`, which now also carries `held` and `collectable`. Collection reads `collectable`. The database refuses any receipt line against a held due.

## Goals

*   **G1: hold and release.** A holder of `fee.hold` and `student.view` at the due's centre can hold an unheld PLAN due, or release a held one, while the centre is active. A reason is required.
    *   Holding needs something owed (D5). Releasing is always allowed.
    *   Both actions are audited with `{ dueId, registrationId, owed }`.
    *   The URL's person must own the due (C8). [T-FH-001]
*   **G2: collection skips held dues.** `collectFee` uses `collectable` throughout. When the amount exceeds what is collectable only because dues are held, or when only held dues are left, the refusal is `fee.receipt.held`: "Some dues are on hold; only {collectable} can be collected." The learner page shows Outstanding and, beside it, "Collectable now". The collect form defaults to the collectable amount (C1, D4, Z6). [T-FH-001]
*   **G3: the database proves holds.** [T-FH-002]
    *   An event alternates: HOLD needs the due unheld and owed above 0; RELEASE needs it held.
    *   Only PLAN dues of the event's centre can be held.
    *   A reason is required, and who and when are stamped.
    *   The event runs under the `fee-dues:` lock, and its id is assigned under that lock (D1).
    *   Events never change.
    *   The allocation guard refuses a held due (`receipt_hold_guard`).
    *   RLS: `student.view` reads, `fee.hold` writes.
*   **G4: the hold list (R-067).** It lists a centre's dues currently on hold: learner, course, academic year, fee type, instalment, owed, held since, by whom and reason. It filters by fee type, course and academic year (Z3). The history lists events (All, Hold or Release) for an IST date range of at most 92 days, both ends included. [T-FH-003, smoke]

## Non-Goals (DD-5)

*   Reminders. When they are built, they read `fee_due_balance.held` and `collectable`.
*   Bulk holds, and "hold every open due of this registration".
*   Holds on ad-hoc dues.
*   Holds that expire on their own.
*   **Legacy import (paused).** The mapping is recorded now for the ETL piece (Z2): each legacy hold flag becomes one HOLD event per open PLAN due of that learner and fee type, with reason "Imported from legacy (YYYY-MM-DD)" and the migration actor.

## Technical Plan

### Migration `0031_fee_holds`

**`app.fee_hold_event`.** Every column is NOT NULL.

| Column | Type | Rule |
|---|---|---|
| `id` | bigserial | Re-assigned by the guard under the lock (D1). |
| `due_id` | bigint | Plain FK to `fee_due`; the centre is checked in the guard (Z4). |
| `centre_id` | int | |
| `action` | text | `HOLD` or `RELEASE`. |
| `reason` | text | Trimmed, 1–500 characters. |
| `created_at` | timestamptz | |
| `created_by` | uuid | FK to `app_user`. |

Index `(due_id, id)`. Named checks on `action` and `reason`.

**Guard `fee_hold_guard`** (BEFORE INSERT; invoker; rules only; nested ifs; every message carries `constraint "<name>"`). In order:
1.  Read the due: `registration_id`, `centre_id`, `source`. If it is not found, raise `fee_hold_guard`, before any lock (`hashtext(null)` would take none, D3).
2.  Take `pg_advisory_xact_lock(hashtext('fee-dues:' || registration_id))`.
3.  Set `new.id := nextval('app.fee_hold_event_id_seq')`, so ids follow lock order (D1). Stamp `created_at` and `created_by`.
4.  If the due's centre differs from `new.centre_id`, or its `source` is not `'PLAN'`, raise `fee_hold_guard`.
5.  Read the state: `select action from app.fee_hold_event where due_id = … order by id desc limit 1` (D7).
    *   HOLD on a held due, or RELEASE on an unheld one: raise `fee_hold_state_guard`.
    *   HOLD with `owed = 0` (from `fee_due_balance`): raise `fee_hold_paid_guard` (D5).

**Immutability (D8).** `fee_hold_event_no_update_delete` (row) and `fee_hold_event_no_truncate` (statement) execute `app.ticket_immutable()`.

**`fee_due_balance`** (`create or replace`, keeping `security_invoker`) adds two columns at the end (D2, Z1). The `owed` expression is written out each time.
*   `held`: `coalesce((select e.action = 'HOLD' from app.fee_hold_event e where e.due_id = d.id order by e.id desc limit 1), false)`.
*   `collectable`: `case when <held> then 0 else <owed> end`, cast to `numeric(14,2)`.

**`receipt_allocation_guard`** (`create or replace`, from 0029) adds one step after the due is read, under the lock the guard already holds. If the due's latest event is HOLD, it raises `receipt_hold_guard`.

The event is read as invoker. A hidden event would read as "not held". That cannot happen, because the `receipt` select policy and the `fee_hold_event` select policy are both `student.view` at the same centre: a user who cannot see the event cannot see the receipt either. The guard records this dependency in a comment (D6).

**RLS on `fee_hold_event`:**

| Action | Policy |
|---|---|
| select | `scoped_centre_ids('student.view')` |
| insert | `scoped_centre_ids('fee.hold')` |
| update, delete | `false` |

**Grants:** `select` and `insert (due_id, centre_id, action, reason)`, plus usage on the sequence.

**Permission:** `('fee.hold', 'Hold and release a learner''s fee dues', false)`, with `system_admin`.

**`schema.prisma` (C3):** model `FeeHoldEvent` with relations to `FeeDue`, `Centre` and `AppUser` (Restrict), plus back-relations. There is no new unique key on `fee_due`.

### Server (`src/server/holds.ts`)

```ts
export async function setHold(session, personId: string, dueId: string, hold: boolean, reason: string): Promise<void>
export function heldDues(session, centreId: number, f: { feeTypeId?: number; courseCode?: string; academicYear?: string }): Promise<HeldRow[]>
export function holdHistory(session, centreId: number, from: string, to: string, kind: "ALL" | "HOLD" | "RELEASE"): Promise<HoldEventRow[]>
```

**`setHold`** runs in this order:
1.  **Check the inputs.** The person must be a UUID and the due id must match `^\d{1,18}$`; otherwise `PersonError("notfound")`. The reason is trimmed: an empty one gives `"reason: required"`, one longer than 500 characters gives `"reason: 1-500 characters"`.
2.  **Pre-flight (C8).** Read the due's `centre_id` and `registration_id` through registration → admission, for this person, under `student.view` scope. If nothing is found, `PersonError("notfound")`.
3.  **Act.** Run `scopedAction({ action: hold ? "fee.hold" : "fee.release", permission: "fee.hold", centreId, targetType: "fee_due", targetId: dueId, reason })`. The action names are two literal calls. Inside the callback:
    1.  authorize `student.view`;
    2.  the **trading gate**, meaning the centre is ACTIVE (`"centreId: centre is not active"`);
    3.  take the lock;
    4.  read `owed` for the audit;
    5.  insert the event.

    Holds are not tied to `FEE_GATES`, because no money moves (D9).
4.  **Map errors.**

    | Database error | Result |
    |---|---|
    | `fee_hold_state_guard` | `fee.hold.state` ("This due is already on hold, or is not on hold.") |
    | `fee_hold_paid_guard` | `fee.hold.paid` ("Nothing is owed on this due.") |
    | `fee_hold_guard` or any other 23514 | `fee.hold.mismatch` |
    | 42501 | `Forbidden` |

5.  **Audit:** `{ after: { dueId, registrationId, owed, action } }`, with the reason stored in the audit row's reason column.

**`heldDues`.** Authorizes `student.view` at the centre and returns dues with `held` from `fee_due_balance`. **`holdHistory`.** Checks the dates as ISO, `from ≤ to`, and `to − from ≤ 91`.

**`collectFee`:**
*   The open-dues query and the allocation window use `b.collectable > 0`, and the window sums `collectable`.
*   The refusals compare against both totals: `${amount} > Σ collectable` while `${amount} ≤ Σ owed` gives `fee.receipt.held`; above `Σ owed` gives `fee.receipt.over`; no collectable but some owed gives `fee.receipt.held`.
*   `receiptDb` maps `receipt_hold_guard` to `fee.receipt.held`. That branch goes beside `receipt_over_guard`, before the generic 23514 branch (C7, D9).

**`duesForPerson`.** Each `DueRow` gains `held`. `RegistrationDues` gains `collectable` (`sum(collectable)::text`) and `canHold` (centre ACTIVE and `has_permission('fee.hold', centre)`) (C4).

### Pages and routes

*   **The learner page's dues table** gains a column. A `canHold` user sees a Hold form (reason) on an unheld due with something owed, or a Release form on a held due. Everyone else sees "On hold" or nothing. Beside Outstanding the page shows "Collectable now", and the collect form defaults to it.
*   **`POST /students/[personId]/holds`.** Fields: `dueId`, `action` (`hold` or `release`) and `reason`. Uses `safeRoute`, a person UUID check and `adminPost`, then returns to the learner page.
*   **`/fees/holds?centre=&feeType=&course=&year=&from=&to=&kind=`.** The hold list plus the history. A centre outside scope gives 404.
*   **Home page.** Links "Fee holds" when the user holds `fee.hold` at any centre (`holdCentres`).

### Tests (`tests/fee-holds.test.ts`)

**Fixtures:**
*   role 33 `fee_hold` (`fee.hold`, `student.view`);
*   user `…00fd` at centre A with `tok-feeH`;
*   the permission row and the truncate list.

| ID | Goal | What it does |
|---|---|---|
| T-FH-001 | G1, G2 | **Hold and collect:** hold the oldest due, then collect. The next due is paid; the held due is untouched but still in outstanding, and collectable is lower. **Refusals:** the full outstanding gives `fee.receipt.held`; only held dues left gives `held`; release, then the due is collected. **Hold refusals:** twice, unheld release, no reason, nothing owed, a viewer (Forbidden), out of scope, another person's due (notfound), an inactive centre, an ad-hoc due. **Audit:** both actions, with the payload. |
| T-FH-002 | G3 | **As gems_app with raw SQL**, refused by name: an allocation against a held due; non-alternating events; ADHOC; another centre; a due paid in full. **Race:** two sessions, HOLD asked first and RELEASE second, with the RELEASE granted the lock first. The ids follow lock order, so the latest state is right (D1). **Also:** stamps, immutability (owner), RLS. |
| T-FH-003 | G4 | `heldDues` with each filter; `holdHistory` with kinds and the range limit. The route: origin, success, errors, and 404 for another person. |

**Existing tests that change:**
*   T-RLS-002 adds `fee_hold_event`.
*   T-AUD-009 adds `fee.hold` and `fee.release`, in `tests/audit-catalogue.ts` under "fee holds (src/server/holds.ts)" (C9).
*   T-FD-001's `duesForPerson` shape gains `collectable` and `canHold`.
*   The matrix maps R-067 to T-FH-001…003 (Z7).

**Smoke checks:** the hold list is 404 without `student.view` at a centre. A hold post from a foreign origin is refused.

## Decisions (recommended options)

1.  **DD-1:** Holds are per PLAN due, recorded as append-only events. The latest event, by an id assigned under the lock, is the state.
2.  **DD-2:** A held due stays owed but is not collectable. `fee_due_balance` defines `held` and `collectable` once. The database refuses allocation to a held due (D-FEE-5).
3.  **DD-3:** The hold list and history form the R-067 report, with the SPEC's filters.
4.  **DD-4 (PMC):** `fee.hold` is not sensitive.
5.  **DD-5:** Out of scope; see Non-Goals. The legacy import mapping is recorded.
6.  **DD-6:** A release needs a reason as well, and is audited as `fee.release`.
7.  **DD-7:** HOLD needs something owed. RELEASE is always allowed.
8.  **DD-8:** Holds are not tied to the collection gate, because no money moves.

## Risks and Limits

*   The hold check relies on matching RLS between `receipt` and `fee_hold_event` (D6). Any later change to either select policy must keep them aligned.

## Revision after EGM steps 8 and 9 (approved)

This revision resolves [`zoom_out_step8_report.md`](zoom_out_step8_report.md) and [`readiness_report.md`](readiness_report.md), and supersedes the text above wherever they differ. The build is approved as the recommended option under the owner's standing instruction; this is not an owner signature.

1.  **One definition of "held" (Z8-1, Z8-2).**
    *   `fee_due_balance` computes `held` once, through `left join lateral (select action from app.fee_hold_event … order by id desc limit 1) h on true`, grouped by `h.action`.
    *   `owed` is computed once in an inner select, and `collectable` is derived from it.
    *   The view repeats `with (security_invoker = true)` (R6).
    *   `fee_hold_guard` (step 5) and the new step in `receipt_allocation_guard` both read `held`, `owed` and `outstanding` from `fee_due_balance`.
2.  **Collection queries (R1, R2, Z8-3).**
    *   The open-dues query keeps `where b.owed > 0` and selects four values:
        *   `n` = `count(*)`;
        *   `nc` = `count(*) filter (where b.collectable > 0)`;
        *   `over` = `${amount} > Σ owed`;
        *   `overc` = `${amount} > Σ collectable`.
    *   The checks run in this order:

        | Condition | Result |
        |---|---|
        | `!zero && n = 0` | `fee.receipt.nothing` |
        | `over` | `fee.receipt.over` |
        | `!zero && (nc = 0 or overc)` | `fee.receipt.held` |

    *   Only the allocation window uses `collectable`.
    *   A receipt carrying only ad-hoc items still works when every due is held. T-FH-001 covers this.
3.  **Messages (R3).** All are fixed text:

    | Key | Message |
    |---|---|
    | `fee.receipt.held` | "Some dues are on hold; only the amount shown as Collectable now can be collected." |
    | `fee.hold.state` | "This due is already on hold, or is not on hold." |
    | `fee.hold.paid` | "Nothing is owed on this due." |
    | `fee.hold.mismatch` | "The due did not match; nothing was saved." |

    The learner page labels add `reason: "Reason"`.
4.  **T-AUD-009 (R4).** The scan list adds `["src/server/holds.ts", /"(fee\.[a-z0-9_.]+)"/g]`.
5.  **ETL reset (R5).** `fee_hold_event` is truncated with `fee_due`. `fee_hold_event_no_truncate` is lifted before the truncate and restored after it.
6.  **Guard conventions (R7).** The guard follows 0029: `language plpgsql security invoker set search_path = pg_catalog, app`; `created_by := coalesce(app.session_user_id(), new.created_by)`; every raise uses `errcode = '23514', constraint = '<name>'`; the lock key is `'fee-dues:' || registration_id::text`.
7.  **Hold page (R8).** `holdCentres(session)` returns the centres in `scoped_centre_ids('fee.hold')` that are also in `student.view` scope. The page and the home link both use it. The page returns 404 when the list is empty or the centre is not in it, and otherwise defaults to the first centre (the Day Book pattern).
8.  **Read functions (R9).**
    *   **Row shapes.**
        *   `HeldRow`: `{ dueId, personId, learner, courseCode, academicYear, feeTypeName, captionName, owed, since, by, reason }`, ordered by `since` descending.
        *   `HoldEventRow`: `{ id, dueId, learner, feeTypeName, captionName, action, reason, at, by }`, ordered by id descending.
        *   `by` is the holder's display name, read through a join to `app_user`. If that is not readable, the user id is shown instead.
    *   **Authorization.** Both functions authorize `student.view` at the centre.
    *   **History.** It filters on the IST date of `created_at`. The defaults are today, today and ALL. It uses the Day Book's error texts.
    *   **Fee type filter.** The options come from `listFeeTypes`.
9.  **`duesForPerson` (R10).**
    *   The registrations query adds `(ce.status = 'ACTIVE' and app.has_permission('fee.hold', r.centre_id)) as "canHold"`.
    *   The dues query adds `b.held`.
    *   The totals query adds `sum(b.collectable)::text as collectable`.
    *   T-FD-001's rows gain `collectable: null, canHold: false`.
10. **`holdDb` (R11).** It reads the cause as `receiptDb` does, then maps:

    | Raised | Mapped to |
    |---|---|
    | the state guard | `fee.hold.state` |
    | the paid guard | `fee.hold.paid` |
    | any other 23514, or 23503 | `fee.hold.mismatch` |
    | 42501 | `Forbidden` |

11. **Pre-flight (R12).** `select d.centre_id, d.registration_id::text from fee_due d join registration r … join admission a … where d.id = $due and a.person_id = $person and d.centre_id = any (scoped_centre_ids('student.view'))`.
12. **Ad-hoc due (R13).** Holding an ad-hoc due fails with `fee.hold.mismatch`.
13. **Prisma and RLS (R14).**
    *   `creator AppUser @relation("feeHoldEventCreatedBy")`, with the back-relation `feeHoldEventsCreated`.
    *   T-RLS-002 lists `fee_hold_event` between `fee_due` and `fee_plan`.
    *   RLS is ENABLE + FORCE.
14. **No app-side lock (Z8-4).** The guard takes the lock on insert. `owed` for the audit is read after the insert, still inside the same transaction.
15. **Race test.** The race test follows the readiness report's two-client method.
