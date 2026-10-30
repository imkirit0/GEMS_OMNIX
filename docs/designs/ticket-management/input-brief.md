# Ticket management view (Stage 5, first piece): input brief for `egm-draft`

Prepared 2026-10-30 from the SPEC (p. 38), the roadmap (audit 10) and the built ticket core (E-023…E-028, E-039).

Owner, 2026-10-30: "keep going with everything planned". Evidence classes: SRC, INF, PRO, PMC. Nothing here is approved.

## 1. Why this piece now (INF; recommended option under the owner's standing instruction)
- **Stage 3's specified workflows are built** (E-037…E-046). What remains in Stage 3 waits on fees or is not described.
- **Stage 4 (fees) is gated.** The roadmap's G-FIN gate requires Accounts to sign every unapproved Stage 4 item first (audit 10:22). Sign-offs are paused (owner, 2026-10-29), so building fees now would break the plan's own gate.
- **Stage 5 (ticket workflows) needs only "Stage 2 core; handlers from Stages 3–4"** (audit 10:24). Its management view (R-094.03, R-094.05) needs no handler and no fees.

## 2. What it is (SRC)
- **R-094.03 Centre Tickets (Ticket Management)** (SPEC p. 38):
  - KPIs: Total, Approved, Pending, Rejected, Forwarded.
  - Filters: Region, Area, Centre, keyword, Status, Priority, Type.
  - Also: New Ticket, the Approved/Not Approved list, and exports.
  - Columns: Ticket Id, Title, Remarks, Document, Student, Region, Area, Centre, Priority, Status, Created Date, Actions.
- **R-094.05 Ticket Report/Summary** (SPEC p. 38):
  - Filters: Region, Area, Centre, Ticket Type, Approval Status, From/To.
  - A summary table.
  - A "Ticket Action History & Details" modal.

## 3. What exists (code)
- **`/tickets`** (`app/tickets/page.tsx`):
  - `listTickets` with status, priority, raw **type id** and raw **centre id** inputs;
  - cursor paging;
  - every row gated by `app.ticket_may_view` (definer, 0009:448).
- **`/tickets/[id]`** already shows the action history (`getTicket().history`). This is the R-094.05 modal, so it needs nothing new.
- **`/tickets/approvals`** is the approver queue.
- **Ticket statuses:** OPEN, APPROVED, REJECTED. "Forwarded" is an event, not a status.
- **Priorities:** LOW, MEDIUM, HIGH. The type carries the priority. Critical is not in the model (D-TKT-2, PRO).

## 4. Decisions taken under the owner's standing instruction
These are recommended options, recorded as such.

- **DD-1: one management view on `/tickets`.** The page gets:
  - KPI tiles: Total, Open, Approved, Rejected, plus Forwarded (OPEN tickets with a forward event);
  - a summary table by type (open, approved, rejected);
  - the list.

  All three use the same filters and the same visibility (`ticket_may_view`).
- **DD-2: filters.**
  - Region, area and centre are pickers over the centres of tickets the user may view. They replace the raw id inputs.
  - Type is a picker over the types of those tickets.
  - Status, priority, and a raised-from/to date range.
  - Ticket number: an exact match or a prefix. It carries no personal data, so a GET parameter is fine.
- **DD-3: no new data, permission or migration.** This piece is reads only.
- **DD-4: out of scope:**
  - exports (a ticket dataset needs its own export permission and columns; later);
  - the SPEC's Title, Remarks, Document and Student columns. Payloads differ per handler, and DD-16 hides values from some viewers.
