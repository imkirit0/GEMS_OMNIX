# Receipt cancellation, same day (Stage 4, F4a; WF4; R-065)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-6 are recommended options taken under the owner's standing instruction (2026-10-29) and "DO THE NEXT STEP" (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs:
*   [`input-brief.md`](input-brief.md);
*   receipts: `docs/designs/fee-receipts/fee-receipts.md` (E-052; D11 sets the F4 rules);
*   financial rules: audit 07 F6, revised by v1.6.

--------------------------------------------------------------------------------

## Overview

A centre admin with step-up can cancel a receipt on the day it was issued. The receipt keeps its number and stays visible, marked CANCELLED. Its lines stay as they were. `fee_due_balance` counts only ACTIVE receipts, so the dues the receipt paid become outstanding again at once.

A cancellation on a later day is refused. That path needs a ticket and is its own piece.

## Goals

*   **G1:** A holder of `fee.receipt.cancel` (sensitive, with fresh step-up) and `student.view` at the receipt's centre can cancel an ACTIVE receipt that was issued today (IST). A reason is required. The cancellation is audited [T-RC-001].
*   **G2:** The database proves each of the following [T-RC-002]:
    *   the only change allowed is ACTIVE → CANCELLED;
    *   the receipt was issued today;
    *   no other column changes;
    *   who and when are stamped;
    *   the reason is present;
    *   the change runs under the registration's money lock, so a concurrent collection sees the restored outstanding only after commit;
    *   no other role or command can change or remove a receipt;
    *   lines never change.
*   **G3:** The learner page and the receipt page show the cancellation. Outstanding is restored. A cancelled receipt's number never comes back, and the next receipt takes the next number [T-RC-001, T-RC-003].

## Non-Goals (DD-5)

*   Cancelling after the receipt's day, through a ticket (D-FIN-3, its own piece).
*   Multiple revert.
*   Holds and post-dated cheques.
*   The reversing journal (F1). F3 DD-5 already keeps collection switched off until the ledger posts.

## Technical Plan

### Migration `0028_receipt_cancel`

**Schema.** `receipt` gains three columns, and `schema.prisma` gains `cancelledAt`, `cancelledBy` (relation `receiptCancelledBy` to `AppUser`) and `cancelReason`:
*   `cancelled_at timestamptz null`;
*   `cancelled_by uuid null` (FK `app_user`, restrict);
*   `cancel_reason text null`.

**Check `receipt_cancel_check`.** `(status = 'CANCELLED') = (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)`, and `cancel_reason` is trimmed (`btrim`) and 1–500 characters long.

**Guard `receipt_cancel_guard` (BEFORE UPDATE).** It replaces the update half of `receipt_no_update_delete`: delete stays refused by a new `receipt_no_delete`, and truncate stays refused by the existing trigger. Like the other guards, it runs as invoker, holds rules only, uses nested ifs, and raises errcode 23514 with `constraint "<name>"`. In order:
1.  It takes the `fee-dues:` lock on `old.registration_id`.
2.  It requires `old.status = 'ACTIVE'` and `new.status = 'CANCELLED'`, else `receipt_cancel_guard`.
3.  It requires `old.received_on = (now() at time zone 'Asia/Kolkata')::date`, else `receipt_cancel_late_guard`.
4.  It stamps `new.cancelled_at := now()` and `new.cancelled_by := coalesce(app.session_user_id(), new.cancelled_by)`.
5.  It requires `(to_jsonb(new) - 'status' - 'cancelled_at' - 'cancelled_by' - 'cancel_reason') = (to_jsonb(old) - …)`, else `receipt_cancel_guard`.

**RLS.** `receipt_update` changes from `using (false)` to `using (centre_id = any (scoped_centre_ids('fee.receipt.cancel'))) with check (the same)`. Delete stays `false`. `receipt_allocation` is unchanged and stays immutable.

**Permission and grants.**
*   The permission `('fee.receipt.cancel', 'Cancel a fee receipt on its day', true)`, with a `system_admin` grant.
*   `grant update (status, cancel_reason) on app.receipt to gems_app`. `cancelled_at` and `cancelled_by` are not granted, so the guard owns them.

### Server (`receipts.ts`)

`rbac.ts` exports `requireFreshStepUp`.

```ts
export async function cancelReceipt(session, receiptId: string, reason: string): Promise<void>  // audit fee.receipt.cancel
```

**`cancelReceipt`** runs these steps:
1.  **Validate.** The id must match `^\d{1,18}$`, otherwise `RbacError("notfound")`. The reason must be 1–500 characters after trimming, otherwise `"reason: required"` or `"reason: 1-500 characters"`.
2.  **Pre-flight.** A `withScope` read gets the receipt's `centre_id` and `registration_id`, visible under `student.view`. A missing row is notfound.
3.  **Act.** `scopedAction({ action: "fee.receipt.cancel", permission: "fee.receipt.cancel", centreId, targetType: "receipt", targetId, reason })` runs inside `cancelDb`, which maps errors both inside and around the action:
    1.  `authorize(tx, "student.view", centreId)`.
    2.  `requireFreshStepUp(tx)`.
    3.  Take the `fee-dues:` lock.
    4.  Read the status and `received_on = today`:
        *   CANCELLED: `fee.receipt.cancelled`;
        *   not today: `fee.receipt.late`.
    5.  `update app.receipt set status = 'CANCELLED', cancel_reason = ${reason} where id = …`.
4.  **Audit detail.** `{ before: { status: "ACTIVE" }, after: { status: "CANCELLED", receiptNo, total } }`, with the reason in the audit row's `reason` column.
5.  **`cancelDb`.**

    | Error | Result |
    |---|---|
    | `receipt_cancel_late_guard` | `fee.receipt.late` |
    | `receipt_cancel_guard` | `fee.receipt.cancelled` |
    | any other 23514 | `fee.receipt.mismatch` |
    | 42501 | `Forbidden` |

`collectFee` needs no change. Outstanding comes from the view, and a replay of a cancelled receipt's key returns that receipt with its status.

`getReceipt` adds `cancelledAt` and `cancelReason`, plus `canCancel`. `canCancel` is true when the receipt is ACTIVE, was issued today, and `has_permission('fee.receipt.cancel', centre)` holds.

`duesForPerson` receipts gain `status`.

**`ADMIN_MESSAGES`:**

| Key | Message |
|---|---|
| `fee.receipt.late` | "This receipt is not from today; ask for a cancellation ticket." |
| `fee.receipt.cancelled` | "This receipt is already cancelled." |

The field label is `reason` "Reason".

### Pages and routes

*   **`/receipts/[id]`.**
    *   A cancelled receipt shows a "CANCELLED on … — reason" banner.
    *   When `canCancel`, the page shows a Cancel form (`reason`, with `required`).
    *   The page reads `error` and `detail`, and renders `AdminErrors`.
*   **`POST /receipts/[id]/cancel`.**
    *   It runs `safeRoute`, checks the id, then calls `adminPost`.
    *   On success it redirects to `/receipts/<id>?cancelled=1`.
    *   When step-up is needed, it goes to the step-up page through `adminPost`'s StepUpRequired branch.
*   **The learner page.** The receipt list shows "(cancelled)" next to a cancelled receipt.

### Tests (`tests/receipt-cancel.test.ts`)

**Fixtures.**
*   Role 31 `fee_cancel` holds `fee.receipt.cancel` and `student.view`.
*   User `…00fb` holds it at centre A, with token `tok-feeR`.
*   The permission row is `fee.receipt.cancel` (sensitive).

**Setup.** The receipts seed: the gate is open, receipts are paid by `tok-feeC`, and `setStepUp(tok-feeR, 0)` is called.

| ID | Goal | What it does |
|---|---|---|
| T-RC-001 (T-FEE-012 part, T-NUM-008) | G1, G3 | A cancel restores outstanding and keeps the receipt and its lines; the next receipt takes the next number. The audit records before, after and reason. These are refused: no reason; a second cancel; a receipt from yesterday (`received_on` moved by the owner with triggers off); a stale step-up (StepUpRequired); `tok-feeC` (Forbidden, audited as DENIED); out of scope (notfound). `getReceipt` returns `canCancel`, the cancel fields and the status in `duesForPerson`. |
| T-RC-002 | G2 | Raw SQL as gems_app with `tok-feeR`. Refused by name: CANCELLED → ACTIVE; a change to the total or any other column, alone or together with cancelling; an update of a past-day receipt; `cancelled_by` or `cancelled_at` supplied (42501, not granted). Also: the database stamps who and when; delete and truncate are still refused (even as the owner); lines are still immutable; the update policy (a collector who cannot cancel updates 0 rows). A concurrent collect waits on the lock, then sees the restored outstanding. |
| T-RC-003 | G3 | The route: same origin; success leads to `?cancelled=1`; field errors and `late` come back on the receipt page; a stale step-up leads to `/stepup?next=…`; a bad id gives 404. |

**Existing tests that change:**
*   T-FR-002's "update refused" case now expects a guard refusal or 0 rows, not 42501.
*   T-AUD-009 adds `fee.receipt.cancel`.

**Smoke.** The Cancel form is absent for a viewer, and a foreign-origin cancel post is refused.

## Decisions (recommended options)

1.  **DD-1:** A receipt is cancelled on its own day only. Later days need the ticket piece.
2.  **DD-2:** `fee.receipt.cancel` is sensitive and centre-scoped, with step-up (D-FIN-3).
3.  **DD-3:** A reason is required, and the database stamps who and when. The receipt and its number are kept and marked (NP-4).
4.  **DD-4:** A bounced cheque on the same day is cancelled the same way.
5.  **DD-5:** Out of scope: see Non-Goals.
6.  **DD-6:** Cancelling a receipt changes no lines. Outstanding comes back through the ACTIVE filter in `fee_due_balance` (F3 D11), so allocation is never reversed row by row. The F1 ledger will post the reversing journal from the status change.

## Risks and Limits

*   Until the F1 ledger exists, a cancellation has no reversing journal. Collection is switched off until then (F3 DD-5).
*   "Today" is in IST. A receipt issued at 23:59 can only be cancelled by ticket after midnight.
