# Ad-hoc fees collected with the receipt (Stage 4, F3b; WF4; D-FEE-1, R-061 part)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-6 are the recommended options under the owner's standing instruction (2026-10-29) and "DO THE NEXT STEP" (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs:
*   [`input-brief.md`](input-brief.md);
*   dues: `docs/designs/fee-dues/fee-dues.md` (DD-7);
*   receipts: `docs/designs/fee-receipts/fee-receipts.md`;
*   cancellation: `docs/designs/receipt-cancel/receipt-cancel.md`.

--------------------------------------------------------------------------------

## Overview

A collector can add ad-hoc items to a receipt, such as an exam fee or a kit, each with a fee type and an amount. In the same transaction the database creates one ADHOC due per item, dated today, and the receipt pays each of them in full. The rest of the receipt's amount still goes to the PLAN dues, oldest first, as before.

Ad-hoc dues never show as owed:
*   they are paid in the transaction that creates them;
*   if their receipt is cancelled they become void: they stay as history and are never collected again.

## Goals

*   **G1: collect ad-hoc items with the plan payment.** `collectFee` takes up to 5 extras `{ feeTypeId, amount }` alongside the plan amount. The plan amount may be 0 when there are extras. Each extra becomes one ADHOC due, paid in full by the receipt, with its GST stamped as for any line. The receipt total is the plan amount plus the extras. The audit records each extra's fee type and amount [T-AF-001].
*   **G2: the database proves the rules** [T-AF-002]:
    *   an ADHOC due has no plan or instalment;
    *   its fee type is active, its due date is today (IST) and its currency is INR;
    *   its registration is visible and belongs to the centre;
    *   at commit it is fully paid by lines of ACTIVE receipts created in the same transaction;
    *   only `fee.collect` may create one;
    *   the PLAN rules are unchanged.
*   **G3: what is owed, and how it is shown** [T-AF-001, T-AF-003]:
    *   collection and the learner's outstanding count PLAN dues only;
    *   a cancelled receipt's ad-hoc dues are not owed;
    *   the receipt page lists ad-hoc lines under their fee type, marked "Ad-hoc";
    *   the learner page's dues table lists PLAN dues only.

## Non-Goals (DD-5)

*   Bulk misc assignment ahead of time (R-061).
*   A misc price master (R-058).
*   Ad-hoc dues without a receipt.
*   A restricted list of fee types allowed as ad-hoc (DD-3, PMC).

## Technical Plan

### Migration `0029_adhoc_fees` (fee-dues DD-7's ALTERs)

**Columns and checks.**
*   `fee_due` gains `source text not null default 'PLAN'`.
*   `plan_id` and `caption_id` drop NOT NULL.
*   Check `fee_due_source_check`: `source in ('PLAN', 'ADHOC') and ((source = 'PLAN') = (plan_id is not null and caption_id is not null)) and (source = 'PLAN' or (plan_id is null and caption_id is null))`.
*   The composite FK to `fee_plan_line` is MATCH SIMPLE, so it binds PLAN rows only.
*   The unique key `(registration_id, fee_type_id, caption_id)` treats NULL captions as distinct, so ADHOC rows may repeat.
*   `schema.prisma`: `planId Int?`, `captionId Int?`, `line FeePlanLine?`, `source String @default("PLAN")`.

**`fee_due_guard`** is replaced by a version that branches on `source` after the lock and the stamps.
*   **PLAN:** exactly the current steps 3–7.
*   **ADHOC:** the following checks, each failing with `fee_due_adhoc_guard`:
    1.  The registration is found at `new.centre_id` (RLS-visible). Any status is allowed, because arrears stay owed (F3 DD-1).
    2.  The fee type is found and active.
    3.  `due_on = (now() at time zone 'Asia/Kolkata')::date`.
    4.  `currency = 'INR'` (the only plan currency today; D-CUR-1).
    5.  `gross > 0`.

**Constraint trigger `fee_due_adhoc_paid`.** It runs `after insert on fee_due`, is `deferrable initially deferred`, and acts only `when (new.source = 'ADHOC')`. At commit it requires `Σ amount of allocations on ACTIVE receipts for this due = gross`. Otherwise it raises `fee_due_adhoc_paid_guard`.

Because receipt lines can only be added in their receipt's transaction (F3 D15), "fully paid at commit" means paid by this transaction's receipt.

**RLS.** `fee_due_insert` becomes:

```sql
with check ((source = 'PLAN' and centre_id = any (scoped('fee.dues')))
            or (source = 'ADHOC' and centre_id = any (scoped('fee.collect'))))
```

**Grants.** The insert grant on `fee_due` adds `source`.

**Owed versus outstanding.** `fee_due_balance` is unchanged: `outstanding = gross − Σ ACTIVE allocations`. The allocation guard still uses it, so an ADHOC due can be allocated once, fully, in its own transaction. Every reader of what a learner **owes** filters `source = 'PLAN'`:
*   `collectFee`'s open dues and its over/nothing checks;
*   `duesForPerson`'s dues, totals and `canCollect`.

DD-2 is enforced in this one place: a void ADHOC due (receipt cancelled) has outstanding greater than 0, but it is never owed and never collected.

### Server (`receipts.ts`)

`CollectInput` gains `extras?: { feeTypeId: number; amount: string }[]`.

**Validation, in order, after `mode`:**

| Rule | Message |
|---|---|
| `extras` is an array of at most 5 | `"extras: at most 5"` |
| each `feeTypeId` is a positive integer | `"extras: fee type"` |
| each `amount` matches the amount pattern and is greater than 0 | `"extras: amount from 0.01"` |
| no fee type appears twice | `"extras: one line per fee type"` |

The plan `amount` may then be `"0"` if `extras` is non-empty. Otherwise it is the current rule.

**Inside the action**, after the replay and the trading gate:
1.  If extras are present, every fee type must be active (`fee_type` read), else `"extras: fee type"`.
2.  The PLAN-only open dues:
    *   a plan amount above 0 with no open PLAN dues: `fee.receipt.nothing`;
    *   above outstanding: `fee.receipt.over`;
    *   a plan amount of 0 with extras: no PLAN allocation.
3.  The currency is the PLAN dues' currency, or `'INR'` when only extras are paid.
4.  The receipt `total` is `${amount}::numeric + Σ extras`, computed in SQL.
5.  Insert the receipt. Then, for each extra in input order:
    1.  insert its ADHOC due (`registration_id, centre_id, source 'ADHOC', fee_type_id, due_on today, gross, currency`);
    2.  insert its allocation for the full amount.
6.  Allocate the plan amount to the PLAN dues, oldest first, as today, with the window filtered to `source = 'PLAN'`.

**Audit detail** adds `extras: [{ feeTypeId, amount }]`.

**Error mapping.** `receiptDb` maps `fee_due_adhoc_guard` and `fee_due_adhoc_paid_guard` to `fee.receipt.mismatch`, through the generic 23514 branch.

**`getReceipt`** lines add `adhoc: boolean` (the due's `source = 'ADHOC'`), and use the instalment name `"Ad-hoc"` when `caption_id` is null.

**`duesForPerson`** filters `source = 'PLAN'` everywhere.

### Pages and route

*   **The learner page's Collect form** gains 3 optional rows: `extraFeeType` (a select of active fee types) and `extraAmount`. These come from `getAll`, so the posted fields repeat. The `amount` label becomes "Amount towards dues".
*   **`POST /students/[personId]/receipts`** reads `data.getAll("extraFeeType")` and `data.getAll("extraAmount")`. Empty pairs are dropped. A half-filled pair is an error: `"extras: fee type"` or `"extras: amount from 0.01"`.
*   **The learner page** reads the active fee types once. A new `listActiveFeeTypes` is not needed: `listFeeTypes` exists, and the page filters it.

### Tests (`tests/adhoc-fees.test.ts`)

| ID | Goal | What it does |
|---|---|---|
| T-AF-001 | G1, G3 | A receipt with a plan amount and 2 extras: 2 ADHOC dues dated today, fully paid, GST stamped from each fee type, total equal to their sum, audited. A receipt of extras only (plan amount 0). Refusals: 6 extras, a duplicate type, an inactive type, an extras amount of 0, and a plan amount of 0 without extras. The learner's outstanding and `canCollect` are unchanged by ADHOC dues. After the receipt is cancelled, its ADHOC dues are not owed and the next collection does not touch them. `getReceipt` marks the ad-hoc lines. |
| T-AF-002 | G2 | Raw SQL as gems_app. An ADHOC due not fully paid at commit is refused by name, and so is one paid by a receipt of a later transaction. Also refused by name: an ADHOC due with a plan, with another date, with an inactive type, or in USD. RLS: ADHOC needs `fee.collect`, and PLAN still needs `fee.dues`. `fee_due_source_check` holds. Every T-FD-002 PLAN case is still green (re-run unchanged). |
| T-AF-003 | G3 | The route: extras posted as repeated fields; a half-filled pair is refused with its field detail; success lands on the receipt. |

**Changes to existing tests:**
*   T-AUD-009 is unchanged, because the action name is the same.
*   The T-FD and T-FR suites run unchanged.

**Smoke:** the Collect form is still absent while collection is switched off.

## Decisions (recommended options)

1.  **DD-1:** Up to 5 ad-hoc items per receipt, each a fee type and an amount. Each item's due is created in the receipt's transaction, dated today, and paid in full (D-FEE-1).
2.  **DD-2:** Ad-hoc dues are never owed. The database proves "paid in full at commit". After a cancellation they are void history.
3.  **DD-3 (PMC):** Any active fee type, at an amount the cashier enters, until Accounts decides on a misc list or price master.
4.  **DD-4:** The plan amount may be 0 when extras are present.
5.  **DD-5:** Out of scope; see Non-Goals.
6.  **DD-6:** `fee_due_balance` keeps one meaning (what is still allocatable). "Owed" is PLAN dues only, filtered in `collectFee` and `duesForPerson`.

## Risks and Limits

*   The cashier sets the amount (PMC). Misuse, such as charging a course fee ad hoc, is visible in the audit and on the receipt. A misc list would remove it.
*   A void ADHOC due keeps outstanding greater than 0 in `fee_due_balance`. Reports of what is owed must filter PLAN. The F1 ledger and reports inherit this rule.
