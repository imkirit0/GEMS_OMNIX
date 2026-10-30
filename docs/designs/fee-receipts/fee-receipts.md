# Fee collection and receipts (Stage 4, F3; WF4)

*   **Author:** gtm
*   **Status:** Proposed, revised after EGM steps 5–7, which ran in parallel ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)). Every finding is resolved below. DD-1…DD-9 are recommended options taken under the owner's standing instruction (2026-10-29) and "yes do the next step" (2026-10-30).
*   **Date:** 2026-10-30

**Sources:**
*   Evidence classes: `docs/audit/00-README.md`.
*   Input: [`input-brief.md`](input-brief.md).
*   Financial rules: audit 07, as revised by `revisions/v1.6-fee-dues-model.md`.
*   Dues: `docs/designs/fee-dues/fee-dues.md` (E-051).
*   Numbering: `revisions/v1.1-corrections.md` §C-02.
*   Seed for tests: `tests/fee-seed.ts` (`seedFeePlan`).

--------------------------------------------------------------------------------

## Overview

A centre collects money from a learner against one registration's dues:
*   The money goes to the oldest open dues first.
*   Each line carries a GST split, which the database computes at receipt from the fee type and the centre's GST registration.
*   The receipt gets the next gapless FEEREC number for its centre and financial year.

Receipts and lines never change. Cancellation is F4.

**Definitions (Z1, C6).**
*   **Outstanding** of a due is `gross − Σ amount of its allocations on ACTIVE receipts`. It is defined once, in the view `app.fee_due_balance`, and every reader and guard uses it.
*   **Open** means outstanding > 0.
*   Concessions (F5) and adjustments (F4) will change only that view.

## Goals

*   **G1:** A holder of `fee.collect` and `student.view` at the registration's centre records one receipt while the gate is open (DD-5). These conditions apply:
    *   the centre is active;
    *   the amount is from 0.01 up to the registration's outstanding total;
    *   the mode is an offline mode (DD-2), with its instrument details;
    *   the date is today in IST.

    Allocation runs oldest first by `(due_on, id)`. The receipt is audited [T-FR-001].
*   **G2:** The database proves each of the following, and every check fails closed [T-FR-002]:
    *   every line is a due of the receipt's registration, in the receipt's currency, inserted in the receipt's own transaction;
    *   no due is ever allocated beyond its gross, even under concurrent receipts;
    *   the tax on each line is the DD-3 rule, stamped by the database;
    *   the total equals Σ lines, with at least one line, checked at commit;
    *   the number is the series' current number, and the printed number is built by the database from it;
    *   the date is today and the period is its financial year;
    *   nothing changes or disappears.
*   **G3:** A retry or a concurrent double submit with the same idempotency key, for the same registration, returns the original receipt (`replay`). Receipts for other learners on one series get distinct, consecutive numbers [T-FR-003].
*   **G4:** Anyone with `student.view` at the centre can see receipts in two places [T-FR-004, smoke]:
    *   on the learner page: paid and outstanding for each due, and the registration's receipts;
    *   a printable `/receipts/[id]`.

    A receipt outside the viewer's scope returns 404. The routes check the request origin.

## Non-Goals (DD-6)

These are out of scope:
*   Ad-hoc dues (D-FEE-1). These move to their own piece, which also carries fee-dues DD-7's ALTERs (Z8).
*   Cancellation, bounced cheques and post-dated cheques (D13). These go to F4, with holds.
*   Ledger journals, Round Off and bank accounts (F1, D-FIN-1).
*   The hash-chained finance audit (D-FIN-8).
*   Online payments (D-FEE-3), advances and overpayment (D-FIN-9), and refunds (D-FIN-5).
*   Back-dated receipts (F12).

## Technical Plan

### Data model (migration `0027_fee_receipts`)

The head of the migration comes from `prisma migrate diff`. The changes to `schema.prisma` are:
*   new models `Receipt` (with `@@unique([id, centreId])` and `status @default("ACTIVE")`) and `ReceiptAllocation`;
*   back-relations on `FeeDue`, `Registration`, `Centre` and `AppUser`;
*   `@@index([dueId])` on `ReceiptAllocation` (D10).

**SQL functions.** Both are `immutable`, with `language sql` and the search path pinned.
*   `app.financial_year(d date) returns text`. It returns the Indian financial year (April to March) as `YYYY-YY`, so it gives the same answer as `financialYear()` in `numbering.ts`. Both the app and the guard use it, so the year boundary can never disagree (C5, D9).
*   `app.receipt_no(code text, period text, n bigint) returns text`. It returns `code || '/' || substr(period, 3, 2) || '/' || n`, for example `KL2-25/26/123456`. This format is PMC (NP-5, DD-4).

**`app.receipt`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | Reserved by the app before the action, for the audit target. |
| `centre_id`, `registration_id` | int, uuid | Composite FK to `registration(id, centre_id)`. |
| `period` | text | Must equal `app.financial_year(received_on)` (guard). |
| `number` | bigint | Unique `(centre_id, period, number)`. |
| `receipt_no` | text | Stamped by the guard from `app.receipt_no`. Unique `(centre_id, period, receipt_no)` (D5). |
| `received_on` | date | Stamped by the guard: today in IST. |
| `mode` | text | Check: one of `CASH`, `CHEQUE`, `DD`, `BANK_TRANSFER`, `UPI`, `CARD`. |
| `reference` | text, nullable | Check: NULL exactly for `CASH`; otherwise `btrim`med, 1–50 characters. |
| `instrument_date` | date, nullable | Check: not NULL exactly for `CHEQUE` and `DD`. |
| `currency` | char(3) | Taken from the dues (C7); one plan per registration gives one currency. |
| `total` | numeric(14,2) | Check: `> 0`. |
| `idempotency_key` | uuid | Unique. |
| `status` | text | Default `'ACTIVE'`. Check: in `('ACTIVE', 'CANCELLED')`. Not granted, so every insert is ACTIVE (C3). |
| `created_at`, `created_by` | | Stamped by the guard. |

**`app.receipt_allocation`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | |
| `receipt_id`, `centre_id` | bigint, int | Composite FK to `receipt(id, centre_id)`. `centre_id` also drives RLS. |
| `due_id` | bigint | FK to `fee_due`. Unique `(receipt_id, due_id)`; index `(due_id)`. |
| `amount` | numeric(14,2) | Check: `> 0`. GST-inclusive. |
| `gst_rate`, `hsn_sac` | numeric(7,4), text | Stamped by the guard from the fee type. |
| `taxable`, `cgst`, `sgst`, `igst` | numeric(14,2) | Stamped by the guard. Check: each `>= 0`. Check: `taxable + cgst + sgst + igst = amount`. |

Every FK is `restrict`.

**View `app.fee_due_balance`** (`security_invoker = true`, so the caller's RLS applies):

```sql
select d.id as due_id, d.registration_id,
  coalesce(sum(a.amount) filter (where r.status = 'ACTIVE'), 0) as paid, d.gross - coalesce(…same…, 0) as outstanding
from app.fee_due d left join app.receipt_allocation a on a.due_id = d.id left join app.receipt r on r.id = a.receipt_id
group by d.id
```

**Guard `receipt_guard`** runs BEFORE INSERT. Like all guards here it is invoker-rights and rules-only, uses nested ifs and `is distinct from`, and raises errcode 23514 with `constraint "<name>"` in the message. Its steps:
1.  Take the `fee-dues:` advisory lock on `new.registration_id`.
2.  Stamp `created_at`, `created_by`, `received_on := (now() at time zone 'Asia/Kolkata')::date` and `status := 'ACTIVE'`.
3.  If `new.period` is distinct from `app.financial_year(new.received_on)`, raise `receipt_number_guard`.
4.  Read `(new.centre_id, 'FEEREC', new.period)` from `number_series` `for update`. The caller's `allocate()` already holds that lock. If there is no row, or `current` is distinct from `new.number`, raise `receipt_number_guard`.
5.  Stamp `receipt_no := app.receipt_no(centre.code, new.period, new.number)`. If `char_length > 16`, raise `receipt_number_guard` (DD-4).

**Guard `receipt_allocation_guard`** runs BEFORE INSERT:
1.  Read the receipt. Refuse with `receipt_allocation_guard` if there is no row, or if `created_at` is distinct from `now()`, meaning the receipt was not inserted in this transaction (D15).
2.  Take the same `fee-dues:` lock.
3.  Read the due. Refuse with `receipt_allocation_guard` unless it belongs to the receipt's registration and centre, and has the receipt's currency.
4.  Refuse with `receipt_over_guard` if `new.amount > outstanding` (from `fee_due_balance`). The lock makes this safe.
5.  Stamp the tax (Z2). Read the fee type's `gst_rate` and `hsn_sac`, and the centre's `gst_enabled`, `gst_supply` and `gstin`. The centre is **taxed** when `gst_enabled` is true and the currency is INR.
    *   If the centre is taxed and `gst_supply` or `gstin` is NULL, raise `receipt_tax_guard` (D2, C2, Z5).
    *   Otherwise stamp the split from this table:

| Centre | `taxable` | `cgst` | `sgst` | `igst` |
|---|---|---|---|---|
| Not taxed | `amount` | 0 | 0 | 0 |
| Taxed, `STATE` | `round(amount * 100 / (100 + gst_rate), 2)` | `round((amount − taxable) / 2, 2)` | `amount − taxable − cgst` | 0 |
| Taxed, `INTERSTATE` | the same | 0 | 0 | `amount − taxable` |

Postgres `round(numeric)` rounds half away from zero, which is half-up for positive amounts (D-FIN-4). Any residual stays inside the line.

**Commit check `receipt_total_check`.** A constraint trigger, `after insert on receipt`, `deferrable initially deferred`. At commit it requires at least one line and `total = Σ amount`; otherwise it raises `receipt_total_guard`. Lines can only be added in the receipt's own transaction, so firing on `receipt` alone is enough (D15).

**Immutability.** Both tables get `*_no_update_delete` and `*_no_truncate` triggers running `app.ticket_immutable()`. The rules for F4 are fixed now (D11):
*   the only update is `status` from ACTIVE to CANCELLED, and only in that direction;
*   every other column is unchanged (the `to_jsonb` diff from `fee_plan_guard`);
*   the update runs under the `fee-dues:` lock;
*   the grant is `update (status)` only;
*   lines stay immutable forever.

**RLS.** Both tables have ENABLE and FORCE, with four policies each:

| Command | Policy |
|---|---|
| select | `scoped_centre_ids('student.view')` (DD-7) |
| insert | `scoped_centre_ids('fee.collect')` |
| update | `using (false)` |
| delete | `using (false)` |

**Numbering (DD-4, D3, D4, Z3).**
*   gems_app gains `insert (centre_id, doc_type, period, gap_rule)` on `number_series`. `current` is not granted and defaults to 0, so no row can be created with a value.
*   A FEEREC row is created, at 0, in exactly two cases:
    *   **(a) Year rollover.** In `collectFee`, when the centre already has a FEEREC row for the **previous** financial year (the `allocateGlobal` `previous` pattern).
    *   **(b) Activation.** In `setCentreActive(…, true)`, in `centres.ts`, for the current financial year, `on conflict do nothing`. A centre created in this system has no legacy numbers.
*   Otherwise the receipt is refused with `fee.receipt.noseries` ("The receipt series is not set up for this centre; ask head office"). So a legacy centre that was not seeded at cutover can never restart at 1.
*   `gap_rule` is cast to `app."GapRule"` (`'GAPLESS'`) (C12).

**Permission.** `('fee.collect', 'Collect fees and issue receipts at a centre', false)`, with a `system_admin` grant.

**Grants.**
*   `select, insert (id, centre_id, registration_id, period, number, mode, reference, instrument_date, currency, total, idempotency_key)` on `receipt`.
*   `select, insert (receipt_id, centre_id, due_id, amount)` on `receipt_allocation`.
*   `select` on `fee_due_balance`.
*   Usage on both sequences.

**ETL reset (D7).** `scripts/etl/reset.sql` clears `receipt_allocation` and `receipt` before `fee_due`, with the no-truncate triggers lifted for that statement. As with dues, this holds only while no real receipts exist before cutover. The legacy cutover has not happened, and the reset is never run afterwards.

### Server (`src/server/receipts.ts`)

```ts
export const FEE_GATES = { collectionLive: false }; // DD-5: committed closed
export const MODES = ["CASH", "CHEQUE", "DD", "BANK_TRANSFER", "UPI", "CARD"] as const;
export type CollectInput = { registrationId: string; amount: string; mode: string; reference?: string; instrumentDate?: string; idempotencyKey: string };
export async function collectFee(session, personId, input): Promise<{ receiptId: string; receiptNo: string; total: string; replay: boolean }>
export async function getReceipt(session, receiptId: string): Promise<ReceiptView>  // RbacError notfound when invisible or malformed
```

**`collectFee`.**

1.  **Gate.** Closed: throw `RbacError("invalid", "fee collection is not switched on", "fee.receipt.closed")`.
2.  **Validation**, in this order. The messages use the `adminPost` format `"<field>: <rule>"` (C10).
    *   `registrationId` must be a UUID, else `PersonError("notfound")`.
    *   `idempotencyKey`: `"idempotencyKey: invalid"`.
    *   `amount`: `^\d{1,12}(\.\d{1,2})?$`, and not zero (`/^0+(\.0+)?$/`). Otherwise `"amount: from 0.01, up to 2 decimals"`.
    *   `mode`: `"mode: one of the listed values"`.
    *   `reference`: `"reference: required for this mode"` / `"reference: not for cash"` / `"reference: 1-50 characters"`.
    *   `instrumentDate`: `"instrumentDate: required for cheque and DD"` / `"instrumentDate: only for cheque and DD"` / `isoDate`.
    *   A post-dated instrument is refused: `"instrumentDate: not after today"` (D13).
3.  **Pre-flight.** The registration must belong to `personId` and be inside the caller's `student.view` scope, as in `createDues`; otherwise `PersonError("notfound")`. Then `nextval('app.receipt_id_seq')`.
4.  **Action.** `receiptDb(() => scopedAction({ action: "fee.receipt.create", permission: "fee.collect", centreId, targetType: "receipt", targetId }, …))`. Wrapping the whole action means commit-time errors are mapped too (D8). Inside:
    1.  `authorize(tx, "student.view", centreId)`.
    2.  Trading gate: `centreId: centre is not active`.
    3.  Take the `fee-dues:` lock.
    4.  **Replay (C1, D1).** Look up `receipt` by `idempotency_key`. If it is found for this registration, return it with `replay: true`; no audit detail is written beyond the action's OK row. If it is found for another registration, raise `fee.receipt.mismatch` (C9, D14).
    5.  **Tax setup.** If the centre is taxed with NULL `gst_supply` or `gstin`, throw `fee.receipt.gst` ("The centre's GST details are incomplete; ask head office").
    6.  **Amount.** Read the open dues from `fee_due_balance`. None: `fee.receipt.nothing`. If `${amount}::numeric > Σ outstanding` (in SQL): `fee.receipt.over`.
    7.  **Number.** `period := select app.financial_year((now() at time zone 'Asia/Kolkata')::date)`. Create the series row per rule (a); missing: `fee.receipt.noseries`. Then `allocate()`.
    8.  **Insert** the receipt, with `currency` taken from the dues. It returns `receipt_no`.
    9.  **Insert the lines** with one `insert … select`. It runs over the open dues ordered `(due_on, id)`, and gives each line `least(outstanding, ${amount} − coalesce(sum(outstanding) over (order by due_on, id rows between unbounded preceding and 1 preceding), 0))`, keeping only lines `> 0`.
    10. Return `{ receiptId, receiptNo, total, replay: false }`.
5.  **Audit detail:** `{ after: { receiptNo, total, mode, lines } }`, with no references (DD-8). A replay records `{ after: { replay: true, receiptNo } }`.
6.  **Backstop.** A 23505 whose message names `receipt_idempotency_key_key` leads to a fresh `withScope` re-read by key, after which the replay rule above applies. If the re-read finds nothing (the receipt is invisible to the caller), it becomes `fee.receipt.mismatch`.
7.  **`receiptDb` (C4, D8).** It checks the constraint name in the message first, then the code:

    | Error | Result |
    |---|---|
    | `receipt_over_guard` | `fee.receipt.over` |
    | `receipt_number_guard` | `fee.receipt.noseries` |
    | `receipt_tax_guard` | `fee.receipt.gst` |
    | any other 23514 or 23503 | `fee.receipt.mismatch` |
    | 23505 on the idempotency key | passed through to the backstop |
    | any other 23505 | `fee.receipt.mismatch` |
    | 42501 | `Forbidden` |

**`duesForPerson`** (in `dues.ts`) gains:
*   per due: `paid` and `outstanding`, as `::text` from `fee_due_balance`;
*   per registration: `outstanding` (string or null) and `receipts` (`{ id, receiptNo, receivedOn, total, mode }[]`, newest first);
*   `canCollect`: the gate is open, outstanding > 0, the centre is ACTIVE, `has_permission('fee.collect', centre)`, and the centre's GST setup is complete.

**`getReceipt`** returns:
*   the header: centre code, name and GSTIN; the learner's name; the course and register number; and the receipt's number, date, mode, reference, total and status;
*   the lines: fee type, instalment, HSN/SAC, rate, taxable, CGST, SGST, IGST and amount;
*   the totals, computed in SQL.

The id must match `^\d{1,18}$`. A receipt that is invisible or missing gives notfound.

**`ADMIN_MESSAGES`:**

| Key | Message |
|---|---|
| `fee.receipt.closed` | "Fee collection is not switched on yet." |
| `fee.receipt.nothing` | "Nothing is outstanding for this course." |
| `fee.receipt.over` | "The amount is more than what is outstanding." |
| `fee.receipt.noseries` | "The receipt series is not set up for this centre; ask head office." |
| `fee.receipt.gst` | "The centre's GST details are incomplete; ask head office." |
| `fee.receipt.mismatch` | "The receipt did not match the dues; nothing was saved." |

The field labels are `amount` "Amount", `mode` "Mode", `reference` "Reference", `instrumentDate` "Instrument date", `idempotencyKey` "Form (reload the page)", `centreId` "Centre".

### Pages and routes

*   **The learner page's Fees row.**
    *   The dues table gains Paid and Outstanding columns.
    *   Below it are the registration's receipts, each linking to `/receipts/<id>`.
    *   When `canCollect`, a Collect form follows. Its fields are `amount` (prefilled with the outstanding), `mode` (a select), `reference`, `instrumentDate` (`type=date`), and hidden `registrationId` and `idempotencyKey` (`randomUUID()` at render).
*   **`POST /students/[personId]/receipts`.**
    *   `safeRoute`.
    *   A UUID check on the person.
    *   `adminPost`, which redirects to `/receipts/<id>?saved=1`, or to `/receipts/<id>?replay=1` for a replay.
*   **`/receipts/[id]`.** A plain, printable receipt. It notes "Duplicate submission: this receipt was already recorded" on a replay (Z9).

### Tests (`tests/fee-receipts.test.ts`)

**Fixtures:**
*   role 30 `fee_collect` (`fee.collect`, `student.view`);
*   user `…00f8` at centre A with token `tok-feeC`;
*   the `fee.collect` permission;
*   `receipt_allocation` and `receipt` in the truncate list.

**Setup:**
*   Tests set `FEE_GATES.collectionLive = true` and restore it in `afterEach`.
*   Each starts from `seedFeePlan()` plus dues by `tok-feeD`.
*   The centre's GST is set as the owner, for each test.
*   The period comes from `app.financial_year`, never from `PERIOD`. The fixtures' FEEREC rows exist for `2026-27`, and rule (a) covers later years (C8).

| ID | Goal | What it does |
|---|---|---|
| T-FR-001 (T-FEE-001/002/003/004/010) | G1 | **Payments:** full and partial, oldest first across instalments. **Tax:** exact CGST/SGST, IGST for INTERSTATE, none for an untaxed centre. **Numbers:** 1, 2, 3 per centre, with the formatted `receipt_no`. **Refusals**, each message in order: over; nothing outstanding; gate closed; viewer (Forbidden, DENIED audit); another person's registration or out of scope (notfound); inactive centre; incomplete GST; post-dated instrument. **Series:** with no series row, `noseries`; with the previous year's row, a row is created; activation creates the row. **Audit and numbering:** the audit detail; no number is used up by any refused receipt. |
| T-FR-002 | G2 | **Raw SQL as gems_app, each refused by name:** another registration's due; another currency; over-allocation; a line on a receipt from an earlier transaction; a receipt with no lines, and a wrong total (both at commit); a number other than the series current; a period other than the date's year; a taxed centre without supply or GSTIN. **Stamped by the database:** tax, `receipt_no`, date, status and who/when, even when a caller supplies different values as the owner. **Grants (42501):** status, `received_on` and tax columns. **Concurrency:** two sessions allocating the last rupee of one due; the second is refused. **RLS:** on all four commands. **Immutability:** update, delete and truncate are refused, even for the owner. **Series:** an inserted series row starts at 0 (`current` not granted). |
| T-FR-003 (T-FEE-007/008/009) | G3 | The same key returns the same receipt (`replay`), with no second number. Two concurrent submits with one key for the full outstanding give one receipt plus a replay with the same id. A key reused for another registration gives `mismatch`. Concurrent receipts for two learners give distinct, consecutive numbers. |
| T-FR-004 | G4 | **`duesForPerson`:** paid, outstanding, receipts, `canCollect`. **`getReceipt`:** lines and totals; another centre's receipt gives notfound; a bad id gives notfound. **Route:** origin check; success leads to `/receipts/<id>?saved=1`; a replay to `?replay=1`; field errors return to the learner page; 404s. |

**Existing tests that change:**
*   T-RLS-002 adds `receipt` and `receipt_allocation`.
*   T-AUD-009 adds the `receipts.ts` scan and `fee.receipt.create`.
*   T-FD-001 gets the new `duesForPerson` fields.
*   The centre-activation test checks the FEEREC row.

**Smoke:**
*   the Fees row shows no Collect form while the gate is closed;
*   `/receipts/abc` returns 404;
*   a foreign-origin post is refused.

## Decisions (recommended options)

1.  **DD-1: one registration per receipt, paid oldest first.**
    *   Allocation is by `(due_on, id)`, which is fee order within an instalment (D-FEE-4).
    *   Partial payment is allowed.
    *   Overpayment is refused until advances and the ledger exist.
    *   Collection is allowed for any registration status.
2.  **DD-2: offline modes only.** A reference is required for every mode except cash. An instrument date, not in the future, is required for cheque and DD. Post-dated cheques belong to F4.
3.  **DD-3: tax is computed by the database at receipt.** This is the rule in the guard. Places where it goes beyond the brief:
    *   IGST is added through the centre's `gst_supply` (Z5).
    *   A taxed centre with incomplete GST details is refused.

    PMC items for the tax advisor:
    *   the place of supply;
    *   per-allocation rounding, under which a due paid in parts can differ by a few paise (D12).
4.  **DD-4: numbering.**
    *   FEEREC numbers run per centre and financial year, gapless, in the receipt's transaction.
    *   Series rows are created only at year rollover or at activation. Otherwise the receipt is refused.
    *   The database builds `receipt_no` as `{code}/{yy}/{n}`, at most 16 characters (PMC, NP-5).
    *   The FEEREC number also serves as the tax invoice number, pending the tax advisor (Z6).
5.  **DD-5: `FEE_GATES.collectionLive`, committed `false`.** It opens only when all of these hold:
    *   the tax advisor has checked NP-5 and DD-3, including split payments;
    *   Accounts' worked examples pass;
    *   every active centre's FEEREC counter for the cutover year has been seeded from legacy (NP-8);
    *   every active centre's worst-case number, `code + '/yy/' + 6 digits`, fits in 16 characters (D6);
    *   the F1 ledger posts in the receipt's transaction, or Accounts has accepted a backfill rule. F1 adds bank and cheque-in-hand accounts (Z4).
6.  **DD-6: out of scope.** The Non-Goals list.
7.  **DD-7 (PMC):** receipts are visible to `student.view` at the centre, like dues.
8.  **DD-8:** the audit keeps no instrument references.
9.  **DD-9:** a replay returns the recorded receipt even if the resubmitted amount or mode differ. The page says it was a duplicate. A key reused for another registration is refused (Z9, C9).

## Alternatives Considered

*   **A receipt spanning several registrations.** Rejected: there would be no single allocation order or lock.
*   **Allocation or tax computed in TypeScript.** Rejected (F13): money stays in SQL, and the tax is in one place (Z2).
*   **A Postgres sequence for numbers.** Rejected (C-02.2): it is not gapless.

## Risks and Limits

*   gems_app holds UPDATE on `number_series`. Stray increments by other code could leave a gap that the guard cannot see. A gap report belongs in reconciliation.
*   Rates follow the fee type at receipt.
*   An owner can still disable triggers until D-FIN-8 exists.
