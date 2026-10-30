# Receipt cancellation, same day (Stage 4, F4a; WF4): input brief for `egm-draft`

This brief was prepared on 2026-10-30, at the owner's instruction "DO THE NEXT STEP" (2026-10-30), following F3 receipts (E-052). Evidence classes used: SRC, PRO, PMC.

## 1. What it is (SRC, PRO)

- **R-065 Fee Cancel** (SPEC p. 49): a receipt is cancelled, its dues are restored, and its number is kept and marked cancelled. This follows NP-4: numbers are never reused.
- **D-FIN-3** (approved, E-049): a centre admin with step-up may cancel on the receipt's own day. Later cancellations need a ticket.
- **Audit 07 F6:** a cancellation is a status change, a reversing journal, and reversed allocations, all in one transaction, with the links kept.
- **F3 design D11:** the rules for F4 are already fixed:
  - the only update allowed is `status` going from ACTIVE to CANCELLED, never back;
  - every other column stays unchanged, checked with a `to_jsonb` diff;
  - the update takes the `fee-dues:` lock;
  - the grant is `update(status)` only;
  - receipt lines stay immutable for good.

## 2. What exists

- **Receipts:** `receipt` has a `status` column defaulting to ACTIVE. `fee_due_balance` counts only ACTIVE receipts, so a cancelled receipt restores outstanding without touching any line. Receipts and their lines are immutable today, through `ticket_immutable` triggers and update policies that are `using (false)`.
- **Ledger:** none yet (F1). No reversing journal can be written, so cancellation is part of the ledger's go-live condition (F3 DD-5).
- **Step-up:** `requireFreshStepUp` in `rbac.ts`. Sensitive permissions keep TOTP mandatory (0013).

## 3. Decisions taken under the owner's instruction (recommended options)

- **DD-1: same day only.** A receipt may be cancelled only on its own `received_on` date (IST). Later cancellations are refused for now, with the message "after the receipt's day, ask for a cancellation ticket". The ticket path is its own piece.
- **DD-2: permission.** The new permission `fee.receipt.cancel` is sensitive and scoped to the centre. Using it needs step-up.
- **DD-3: cancellation details.**
  - A reason is required.
  - The database stamps `cancelled_at` and `cancelled_by`.
  - The cancelled receipt stays visible and printable, marked CANCELLED.
  - Its number is never reused.
- **DD-4: bounced cheques.** A bounced cheque is cancelled the same way. A later-day bounce waits for the ticket path.
- **DD-5: out of scope.** Ticket cancellation (after the day), multiple revert, holds, post-dated cheques, and ledger reversal (F1).
