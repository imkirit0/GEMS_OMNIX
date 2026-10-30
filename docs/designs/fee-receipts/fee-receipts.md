# Fee collection and receipts (Stage 4, F3; WF4)

*   **Author:** gtm
*   **Status:** Approved as the recommended option, under the owner's standing instruction (2026-10-29) and "yes do the next step" (2026-10-30). This is not an owner signature.
*   **Reviews:** EGM steps 5–7 ran in parallel ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)). Steps 8 ([`zoom_out_step8_report.md`](zoom_out_step8_report.md)) and 9 ([`readiness_report.md`](readiness_report.md)) followed. Every finding is resolved below.
*   **Date:** 2026-10-30

Sources:
*   evidence classes: `docs/audit/00-README.md`;
*   input: [`input-brief.md`](input-brief.md);
*   financial rules: audit 07, as revised by `revisions/v1.6-fee-dues-model.md`;
*   dues: `docs/designs/fee-dues/fee-dues.md` (E-051);
*   numbering: `revisions/v1.1-corrections.md` §C-02;
*   test seed: `tests/fee-seed.ts` (`seedFeePlan`).

--------------------------------------------------------------------------------

## Overview

A centre collects money from a learner against one registration's dues. The money goes to the oldest open dues first. Each line carries a GST split, which the database computes at receipt from the fee type and the centre's GST registration. The receipt gets the next gapless FEEREC number for its centre and financial year. Receipts and their lines never change; cancellation is F4.

Two terms are defined once (Z1, C6):
*   A due's **outstanding** is `gross − Σ amount of its allocations on ACTIVE receipts`. The view `app.fee_due_balance` holds this definition, and every reader and guard uses it. Concessions (F5) and adjustments (F4) will change only that view.
*   A due is **open** when its outstanding is above 0.

## Goals

*   **G1: collect a receipt** [T-FR-001]. A holder of `fee.collect` and `student.view` at the registration's centre can record one receipt while the gate is open (DD-5). The centre must be active. The receipt has:
    *   an amount from 0.01 up to the registration's outstanding total;
    *   an offline mode (DD-2), with its instrument details;
    *   today's date in IST.

    The amount is allocated oldest first by `(due_on, id)`, and the receipt is audited.
*   **G2: the database proves the receipt** [T-FR-002]. Every check fails closed:
    *   each line is a due of the receipt's registration, in the receipt's currency, inserted in the receipt's own transaction;
    *   no due is ever allocated beyond its gross, even under concurrent receipts;
    *   each line's tax follows the DD-3 rule and is stamped by the database;
    *   the total equals the sum of the lines, with at least one line, checked at commit;
    *   the number is the series' current number, and the database builds the printed number from it;
    *   the date is today and the period is that date's financial year;
    *   nothing changes or disappears.
*   **G3: the same key gives the same receipt** [T-FR-003]. A retry or a concurrent double submit with the same idempotency key, for the same registration, returns the original receipt (`replay`). Receipts for other learners on one series get distinct, consecutive numbers.
*   **G4: reading receipts** [T-FR-004, smoke]. Anyone with `student.view` at the centre sees, on the learner page, the paid and outstanding amount per due and the registration's receipts, and can open a printable `/receipts/[id]`. A receipt outside the reader's scope gives 404. The routes check the origin.

## Non-Goals (DD-6)

*   Ad-hoc dues (D-FEE-1). These get their own piece, which also carries fee-dues DD-7's ALTERs (Z8).
*   Cancellation, bounced cheques and post-dated cheques (F4, with holds; D13).
*   Ledger journals, Round Off and bank accounts (F1, D-FIN-1).
*   The hash-chained finance audit (D-FIN-8).
*   Online payments (D-FEE-3).
*   Advances and overpayment (D-FIN-9).
*   Refunds (D-FIN-5).
*   Back-dated receipts (F12).

## Technical Plan

### Data model (migration `0027_fee_receipts`)

The migration's head comes from `prisma migrate diff`. `schema.prisma` gains:
*   the models `Receipt` (`@@unique([id, centreId])`, `status @default("ACTIVE")`) and `ReceiptAllocation`;
*   back-relations on `FeeDue`, `Registration`, `Centre` and `AppUser`;
*   `@@index([dueId])` on `ReceiptAllocation` (D10).

Timestamps are `@db.Timestamptz`, with microseconds (R9).

**The SQL function `app.financial_year(d date) returns text`** is `immutable`, written in `language sql`, with a pinned search path. It returns the Indian financial year (April to March) as `YYYY-YY`, the same as `financialYear()` in `numbering.ts`. The app and the guard both use it, so they always agree at the year boundary (C5, D9).

**`app.receipt`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | The app reserves it before the action, as the audit target. |
| `centre_id`, `registration_id` | int, uuid | Composite FK to `registration(id, centre_id)`. |
| `period` | text | Must equal `app.financial_year(received_on)` (guard). |
| `number` | bigint | Unique `(centre_id, period, number)`. |
| `receipt_no` | text | Stamped by the guard (DD-4). Unique `(centre_id, period, receipt_no)`, kept as a cheap extra check (D5). |
| `received_on` | date | Stamped by the guard: today in IST. |
| `mode` | text | Check: one of `CASH`, `CHEQUE`, `DD`, `BANK_TRANSFER`, `UPI`, `CARD`. |
| `reference` | text, nullable | Check: NULL exactly when the mode is `CASH`; otherwise trimmed (`btrim`) and 1–50 characters. |
| `instrument_date` | date, nullable | Check: present exactly for `CHEQUE` and `DD`. |
| `currency` | char(3) | Taken from the dues (C7). |
| `total` | numeric(14,2) | Check: `> 0`. |
| `idempotency_key` | uuid | Unique. |
| `status` | text | Default `'ACTIVE'`. Check: in `('ACTIVE', 'CANCELLED')`. Not granted (C3). |
| `created_at`, `created_by` | timestamptz, uuid | Stamped by the guard: `now()` and `coalesce(app.session_user_id(), new.created_by)`, as in 0026 (R10). |

**`app.receipt_allocation`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | |
| `receipt_id`, `centre_id` | bigint, int | Composite FK to `receipt(id, centre_id)`. `centre_id` is also used for RLS. |
| `due_id` | bigint | FK to `fee_due`. Unique `(receipt_id, due_id)`, plus an index on `(due_id)`. |
| `amount` | numeric(14,2) | Check: `> 0`. The amount includes GST. |
| `gst_rate`, `hsn_sac` | numeric(7,4), text | Stamped by the guard from the fee type. |
| `taxable`, `cgst`, `sgst`, `igst` | numeric(14,2) | Stamped by the guard. Check: each is `>= 0`. Check: `taxable + cgst + sgst + igst = amount`. |

Every FK is `restrict`.

**The view `app.fee_due_balance`** is created with `security_invoker = true`, so the caller's RLS applies. It has the columns `due_id`, `registration_id`, `paid` and `outstanding`:
*   `paid` is `coalesce(sum(a.amount) filter (where r.status = 'ACTIVE'), 0)`;
*   `outstanding` is `d.gross − paid`;
*   the rows come from `fee_due d`, left joined to its allocations `a` and their receipts `r`, grouped by `d.id`.

**Guard `receipt_guard` (BEFORE INSERT).** Every guard in this migration follows the same style:
*   it runs with invoker rights and contains rules only;
*   it uses nested `if`s and `is distinct from` comparisons;
*   it raises with errcode 23514 and puts `constraint "<name>"` in the message.

`receipt_guard` does the following:
1.  Takes the `fee-dues:` advisory lock on `new.registration_id`.
2.  Stamps `created_at` and `created_by`, `received_on := (now() at time zone 'Asia/Kolkata')::date`, and `status := 'ACTIVE'`.
3.  Raises `receipt_number_guard` if `new.period is distinct from app.financial_year(new.received_on)`.
4.  Reads the series row `(new.centre_id, 'FEEREC', new.period)` `for update`; the caller's `allocate()` already holds that lock. If there is no row, or `current` is distinct from `new.number`, it raises `receipt_number_guard`.
5.  Stamps `receipt_no := centre.code || '/' || substr(new.period, 3, 2) || '/' || new.number`. For example, centre `KL2-25`, financial year 2026-27 and number 123 give `KL2-25/26/123`. If the result is longer than 16 characters, it raises `receipt_length_guard` (DD-4).

**Guard `receipt_allocation_guard` (BEFORE INSERT).**
1.  Reads the receipt. If there is no row, or the receipt's `created_at is distinct from now()` (so it was not inserted in this transaction), it raises `receipt_allocation_guard` (D15).
2.  Takes the same `fee-dues:` lock.
3.  Reads the due. Unless the due belongs to the receipt's registration and centre and has the receipt's currency, it raises `receipt_allocation_guard`.
4.  Raises `receipt_over_guard` if `new.amount > outstanding` (from `fee_due_balance`). The lock makes this check safe.
5.  Stamps the tax (Z2). It reads the fee type's `gst_rate` and `hsn_sac`, and the centre's `gst_enabled`, `gst_supply` and `gstin`. The centre counts as **taxed** when `gst_enabled` is true and the currency is INR.
    *   A taxed centre with a NULL `gst_supply` or a NULL `gstin` raises `receipt_tax_guard` (D2, C2, Z5).
    *   Otherwise the split is:

        | Centre | `taxable` | `cgst` | `sgst` | `igst` |
        |---|---|---|---|---|
        | not taxed | `amount` | 0 | 0 | 0 |
        | taxed, `STATE` | `round(amount * 100 / (100 + gst_rate), 2)` | `round((amount − taxable) / 2, 2)` | `amount − taxable − cgst` | 0 |
        | taxed, `INTERSTATE` | the same | 0 | 0 | `amount − taxable` |

        Postgres `round(numeric)` rounds half away from zero, which is half-up for positive amounts (D-FIN-4). Any residual stays inside the line.

**Commit check `receipt_total_check`.** This is a constraint trigger, `after insert on receipt`, `deferrable initially deferred`. At commit it requires at least one line and `total = Σ amount`; otherwise it raises `receipt_total_guard`. Lines can only be inserted in the receipt's own transaction, so firing on `receipt` alone is enough (D15).

**Immutability.** Both tables get `*_no_update_delete` and `*_no_truncate` triggers that run `app.ticket_immutable()`. The rules for F4 are fixed now (D11):
*   the only update allowed is `status` from ACTIVE to CANCELLED, in one direction only;
*   every other column stays unchanged, checked with the `to_jsonb` diff used by `fee_plan_guard`;
*   the update runs under the `fee-dues:` lock;
*   the grant is `update (status)` only;
*   lines stay immutable for good.

**RLS.** Both tables have ENABLE and FORCE, and four policies:
*   select: `scoped_centre_ids('student.view')` (DD-7);
*   insert: `scoped_centre_ids('fee.collect')`;
*   update and delete: `using (false)`.

**Numbering (DD-4, D3, D4, Z3, Z8-1, Z8-2, R4).**
*   gems_app gains `insert (centre_id, doc_type, period, gap_rule)` on `number_series`. `current` is not granted and defaults to 0, so a row can never be created with a value.
*   A FEEREC row (at 0, `'GAPLESS'`, cast to `app."GapRule"`) is created in exactly two cases:
    *   **(a) Rollover.** `allocate()` gains an option `{ create: "after-any-earlier" }`. When the row is missing, it inserts the row only if the centre has **any** FEEREC row for an earlier period (`period < $period`), so a year with no receipts does not block. Otherwise it throws the existing `SeriesMissing`.
    *   **(b) Activation.** `setCentreActive(…, true)` in `centres.ts` inserts the current financial year's row, with `on conflict do nothing`.
*   A missing row is refused with `fee.receipt.noseries`. The remedy is the NP-8 cutover seed in the owner runbook. That seed **upserts** `current = greatest(current, legacy)` for every centre with legacy receipts, active or not, so neither rule can restart a legacy centre at 1.

**Permission.** `('fee.collect', 'Collect fees and issue receipts at a centre', false)`, with a `system_admin` grant.

**Grants.**
*   On `receipt`: `select`, and `insert (id, centre_id, registration_id, period, number, mode, reference, instrument_date, currency, total, idempotency_key)`.
*   On `receipt_allocation`: `select`, and `insert (receipt_id, centre_id, due_id, amount)`.
*   `select` on `fee_due_balance`.
*   `usage` on both sequences.

**ETL reset (D7).** `scripts/etl/reset.sql` clears `receipt_allocation` and `receipt` before `fee_due`, with the no-truncate triggers lifted for that statement. As with dues, this is safe only while no real receipts exist, before cutover.

### Server

**`src/server/dues.ts`** gains:
*   `export const FEE_GATES = { collectionLive: false }` (DD-5, committed closed);
*   an export of `lockKey` (R2).

`receipts.ts` re-exports `FEE_GATES`, so there is no import cycle.

**`src/server/receipts.ts`:**

```ts
export const MODES = ["CASH", "CHEQUE", "DD", "BANK_TRANSFER", "UPI", "CARD"] as const;
export type CollectInput = { registrationId: string; amount: string; mode: string; reference?: string; instrumentDate?: string; idempotencyKey: string };
export async function collectFee(session, personId, input): Promise<{ receiptId: string; receiptNo: string; total: string; replay: boolean }>
export async function getReceipt(session, receiptId: string): Promise<ReceiptView>  // RbacError notfound when invisible or malformed
```

**`collectFee`** runs these steps:

1.  **Gate.** If the gate is closed, it throws `RbacError("invalid", "fee collection is not switched on", "fee.receipt.closed")`.
2.  **Validation**, in this order. Messages use the `adminPost` form `"<field>: <rule>"` (C10).

    | Field | Rule | Message on failure |
    |---|---|---|
    | `registrationId` | a UUID | `PersonError("notfound")` |
    | `idempotencyKey` | a UUID | `"idempotencyKey: invalid"` |
    | `amount` | matches `^\d{1,12}(\.\d{1,2})?$` and is not zero | `"amount: from 0.01, up to 2 decimals"` |
    | `mode` | one of `MODES` | `"mode: one of the listed values"` |
    | `reference` | required for every mode except cash; refused for cash; 1–50 characters | `"reference: required for this mode"`, `"reference: not for cash"`, `"reference: 1-50 characters"` |
    | `instrumentDate` | required for cheque and DD, refused otherwise; a valid date (`isoDate`) that is not after today | `"instrumentDate: required for cheque and DD"`, `"instrumentDate: only for cheque and DD"`, `"instrumentDate: not after today"` |
3.  **Pre-flight.** The registration must belong to `personId` and sit inside `student.view` scope, as in `createDues`; otherwise `PersonError("notfound")`. Then it reserves `nextval('app.receipt_id_seq')`.
4.  **Action.** `scopedAction({ action: "fee.receipt.create", permission: "fee.collect", centreId, targetType: "receipt", targetId }, …)`, wrapped by `receiptDb` both inside the callback and around the whole call. Inside the callback:
    1.  `authorize(tx, "student.view", centreId)`, then the `fee-dues:` lock.
    2.  **Replay** (C1, D1), before the trading gate (Z8-7). Look up `receipt` by `idempotency_key`:
        *   found for this registration: return it with `replay: true`;
        *   found for another registration: `fee.receipt.mismatch` (C9, D14).
    3.  **Trading gate:** `centreId: centre is not active`. The app does not repeat the GST-setup check. Activation and centre edits already require complete GST details, and the guard covers rows loaded outside the app (`receipt_tax_guard` becomes `fee.receipt.gst`; Z8-4).
    4.  **Open dues:** `fee_due_balance` joined to `fee_due` for `due_on` and `currency` (R11).
        *   none: `fee.receipt.nothing`;
        *   `${amount}::numeric > Σ outstanding`, compared in SQL: `fee.receipt.over`.
    5.  **Number:**
        *   `period := app.financial_year((now() at time zone 'Asia/Kolkata')::date)`;
        *   `allocate(tx, { centreId, docType: "FEEREC", period }, { create: "after-any-earlier" })`;
        *   `SeriesMissing` becomes `fee.receipt.noseries`.
    6.  **Insert the receipt.** `currency` comes from the dues and `total` is `${amount}::numeric`. The insert returns `receipt_no`.
    7.  **Insert the lines** with one `insert … select`. It runs over the open dues ordered `(due_on, id)`. Each line's amount is `least(outstanding, ${amount}::numeric − coalesce(sum(outstanding) over (order by due_on, id rows between unbounded preceding and 1 preceding), 0))`, and only lines `> 0` are kept.
    8.  Return `{ receiptId, receiptNo, total, replay: false }`.
5.  **Audit detail.**
    *   A new receipt: `{ after: { receiptNo, total, mode, lines } }`, with no instrument references (DD-8).
    *   A replay: `{ after: { replay: true, receiptId: <original>, receiptNo } }`, because the OK row's target is the reserved id (R6).
6.  **A 23505 on `receipt_idempotency_key_key`** can only come from another registration's receipt, or from one the caller cannot see. Same-key, same-registration submits queue on the lock and replay instead. It becomes `fee.receipt.mismatch` (Z8-3, R7).
7.  **`receiptDb`** (C4, D8, R3, R5) is applied in two places:
    *   inside the callback, so a 42501 becomes `Forbidden` with a DENIED row;
    *   around the whole call, so commit-time errors are mapped too.

    It reads `e.meta?.driverAdapterError?.cause ?? e.cause`. It matches the constraint name in the message first, then the error code:

    | Error | Becomes |
    |---|---|
    | `receipt_over_guard` | `fee.receipt.over` |
    | `receipt_tax_guard` | `fee.receipt.gst` |
    | any other 23514, 23503 or 23505 | `fee.receipt.mismatch` |
    | 42501 | `Forbidden` |

**`duesForPerson`** gains:
*   per due: `paid` and `outstanding`, as `::text` from `fee_due_balance`;
*   per registration:
    *   `outstanding`, which is `null` when the registration has no dues;
    *   `receipts`: `{ id, receiptNo, receivedOn, total, mode }[]`, newest first;
    *   `canCollect`: the gate is open, outstanding is above 0, the centre is ACTIVE, and `has_permission('fee.collect', centre)` holds.

**`getReceipt`** reads:
*   the header: centre code, name and GSTIN; the learner's name; the course and register number; the receipt's number, date, mode, reference, total and status;
*   the lines: fee type, instalment, HSN/SAC, rate, taxable, CGST, SGST, IGST and amount;
*   the totals, computed in SQL.

The id must match `^\d{1,18}$`. A receipt that is invisible to the caller or missing is notfound.

**`ADMIN_MESSAGES`:**

| Key | Message |
|---|---|
| `fee.receipt.closed` | "Fee collection is not switched on yet." |
| `fee.receipt.nothing` | "Nothing is outstanding for this course." |
| `fee.receipt.over` | "The amount is more than what is outstanding." |
| `fee.receipt.noseries` | "The receipt series is not set up for this centre; ask head office." |
| `fee.receipt.gst` | "The centre's GST details are incomplete; ask head office." |
| `fee.receipt.mismatch` | "The receipt did not match the dues; nothing was saved." |

The field labels go in the learner page's inline `labels` map, `app/students/[personId]/page.tsx` (R12):

| Field | Label |
|---|---|
| `amount` | "Amount" |
| `mode` | "Mode" |
| `reference` | "Reference" |
| `instrumentDate` | "Instrument date" |
| `idempotencyKey` | "Form (reload the page)" |
| `centreId` | "Centre" |

### Pages and routes

*   **The learner page's Fees row.**
    *   The dues table gains Paid and Outstanding columns.
    *   The registration's receipts are listed, each linking to `/receipts/<id>`.
    *   When `canCollect`, a Collect form appears. Its fields are:
        *   `amount`, prefilled with the outstanding;
        *   `mode`, a select;
        *   `reference`;
        *   `instrumentDate`, an `input type="date"`;
        *   hidden `registrationId` and `idempotencyKey`, where the key is `randomUUID()` at render.
*   **`POST /students/[personId]/receipts`.** `safeRoute`, a UUID check on `personId`, then `adminPost`. On success it redirects to `/receipts/<id>?saved=1`, or to `?replay=1` for a replay.
*   **`/receipts/[id]`.** A plain, printable receipt. On a replay it notes "Duplicate submission: this receipt was already recorded" (Z9).

### Tests (`tests/fee-receipts.test.ts`)

**Fixtures:**
*   role 30 `fee_collect` (`fee.collect`, `student.view`);
*   user `…00f8` at centre A, token `tok-feeC`;
*   the `fee.collect` permission;
*   `receipt_allocation` and `receipt` in the truncate list.

**Setup.**
*   The tests set `FEE_GATES.collectionLive = true` and restore it in `afterEach`.
*   The data is `seedFeePlan()` plus dues created by `tok-feeD`. The owner sets the centre's GST for each test.
*   The period comes from `app.financial_year`, never from `PERIOD`. `beforeEach` inserts, as the owner, the current financial year's FEEREC rows for centres 1–3 (`on conflict do nothing`). `seriesCurrent` gains an optional `period` argument (C8, R1).
*   One test checks that `app.financial_year` and the TS `financialYear()` agree on 31 March and 1 April in IST.

| ID | Goal | What it does |
|---|---|---|
| T-FR-001 (T-FEE-001/002/003/004/010) | G1 | **Allocation and tax:** full and partial payment, oldest first across instalments; exact CGST/SGST; IGST for INTERSTATE; no tax for an untaxed centre. **Numbering:** 1, 2, 3 per centre, with `receipt_no`. **Refusals**, with each message in order: over the outstanding; nothing outstanding; gate closed; a viewer (Forbidden, with a DENIED audit row); another person's registration, or one out of scope (notfound); inactive centre; incomplete GST (`fee.receipt.gst`, via the guard); post-dated instrument. **Series:** no series gives `noseries`. **Audit:** the detail is recorded, and no number is used up by any refused receipt. |
| T-FR-002 | G2 | **Refused by name, as gems_app with raw SQL:** another registration's due; another currency; over-allocation; a line on a receipt from an earlier transaction; a receipt with no lines, and a wrong total (both at commit); a number other than the series' current; a period other than the date's year; an over-length number; a taxed centre without supply or GSTIN. **Stamped by the database**, even when the owner supplies other values with `app.session_id` set: tax, `receipt_no`, date, status, who and when. **Grants:** gems_app gets 42501 on the status, `received_on` and tax columns. **Commit errors:** a commit-time 23514 reaches `collectFee` as `fee.receipt.mismatch`, not a 500 (an owner-installed deferred test trigger, in the T-ADM-003 style). **Concurrency:** two sessions allocating the last rupee of one due; the second is refused. **RLS** on four commands. **Immutability:** update, delete and truncate are refused, even as the owner. **Series:** a series row starts at 0; rule (a) after a year with no receipts; rule (b) at activation. |
| T-FR-003 (T-FEE-007/008/009) | G3 | **Replay:** the same key returns the same receipt (`replay`), with no second number. **Concurrent double submit:** two concurrent submits with one key for the full outstanding give one receipt and a replay with the same id. **Key reuse:** a key reused for another registration gives `mismatch`. **Numbering:** concurrent receipts for two learners get distinct, consecutive numbers. |
| T-FR-004 | G4 | **`duesForPerson`:** paid, outstanding, receipts and `canCollect`. **`getReceipt`:** lines and totals; another centre's receipt and a bad id give notfound. **Route:** origin check; success leads to `/receipts/<id>?saved=1` and a replay to `?replay=1`; field errors come back on the learner page; 404s. |

**Existing tests that change:**
*   T-RLS-002's list adds `receipt` and `receipt_allocation`.
*   T-AUD-009 adds the `receipts.ts` scan, and `fee.receipt.create` goes into `tests/audit-catalogue.ts` (R8).
*   T-FD-001 gains the new `duesForPerson` fields.
*   T-CO-003 checks the FEEREC row at activation.

**Smoke checks:**
*   the Fees row has no Collect form while the gate is closed;
*   `/receipts/abc` gives 404;
*   a post from a foreign origin is refused.

## Decisions (recommended options)

1.  **DD-1:** One registration per receipt, allocated oldest first by `(due_on, id)` (D-FEE-4).
    *   Partial payment is allowed.
    *   Overpayment is refused until advances and the ledger exist.
    *   Any registration status may pay.
2.  **DD-2:** Offline modes only.
    *   A reference is required except for cash.
    *   Cheque and DD need an instrument date that is not in the future.
    *   Post-dated cheques belong to F4.
3.  **DD-3:** The database computes the tax at receipt.
    *   IGST follows the centre's `gst_supply` (Z5).
    *   A taxed centre with incomplete GST details is refused.
    *   PMC for the tax advisor: place of supply, and per-allocation rounding. Because rounding is per allocation, a due paid in parts can differ by a few paise (D12).
4.  **DD-4:** Numbering.
    *   FEEREC numbers run per centre and financial year, gapless, inside the receipt's transaction.
    *   Series rows are created only at rollover (when the centre has any earlier row) or at activation. Otherwise the receipt is refused.
    *   The database builds `receipt_no` as `{code}/{yy}/{n}`, for example `KL2-25/26/123`, at most 16 characters. A longer number is refused by `receipt_length_guard` and becomes `fee.receipt.mismatch`. The format is PMC (NP-5).
    *   The FEEREC number is also the tax invoice number, pending the tax advisor (Z6).
5.  **DD-5:** `FEE_GATES.collectionLive` is committed `false`. It opens only after all of these:
    *   the tax advisor checks NP-5 and DD-3, including split payments;
    *   Accounts' worked examples pass;
    *   the cutover year is seeded (NP-8) for every centre with legacy receipts, active or not, as an upsert of `greatest(current, legacy)`;
    *   every active centre's worst-case number fits in 16 characters (D6);
    *   the F1 ledger posts in the receipt's transaction, or Accounts accepts a backfill rule (Z4) that also covers cancellations (receipt-cancel Z1).
6.  **DD-6:** The Non-Goals.
7.  **DD-7 (PMC):** Receipts are visible to `student.view` at the centre.
8.  **DD-8:** The audit keeps no instrument references.
9.  **DD-9:** A replay returns the recorded receipt even when the resubmitted amount or mode differ, and the page says it was a duplicate. A key reused for another registration is refused.

## Alternatives Considered

*   A receipt across several registrations: rejected, because it has no single allocation order and no single lock.
*   Allocation or tax in TypeScript: rejected under F13 and Z2.
*   A Postgres sequence for numbers: rejected under C-02.2, because a sequence is not gapless.

## Risks and Limits

*   **Lock order (found at build):** every writer takes the registration's `fee-dues:` lock **before** the series row (`collectFee` does; the guards take the same lock again, which is free). A writer in the other order can deadlock with `collectFee`; Postgres then aborts one transaction, so it fails closed, never wrongly. T-FR-002's raw writer follows the contract.
*   gems_app holds UPDATE on `number_series`, so a stray increment by other code could leave a gap. A gap report belongs in reconciliation.
*   Rates follow the fee type at the time of receipt.
*   An owner can still disable triggers until D-FIN-8 is built.
