# Ticket management: EGM step 5 zoom-out report

Commit 5dccb62 was reviewed on 2026-10-30, in parallel with steps 6 and 7.

**Verdict: approve with changes.** The scope is right: the change only reads data, adds no migration, and reuses `ticket_may_view`. How each finding was resolved is recorded in the commit that revised the design.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | `decodeCursor` throws `TicketError` (engine.ts:283). The page does not handle it, so a junk cursor gives a 500. | In `listTickets`, treat an invalid cursor as an empty result. `approvalQueue` stays unchanged. Test it, including in smoke. |
| Z2 | Major | The page's `num()` drops an invalid type or centre id, which widens the result. | Pass the raw strings and validate them once, in the engine. Delete `num()`. |
| Z3 | Major | `listColumns` is shared with `approvalQueue` and `getTicket`. Region also needs a join to `app.region`. | Select the area and region columns in `listTickets` only, and join both tables there. |
| Z4 | Nit | Region and area are not secret, since `listGeography` exists. | Accept the design (one query). Do not assert that they are absent. |
| Z5 | Nit | About 3×N `ticket_may_view` calls per page load; the cost is unmeasured. | Keep the ponytail deferral. Measure once. |
| Z6 | Nit | The date rule is given in two forms. | Use the IST, index-friendly form. |
| Z7 | Nit | Turning the throw into an empty result is correct. | Keep it. |
| Z8 | Nit | The shared filter fragment is the right size. | Keep it, with the same table aliases. |
