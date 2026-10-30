# Approvals workbench (Stage 5, second piece): input brief for `egm-draft`

Prepared 2026-10-30 from the SPEC (pp. 38, 44–45), the built ticket core and a measurement. Owner, 2026-10-30: "keep going with everything planned". Evidence classes: SRC, INF, PRO, PMC. Nothing here is approved.

## 1. What it is (SRC)
- **R-094.04 Tickets Approval List** (SPEC p. 38):
  - Filters: Centre, Ticket Type, From/To, and a status radio.
  - Bulk Remarks with Select All; Approve, Reject, Forward (pick an employee), View.
  - A Course Change modal: target course, scheme, join and end dates.
  - Columns: Centre, Ticket No, Type, Registration No, Course, dates, Current Level, Description, Document, Priority, Created date and by.
- **R-144 approval dashboards** (SPEC pp. 44–45):
  - A live queue header with KPI tiles (Total, Pending review, Approved, Rejected).
  - Category search and chips.
  - One card per queue with its counts, plus "Review queue" and History.
  - The legacy version used a hard-coded password; PR-01 replaces that.

## 2. What exists and what was measured
- **`/tickets/approvals`:** `approvalQueue`, oldest first, cursor paging, no filters, one ticket at a time via `/tickets/[id]`.
- **`act()`:** one ticket per transaction. It locks the ticket, checks the version, and runs `ticket_may_act`, the handler and the audit (T-TKT-003…009).
- **The per-row cost (measured 2026-10-30, `tests/ticket-timing.test.ts`, 16,542 tickets, 2,412 OPEN, the legacy pending count):** `approvalQueue` runs the definer `app.ticket_may_act` per OPEN row.
  - An active level-1 approver: 127 ms.
  - A user who may act on almost nothing: **4.1 s**, against the 5 s transaction limit. It grows with the pending count.
  - This is the same cause as the ticket view (E-047, fixed there by `app.visible_ticket_ids()`).

## 3. Decisions taken under the owner's standing instruction
These are recommended options, recorded as such.

- **DD-1: `app.actable_ticket_ids()`.** A set-returning definer equal to `ticket_may_act`, used by the queue and its counts. It is proven equal, as `visible_ticket_ids` was.
- **DD-2: queue filters** (type, centre, raised from/to in IST) and **queue cards**: per-type counts of what the user may act on now (R-144). History is the existing ticket page.
- **DD-3: bulk approve and bulk reject.**
  - Up to 50 tickets per submit, with one remarks text (required to reject).
  - Each ticket goes through `act()` on its own, so each has its own lock, version check, permission, handler and audit.
  - A summary reports how many succeeded and how many were refused, for each reason.
  - No bulk forward: forwarding picks a person per ticket.
- **DD-4: out of scope:**
  - the course-change modal (fees, D-STU-2);
  - the SPEC's registration, course, description and document columns (per handler; DD-16 hides values);
  - R-144's fund-transfer and exam queues (Stage 4 and 6 handlers).
