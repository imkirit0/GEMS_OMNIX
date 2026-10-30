# Schemes and concessions (Stage 4, F5; WF5): input brief for `egm-draft`

**Prepared:** 2026-10-30, under the owner's standing instruction of that day ("keep working … agree on the recommended option … finish everything"). This follows F4b holds (E-056).

**Evidence classes:** SRC, PRO, PMC.

## 1. What it is (SRC, PRO)

**WF5 (WF pp. 10–11).**
1. Head office creates a scheme: a name, and valid from and to dates.
2. It chooses the scheme's nature: normal, or constant or variable, as a % or an amount.
3. It targets courses and geography.
4. It sets the discount per fee type.
5. It marks the scheme live (146 schemes are live today).
6. At admission the centre picks the scheme.
7. The dues carry the discount, through the Student Concession Log per fee type.
8. Head office can change it later, on the scheme edit pages.

**Requirements.**
- **R-053 Scheme Master:** 242 schemes. Natures: Normal, Constant Percentage, Constant Amount, Variable Percentage, Variable Amount. Targeting by category or division, or by region, area or centre; plus target courses.
- **R-054 Scheme Rule Master:** each rule gives a fee type, an amount type, and an amount or percentage.
- **R-060 Scheme Assign / Scheme Edit:** assigning a scheme to a learner and editing it afterwards.

**Approved decisions (E-049).**
- **D-SCH-1:** head office creates a scheme; it goes live only after approval.
- **D-SCH-2:** one scheme per registration; a change is re-evaluated through a ticket.
- **D-SCH-3:** an existing assignment keeps its scheme. A new assignment may use a scheme only if the scheme is valid on the admission date.
- **D-FEE-2:** a scheme edit goes through a ticket (maker-checker) plus step-up.

**Audit 07, v1.6.** Concessions are append-only rows that reference `fee_due.id`, and `owed` is computed from them. Concessions post no journal (D-FIN-1, cash basis).

## 2. What exists

- **Dues and balances.** PLAN dues per registration, read through `fee_due_balance`: `owed`, `outstanding`, `held` and `collectable`. These are the single definitions.
- **Locking.** Every writer of a registration's money takes the `fee-dues:` lock.
- **Plans.** Fee plans carry a course, a centre class or centre, and fee types.

## 3. Decisions taken under the owner's instruction (recommended options)

- **DD-1: the scheme master, with maker-checker (D-SCH-1).**
  - A holder of `scheme.manage` (sensitive, ALL scope, step-up) creates a DRAFT scheme with code, name, valid from and valid to, and edits its draft rules and targets.
  - A different holder of `scheme.approve` (sensitive, step-up) makes it LIVE. The maker cannot approve their own scheme.
  - A live scheme never changes. It can be RETIRED, which stops new assignments.
- **DD-2: rules per fee type (R-054).** Each rule is either PERCENT (0.01–100) or AMOUNT (up to the due), applied to each PLAN due of that fee type. The "nature" collapses into the rule's type. Variable natures (an amount chosen at assignment) are PMC and come later.
- **DD-3: targets.**
  - **Courses:** a required list.
  - **Centres:** an optional list; empty means every centre.
  - Category, division, region and area targeting is PMC and comes later.
- **DD-4: assigning a scheme (D-SCH-2, D-SCH-3).**
  - A holder of `fee.concession` (centre-scoped) assigns one live scheme to an ACTIVE registration that has PLAN dues, once.
  - The scheme must be valid on the registration's admission date, target its course, and target its centre (or list no centres).
  - The database writes one concession row per PLAN due whose fee type has a rule:
    - PERCENT: `round(gross × pct / 100, 2)`, half-up;
    - AMOUNT: the rule amount.
  - Either way, a concession is capped at that due's owed amount at the moment of assignment.
  - Changing or removing a scheme later goes through a ticket (a later piece).
- **DD-5: concessions are append-only and reduce owed.** `fee_due_balance.owed` = gross − Σ concessions − Σ ACTIVE allocations (PLAN dues only). There is no ledger posting (cash basis).
- **DD-6: out of scope.**
  - Variable natures and the scheme edit and change ticket (D-FEE-2).
  - Category, division and geographic targeting.
  - Scheme targets and reports (R-099), and legacy import (paused).
