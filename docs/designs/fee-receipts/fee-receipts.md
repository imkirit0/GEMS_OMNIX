# Fee collection and receipts (Stage 4, F3; WF4)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-8 are recommended options, taken under the owner's standing instruction (2026-10-29) and "yes do the next step" (2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`.

Sources:
*   Input: [`input-brief.md`](input-brief.md).
*   Financial rules: audit 07, as revised by `revisions/v1.6-fee-dues-model.md`.
*   Dues: `docs/designs/fee-dues/fee-dues.md` (E-051).
*   Numbering: `docs/audit/revisions/v1.1-corrections.md` §C-02.

--------------------------------------------------------------------------------

## Overview

A centre collects money from a learner against one registration's dues. The money goes to the oldest open dues first. Each line carries the GST split, copied at receipt from the fee type and the centre's GST registration. The receipt gets the next gapless FEEREC number for its centre and financial year. Receipts and allocations never change; cancellation is F4.

Outstanding per due is `gross − Σ allocations` (v1.6). Concessions (F5) and adjustments (F4) do not exist yet.

## Goals

*   **G1: Collect.** A holder of `fee.collect` and `student.view` at the registration's centre records one receipt, at an active centre, while the gate is open (DD-5):
    *   the amount is between 0.01 and the registration's outstanding total;
    *   the mode is offline (DD-2), with its instrument details;
    *   the date is today (IST).

    The receipt is allocated oldest first, by `(due_on, id)`, and is audited [T-FR-001].
*   **G2: Database proof.** The database proves all of the following, and every check fails closed [T-FR-002]:
    *   each allocation is to a due of the receipt's registration, in the receipt's currency;
    *   no due is ever allocated beyond its gross, even under concurrent receipts;
    *   each line's tax split is exactly the DD-3 rule for the centre's GST registration, at the fee type's current rate and HSN/SAC;
    *   a receipt's total equals the sum of its lines, and it has at least one line, checked at commit;
    *   the number is the series' current number, under its lock;
    *   the date is today (IST);
    *   nothing changes or disappears.
*   **G3: Exactly once.** A retry or a concurrent double submit with the same idempotency key yields the original receipt. Receipts for other learners on the same series get distinct, consecutive numbers [T-FR-003].
*   **G4: Reading receipts.** Anyone with `student.view` at the centre sees, on the learner page, paid and outstanding per due and the registration's receipts. They can also open a printable receipt `/receipts/[id]`. A receipt outside the reader's scope is a 404. The routes check the origin [T-FR-004, smoke].

## Non-Goals

These are out of scope (DD-6):
*   ad-hoc dues (D-FEE-1; next piece, using fee-dues DD-7);
*   cancellation and bounced cheques (F4, D-FIN-3);
*   ledger journals and Round Off (F1, D-FIN-1);
*   the hash-chained finance audit (D-FIN-8);
*   online payments (D-FEE-3);
*   advances and overpayment (D-FIN-9, F5);
*   refunds (D-FIN-5);
*   holds (D-FEE-5, F4);
*   back-dated receipts (F12).

## Technical Plan

### Data model (migration `0027_fee_receipts`)

The head comes from `prisma migrate diff`. `schema.prisma` gains the following:
*   models `Receipt` and `ReceiptAllocation`;
*   `FeeDue.allocations`, `Registration.receipts` and `AppUser` back-relations;
*   `@@unique([id, centreId])` on `Receipt`.

**`app.receipt`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | Reserved by the app before the action, so the audit row can target it. |
| `centre_id` | int | Part of the composite FK `(registration_id, centre_id)` → `registration(id, centre_id)`. |
| `registration_id` | uuid | Part of the same FK. |
| `period` | text | The financial year, e.g. `2026-27`. |
| `number` | bigint | Unique together with `(centre_id, period)`. |
| `receipt_no` | text | The formatted number (DD-4). |
| `received_on` | date | Stamped by the guard: today in IST. |
| `mode` | text | One of `CASH`, `CHEQUE`, `DD`, `BANK_TRANSFER`, `UPI` or `CARD`. |
| `reference` | text, nullable | The instrument or transaction number. NULL exactly when the mode is CASH. 1–50 characters, trimmed. |
| `instrument_date` | date, nullable | Required for CHEQUE and DD; NULL otherwise. |
| `currency` | char(3) | |
| `total` | numeric(14,2) | Greater than 0. |
| `idempotency_key` | uuid | Unique. |
| `status` | text | `ACTIVE`; `CANCELLED` is reserved for F4. Insert must be ACTIVE. |
| `created_at`, `created_by` | | Stamped by the guard. |

**`app.receipt_allocation`**

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial | |
| `receipt_id` | bigint | Composite FK `(receipt_id, centre_id)` → `receipt(id, centre_id)`. |
| `centre_id` | int | For RLS. |
| `due_id` | bigint | FK → `fee_due`. Unique together with `receipt_id`. |
| `amount` | numeric(14,2) | Greater than 0; GST-inclusive. |
| `gst_rate` | numeric(7,4) | Copied from the fee type. |
| `hsn_sac` | text | Copied from the fee type. |
| `taxable`, `cgst`, `sgst`, `igst` | numeric(14,2) | Each ≥ 0. Named check: `taxable + cgst + sgst + igst = amount`. |

Every FK is `restrict`. The named checks are mirrored in the app.

**The tax rule (DD-3).** The guard enforces it, and the insert computes it the same way, in SQL. A centre is *taxed* when `centre.gst_enabled` is true and the currency is INR (D-CUR-1).

| Centre | taxable | cgst, sgst | igst |
|---|---|---|---|
| Not taxed | amount | 0 | 0 |
| Taxed, `gst_supply = 'STATE'` | `round(amount * 100 / (100 + gst_rate), 2)` | `cgst = round((amount − taxable) / 2, 2)`, `sgst = amount − taxable − cgst` | 0 |
| Taxed, `gst_supply = 'INTERSTATE'` | as above | 0 | `amount − taxable` |

Postgres `round(numeric)` rounds half away from zero. Every amount here is positive, so this is half-up (D-FIN-4). Each line's residual stays inside the line, so the line needs no Round Off.

**Guard `receipt_guard`, BEFORE INSERT.** It is invoker, rules only, uses nested ifs, compares with `is distinct from`, and gives every raise errcode 23514 with `constraint "<name>"` in the message. Its steps:
1.  Take the lock `pg_advisory_xact_lock(hashtext('fee-dues:' || new.registration_id))`.
2.  Stamp `created_at`, `created_by` and `received_on := (now() at time zone 'Asia/Kolkata')::date`. Then require `status = 'ACTIVE'`, otherwise raise `receipt_guard`.
3.  The series row `(new.centre_id, 'FEEREC', new.period)` must exist with `current = new.number`, read `for update`. Since `allocate()` in the same transaction already holds that lock, this costs nothing. Otherwise raise `receipt_number_guard`.
4.  The period must be the financial year of `received_on`, otherwise raise `receipt_number_guard`.

**Guard `receipt_allocation_guard`, BEFORE INSERT.**
1.  Read the receipt (`registration_id`, `currency`, `centre_id`, `status`). No row raises `receipt_allocation_guard`.
2.  Take the same `fee-dues:` lock on the receipt's registration. Within the transaction it was already taken, so the call is free.
3.  Read the due. It must belong to the receipt's registration and centre, and its currency must be the receipt's. Otherwise raise `receipt_allocation_guard`.
4.  Require `new.amount <= due.gross − Σ amount of allocations of ACTIVE receipts on this due`. Otherwise raise `receipt_over_guard`. The lock makes this safe against concurrent receipts.
5.  Require `gst_rate` and `hsn_sac` to equal the fee type's current values, and the split to equal the tax rule for the centre's current `gst_enabled` and `gst_supply` and the receipt's currency. Otherwise raise `receipt_tax_guard`.

**The total check: constraint trigger `receipt_total_check`.** It is `after insert` on both tables, `deferrable initially deferred`, for each row. At commit, the receipt (or the allocation's receipt) must have at least one allocation, and `total = Σ amount`. Otherwise raise `receipt_total_guard`.

**Immutability.** Both tables get `*_no_update_delete` and `*_no_truncate` triggers executing `app.ticket_immutable()`. F4 will open a status update for cancellation.

**RLS.** Both tables have ENABLE and FORCE, with four policies each:

| Policy | Rule |
|---|---|
| select | `centre_id = any (scoped_centre_ids('student.view'))` (DD-7, PMC) |
| insert | `centre_id = any (scoped_centre_ids('fee.collect'))` |
| update, delete | `using (false)` |

**Numbering (DD-4).** gems_app gains `insert (centre_id, doc_type, period, gap_rule, current)` on `number_series`; the existing `scope_insert` policy applies. The app creates a missing row (`current 0`, `GAPLESS`) with `on conflict do nothing`, then calls the existing `allocate()`.

**Permission.** `('fee.collect', 'Collect fees and issue receipts at a centre', false)`, plus the `system_admin` grant.

**Grants.**
*   `select` and `insert (id, centre_id, registration_id, period, number, receipt_no, mode, reference, instrument_date, currency, total, idempotency_key)` on `receipt`.
*   `select` and `insert (receipt_id, centre_id, due_id, amount, gst_rate, hsn_sac, taxable, cgst, sgst, igst)` on `receipt_allocation`.
*   Usage on both sequences.

### Server (`src/server/receipts.ts`)

```ts
export const FEE_GATES = { collectionLive: false }; // DD-5: committed closed
export const FEE_POLICY = { receiptNo: (centreCode: string, period: string, n: bigint) => `${centreCode}/${period.slice(2, 4)}${period.slice(5, 7)}/${n}`, maxLength: 16 }; // PMC (NP-5)
export const MODES = ["CASH", "CHEQUE", "DD", "BANK_TRANSFER", "UPI", "CARD"] as const;
export type CollectInput = { registrationId: string; amount: string; mode: string; reference?: string; instrumentDate?: string; idempotencyKey: string };
export async function collectFee(session, personId, input): Promise<{ receiptId: string; receiptNo: string; replay: boolean }>
export async function getReceipt(session, receiptId): Promise<ReceiptView>   // RbacError notfound when invisible or malformed
```

**`collectFee`** runs these steps:
1.  **Gate.** If the gate is closed, throw `RbacError("invalid", …, "fee.receipt.closed")`.
2.  **Validation**, in this order. Each message names its field:
    *   `registrationId` must be a UUID, else `PersonError("notfound")`;
    *   `idempotencyKey` must be a UUID;
    *   `amount` must match `^\d{1,12}(\.\d{1,2})?$` and be greater than 0 (compared in SQL later);
    *   `mode` must be one of the listed modes;
    *   `reference`: required unless CASH, refused for CASH, 1–50 characters;
    *   `instrumentDate`: required for CHEQUE and DD, refused otherwise, an ISO date not after today.
3.  **Replay.** A `withScope` read of `receipt` by `idempotency_key`, under the caller's RLS, returns `{ replay: true }` if a row exists. It writes no audit row.
4.  **Pre-flight**, as in dues:
    *   the registration must belong to `personId` and sit inside `student.view` scope, else `PersonError("notfound")`;
    *   then reserve `nextval('app.receipt_id_seq')`.
5.  **The action.** `scopedAction({ action: "fee.receipt.create", permission: "fee.collect", centreId, targetType: "receipt", targetId })` runs inside `receiptDb`:
    1.  `authorize(tx, "student.view", centreId)`.
    2.  The trading gate: the centre must be ACTIVE.
    3.  Take the `fee-dues:` lock.
    4.  Read the open dues with their outstanding and currency. If there are none, throw `fee.receipt.nothing`. If `amount > Σ outstanding` (compared in SQL), throw `fee.receipt.over`.
    5.  Find the period: `financialYear(now)`. Create the series row if it is missing, then `allocate()`. Format the number; if it is longer than `maxLength`, throw `fee.receipt.numberlength`. This rolls back, so no number is used.
    6.  Insert the receipt.
    7.  Insert the allocations in one `insert … select`. It uses a window over the open dues ordered `(due_on, id)`: `least(outstanding, greatest(0, amount − Σ outstanding of the earlier dues))`, keeping rows above 0. The tax is computed by the DD-3 rule.
    8.  Return the count and `total::text`.
6.  **Audit detail.** `{ after: { receiptNo, total, mode, lines } }`. It holds no reference numbers (DD-8).
7.  **Concurrent double submit (G3).** A `23505` on `receipt_idempotency_key_key` aborts that transaction. `collectFee` catches it, re-reads by key, and returns the original with `replay: true`.
8.  **`receiptDb` error mapping.**

    | Error | Becomes |
    |---|---|
    | `23514` / `23503` | `fee.receipt.mismatch` |
    | `receipt_over_guard` | `fee.receipt.over` |
    | `42501` | `Forbidden` |
    | `40P01` | thrown as-is |

**`duesForPerson`** (in `dues.ts`) gains the following:
*   each `DueRow` gets `paid` and `outstanding`, as `::text` computed in SQL;
*   each `RegistrationDues` gets `outstanding` (`string | null`), `receipts: { id, receiptNo, receivedOn, total, mode }[]` (newest first) and `canCollect`;
*   `canCollect` is true when all of these hold: the gate is open, outstanding is above 0, the centre is ACTIVE, and `app.has_permission('fee.collect', r.centre_id)`.

**`getReceipt`.**
*   It reads the header: centre code, name and GSTIN; the learner's name; the course code and name; the register number; number, date, mode, reference and total.
*   It reads the lines: fee type, instalment, HSN/SAC, rate, taxable, CGST, SGST, IGST and amount.
*   It computes totals in SQL.
*   Under RLS a receipt outside scope is not found.

**`ADMIN_MESSAGES`**

| Key | Message |
|---|---|
| `fee.receipt.closed` | "Fee collection is not switched on yet." |
| `fee.receipt.nothing` | "Nothing is outstanding for this course." |
| `fee.receipt.over` | "The amount is more than what is outstanding." |
| `fee.receipt.numberlength` | "The receipt number would be too long; ask head office." |
| `fee.receipt.mismatch` | "The receipt did not match the dues; nothing was saved." |

The field labels are Amount, Mode, Reference, Instrument date and Request.

### Pages and routes

*   **The learner page's Fees row.** The dues table gains Paid and Outstanding columns. Below it:
    *   the registration's receipts, each linking to `/receipts/<id>`;
    *   when `canCollect`, a "Collect" form. It has `amount` (prefilled with the outstanding), `mode` (a select), `reference`, `instrumentDate` (a date input), and hidden `registrationId` and `idempotencyKey` fields. The key is `randomUUID()` at render, so every form render is a new request and every retry of that render is the same request.
*   **`POST /students/[personId]/receipts`.** It uses `safeRoute`, checks the UUID, then calls `adminPost`. On success it goes to `/receipts/<id>?saved=1`.
*   **`/receipts/[id]` page.** A plain, printable receipt. The id must match `^\d{1,18}$`, otherwise 404; a receipt that is not found is also a 404 (via `pageRead`).

### Tests (`tests/fee-receipts.test.ts`)

**Fixtures:**
*   role 30 `fee_collect` (`fee.collect`, `student.view`);
*   user `…00f8` at centre A, with `tok-feeC`;
*   the `fee.collect` permission;
*   `receipt_allocation` and `receipt` in the truncate list.

The tests set `FEE_GATES.collectionLive = true` and restore it afterwards. The seed is `seedFeePlan()` plus dues created by `tok-feeD`. The centre's GST is set per test as the owner.

| ID | Goal | What it does |
|---|---|---|
| T-FR-001 (T-FEE-001/002/003/010) | G1 | Full and partial payment, oldest first across instalments, with exact CGST/SGST. Also covers INTERSTATE (IGST) and an untaxed centre. Numbers 1, 2, 3 per centre per financial year, with `receipt_no` formatted. Refusals: over and nothing outstanding; each field message in order; the gate closed; a viewer (Forbidden, DENIED audit); another person's registration and out of scope (notfound); an inactive centre; an over-length number. Checks the audit detail and that no number is used by a refused receipt. |
| T-FR-002 | G2 | Raw SQL as gems_app, with a refusal by name for each of: another registration's due; another currency; over-allocation; a wrong rate, HSN, taxable or split; a receipt without lines and a wrong total (at commit); a number that is not the series current; a non-ACTIVE insert; a past date (stamped to today). Also: two sessions allocating the last rupee of one due (the second refused); RLS on four commands; update, delete and truncate refused, even as the owner. |
| T-FR-003 (T-FEE-007/008/009) | G3 | The same key returns the same receipt with no second number. Two concurrent submits with one key give one receipt. Concurrent receipts for two learners on one series give distinct, consecutive numbers. |
| T-FR-004 | G4 | `duesForPerson`: paid, outstanding, receipts, `canCollect`. `getReceipt`: lines and totals; another centre's receipt is notfound. The route: same origin, success to `/receipts/<id>?saved=1`, field errors back on the learner page, 404s. |

Changes to existing tests:
*   T-RLS-002 lists `receipt` and `receipt_allocation`;
*   T-AUD-009 adds the `receipts.ts` scan and `fee.receipt.create`;
*   T-FD-001's expected `duesForPerson` shape gains the new fields.

The smoke checks cover three things: the learner page's Fees row for a viewer, which has no Collect form while the gate is closed; `/receipts/abc` returns 404; and a foreign-origin post to the receipts route is refused.

## Decisions (recommended options)

1.  **DD-1: one registration per receipt; oldest first.**
    *   Allocation is oldest first by `(due_on, id)`, which follows fee order within an instalment (D-FEE-4).
    *   Partial payment is allowed. Overpayment is refused until advances (D-FIN-9) and the ledger exist.
    *   Collection is allowed whatever the registration's status, because arrears stay owed.
2.  **DD-2: offline modes only.** The modes are CASH, CHEQUE, DD, BANK_TRANSFER, UPI and CARD. A reference is required for every mode except cash; an instrument date for cheques and DDs. Online gateways come with D-FEE-3.
3.  **DD-3: tax at receipt (D-FIN-2).**
    *   The rate and HSN/SAC are copied from the fee type.
    *   CGST+SGST or IGST follows the centre's `gst_supply`.
    *   An unregistered centre, or one using another currency, charges no GST (D-CUR-1).
    *   Rounding is half-up per line, with the residual kept inside the line (D-FIN-4).
    *   Place of supply, read as the centre's registration, is PMC for the tax advisor.
4.  **DD-4: FEEREC numbering.**
    *   Numbering is per centre and financial year, gapless, and runs in the receipt's transaction (NP-1/2/3/6).
    *   A missing series row is created at 0.
    *   The format `{centreCode}/{yyyy short}/{n}`, e.g. `KL2-25/2627/123`, is PMC (NP-5) and limited to 16 characters. A longer number refuses the receipt.
5.  **DD-5: `FEE_GATES.collectionLive` is committed `false`.** It opens only after all of these:
    *   the tax advisor checks NP-5 and DD-3;
    *   Accounts' worked examples pass;
    *   the cutover year's FEEREC counters are seeded from legacy (NP-8). Otherwise a centre would restart at 1 inside a year that already has legacy numbers.
6.  **DD-6: out of scope.** This is the Non-Goals list.
7.  **DD-7 (PMC): who sees receipts.** Receipts are visible to `student.view` at the centre, as dues are (fee-dues DD-5).
8.  **DD-8: the audit keeps no instrument references.** It records the number, total, mode and line count.

## Alternatives Considered

*   **A receipt across several registrations.** Rejected: one allocation order and one lock per receipt keep the proof simple. A learner with two courses pays twice.
*   **Allocation computed in TypeScript.** Rejected under F13: money stays in SQL.
*   **A Postgres sequence for numbers.** Rejected under C-02.2: it is not gapless.

## Risks and Limits

*   The database proves that the number equals the series counter. It cannot stop a stray counter increment by other code from leaving a gap: `gems_app` holds UPDATE on `number_series`. A gap report belongs to the reconciliation piece.
*   Rates follow the fee type at receipt. A rate change between two instalments taxes them differently, which is the tax-at-receipt rule.
*   An owner can still disable triggers until D-FIN-8 exists.
