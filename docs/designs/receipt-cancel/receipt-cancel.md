# Receipt cancellation, same day (Stage 4, F4a; WF4; R-065)

*   **Author:** gtm
*   **Status:** Proposed, revised after EGM steps 5–7, which ran in parallel ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)). Every finding is resolved below. DD-1…DD-7 are recommended options taken under the owner's standing instruction (2026-10-29) and "DO THE NEXT STEP" (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs:
*   [`input-brief.md`](input-brief.md);
*   receipts: `docs/designs/fee-receipts/fee-receipts.md` (E-052; its D11 sets the F4 rules);
*   financial rules: audit 07 F6, as revised by v1.6.

--------------------------------------------------------------------------------

## Overview

A centre admin cancels a receipt on its own day (IST). The admin needs step-up to do so, and the database checks the step-up too. The receipt keeps its number and stays visible, marked CANCELLED, and its lines stay as they were. `fee_due_balance` counts only ACTIVE receipts, so the dues the receipt paid become outstanding again at once. A cancellation on a later day is refused, because that path needs a ticket.

## Goals

*   **G1: same-day cancel [T-RC-001].** A user may cancel an ACTIVE receipt issued today (IST) when all of the following hold:
    *   they hold `fee.receipt.cancel` and `student.view` at the receipt's centre;
    *   their step-up is fresh;
    *   collection is switched on (D10).

    A reason is required. The cancel is audited with the receipt's lines. A late attempt is audited as failed.
*   **G2: the database proves the cancel [T-RC-002].** Each of these holds in the database itself:
    *   the only transition is ACTIVE → CANCELLED;
    *   the receipt is from today (IST, the database clock);
    *   the session's step-up is fresh whenever a session is set (D2);
    *   no other column changes;
    *   who and when are stamped;
    *   a reason is present;
    *   the change runs under the registration's money lock, so a concurrent collection sees the restored outstanding only after commit;
    *   nothing else can change or remove a receipt;
    *   lines never change.
*   **G3: what users see afterwards [T-RC-001, T-RC-003].**
    *   The learner page and the receipt page show the cancellation, and the outstanding is restored.
    *   The number never comes back; the next receipt takes the next number.
    *   A collect form resubmitted after a cancel is refused: it is never shown as a payment (D1).
    *   A resubmitted cancel lands on the cancelled receipt (D6).

## Non-Goals (DD-5)

*   **Cancelling after the receipt's day (D-FIN-3).** This is its own piece, which replaces guard step 3 and adds its own column (Z6). It crosses GST return periods and the financial year, so it needs credit-note handling, not only a status change (D4).
*   **Most bounced cheques.** A dishonour is usually known days later, so bounces go mainly to the ticket piece (D9).
*   **Multiple revert, holds and post-dated cheques.**
*   **The reversing journal (F1).** What F1 needs is recorded under DD-6.

## Technical Plan

### Migration `0028_receipt_cancel`

**Columns.** `receipt` gains three columns:
*   `cancelled_at timestamptz null`;
*   `cancelled_by uuid null`, an FK to `app_user` with restrict;
*   `cancel_reason text null`.

`schema.prisma` gains `cancelledAt`, `cancelledBy` (relation `receiptCancelledBy` on `AppUser`) and `cancelReason`.

**Check `receipt_cancel_check` (C7):**

```sql
(status = 'CANCELLED') = (cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)
  and (cancel_reason is null or (cancel_reason = btrim(cancel_reason) and char_length(cancel_reason) between 1 and 500))
```

**Triggers.** `receipt_no_update_delete` is replaced by two triggers:
*   `receipt_no_delete`: `before delete … execute function app.ticket_immutable()` (C3);
*   `receipt_cancel_guard`: before update.

`receipt_no_truncate` and both of `receipt_allocation`'s triggers stay unchanged.

**Guard function `app.receipt_cancel_guard()`.** It runs with invoker rights and holds rules only. Ifs are nested and comparisons use `is distinct from`. Every raise uses errcode 23514 with `constraint "<name>"`. In order:
1.  Take `pg_advisory_xact_lock(hashtext('fee-dues:' || old.registration_id::text))`.
2.  If `old.status` is distinct from `'ACTIVE'` or `new.status` is distinct from `'CANCELLED'`, raise `receipt_cancel_status_guard` (D7).
3.  If `old.received_on` is distinct from `(now() at time zone 'Asia/Kolkata')::date`, raise `receipt_cancel_late_guard`. The ticket piece replaces this step.
4.  If `app.session_user_id() is not null and not app.session_step_up_fresh(300)`, raise `receipt_cancel_stepup_guard`. The 300 seconds is `POLICY.stepUpMaxAgeSeconds`, and T-RC-002 asserts that the two agree (D2).
5.  Stamp `new.cancelled_at := now()` and `new.cancelled_by := coalesce(app.session_user_id(), new.cancelled_by)`.
6.  Compare `to_jsonb(new) - 'status' - 'cancelled_at' - 'cancelled_by' - 'cancel_reason'` with the same expression on `old`. If they are distinct, raise `receipt_cancel_frozen_guard` (D7). Every other column is frozen, including any future column. F1 and the ticket piece will each replace this guard and name their own columns (D4).

**RLS.** `receipt_update` changes from `using (false)` to:

```sql
using (centre_id = any ((select app.scoped_centre_ids('fee.receipt.cancel'))::int[]))
with check (the same)
```

Delete stays `false`.

**Permission and grants.**
*   The permission is `('fee.receipt.cancel', 'Cancel a fee receipt on its day', true)`, granted to `system_admin`.
*   It is **sensitive** (C2). Holding it makes TOTP enrolment mandatory, because 0005 `recompute_requires_totp` recomputes `requires_totp`. Every action it allows also needs a fresh step-up.
*   Grant `update (status, cancel_reason) on app.receipt` to gems_app. This widens F3 D11's `update (status)` by the reason column (Z5). `cancelled_at` and `cancelled_by` are not granted.

### Server

**`rbac.ts`** exports `requireFreshStepUp`. `adminWrite` is not used, because its `db()` maps every 23514 to a generic "invalid value" and would hide which guard refused (Z4, C4).

**`receipts.ts`:**

```ts
export async function cancelReceipt(session, receiptId: string, reason: string): Promise<{ receiptNo: string }>  // audit fee.receipt.cancel
```

**`cancelReceipt`** runs these steps:

1.  **Gate.** If `FEE_GATES.collectionLive` is false, throw `fee.receipt.closed` (D10).
2.  **Validate the input.**
    *   The id must match `^\d{1,18}$`; otherwise throw `PersonError("notfound")`, so the route answers 404 (C5).
    *   The reason is trimmed. Empty gives `"reason: required"`; over 500 characters gives `"reason: 1-500 characters"`.
3.  **Pre-flight.** A `withScope` read takes `centre_id` from a receipt visible under `student.view`. If none is found, throw `PersonError("notfound")`.
4.  **Act.** `receiptDb(() => scopedAction({ action: "fee.receipt.cancel", permission: "fee.receipt.cancel", centreId, targetType: "receipt", targetId, reason }, …, detail, onFailure))`. `receiptDb` wraps the callback as well (Z2). The callback:
    1.  `authorize(tx, "student.view", centreId)`;
    2.  `requireFreshStepUp(tx)`;
    3.  takes the lock;
    4.  reads `status`, `receipt_no`, `total`, `registration_id` and `received_on = (now() at time zone 'Asia/Kolkata')::date as today` **in SQL** (C6, D5), plus the lines (`due_id`, `amount`) for the audit;
    5.  runs `update app.receipt set status = 'CANCELLED', cancel_reason = ${reason} where id = ${id}` and requires `$executeRaw` to report exactly 1 row, otherwise `PersonError("notfound")` (D3, Z3).

    The guard alone decides whether the status or the day is wrong (Z3). The read in step 4 serves the audit only.
5.  **Audit.**
    *   **Detail:** `{ before: { status: <read> }, after: { status: "CANCELLED", receiptNo, total, registrationId, lines: [{ dueId, amount }] } }`, with the reason in the row's `reason` column (D8).
    *   **`onFailure`:** a `fee.receipt.late` refusal records `{ action: "fee.receipt.cancel", extra: { after: { refused: "late" } } }` as FAILED (D8).
6.  **Error mapping.** `receiptDb` gains these branches:

    | Refusal | Becomes |
    |---|---|
    | `receipt_cancel_late_guard` | `fee.receipt.late` |
    | `receipt_cancel_status_guard` | `fee.receipt.cancelled` |
    | `receipt_cancel_stepup_guard` | `StepUpRequired` |
    | `receipt_cancel_frozen_guard` | `fee.receipt.mismatch` (via the generic 23514 branch) |

**`collectFee` (D1).** The replay read adds `status`. If the replayed receipt is CANCELLED, throw `RbacError("invalid", …, "fee.receipt.cancelled")`. The learner page then renders a fresh form with a new key.

**`getReceipt`** adds the following:
*   `cancelledAt`, `cancelReason` and `cancelledBy` (the user's display name);
*   `canCancel`, computed in SQL. It is true when the gate is open, the receipt is ACTIVE, `received_on = (now() at time zone 'Asia/Kolkata')::date`, and `has_permission('fee.receipt.cancel', centre)` holds.

**`duesForPerson`.** The receipts it returns add `status`.

**`ADMIN_MESSAGES`:**

| Key | Message |
|---|---|
| `fee.receipt.late` | "This receipt is not from today; ask for a cancellation ticket." |
| `fee.receipt.cancelled` | "This receipt is cancelled." |

### Pages and routes

*   **`/receipts/[id]`.**
    *   It reads `error`, `detail` and `cancelled`, and renders `AdminErrors` with `labels={{ reason: "Reason" }}`.
    *   A cancelled receipt shows the banner "CANCELLED on {date, IST} by {name}: {reason}". The existing `· CANCELLED` suffix is removed (C8).
    *   `?cancelled=1` shows "Cancelled."
    *   When `canCancel`, the page shows a Cancel form: `reason`, required, `maxLength` 500.
*   **`POST /receipts/[id]/cancel`.**
    *   It goes through `safeRoute`, then checks the id (404), then runs `adminPost`.
    *   On success it redirects to `/receipts/<id>?cancelled=1`.
    *   `fee.receipt.cancelled` is also treated as success, and redirects to the receipt (D6).
    *   A stale step-up goes to `/stepup?next=/receipts/<id>`.
*   **The learner page.** The receipt list marks a receipt "(cancelled)". When collect is refused with `fee.receipt.cancelled`, the page shows the message and a fresh form with a new key.

### Tests (`tests/receipt-cancel.test.ts`)

**Fixtures (C10).** In `reset()`:
*   the permission insert gains `('fee.receipt.cancel', …, true)`;
*   the roles gain `(31, 'fee_cancel', 'Fee cancellation')`;
*   `role_permission` gains `(31, 'fee.receipt.cancel')` and `(31, 'student.view')`;
*   user `FR = { a: "…00fb" }` gets an `app_user` row and a centre 1 assignment;
*   session `tok-feeR` is added.

**Setup.** As in the receipts tests: the gate is opened, receipts are paid by `tok-feeC`, and `setStepUp("tok-feeR", 0)` is applied.

| ID | Goal | What it does |
|---|---|---|
| T-RC-001 (T-FEE-012 part, T-NUM-008) | G1, G3 | **Cancel:** outstanding is restored; the receipt and its lines are kept; the next receipt takes the next number; the audit has before, after (with lines) and the reason. **Refused:** no reason; a second cancel; a receipt from yesterday (`received_on` moved by the owner under `session_replication_role = replica`, C9), with a FAILED audit; a stale step-up (StepUpRequired); `tok-feeC` (Forbidden, DENIED); out of scope (notfound); gate closed. **Resubmit:** a collect resubmitted with the cancelled receipt's key gives `fee.receipt.cancelled`. **Reads:** `getReceipt` `canCancel`, the cancel fields, and the status in `duesForPerson`. |
| T-RC-002 | G2 | Raw SQL as gems_app with `tok-feeR`. **Refused by name:** CANCELLED → ACTIVE (status); a change to `total` together with cancelling (frozen); an update of a past-day receipt (late); a stale step-up (step-up); `cancelled_by` or `cancelled_at` supplied (42501). **Checked:** who and when are stamped; the guard's 300 equals `POLICY.stepUpMaxAgeSeconds`; delete and truncate still refused, even as the owner; lines still immutable; a collector who cannot cancel updates 0 rows. **Concurrency:** a collect waiting on the lock sees the restored outstanding after the cancel commits. |
| T-RC-003 | G3 | The route. Same origin. Success leads to `?cancelled=1`. A resubmitted cancel lands on the receipt. Field errors and `late` come back on the receipt page. A stale step-up leads to `/stepup?next=…`. A bad id or out of scope gives 404. |

**Existing tests that change (C1, C9):**
*   In T-FR-002's "kept for good" loop, the owner's `update app.receipt` now expects `receipt_cancel_status_guard`. Delete, truncate and every `receipt_allocation` case still expect `append-only`. The 42501 case for `set total` is unchanged.
*   T-AUD-009: `fee.receipt.cancel` is added in `tests/audit-catalogue.ts`.

**Smoke.** No Cancel form while collection is switched off. A cancel post from a foreign origin is refused.

## Decisions (recommended options)

1.  **DD-1:** A receipt can be cancelled on its own day only, by the database's clock in IST. Later cancellations need the ticket piece.
2.  **DD-2:** `fee.receipt.cancel` is sensitive and centre-scoped. Holders need TOTP, and step-up is checked by both the app and the database (D-FIN-3).
3.  **DD-3:** A reason is required. The database stamps who and when. The receipt and its number are kept and marked (NP-4). This widens F3 D11's grant to include `cancel_reason`.
4.  **DD-4:** A bounced cheque discovered on the same day is cancelled the same way. Later bounces go to the ticket piece.
5.  **DD-5:** Out of scope; see Non-Goals.
6.  **DD-6:** The lines do not change. Outstanding returns through `fee_due_balance`'s ACTIVE filter, which revises audit 07 F6 "reversed allocations" (Z5). **What F1 needs (D4):**
    *   to find each cancellation that has no reversing journal yet (`status = 'CANCELLED'` with no journal link);
    *   to post it on the IST date of `cancelled_at`;
    *   to reverse each line with its GST;
    *   to add its own column and replace the guard.
7.  **DD-7:** Cancelling follows the collection switch, `FEE_GATES.collectionLive` (D10).

## Risks and Limits

*   **The ledger gate (Z1).** Collection opens only once the F1 ledger posts with the receipt, or Accounts accepts a backfill rule. **That backfill rule must cover cancellations as well**, and F3 DD-5 is amended to say so. The `cancelled_at` and `cancelled_by` stamps are enough to backfill from.
*   **Midnight.** "Today" is IST, so a receipt issued at 23:59 can be cancelled only by ticket after midnight.
