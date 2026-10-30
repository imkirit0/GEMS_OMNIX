# Fee holds (Stage 4, F4b; WF4): input brief for `egm-draft`

**Prepared:** 2026-10-30, under the owner's standing instruction of the same day ("keep working … agree on the recommended option … finish everything"). This follows F1, the ledger (E-055).

**Evidence classes used:** SRC, PRO, PMC.

## 1. What it is (SRC, PRO)

- **R-067 Fee Hold/Unhold (+ report)** (SPEC p. 50). The screen filters by Centre, Academic Year and Course, and has a Hold List and an Unhold List. The report filters by Fee Type and by Report Type (All, Hold or UnHold).
- **D-FEE-5** (approved, E-049): the meaning of a fee hold is "excluded from collection and reminders".
- **Audit 07 §1** (as revised in v1.6): holds are append-only rows that reference `fee_due.id`, and never columns on the due.

## 2. What exists

- **Dues.** PLAN dues per registration. `fee_due_balance` gives `owed` (PLAN only) and `outstanding`.
- **Collection.** It allocates to dues oldest first, by `owed > 0`. Every writer of a registration's money takes the `fee-dues:` lock. The allocation guard runs per line.
- **Reminders.** There are none yet (Stage 6/7).

## 3. Decisions taken under the owner's instruction (recommended options)

- **DD-1: holds are recorded per due.**
  - A holder of `fee.hold` at the centre holds or releases one PLAN due, with a reason.
  - Each action is an append-only event (HOLD or RELEASE).
  - A due's current state is its latest event.
- **DD-2: a held due stays owed but is not collected.**
  - The learner's outstanding still counts it, and the page shows it as held.
  - Collection skips it, both in the oldest-first allocation and in the "over the amount" check.
  - The database refuses any receipt line against a held due.
- **DD-3: the hold list per centre.**
  - Shows the dues currently held, filterable by fee type.
  - Shows the hold and release history as a report.
- **DD-4: who can hold.** `fee.hold` is not sensitive (PMC). Holds never move money.
- **DD-5: out of scope.**
  - Reminders, which arrive with Stage 6/7 and will skip held dues.
  - Bulk hold by course or year.
  - Holds on ad-hoc dues.
