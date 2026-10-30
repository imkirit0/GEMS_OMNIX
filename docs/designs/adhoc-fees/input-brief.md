# Ad-hoc fees collected with the receipt (Stage 4, F3b; WF4): input brief for `egm-draft`

Prepared 2026-10-30 at the owner's instruction "DO THE NEXT STEP", after F4a (E-053). Evidence classes: SRC, PRO, PMC.

## 1. What it is (SRC, PRO)

**Approved decision D-FEE-1** (E-049): an ad-hoc fee is a fee with no prior due, such as a re-exam fee, an exam processing fee or an academic kit. Its due is created in the same transaction as the receipt that collects it, so every receipt line still points at a due and stays reconcilable.

**What the SPEC shows:**
- R-061 (Miscellaneous Fee Assign, p. 49) assigns misc fees to learners, with a fee type, an amount and a due date.
- R-051 (Fee Type Master) marks some fee types as "misc".

**Fee-dues DD-7** chose one dues table for both kinds. Ad-hoc dues add a `source` column (`PLAN` or `ADHOC`), and their plan columns are nullable. The plan-line FK then applies to PLAN rows only (MATCH SIMPLE).

## 2. What exists

**Dues.** `fee_due` holds dues copied from the plan, with every plan column NOT NULL. Its guard proves each due against the plan, and RLS insert is limited to `fee.dues`.

**Receipts (F3, F4a).**
- Lines point at dues.
- `fee_due_balance` gives outstanding.
- The allocation guard stamps GST from the due's fee type.
- `collectFee` allocates oldest first.
- A cancelled receipt restores outstanding.

## 3. Decisions taken under the owner's instruction (recommended options)

- **DD-1: who collects.** A collector (`fee.collect`) adds up to 5 ad-hoc items to a receipt, each a fee type and an amount. The database creates each item's due in the same transaction, with today's date (IST), and allocates it fully.
- **DD-2: the database guarantees the ad-hoc dues.** An ad-hoc due is paid in full, at commit, by a line of an ACTIVE receipt in the same transaction. It never appears as owed:
  - collection and the learner's outstanding count PLAN dues only;
  - if its receipt is cancelled, the ad-hoc due is void and is not owed.
- **DD-3: fee types and amounts (PMC).** Any active fee type may be used ad hoc, and the cashier enters the amount, because no misc price master exists yet (R-058). Accounts may later restrict this to a list of misc fee types and fixed prices.
- **DD-4: out of scope.**
  - Assigning misc fees to many learners ahead of time (R-061 bulk).
  - A misc price master (R-058).
  - Ad-hoc dues without a receipt.
