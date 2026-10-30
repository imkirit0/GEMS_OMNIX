# Fee dues: EGM step 7 design critic report

Reviewed: commit 16859ed (2026-10-30), alongside steps 5 and 6.

**Verdict:** approve with changes. The review found 2 major findings and one major for F3. The rest are minor or nits. The design revision records how each one was resolved.

What the review endorsed:
- dues that are gross-only and include GST;
- F3 copies the rate and HSN/SAC at receipt;
- concessions, holds and allocations go in separate append-only tables.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Major | The guard proves a due matches some published line, not the plan for this registration's course and centre or class. | Check 7: the plan's course matches the registration's, and the plan's centre or class matches the registration's centre or class. |
| D2 | Major | The checks are not NULL-safe: a missing or hidden source row passes silently. | Use `is distinct from`, and raise when the row is not found (fail closed). |
| D3 | Major (F3) | Ad-hoc dues do not fit the table. | One table: `source PLAN/ADHOC`, nullable plan columns, and a check; or record the decision for F3. |
| D4 | Minor | Immutability plus the unique key commits F4/F5 to an adjustment ledger. | State this in DD-3. |
| D5 | Minor | The oldest-first order needs a total order; ties on `due_on` are common. | Insert in a defined order; F3 orders by `(due_on, id)`. |
| D6 | Minor | Moving a centre by cascade with dues present aborts (RESTRICT). | Keep it and document it; a transfer makes a new registration; add a test. |
| D7 | Minor | Registration ACTIVE and the currency are checked only in the app. | Add both to the guard. |
| D8 | Nit | `centre.currency` versus 0020: the grant tests already prove the app cannot set it. | Document this; do not edit the tests. |
| D9 | Nit | "Once per registration" is enforced only by the app; the database enforces once per line. | Note it. |
| D10 | Nit | Dues are personal financial data visible to `student.view`. | Mark DD-5 PMC; `fee.view` later. |
| D11 | Nit | The admission year stands in for the registration year. | Record the assumption. |
