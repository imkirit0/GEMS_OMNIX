# Fee ledger, posted at receipt and at cancellation (Stage 4, F1; WF4): input brief for `egm-draft`

**Prepared:** 2026-10-30, under the owner's standing instruction of the same day: "keep working … agree on the recommended option … finish everything". This follows F3b (E-054).

**Evidence classes used:** SRC, PRO, PMC.

## 1. What it is (SRC, PRO)

**From the specification (SPEC p. 15, R-040, R-042, R-044.01):**
- The Accounts sub-application is "the double-entry ledger behind fee receipts". Every fee type maps to an account head, and receipts post with the GST split.
- The chart of accounts has 31 heads. Income: Academic Kit (3920), Additional Registration Fee (6871), Caution Deposit (3724), Course Fee (3909), Down Payment (3922, 3954), Exam Fee (3923), Exam Processing Fee (3955), Registration Fee (3908), Round Off, Voucher Fee (3919), Welcome Kit Cost (3921), and others. Assets: Admission Fee Receivable (3903). Liabilities: CGST (3910), SGST (3911), IGST (4385), Excess Fee, Fee_Transfer. Expense: Bank Charges, Purchase.
- The Day Book (R-044.01) shows Transaction Date, Reference No., Ledger Name, Debit, Credit and Narration.

**From the approved financial decisions (audit 07 F1/F2/F6, E-049):**
- D-FIN-1: the books are kept on a cash basis.
- Every posted journal balances.
- Posted journals are immutable; corrections are made only by reversal.
- Cancelling a receipt means a reversing journal.
- D-FIN-2: tax is due at receipt.

**From the earlier fee designs:**
- F3 DD-5 keeps collection switched off until the ledger posts in the receipt's own transaction.
- F4a DD-6: the reversing journal posts on the IST date of `cancelled_at`.

## 2. What exists

- **Receipts and lines.** The database stamps the taxable amount and the CGST, SGST and IGST on every line. Every line has a fee type, through its due. Receipts carry `mode`, `received_on` and `period` (the financial year).
- **Cancellation.** It changes `status` to CANCELLED and stamps `cancelled_at`.
- **Not yet built.** There are no accounts and no journals.

## 3. Decisions taken under the owner's instruction (recommended options)

- **DD-1: the database posts, not the app.**
  - A security-definer posting function writes the journal of a receipt when the receipt transaction commits (a deferred trigger).
  - It writes the reversal when a receipt is cancelled.
  - The app never writes journals; gems_app has no insert grant on them.
  - A receipt therefore cannot exist without its balanced journal.
- **DD-2: the chart is seeded from the SPEC heads.** Each account carries a system key for the cash, bank and GST accounts it is posted to.
  - Each fee type maps to one income account (`fee_type.account_id`).
  - An unmapped fee type refuses the receipt ("fee type has no account").
  - Mapping a fee type is done by fee setup, audited.
- **DD-3: payment modes.** CASH posts to Cash in hand. Every other offline mode posts to a "Bank (clearing)" account. Real bank accounts (R-035) and deposits come later. This is PMC for Accounts.
- **DD-4: the receipt journal.**
  - Debit the cash or bank account with the total.
  - Credit each income account with the sum of its lines' taxable amounts.
  - Credit CGST, SGST and IGST with their sums.
  - The entry is dated `received_on`, and its reference is the receipt number.
  - The cancellation journal mirrors it, dated on the IST date of `cancelled_at`, and links to the original journal.
- **DD-5: reading.** A new permission, `ledger.view` (centre-scoped), gives access to a Day Book page for a centre and a date range, with totals.
- **DD-6: out of scope.**
  - Managing accounts (R-042 page), banks (R-035), journal and voucher prefixes (R-041) and the other A/c reports (R-044).
  - Periods and period close (F12), opening balances, and the hash-chained finance audit (D-FIN-8, its own piece).
