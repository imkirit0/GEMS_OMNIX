# Ticket management view (Stage 5, first piece; R-094.03, R-094.05)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-4 are recommended options taken under the owner's standing instruction of 2026-10-29, re-confirmed 2026-10-30. EGM review (steps 5–9) next.
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
*   **G4:** the page renders the view. Paging keeps the filters. Bad parameters give an empty result, not a 500 [smoke].

## Non-Goals

*   Exports (DD-4).
*   The SPEC's Title, Remarks, Document and Student columns (DD-4).
*   A "Critical" priority (D-TKT-2, PRO).
*   Changes to `/tickets/approvals` or `/tickets/[id]`.

## Technical Plan

### Server (`src/server/tickets/engine.ts`)

```ts
type TicketFilter = { status?: string; priority?: string; typeId?: number; centreId?: number; areaId?: number; regionId?: number;
  from?: string; to?: string; number?: string; cursor?: string };
listTickets(session, f?: TicketFilter): Promise<{ rows: TicketListRow[]; next: string | null }>;   // existing, filters extended
ticketSummary(session, f?: TicketFilter): Promise<{ kpi: { total: number; open: number; approved: number; rejected: number; forwarded: number };
  byType: { typeId: number; code: string; name: string; open: number; approved: number; rejected: number }[] }>;
ticketFilterOptions(session): Promise<{ regions: { id: number; code: string }[]; areas: { id: number; regionId: number; name: string }[];
  centres: { id: number; areaId: number; code: string; name: string }[]; types: { id: number; code: string; name: string }[] }>;
```

**One shared filter fragment** builds the where-clause for `listTickets` and `ticketSummary`. Each condition is added only when its value is given and valid:
*   `status = $s`;
*   `ty.priority = $p`;
*   `t.type_id = $t`;
*   `t.centre_id = $c`;
*   `c.area_id = $a`;
*   `a.region_id = $r` (the query joins `app.area a`);
*   `t.created_at >= $from::date`, and `t.created_at < $to::date + 1`, both in IST: `(t.created_at at time zone 'Asia/Kolkata')::date between $from and $to`;
*   `t.number ilike $n || '%'`, with `%`, `_` and `\` escaped, as `listEnquiries` does.

**Invalid filters (G3):**
*   A status or priority outside its list, a non-integer id, a date that is not `YYYY-MM-DD`, or a number longer than 40 characters makes the function return an empty result (`rows: []` and zero counts) without querying.
*   **This changes the existing behaviour.** Today `listTickets` throws `TicketError("invalid", "bad filter")`, which the page turns into a 500. No test asserts the throw (`tests/tickets.test.ts:214` lists without filters). The throw goes.
*   The cursor keeps its existing rule: a bad cursor is ignored (`decodeCursor`).

**`ticketSummary`:**
*   One query over `app.ticket t join app.ticket_type ty join app.centre c join app.area a`, with `where app.ticket_may_view(t.id) and <filters>`.
*   It groups by type, with `count(*) filter (where t.status = …)`.
*   It computes the KPIs from the same rows.
*   `forwarded` = OPEN tickets having at least one `ticket_event` with `action = 'FORWARD'`.
*   It returns `::int` counts. Types are ordered by code.

**`ticketFilterOptions`:**
*   The distinct centres, areas, regions and types of `ticket_may_view` tickets.
*   Area and region names come by join. The area and region tables are readable by everyone (0020 `geo_select`), and centre codes come only from visible tickets.
*   The result is ordered by code or name.

**Cost (ponytail):** `ticket_may_view` runs once per ticket row in each of the three reads. That is acceptable at today's volume (legacy: 16,542 tickets). If it gets slow, a set-returning `visible_ticket_ids()` replaces the per-row calls.

### Page (`app/tickets/page.tsx`)

*   **GET parameters:** `status`, `priority`, `type`, `region`, `area`, `centre`, `from`, `to`, `number`, `cursor`. These are ids, dates and ticket numbers, with no personal data.
*   **Data:** `pageRead` with `Promise.all([listTickets, ticketSummary, ticketFilterOptions])`.
*   **Tiles:** Total, Open, Approved, Rejected, Forwarded.
*   **Pickers:**
    *   Region, Area and Centre are three plain selects. A chosen region narrows nothing client-side: there is no JavaScript, and the server applies all three.
    *   Type, Status and Priority are selects.
    *   From and To are date inputs; Number is a text input.
*   **The summary table:** Type, Open, Approved, Rejected, Total.
*   **The list:** as today, plus Area and Region columns.
*   **Paging:** "Next page" keeps every filter.
*   **Links:** Raise a ticket, My approvals.

### Tests (`tests/ticket-management.test.ts`)

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-TM-001 | G1, G2 | Tickets at centres A, A2 and B for two types. Checks: each filter alone and combined; KPIs and per-type counts agree with the list; a forwarded ticket counts in Forwarded; a viewer at A sees only A's tickets, counts and pickers (B's centre, area, region and B-only type are absent); a named approver sees the ticket they act on | Counts and ids |
| T-TM-002 | G3 | Bad status, priority, ids, dates and over-long number: empty results and zero counts, no throw; `%` and `_` in the number are literal | As listed |

**Real-server smoke:**
*   `/tickets?status=NOPE` returns 200 with no rows;
*   the viewer's page shows the tiles and only its own centre in the centre picker.

T-AUD is unchanged: these are reads, not actions.

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

*   The per-row definer call has a cost (see above).
*   **"Forwarded" is a count of OPEN tickets with a forward event.** The SPEC's count may have meant something else (PRO).
*   The pickers list only the centres and types that have tickets.
