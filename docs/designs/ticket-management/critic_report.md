# Ticket management: EGM step 7 design critic report

Reviewed commit 5dccb62 on 2026-10-30, in parallel with steps 5 and 6.

**Verdict:** approve with changes. There are no blockers, 3 major findings and 5 nits. The design-revision commit records how each one is resolved.

**Confidentiality holds:**
* Ticket, event and centre RLS all use `visible_centre_ids()`, which is also the first condition of `ticket_may_view`. RLS therefore removes only rows that `ticket_may_view` would reject anyway.
* The FORWARD `exists` check reads only events of visible tickets.
* The pickers reveal nothing new: regions, areas and types are readable by everyone.
* A filter on an unseen id returns zero, the same as a missing id.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Major | A bad cursor throws (`engine.ts:283`), so the page fails with a 500. `approvalQueue` is hit too. | Decide one behaviour in `decodeCursor`, and test it. |
| D2 | Major | The date rule is given twice and contradicts itself. A date matching the pattern but impossible (2026-02-30) raises 22008, which surfaces as a 500. | Use an IST range on `created_at` that can use an index. Validate dates by round-trip. |
| D3 | Major | The cost is unmeasured: the summary and options queries run `ticket_may_view` on every visible ticket. | Measure it on about 16.5k tickets against a budget. If it is over, hoist the cheap case (that needs a migration). |
| D4 | Nit | `ilike` cannot use the number index. | Acceptable at this volume. |
| D5 | Nit | The id parser is unspecified. | `^\d{1,9}$`. |
| D6 | Nit | The tiles follow the status filter. | State this. |
| D7 | Nit | A named-approver fixture only works within the approver's scope. | Add a fixture in scope, plus a negative case. |
| D8 | Nit | Removing the throw is safe. | Accept. |
