# 07 Financial invariants and transaction design (v1.1)

Status: **specification only; no posting code may be written for production until Gate G-FIN** (end of Stage 3), when Accounts signs the items marked UNAPPROVED below. Financial code may be built and tested against the defaults in non-production environments only. Each default sits behind a configuration flag whose production value stays unset until approved (01 §C-07).

Owner of every policy: **Accounts** (Certification co-owns numbering).

## 1. Entities (PRO)
- **Fee structures and dues**
  - `fee_structure`: AY; centre class or centre; course; fee type; amounts per caption.
  - `fee_due`: registration, fee type, caption, due date, gross, concession, fine, currency, hold flag.
  - `concession_application`: due, scheme, rule, amount, source (admission, scheme edit, ticket).
- **Receipts and payments**
  - `receipt`: number, centre, student, date, currency, total, mode, instrument, status Active/Cancelled, unique `idempotency_key`, unique nullable `payment_attempt_id`.
  - `receipt_allocation`: receipt, due, amount, taxable, cgst, sgst, igst.
  - `unapplied_payment`: advances and application fees (D-FIN-9).
  - `payment_attempt`: gateway, MID, order id, amount, state machine Generated→Processed→Success/Failed, idempotency key.
  - `gateway_event`: raw payload, verified flag, unique (gateway, event id).
  - `settlement` + `settlement_line`.
  - `refund`: blocked until D-FIN-5 is approved.
- **Ledger and periods**
  - `account` (chart, SPEC p15) and `fee_type_account_map`.
  - `journal_entry`: number, FY, period, date, source, status Draft/Posted, `reversal_of`.
  - `journal_line`: account, centre, debit or credit.
  - `accounting_period`: Open/Closed.
  - `number_series` (see 01 §C-02).
- **Royalty**
  - `royalty_rate`: effective-dated, per centre.
  - `royalty_period`: centre, month, frozen inputs, amount, tax, status.

## 2. Invariants (each enforced in the DB where possible; each has a test)
| ID | Invariant | Enforcement | Tests | Approval state |
|---|---|---|---|---|
| F1 | Every posted journal balances (Σ Dr = Σ Cr > 0) | Deferred constraint trigger at commit | T-FEE-001 | Technical: needs Accounts acknowledgement |
| F2 | Posted journals and receipts are immutable; corrections only by reversal | Triggers + revoked privileges | T-FEE-012, T-AUD-004 | Ack |
| F3 | Receipt total = Σ allocations (+ unapplied part) | Constraint trigger | T-FEE-001 | Ack |
| F4 | Allocation ≤ outstanding; outstanding = gross − concession + fine − Σ active allocations ≥ 0 | Row lock + check | T-FEE-010 | Ack |
| F5 | Overpayment → Excess Fee liability | Posting rule | T-FEE-006 | **UNAPPROVED** |
| F6 | Cancellation = status change + reversing journal + reversed allocations, in one transaction; links kept | Service + F2 | T-FEE-012, 013 | Ack (window/approver D-FIN-3 UNAPPROVED) |
| F7 | Receipt numbers unique within the approved scope; gapless only if NP-3 says so | `number_series` row lock + unique index | T-NUM-001…010 | **Policy UNAPPROVED (NP-1…8)** |
| F8 | GST split exact; residual per D-FIN-4; no GST for non-Indian centres | Posting function + check | T-FEE-003…005, 016 | **UNAPPROVED** (D-FIN-4, D-CUR-1) |
| F9 | One receipt per successful payment attempt | Unique `payment_attempt_id` | T-FEE-018, 019 | Ack |
| F10 | Success only after signature verification + server recheck + amount/order match; no backward transitions | State machine + unique event | T-FEE-020…022 | Ack |
| F11 | Idempotent collection | Unique `idempotency_key` | T-FEE-007, 008 | Ack |
| F12 | No posting into a Closed period; back-dated corrections post in the open period with a reference | Trigger | T-FEE-015 | **UNAPPROVED** (rule) |
| F13 | `numeric(14,2)`, one currency per receipt/journal, no floats | Types + lint | T-FEE-017 | Ack |
| F14 | Settlement totals tie; differences recorded, never absorbed | Constraint + report | T-FEE-023 | Ack |
| F15 | Receivable control = Σ outstanding dues | Nightly job | T-FEE-028 | Only if accrual (D-FIN-1 UNAPPROVED) |
| F16 | Unapplied cash tracked until applied or refunded | Liability account + check | T-FEE-024 | **UNAPPROVED** (D-FIN-9) |
| F17 | Fee balance per student = Σ dues − Σ concessions + Σ fines − Σ active allocations, recomputable from records | Reconciliation query | T-FEE-028 | Ack |
| F18 | Report totals come only from the documented rules (SPEC p45), one implementation shared by screen, export and API | Shared query module | T-RPT-001…009, T-API-003 | Rules SRC; D-ADM-2 UNAPPROVED |
| F19 | Failed transactions leave no partial business update (number, audit, stock, ticket) | Single transaction per command | T-TKT-007, T-NUM-002, T-AUD-002 | Ack |
| F20 | Royalty inputs frozen per period; recompute idempotent | Snapshot table | T-ROY-002, 003 | **Formula UNAPPROVED** (D-ROY-2) |
| F21 | Migration differences reported, investigated and signed off; never auto-balanced | K7, K8 checks | T-MIG-007, 008 | D-MIG-3 UNAPPROVED |

## 3. Transaction boundaries
- **Offline collection** runs in one transaction:
  1. RLS scope.
  2. authorize.
  3. Idempotency lookup.
  4. Lock the student's open dues `FOR UPDATE`.
  5. Validate F4.
  6. Allocate the number (C-02).
  7. Insert receipt and allocations.
  8. Build the journal (composition depends on D-FIN-1).
  9. Post: F1 checked at commit.
  10. Audit row.
  11. Commit.

  Any failure rolls back everything, including the number.
- **Online payment.**
  - Creating the attempt is one transaction.
  - The callback runs in this order:
    1. Insert `gateway_event` (dedupe).
    2. Verify the signature.
    3. Server recheck (outside the DB transaction).
    4. One transaction: state transition, then the same collection routine with `idempotency_key = attempt.id`.
- **Cancel, transfer, refund and scheme edit.** The final ticket approval and the domain `apply` commit together (T-TKT-005, 007).
- **Settlement import.** One transaction per file. Unmatched lines go to exceptions.
- **Concurrency.** Row locks on dues and the number series. Deadlock/serialization errors are retried up to 3 times with jitter. Retries reuse the same idempotency key.

## 4. Decimal and rounding
- Amounts are `numeric(14,2)`. Rates are `numeric(7,4)`.
- Application code uses decimal.js. No JS `number` arithmetic is used for money.
- Rounding is **UNAPPROVED (D-FIN-4)**. The default is per line, half-up to 2 dp, with the residual posted to Round Off (that account exists, SPEC p15).

## 5. Reconciliation (schedule UNAPPROVED; stored in `reconciliation_run`; non-zero differences alert Accounts)
1. **Daily:** receipts by centre, day and mode = cash/bank journal lines.
2. **Daily:** gateway successes ↔ receipts ↔ settlements.
3. **Nightly:**
   - trial balance per FY = 0;
   - F15 (if accrual);
   - F17 sample.
4. **Monthly:** royalty inputs frozen (F20).

## 6. Periods and year end (UNAPPROVED cadence)
- **Monthly period close** needs Accounts permission + step-up.
- **FY close** needs:
  - all periods closed;
  - trial balance = 0;
  - clean reconciliation;
  - closing entries (I&E to Accumulated Fund);
  - opening balances posted.
- **Reopening** a period needs a ticket + audit.
- **AY rollover** (dues carry-over, number series) follows D-YEAR-2/3 and NP-2.

## 7. Historical fee imports and financial migration
- Paid Fee Import and migrated receipts post into an "opening/migration" period (D-FIN-7, UNAPPROVED).
- Legacy imbalances (SPEC p16 "Invalid Bank Transactions") are listed per voucher, with an Accounts-approved treatment for each (D-MIG-3). **No balancing entries are manufactured.**
- The XLS workbook carries no receipts or ledger. It cannot support financial migration (08 §2).
