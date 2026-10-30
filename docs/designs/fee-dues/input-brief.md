# Fee dues (Stage 4, second piece F2; WF4): input brief for `egm-draft`

Prepared 2026-10-30 from audit 07 (the `fee_due` entity; invariants F4, F13 and F17), the approved Stage 4 decisions (E-049) and the built fee structure (E-050). Owner, 2026-10-30: "yes do the next step". Evidence classes: SRC, INF, PRO, PMC.

## 1. What it is (SRC, PRO)
- **Audit 07, §1.** `fee_due` holds registration, fee type, caption, due date, gross, concession, fine, currency and a hold flag. Outstanding = gross − concession + fine − Σ active allocations, and is never below 0 (F4).
- **WF4 (WF p. 9).** At admission, the learner's dues come from the fee structure. Collection (F3) then allocates receipts against dues, oldest first (D-FEE-4).
- **R-063 Balance Due Posting** carries last year's balances into the new year. That is year rollover; it comes later.

## 2. What exists
- Registrations: one per admitted course, at a centre, in an academic year through its admission.
- Fee plans: published, immutable and versioned (E-050). `resolvePlan(tx, centre, course, year)` returns the centre override if there is one, otherwise the class plan, never a draft, and gives the plan's currency.
- Centres have no currency column yet. D-CUR-1 says one currency per centre.

## 3. Decisions taken under the owner's instruction (recommended options)
- **DD-1: one due per registration, fee type and instalment.** Each due is copied from the plan that `resolvePlan` returns for the registration's centre, course and year. The copy carries the amount, the instalment's due date, the fee type, the plan id and the currency. Dues are never repriced when a newer plan is published.
- **DD-2: dues are created on purpose, not inside `admit()`.**
  - A centre user with the new permission `fee.dues` (centre-scoped) presses "Create dues" on the learner page, for each registration.
  - It runs once per registration and is refused when the registration already has dues.
  - It is refused when no published plan prices the course there, so admitting a learner never fails for lack of a fee plan.
- **DD-3: dues are immutable here.** Concession (F5), hold and amount change (F4) and allocations (F3) are later pieces. They will add their own records, not rewrite dues. F2 stores only `gross`.
- **DD-4: currency.**
  - `centre.currency` is added, `char(3)` with default `'INR'`.
  - Creating dues is refused when the plan's currency differs from the centre's.
  - The due records its currency.
- **DD-5: who sees dues.** Dues are shown on the learner page to anyone with `student.view` at the centre, with a total per registration. They are personal financial data, so they are scoped by centre.
- **DD-6: out of scope:**
  - ad-hoc dues, which are created with their receipt (D-FEE-1, in F3);
  - balance carry-forward (R-063);
  - schemes and fines;
  - bulk creation for many learners (later);
  - the legacy fee import (paused).
