# Ticket management view (Stage 5, first piece; R-094.03, R-094.05)

*   **Author:** gtm
*   **Status:** Proposed, revised after EGM steps 5–7 ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md), in parallel; every finding resolved below). DD-1…DD-4 are recommended options under the owner's standing instruction (2026-10-29, re-confirmed 2026-10-30).
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Limits are PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

`/tickets` today is a filtered list. Two of its filters are raw id inputs ("Type id", "Centre id"), and it has no totals.

R-094.03 asks for a management view of everything a user may see:
*   KPI tiles;
*   region, area, centre, type, status, priority and keyword filters;
*   a summary.

R-094.05 adds a summary by type with a date range, and an action-history modal. The ticket page already shows that history.

This piece adds two read functions and rewrites the `/tickets` page. It needs no migration and no new permission. Visibility stays exactly `app.ticket_may_view` (0009:448).

## Goals

*   **G1:** one filter set (`TicketFilter`) drives the KPIs, the per-type summary and the list. Every count and row is limited to tickets the user may view [T-TM-001].
*   **G2:** the pickers offer only the centres, areas, regions and types of tickets the user may view. They never reveal a centre or type the user cannot see [T-TM-001].
*   **G3:** an invalid filter matches nothing. It never errors and never widens the result [T-TM-002].
*   **G4:** the page renders the view. Paging keeps the filters. Bad parameters, a bad cursor included, give an empty result, not a 500 [smoke].

## Non-Goals

*   Exports (DD-4).
*   The SPEC's Title, Remarks, Document and Student columns (DD-4).
*   A "Critical" priority (D-TKT-2, PRO).
*   Changes to `/tickets/approvals` or `/tickets/[id]`.

## Technical Plan

### Server (`src/server/tickets/engine.ts`)

```ts
/** Raw GET strings; the engine validates them once (Z2, C2). "" or undefined means not given. */
type TicketFilter = { status?: string; priority?: string; type?: string; centre?: string; area?: string; region?: string;
  from?: string; to?: string; number?: string };
type TicketManageRow = TicketListRow & { areaName: string; regionCode: string };   // listTickets only (Z3, C3)
listTickets(session, f?: TicketFilter & { cursor?: string }): Promise<{ rows: TicketManageRow[]; next: string | null }>;
ticketSummary(session, f?: TicketFilter): Promise<{ kpi: { total: number; open: number; approved: number; rejected: number; forwarded: number };
  byType: { typeId: number; code: string; name: string; open: number; approved: number; rejected: number; total: number; forwarded: number }[] }>;
ticketFilterOptions(session): Promise<{ regions: { id: number; code: string }[]; areas: { id: number; label: string }[];
  centres: { id: number; code: string; name: string }[]; types: { id: number; code: string; name: string }[] }>;
```

**Validation.** One `parseFilter(f)` runs before any query. It returns the typed values or `"invalid"`. An invalid filter gives the empty result: `{ rows: [], next: null }`, or zero KPIs with `byType: []` (G3).

| Field | Valid when | SQL |
|---|---|---|
| `status` | OPEN, APPROVED or REJECTED | `t.status = $s::app."TicketStatus"` (C6) |
| `priority` | LOW, MEDIUM or HIGH | `ty.priority = $p::app."TicketPriority"` |
| `type`, `centre`, `area`, `region` | `^\d{1,9}$` (D5) | `t.type_id`, `t.centre_id`, `c.area_id`, `a.region_id` |
| `from`, `to` | `YYYY-MM-DD` that round-trips through `Date` (C5, D2) | `t.created_at >= ($from::date)::timestamp at time zone 'Asia/Kolkata'` and `t.created_at < (($to::date) + 1)::timestamp at time zone 'Asia/Kolkata'`. This is IST and can use the index. `from > to` gives nothing. |
| `number` | 1–40 characters | `t.number ilike $n \|\| '%'`, with `%`, `_` and `\` escaped as in `listEnquiries`. The match ignores case (C14). |
| `cursor` (list only) | `decodeCursor` accepts it | A bad cursor gives the empty result. `listTickets` catches the `TicketError` itself, and `approvalQueue` is unchanged (Z1, C1, D1). |

**Shared FROM clause (C11):**

```sql
from app.ticket t
  join app.ticket_type ty on ty.id = t.type_id
  join app.centre c on c.id = t.centre_id
  join app.area a on a.id = c.area_id
  join app.region r on r.id = a.region_id
where app.ticket_may_view(t.id) and <conditions>
```

**`listTickets`** selects `${listColumns}, a.name as "areaName", r.code as "regionCode"`. The cursor and the order stay as today. `listColumns` itself does not change, so `approvalQueue` and `getTicket` are untouched.

**`ticketSummary`** groups by type and ignores the cursor (C8). Per type:
* `open`, `approved`, `rejected`: `count(*) filter (where t.status = …)`;
* `total`: `count(*)`;
* `forwarded`: `count(*) filter (where t.status = 'OPEN' and exists (select 1 from app.ticket_event e where e.ticket_id = t.id and e.action = 'FORWARD' and coalesce(e.detail->>'admin', '') <> 'true'))`. Only approver forwards count; admin reassigns are excluded (C7). Event RLS allows this read for visible tickets.

The KPIs are the sums of `byType`. Counts are cast `::int`, and types are ordered by code, then id. The tiles follow every filter, status included (D6): with `status=OPEN`, the Approved tile shows 0.

**`ticketFilterOptions`** returns the distinct values among `ticket_may_view` tickets. It ignores the current filters (C10). Order:
* regions by code;
* areas labelled `R1 / A1`, ordered by region code, then name, then id;
* centres by code;
* types by code.

Regions, areas and types are readable by everyone anyway (0020 `geo_select`, 0009:293). Centres come only from visible tickets. So nothing new is revealed (step 7).

**Cost (D3, Z5).** Each read calls `ticket_may_view` once per ticket row. It is a security definer, so it is not inlined.

Before acceptance, a one-off timing run seeds about 16.5k tickets at three centres. It records `EXPLAIN ANALYZE` of `ticketSummary` and `ticketFilterOptions` for an ALL-scope user in the evidence entry. The budget is 500 ms each (PMC).
* Over budget: a later piece adds a set-returning `visible_ticket_ids()`. That needs a migration and a T-RLS-005 entry.
* Within budget: `ponytail: per-row definer; set-returning ids when volume grows`.

### Page (`app/tickets/page.tsx`)

**Parameters:** the raw GET strings go to all three reads, and `num()` is deleted. The parameters are `status`, `priority`, `type`, `region`, `area`, `centre`, `from`, `to`, `number` and `cursor`. They are ids, dates and ticket numbers only, with no personal data.

**Layout, top to bottom (C12):**
1. Links: Home, Raise a ticket, My approvals.
2. Tiles: Total, Open, Approved, Rejected, Forwarded.
3. The filter form:
   * every option list is a select;
   * the dates are date inputs, labelled "Raised from" and "Raised to" (IST);
   * the number is a text input;
   * submitting the form drops the cursor.
4. Summary table: Type, Open, Approved, Rejected, Forwarded, Total.
5. The list as today, plus Area and Region columns.
6. "Next page", which keeps every filter.

A selected id that is not among the options is still applied, and shown by its raw id.

### Tests (`tests/ticket-management.test.ts`)

**Setup (C9, D7).**
* Copy the small helpers from `tests/tickets.test.ts:25-53` (`makeType`, raise, grant).
* Run `ticket-test-handler.sql` and open `TICKET_GATES` as that file does.
* Set each type's priority by SQL.
* Raise tickets at A, at A2 (`TK.raiser`, after granting the raiser role at A2) and at B (after a grant at B).

**Users:**
* viewer: `TK.reviewer` (`ticket.view` at A);
* in-scope approver: `TK.l1` (level 1 at A);
* negative case: `TK.b`, who sees nothing at A.

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-TM-001 | G1, G2 | Each filter alone and combined: status, priority, type, centre, area, region, from/to in IST across midnight, and the number prefix ignoring case. KPIs and per-type counts agree with the list. An approver forward counts; an admin reassign does not. The viewer at A sees only A's tickets, counts and pickers (centre, types). The in-scope approver sees the ticket they act on; `TK.b` sees none of A's | Counts and ids |
| T-TM-002 | G3 | Bad status or priority; ids `abc`, `1e3` and `""` for a set value; 2026-02-30; a 41-character number; `cursor=junk`: each gives empty results and zero counts, never a throw. `from > to` gives empty. `%` and `_` in the number are literal | As listed |

**Smoke (C13).** The smoke viewer raised `TK-26/SMK/1` at SMK-A, so it sees that ticket.
* `/tickets` shows the tiles and only SMK-A in the centre picker.
* `/tickets?status=NOPE` and `/tickets?cursor=junk` both return 200 with "No tickets."

T-AUD is unchanged, because these are reads.

## Decisions

All four are recommended options under the standing instruction.

1.  **DD-1:** one management view on `/tickets`: KPIs, a summary by type, and the list.
2.  **DD-2:** pickers built from visible tickets; a date range in IST; the ticket number by prefix.
3.  **DD-3:** reads only; no migration, no new permission.
4.  **DD-4:** exports and the per-handler columns come later.

## Alternatives Considered

*   **A separate `/tickets/report` page.** Rejected: the same filters would live twice. One page answers both R-094.03 and R-094.05.
*   **Pickers from `listCentres`.** Rejected: a ticket viewer may lack `org.centre.view`, and approvers see tickets outside their own scope.

## Risks and Limits

*   The per-row definer call has a cost; it is measured before acceptance (see Cost).
*   **"Forwarded" counts OPEN tickets an approver forwarded; admin reassigns are excluded.** The SPEC's count may have meant something else (PRO).
*   The pickers list only the centres and types that have tickets.
