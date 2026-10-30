# Call log: EGM step 8 intermediate zoom-out report

Commit 5819806 was reviewed on 2026-10-30.

**Verdict:** proceed after one minor fix. Every finding from steps 5–7 is resolved in substance. The revision adds no new complexity; the design is now smaller.

**Facts checked against the code (all hold):**
* `enquiryOptions` shape: its `requireView` gives a 404 through `pageRead`, at a cost of 7 queries.
* `canViewEnquiries` and `enquiryCounsellors`.
* `listEnquiries` returns `[]` for invalid filters.
* The messages of `ownText`, `phoneDigits` and `isoDate`.
* The 0018 constants, guard and triggers.
* The fixtures and test lists.

| ID | Severity | Finding | Recommendation | Applied |
|---|---|---|---|---|
| I1 | Minor | Nothing enforces "manage implies view": `0005:157` lets a role hold `enquiry.manage` alone. | `authorize(enquiry.view)` in `logCall`, plus a test. | Yes |
| I2 | Nit | Z5 was superseded by D1. | Say so. | Yes |
| I3 | Nit | `ticket_immutable` comes from 0009. | Say so. | Yes |
| I4 | Nit | "with view" is redundant. | Drop it. | Yes |
| I5 | Nit | The mapping of the URL `type`/`due` parameters is not stated. | State it. | Yes |
| I6 | Nit | The 23503 mapping assumes one foreign key. | Add a comment. | Yes |
