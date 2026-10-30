# Ad-hoc fees collected with the receipt (Stage 4, F3b; WF4; D-FEE-1, R-061 part)

*   **Author:** gtm
*   **Status:** Proposed, revised after EGM steps 5–7, which ran in parallel ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)). Every finding is resolved below. DD-1…DD-8 are the recommended options under the owner's standing instruction (2026-10-29) and "DO THE NEXT STEP" (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs:
*   [`input-brief.md`](input-brief.md);
*   dues: `docs/designs/fee-dues/fee-dues.md` (DD-7);
*   receipts: `docs/designs/fee-receipts/fee-receipts.md`;
*   cancellation: `docs/designs/receipt-cancel/receipt-cancel.md`.

--------------------------------------------------------------------------------

## Overview

A collector can add up to 3 ad-hoc items to a receipt, for example an exam fee or a kit. Each item has a fee type and an amount that includes GST. In the same transaction, the database creates one ADHOC due per item, dated today, and the receipt pays each in full. The rest of the receipt's amount goes to the PLAN dues, oldest first, as before.

**What a learner owes.** This is defined once, as `fee_due_balance.owed`. It counts PLAN dues only.

**Void ADHOC dues.** If the receipt is cancelled, its ADHOC dues become void history. The database refuses any later payment against them.

## Goals

*   **G1: collect extras on a receipt** [T-AF-001]. `collectFee` takes up to 3 extras `{ feeTypeId, amount }` beside the plan amount. The plan amount may be 0 when extras are present.
    *   Each extra becomes one ADHOC due, paid in full by the receipt, with GST stamped from its fee type as for any line.
    *   The receipt total is the plan amount plus the extras.
    *   The audit records each extra's fee type and amount.
    *   A fully paid learner, or one with no dues yet, can still pay extras from the learner page (D6, C2).
*   **G2: the database proves every ADHOC due** [T-AF-002]. An ADHOC due:
    *   has no plan and no instalment;
    *   has an existing, active fee type (with a foreign key, C3) that is **not** on the registration's PLAN dues (D4);
    *   is dated today (IST), in INR, for more than 0;
    *   belongs to a registration at its centre;
    *   is fully paid at commit by lines of ACTIVE receipts made in the same transaction;
    *   is allocated only in the transaction that created it (Z3, D2);
    *   may be created only under `fee.collect`.

    The PLAN rules are unchanged.
*   **G3: what is owed** [T-AF-001, T-AF-003].
    *   `owed` counts PLAN dues only. Collection, the learner's outstanding, Create dues and `canCreate` use PLAN only (Z1, Z2, D1, C1).
    *   A cancelled receipt's ADHOC dues are not owed.
    *   The receipt page lists ad-hoc lines with the instalment "Ad-hoc".

## Non-Goals (DD-5)

*   Bulk misc assignment ahead of time (R-061). If those dues are owed, R-061 changes `owed` alone.
*   A misc price master (R-058) and a misc fee-type flag (DD-3, PMC).
*   Ad-hoc dues without a receipt.
*   Concessions on ADHOC dues (F5): the cashier enters the net amount (Z4).
*   Changing replay: a resubmit with other extras still returns the recorded receipt (F3 DD-9; D8).

## Technical Plan

### Migration `0029_adhoc_fees` (fee-dues DD-7's ALTERs)

**Columns and constraints.**
*   `fee_due` gains `source text not null default 'PLAN'`.
*   `plan_id` and `caption_id` drop NOT NULL.
*   Check `fee_due_source_check`: `source in ('PLAN', 'ADHOC') and ((source = 'PLAN') = (plan_id is not null and caption_id is not null)) and (source = 'PLAN' or plan_id is null and caption_id is null)`.
*   New FK `fee_due_fee_type_id_fkey`: `fee_type_id` references `fee_type(id)`, on delete restrict and on update restrict (C3).
*   The composite FK to `fee_plan_line` is MATCH SIMPLE. It binds PLAN rows only, because any null column skips it.
*   The unique key `(registration_id, fee_type_id, caption_id)` treats NULL captions as distinct.

**`schema.prisma` changes.**
*   `planId Int?`, `captionId Int?`, `line FeePlanLine?` (still `onDelete: Restrict`).
*   `source String @default("PLAN")`.
*   `feeType FeeType @relation(...)`, plus `FeeType.dues FeeDue[]`.
*   Update the comment above `FeeDue`.

**Guard `fee_due_guard`** (`create or replace`). It keeps the lock and the stamps, then branches on `source` (C4):
*   **PLAN:** every check from the registration lookup to the one-plan check in 0026, unchanged. The one-plan check `d.plan_id <> new.plan_id` already ignores ADHOC rows, because a null comparison is unknown.
*   **ADHOC:** replaces all of the PLAN checks. Each step refuses by name:
    1.  The registration exists at `new.centre_id`. Any status is allowed. Otherwise `fee_due_adhoc_guard`.
    2.  The fee type is active. Otherwise `fee_due_adhoc_guard`.
    3.  `due_on` is today (IST), `currency = 'INR'` and `gross > 0`. Otherwise `fee_due_adhoc_guard`.
    4.  If any `fee_due` of this registration with `source = 'PLAN'` has `fee_type_id = new.fee_type_id`, refuse with `fee_due_adhoc_plan_guard`. A plan fee is collected against its due, never as ad-hoc (D4).

**Constraint trigger `fee_due_adhoc_paid`.** It runs `after insert on fee_due`, `deferrable initially deferred`, `when (new.source = 'ADHOC')`. At commit, the sum of allocations on ACTIVE receipts for this due must equal `gross`. Otherwise it refuses with `fee_due_adhoc_paid_guard`.

**`receipt_allocation_guard`** (`create or replace`) gains one step after the due is read: for an ADHOC due, if the due's `created_at is distinct from now()`, refuse with `receipt_allocation_guard`. An ADHOC due is allocated only in the transaction that created it, so a void one can never be paid later (Z3, D2).

**View `fee_due_balance`** (`create or replace`) adds a column at the end:

```sql
case when d.source = 'PLAN' then outstanding else 0 end as owed
```

`outstanding` keeps meaning "still allocatable", and is used by the guard only. **Owed** is what readers use (Z1, D3).

**RLS.** `fee_due_insert` becomes:

```sql
with check ((source = 'PLAN' and centre_id = any ((select app.scoped_centre_ids('fee.dues'))::int[]))
  or (source = 'ADHOC' and centre_id = any ((select app.scoped_centre_ids('fee.collect'))::int[])))
```

**Grant.** The insert grant on `fee_due` adds `source`.

### Server

**`dues.ts`** (Z2, D1, C1, C5):
*   `createDuesTx`'s "has dues" count adds `and source = 'PLAN'`.
*   `duesForPerson`:
    *   `canCreate` uses `not exists (… and d.source = 'PLAN')`.
    *   The dues list uses `where … and d.source = 'PLAN'`.
    *   The totals query uses `sum(b.owed)` and `d.source = 'PLAN'`.
    *   `canCollect` is gate, permission and centre ACTIVE, with no `owing` condition (D6).
    *   A new `owing` field (`sum(owed) > 0`) drives the plan-amount field.

**`receipts.ts`.** `MAX_EXTRAS = 3` (Z6). `CollectInput` gains `extras?: { feeTypeId: number; amount: string }[]`.

*   **Validation**, in order, after `mode`:

    | Rule | Message |
    |---|---|
    | Not an array, or more than 3 items | `"extras: at most 3"` |
    | Each `feeTypeId` must be a positive integer | `"extras: fee type"` |
    | Each `amount` must match `^\d{1,7}(\.\d{1,2})?$` and be > 0 | `"extras: amount from 0.01, up to 99,99,999.99"` (the cap also prevents overflow, D7) |
    | No fee type twice | `"extras: one line per fee type"` |

    The plan `amount` may be `"0"` only when there are extras. Otherwise the current rule applies.
*   **Inside the action**, after the replay check and the trading gate:
    1.  Read the PLAN open dues (`owed > 0`).
        *   A plan amount above 0 with none open: `fee.receipt.nothing`.
        *   Above `Σ owed`: `fee.receipt.over`.
    2.  The currency is the PLAN dues' currency, or `'INR'` when there are none. If there are extras and the currency is not INR: `"extras: INR only"` (C6).
    3.  The total is `${amount}::numeric + Σ extras`, computed in SQL.
    4.  Insert the receipt.
    5.  For each extra, in input order, run two **separate statements** (C7):
        1.  insert its ADHOC due, `returning id`;
        2.  insert its full allocation.
    6.  Allocate the plan amount, oldest first, over PLAN dues with `owed > 0`.
*   **Audit detail** adds `extras: [{ feeTypeId, amount }]`.
*   **`receiptDb`** maps:

    | Database refusal | Becomes |
    |---|---|
    | `fee_due_adhoc_plan_guard` | `fee.receipt.adhocplan` |
    | `fee_due_adhoc_guard` | `fee.receipt.adhoc` |
    | `fee_due_adhoc_paid_guard` | `fee.receipt.mismatch` (generic) |
    | 22003 | `fee.receipt.mismatch` (D10) |
*   **`getReceipt`**: `left join app.fee_caption k`, with `coalesce(k.name, 'Ad-hoc')`. Each line adds `adhoc: d.source = 'ADHOC'` (C5, D9).

**`ADMIN_MESSAGES`:**

| Key | Message |
|---|---|
| `fee.receipt.adhoc` | "An ad-hoc item was refused (inactive fee type or not in INR)." |
| `fee.receipt.adhocplan` | "That fee type is on the learner's fee plan; collect it against the dues." |

### Pages and route

*   **Learner page.**
    *   The Fees row shows when there are dues, when `canCreate` is true, or when `canCollect` is true.
    *   The Collect form shows when `canCollect` is true. Its plan `amount` field, labelled "Amount towards dues (includes GST)", is prefilled with the owed amount. When the learner owes nothing it is prefilled with 0 and noted "nothing owed".
    *   There are 3 extra rows. Each has `extraFeeType`, a select with an empty `<option value="">` and the active fee types (`listFeeTypes`, filtered), and `extraAmount`, labelled "(includes GST)" (C8, D5).
    *   `AdminErrors` labels add `extras: "Ad-hoc items"`.
*   **Route.** It reads `data.getAll("extraFeeType")` and `data.getAll("extraAmount")`, paired by position, and drops pairs that are empty on both sides. A half-filled pair gives `"extras: fee type"` or the extras amount message.

### Tests (`tests/adhoc-fees.test.ts`)

| ID | Goal | What it does |
|---|---|---|
| T-AF-001 | G1, G3 | **Collection:** a plan amount plus 2 extras gives ADHOC dues dated today, fully paid, with GST from their types; the total and the audit are checked. A receipt of extras only (plan 0): first for a learner **with no dues yet**, after which Create dues **succeeds** (C1/D1), and again for a fully paid learner, with `canCollect` true. **Refusals:** 4 extras; a duplicate type; an inactive type; a type on the plan (`adhocplan`); an extras amount of 0 or 8 digits; a plan amount of 0 without extras; extras on a non-INR plan. **Cancellation:** owed and outstanding are unchanged by ADHOC dues; after a cancel, the ADHOC dues are not owed and a new collection does not touch them. **Receipt view:** `getReceipt` shows the ad-hoc lines with "Ad-hoc". |
| T-AF-002 | G2 | Raw SQL as gems_app. **Refused by name:** an ADHOC due not fully paid at commit; an ADHOC due with a plan, with another date, an inactive type, a plan type, or USD; a later transaction's receipt paying a void ADHOC due (Z3/D2). **Rules:** ADHOC needs `fee.collect` and PLAN still needs `fee.dues`; `fee_due_source_check` holds; the fee-type FK holds. T-FD-002 still passes unchanged. |
| T-AF-003 | G3 | **Route:** extras posted as repeated fields; a half-filled pair is refused with `detail=extras`; success lands on the receipt. |

T-FD-001 adds `owing` to its expected `duesForPerson` shape. T-FR-004 is unchanged, except that `canCollect` no longer needs owed. The smoke check is unchanged.

## Decisions (recommended options)

1.  **DD-1:** Up to 3 ad-hoc items per receipt, each a fee type and an amount that includes GST. Each due is created in the receipt's transaction, dated today, and paid in full (D-FEE-1).
2.  **DD-2:** Ad-hoc dues are never owed. The database proves both rules: paid in full at commit, and paid only in the transaction that created them. After a cancel they are void history.
3.  **DD-3 (PMC):** Any active fee type that is **not on the learner's plan**, at an amount the cashier enters, until Accounts decides on a misc flag or a price master.
4.  **DD-4:** The plan amount may be 0 when there are extras. The form allows this even when nothing is owed.
5.  **DD-5:** Out of scope: see Non-Goals.
6.  **DD-6:** `fee_due_balance.owed` is the single definition of "owed" (PLAN only today). `outstanding` stays what can still be allocated.
7.  **DD-7 (PMC, separation of duties):** `fee.collect` may now create ADHOC dues. Until now only `fee.dues` created dues. The owner and Accounts must sign this change. Collection stays switched off until then (F3 DD-5).
8.  **DD-8 (PMC, tax):** Ad-hoc amounts include GST, and the rate and HSN/SAC come from the fee type. Kits and other goods, mixed exempt and taxed lines, and the receipt's document type (tax invoice or bill of supply) are added to the tax advisor's check that F3 DD-5 already waits on.

## Risks and Limits

*   **Cashier-entered amounts (PMC).** The audit records every extra. Plan fee types are refused, so a plan fee cannot be charged twice.
*   **Ledger and reports.** Both use `owed` for what is owed. Void ADHOC dues keep `outstanding > 0` as history.
