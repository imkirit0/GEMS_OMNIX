# Fee holds (Stage 4, F4b; WF4; R-067, D-FEE-5)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-6 are recommended options under the owner's standing instruction (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs: [`input-brief.md`](input-brief.md); `docs/audit/revisions/v1.6-fee-dues-model.md`; `docs/designs/fee-receipts/fee-receipts.md`; `docs/designs/adhoc-fees/adhoc-fees.md`.

--------------------------------------------------------------------------------

## Overview

A centre puts one plan due **on hold**, with a reason, and later **releases** it. A held due is still owed, and the learner page marks it "on hold". Collection skips it, and the database refuses any receipt line against it. Every hold and release is an append-only event. The current state is the latest event.

## Goals

*   **G1: hold and release.** A holder of `fee.hold` and `student.view` at the due's centre can hold an unheld PLAN due, or release a held one. The centre must be active, and a reason is required. Both actions are audited [T-FH-001].
*   **G2: a held due is not collected.** `collectFee` skips held dues in the "nothing" and "over" checks and in the oldest-first allocation. Other dues are still collected. If the only dues left are held, the result is `fee.receipt.nothing` [T-FH-001].
*   **G3: the database proves it** [T-FH-002]:
    *   an event alternates: HOLD needs the due unheld, and RELEASE needs it held;
    *   only PLAN dues can be held;
    *   a reason is required;
    *   who and when are stamped;
    *   the event runs under the `fee-dues:` lock;
    *   events never change;
    *   **the allocation guard refuses a held due** (`receipt_hold_guard`);
    *   RLS: `student.view` reads, `fee.hold` writes.
*   **G4: the hold list (R-067).** It lists a centre's dues currently on hold: learner, course, fee type, instalment, amount owed, held since, by whom and reason. It can be filtered by fee type. A history view lists events (All, Hold or Release) for a date range [T-FH-003, smoke].

## Non-Goals (DD-5)

*   Reminders, which will skip held dues when they are built.
*   Bulk holds.
*   Holds on ad-hoc dues: these are paid in the same transaction as their receipt.
*   Holds that expire on their own.

## Technical Plan

### Migration `0031_fee_holds`

**`app.fee_hold_event`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | |
| `due_id` | bigint | FK → `fee_due` |
| `centre_id` | int | |
| `action` | text | `HOLD` or `RELEASE` (check) |
| `reason` | text | trimmed (btrim), 1–500 characters (check) |
| `created_at` | timestamptz | |
| `created_by` | uuid | FK → `app_user` |

*   Every column is NOT NULL.
*   An index on `(due_id, id)`.
*   The composite FK `(due_id, centre_id)` → `fee_due(id, centre_id)` needs a new unique key `fee_due_id_centre_id_key`.

**View `app.fee_due_hold`** (`security_invoker`). It returns one row per due with its latest event: `due_id`, `held` (`action = 'HOLD'`), `since`, `by`, `reason`. It is written as `select distinct on (due_id) … order by due_id, id desc`.

**Guard `fee_hold_guard`** (BEFORE INSERT; invoker; rules only; nested ifs; each message carries its constraint name):
1.  Takes the `fee-dues:` lock on the due's registration.
2.  Stamps `created_at` and `created_by`.
3.  Checks that the due exists (visible), is PLAN, and belongs to `new.centre_id`. Otherwise it raises `fee_hold_guard`.
4.  Reads the current state from the latest event. If HOLD is requested on a held due, or RELEASE on an unheld one, it raises `fee_hold_state_guard`.

**Immutability.** The `ticket_immutable` triggers make events immutable.

**`receipt_allocation_guard`** (create or replace) gains one step after the due is read: if the due is held (latest event is HOLD), it raises `receipt_hold_guard`. The step runs under the lock that the guard already takes.

**RLS.**

| Action | Policy |
|---|---|
| select | `scoped_centre_ids('student.view')` |
| insert | `scoped_centre_ids('fee.hold')` |
| update, delete | `false` |

**Grants.**
*   `select`, and `insert (due_id, centre_id, action, reason)`.
*   Sequence usage.
*   `select` on the view.

**Permission.** `('fee.hold', 'Hold and release a learner''s fee dues', false)`, plus `system_admin`.

### Server (`src/server/holds.ts`)

```ts
export async function setHold(session, dueId: string, hold: boolean, reason: string): Promise<void>   // audit fee.hold / fee.release
export function heldDues(session, centreId, feeTypeId?): Promise<HeldRow[]>
export function holdHistory(session, centreId, from, to, kind: "ALL" | "HOLD" | "RELEASE"): Promise<HoldEventRow[]>
```

*   **`setHold`.** The id must match `^\d{1,18}$`. The reason is trimmed and must be 1–500 characters.
    *   The pre-flight reads the due's centre under `student.view`. If not found, it throws notfound.
    *   It then runs `scopedAction(fee.hold)`, which:
        1.  authorizes `student.view`;
        2.  applies the trading gate;
        3.  takes the lock;
        4.  inserts the event.
    *   It makes two literal calls, one per action, so the audit catalogue sees both names.
    *   Errors map as follows: `fee_hold_state_guard` → `fee.hold.state` ("This due is already on hold" / "not on hold"); others → mismatch; 42501 → Forbidden.
*   **`heldDues`** authorizes `student.view` at the centre and filters on `fee_due_hold.held`.
*   **`holdHistory`** allows a range of at most 92 days.
*   **`collectFee`** joins `fee_due_hold` and filters `owed > 0 and not coalesce(h.held, false)` in the open-dues query and in the allocation window. `receiptDb` maps `receipt_hold_guard` to `fee.receipt.held` ("A due on this receipt is on hold.").
*   **`duesForPerson`** gives each due row `held`, and `canHold` = `has_permission('fee.hold', centre)`.

### Pages and routes

*   **The learner page's dues table** gains a column. For a `canHold` user it shows a Hold form (reason) on an unheld due, or a Release form on a held one. Everyone else sees "On hold" or nothing.
*   **`POST /students/[personId]/holds`.** Fields `dueId`, `action` and `reason`; returns to the learner page.
*   **`/fees/holds?centre=&feeType=&from=&to=&kind=`.** The hold list, plus a history table. A centre outside the user's scope returns 404.
*   **The home page** links "Fee holds" when the user holds `fee.hold` anywhere.

### Tests (`tests/fee-holds.test.ts`)

**Fixtures.**
*   Role 33 `fee_hold`, with `fee.hold` and `student.view`.
*   User `…00fd` at centre A, with `tok-feeH`.

| ID | Goal | What it does |
|---|---|---|
| T-FH-001 | G1, G2 | Hold the oldest due, then collect: the next due is paid and the held one is untouched. The held due stays in outstanding. Release it, and it is collected again. These are refused: holding twice; releasing an unheld due; no reason; a viewer (Forbidden); out of scope (notfound); an inactive centre; an ad-hoc due. Only held dues left gives `fee.receipt.nothing`. The audit has both actions. |
| T-FH-002 | G3 | Raw SQL as gems_app. Refused by name: an allocation against a held due; a state that does not alternate; an ADHOC due; a due at another centre. Also checked: the stamps, immutability, and RLS. |
| T-FH-003 | G4 | `heldDues`, including the fee type filter, and `holdHistory` with its kinds and range. The route, with origin and errors. |

**Changes to existing tests.**
*   T-RLS-002 adds `fee_hold_event`.
*   T-AUD-009 adds `fee.hold` and `fee.release`.
*   T-FD-001's `duesForPerson` shape adds `canHold`.

## Decisions (recommended options)

1.  **DD-1:** Holds are per PLAN due, as append-only events. The current state is the latest event.
2.  **DD-2:** A held due stays owed, but collection skips it. The database refuses to allocate to it (D-FEE-5).
3.  **DD-3:** The hold list and the history make up the R-067 report.
4.  **DD-4 (PMC):** `fee.hold` is not sensitive.
5.  **DD-5:** Out of scope: see Non-Goals.
6.  **DD-6:** Releasing a hold needs a reason too, and is audited as `fee.release`.

## Risks and Limits

*   Reminders do not exist yet. When they are built, they must read `fee_due_hold`.
