# Fee collection and receipts (Stage 4, third piece F3; WF4): input brief for `egm-draft`

This brief was prepared on 2026-10-30. The owner said "yes do the next step" on 2026-10-30, after F2 fee dues (E-051).

Evidence classes: SRC, INF, PRO, PMC.

Sources:
- audit 07: receipt, allocation, invariants F3, F4, F8, F11, F13, F19, and §3 offline collection;
- the v1.6 dues model;
- approved decisions E-049: NP-1…8, D-FEE-1/4/5, D-FIN-1/2/4/9, D-CUR-1;
- the built dues (E-051) and the numbering mechanism (POC P3, `src/server/numbering.ts`).

## 1. What it is (SRC, PRO)

- **WF4 (WF p. 9):** a centre collects a learner's fee. The receipt is allocated against dues, oldest first. A tax invoice is issued at receipt (D-FIN-2).
- **Receipt numbers:**
  - Numbers are per centre (NP-1) and reset each financial year (NP-2).
  - They are gapless (NP-3).
  - Cancelled numbers are kept and never reused (NP-4).
  - Numbers use legacy prefixes: FEEREC for offline fee receipts (NP-6).
  - The format is legacy, within the GST limit of 16 characters. The tax advisor checks this (NP-5).
  - Numbering continues from the legacy counters (NP-8).
- **Allocation order (D-FEE-4):** oldest due date first, then fee order.
- **GST (D-FIN-4):** computed per line, rounded half-up, with any residual going to Round Off. GST applies in India only (D-CUR-1).
- **Accounting basis:** cash (D-FIN-1).
- **Advances:** unapplied payments are a liability (D-FIN-9).

## 2. What exists

- **Dues:** `fee_due` holds gross amounts only. Dues never change. Every writer of a registration's money takes the `fee-dues:<registrationId>` lock (v1.6).
- **Fee types:** each carries `hsn_sac` and `gst_rate`. Plan amounts include GST (fee-structure DD-1).
- **Numbering:** `app.number_series(centre_id, doc_type, period, gap_rule, current)` exists. Its RLS covers the visible centres. `allocate()` takes a row lock in the caller's transaction. The test fixtures seed FEEREC and INV rows.
- **Release gates:** the gate pattern is `TICKET_GATES` / `CATALOGUE_GATES`, committed closed.

## 3. Decisions taken under the owner's instruction (recommended options)

- **DD-1: one receipt per registration.**
  - Each receipt is allocated across that registration's open dues in the order `(due_on, id)`. Ids follow fee order within an instalment (F2 D5).
  - Partial payment is allowed. Paying more than is outstanding is refused, because advances (D-FIN-9) need the ledger.
- **DD-2: offline modes only.**
  - The modes are CASH, CHEQUE, DD, BANK_TRANSFER, UPI and CARD.
  - Online gateways come later, under D-FEE-3 (the gateway names are still open).
- **DD-3: GST is computed at receipt, for each allocation.**
  - The fee type's current rate and HSN/SAC are copied onto the allocation.
  - Taxable = round(amount × 100 / (100 + rate), 2), rounded half-up. Tax = amount − taxable.
  - CGST = round(tax / 2, 2). SGST = tax − CGST. Any residual stays inside the line, so the line never needs a Round Off posting.
  - Supply is treated as intra-state: CGST and SGST only. Place of supply is PMC.
  - When the currency is not INR, no GST is charged.
- **DD-4: numbering.**
  - The series is FEEREC, per centre and financial year. Numbers are allocated in the same transaction as the receipt.
  - A series row is created on first use (gapless).
  - The formatted number is PMC.
- **DD-5: release gate `FEE_GATES.collectionLive`, committed `false`.** It opens only once all of these are done:
  - the tax advisor has checked NP-5 and the GST split;
  - Accounts' worked examples pass;
  - each centre's FEEREC counter for the cutover year has been seeded from legacy (NP-8).
- **DD-6: out of scope.**
  - Ad-hoc dues (D-FEE-1) become their own piece, using F2's DD-7.
  - Cancellation is F4.
  - Ledger journals (F1, D-FIN-1) and the hash-chained finance audit (D-FIN-8) are later pieces.
  - Online payments, refunds and advances are also out.
