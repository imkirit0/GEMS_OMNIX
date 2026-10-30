# Ticket management: EGM step 6 comprehension report

**Reviewed:** commit 5dccb62 (2026-10-30), in parallel with steps 5 and 7.

**Verdict:** revise. The review found 3 blockers, 7 majors and 4 nits. The design revision records how each one is resolved.

| ID | Severity | Finding | Proposed resolution |
|---|---|---|---|
| C1 | Blocker | The design says a bad cursor is ignored, but `decodeCursor` throws (`engine.ts:283`), so the page returns a 500. | Define one behaviour for a bad cursor and test it. |
| C2 | Blocker | The page's `num()` drops a bad id, which widens the filter. | Pass the raw strings through and validate them in the engine. |
| C3 | Blocker | `listColumns` is shared, so adding area and region columns breaks `approvalQueue` and `getTicket`. | Add the extra fields in `listTickets` only. |
| C4 | Major | The date rule is written two ways. | Give one exact SQL condition, in IST; a `from` later than `to` returns nothing. |
| C5 | Major | `2026-02-31` passes the regex, then `::date` raises. | Validate dates by a round trip. |
| C6 | Major | `status` is ambiguous (centre also has one), and the enum cast is missing. | `t.status = $s::app."TicketStatus"`; cast the priority too. |
| C7 | Major | "Forwarded" is undefined, and admin reassigns also write FORWARD events. | Give the exact count, and decide whether admin reassigns count. |
| C8 | Major | The summary takes a cursor, has no total per type, and the KPI arithmetic is not stated. | The summary ignores the cursor, gains a total, and the KPIs are sums. |
| C9 | Major | Fixtures are unspecified: the helpers are private, tickets are raised only at A, there is no priority, and no viewer is named. | Name the users and grants, copy the helpers, and set the priority by SQL. |
| C10 | Major | Picker order and labels are not given. Areas have no code, and their names repeat across regions. | Define the order; label areas "R1 / A1". |
| C11 | Nit | The join list is incomplete. | Give the FROM clause once. |
| C12 | Nit | The page layout and the cursor behaviour on resubmit are not described. | Add a layout sketch; submitting the form resets the cursor. |
| C13 | Nit | The smoke account is not named. | Name it. |
| C14 | Nit | The number match's case rule and length limit are not stated. | State both. |
