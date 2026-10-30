# Fee masters and fee structure (Stage 4, first piece F1; WF4): input brief for `egm-draft`

Prepared 2026-10-30 from the SPEC (R-050, R-051, R-057, R-059, R-073), the WF PDF (p. 9), audit 07 and the decisions the owner approved on 2026-10-30 (E-049). The owner said "yes do the next step". Evidence classes: SRC, INF, PRO, PMC.

## 1. Why this piece first (INF)
The G-FIN gate's decisions part is met (E-049). Stage 4 has about 30 requirements, so it is cut into pieces that each move less money than the one after:
- **F1 fee masters and structure** (this piece; no money moves);
- F2 dues;
- F3 collection and receipts;
- F4 corrections (cancel, change, hold);
- F5 schemes;
- then transfers, online payments and reports.

## 2. What it is (SRC)
- **R-050 Fee Category:** a name and a listing order. There are 12 categories: ADMISSION FEE, COURSE FEE, Academic Kit, Exam Fee, EXAM PROCESSING FEE, Material Cost, Misc Fee, MSU Certification Fee, RE-EXAM PROCESSING FEE, RE-EXAMINATION FEE, Term Fee I, Voucher Fee.
- **R-051 Fee Type:**
  - its category, a name, a short code, a fee order and an HSN/SAC code (e.g. REGISTRATION FEE 999293);
  - flags: misc, royalty, course fee, down payment, add admission fee, excluding GST;
  - a fee particular (REGISTRATION, DOWN PAYMENT, COURSE FEE, MATERIALS, MISCELLANEOUS);
  - legacy layout fields (term, monthly and yearly amounts).
- **R-057 Fee Caption (instalments):** per academic year, a name, a due date, a sort order and a down-payment flag. Example: INSTALLMENT 1, due 30-11-2025.
- **R-059 Regular Fee Assign:** amounts per academic year × course × fee type × caption, keyed by centre (or, in the "Beta" form, by centre class over many centres). Options: Optional Fee, Excluded from consolidated, Bank Account.
- **R-073 Fee Particulars:** a caption, an HSN code and a receipt type.

## 3. What exists (code)
- Academic years (`app.academic_year`, codes like 2026-27).
- Courses with the KELTRON share.
- Centre classes (METRO …), each centre with its class.
- The catalogue setup pattern: `catalogue.manage`, adminWrite (step-up, audited), everyone reads, named checks.
- Money has no table yet. Audit 07 F13: `numeric(14,2)`, one currency, no floats.

## 4. Decisions taken under the owner's instruction (recommended options)
- **DD-1: masters.**
  - Fee categories: code, name, order, active.
  - Fee types: code, name, category, fee order, SAC/HSN code, GST rate (%), and flags. The flags are:
    - royalty-bearing;
    - course fee;
    - down payment;
    - GST-inclusive. This is the legacy "excluding GST" flag inverted. Its meaning goes to PRO; the default, which is PMC, is that amounts include GST.
- **DD-2: captions** (instalments) per academic year: name, due date, sort order, down-payment flag.
- **DD-3: fee plans.**
  - A plan is per academic year × course × centre class. A per-centre override plan beats the class plan, as in the SPEC's two assign screens.
  - Its lines are fee type × caption × amount, as `numeric(14,2)` ≥ 0.
  - A plan is edited while it is a draft and frozen once published. Dues (F2) will copy from published plans.
  - A published plan is never edited. A new version supersedes it.
- **DD-4: one sensitive permission, `fee.setup`** (ALL scope, step-up, audited with values). Any signed-in user reads masters and published plans; drafts are visible to `fee.setup` only.
- **DD-5: out of scope:**
  - dues, receipts and schemes (F2–F5);
  - fines (D-FEE-6: not built);
  - the legacy School-ERP groupings (R-056, empty);
  - bank accounts per plan (later, with F3 posting);
  - the term, monthly and yearly layout fields (captions replace them);
  - the legacy imports (paused).
