# Approvals workbench (Stage 5, second piece; R-094.04, R-144)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-4 are recommended options taken under the owner's standing instruction of 2026-10-29, re-confirmed 2026-10-30. EGM review (steps 5–9) next.
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Limits are PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

`/tickets/approvals` lists what the user may act on now, one ticket at a time. R-094.04 asks for filters and bulk approve/reject with remarks. R-144 asks for one card per queue, with counts.

Behind both is a measured cost: `approvalQueue` calls the definer `app.ticket_may_act` on every OPEN row. For a user who may act on almost nothing, that took 4.1 s on 2,412 OPEN tickets, the legacy pending count, against the 5 s transaction limit.

This piece adds:
*   one migration, with `app.actable_ticket_ids()`;
*   a filtered queue with per-type cards;
*   `bulkAct()`, which runs `act()` once per ticket.

## Goals

*   **G1:** `app.actable_ticket_ids()` returns exactly the tickets `app.ticket_may_act` allows, for every kind of approver. The queue and its counts use it within 500 ms at the legacy volume [T-AW-001].
*   **G2:** the queue filters by type, centre and raised from/to (IST, as E-047). Invalid filters match nothing. The cards count the queue per type under the same filters [T-AW-002].
*   **G3:** bulk approve and reject of up to 50 tickets (PMC):
    *   each ticket through `act()`, with its own lock, version check, permission check, handler and audit;
    *   rejecting needs remarks;
    *   the result counts successes and refusals by reason.
    *   [T-AW-003]
*   **G4:** the page and route check the origin, and give a 404 for bad input, as today [T-AW-003, smoke].

## Non-Goals

*   Bulk forward. Forwarding picks a person for each ticket.
*   The course-change modal (fees, D-STU-2).
*   Per-handler columns.
*   R-144's fund-transfer and exam queues.

## Technical Plan

### Migration `0024_actable_ticket_ids`

`app.actable_ticket_ids() returns setof uuid`:
*   `language sql stable security definer`, `set search_path = pg_catalog, app`.
*   Execute is revoked from public and granted to `gems_app`.
*   It is the set form of `ticket_may_act` (0009:396). Each array helper sits in a sub-select, so it runs once:

```sql
with me as (select app.session_user_id() as id),
rc as (select r.role_id, unnest(app.user_centre_ids(me.id, null, r.role_id)) as centre_id
       from me, (select distinct ra.role_id from app.role_assignment ra, me where ra.user_id = me.id) r)
select t.id
from app.ticket t join app.ticket_level l on l.ticket_id = t.id and l.level = t.current_level, me
where t.status = 'OPEN'
  and t.centre_id = any ((select app.visible_centre_ids())::int[])
  and t.centre_id = any ((select app.scoped_centre_ids('ticket.approve'))::int[])   -- has_permission('ticket.approve', centre)
  and t.raised_by <> me.id
  and not exists (select 1 from app.ticket_event e where e.ticket_id = t.id and e.action = 'APPROVE' and e.actor_id = me.id)
  and (t.assigned_user_id = me.id
       or (t.assigned_user_id is null
           and (l.approver_user_id = me.id
                or exists (select 1 from rc where rc.role_id = l.approver_role_id and rc.centre_id = t.centre_id))))
```

The T-RLS-005 definer inventory gains the function.

### Server (`src/server/tickets/engine.ts`)

```ts
type QueueFilter = Partial<Record<"type" | "centre" | "from" | "to", string | string[]>>;
approvalQueue(session, f?: QueueFilter & { cursor?: string | string[] }): Promise<{ rows: TicketListRow[]; next: string | null }>;
queueCards(session, f?: QueueFilter): Promise<{ total: number; byType: { typeId: number; code: string; name: string; count: number }[] }>;
bulkAct(session, b: { action: "approve" | "reject"; remarks?: string; items: { ticketId: string; seenVersion: number }[] })
  : Promise<{ done: number; refused: Record<"conflict" | "forbidden" | "invalid" | "failed", number> }>;
```

*   **`approvalQueue`:**
    *   Its filters reuse E-047's `parseFilter` and `manageWhere` pieces, limited to type, centre, from and to. The where clause is `t.id in (select app.actable_ticket_ids())` instead of the per-row call.
    *   It keeps its order (oldest first) and its cursor.
    *   An invalid filter, an array value, or a bad cursor gives `{ rows: [], next: null }`. Today a bad cursor throws (Z1 of E-047).
    *   Its one existing caller, the page, passes the raw GET values.
*   **`queueCards`:** the same set and filters, grouped by type, counted `::int`, ordered by code.
*   **`bulkAct`:**
    *   **Validation before anything runs:**
        *   `items` holds 1–50 distinct UUID ticket ids, each with an integer `seenVersion`;
        *   the action is `approve` or `reject`;
        *   remarks are trimmed and required to reject.
        *   Anything else gives `TicketError("invalid")` before any ticket is touched.
    *   **Then, for each item in turn:** `act(session, { ticketId, action, seenVersion, remarks })`, in its own transaction.
    *   **Errors are counted, not thrown:**
        *   `TicketError("conflict")` → `conflict`;
        *   `Forbidden` and `TicketNotFound` → `forbidden`;
        *   other `TicketError` → `invalid`;
        *   `ApplyFailed` → `failed`.
        *   `StepUpRequired`, `ScopeError` and connection errors are rethrown, which stops the batch. These do not happen for `act()` today, but a lost session must not look like 50 refusals.
    *   **Audit:** each `act()` audits its own row. There is no separate batch audit row: the per-ticket rows are the record (T-AUD unchanged).
    *   **Ordering:** sequential, in the submitted order. There is no parallelism: each ticket's approval may apply a handler.

### Page and route

*   **`/tickets/approvals`:**
    1.  Cards: Total, then one per type. Each card links to `?type=<id>`.
    2.  Filters: type and centre selects, built from `queueCards`' types and from the centres in the rows. The current filter values come back on reload.
    3.  "Raised from" and "Raised to" date inputs.
    4.  The list, with a tick box per row. Each row carries a hidden `seenVersion`, so the row's version goes with it.
    5.  A remarks textarea and two buttons: Approve selected, Reject selected.
    6.  The result line: "Done: n. Refused: conflict a, not allowed b, invalid c, failed d." It comes from `?done=&conflict=&forbidden=&invalid=&failed=`, integers only.
*   **`POST /tickets/approvals/bulk`** goes through `adminPost` (same origin, session).
    *   Fields: `action`, `remarks`, and the repeated pair `ticketId` + `v:<ticketId>` (the version).
    *   Back and success both go to `/tickets/approvals` with the counts.
    *   A `TicketError` from validation gives `?error=ticket.invalid` (already in `ADMIN_MESSAGES`).

### Tests (`tests/approvals-workbench.test.ts`)

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-AW-001 | G1 | Equivalence: `actable_ticket_ids()` equals `ticket_may_act` for every fixture user and a test-local one. Every branch is reached alone: a named approver; a role approver at that centre only; an assigned (forwarded) user; the raiser excluded; a level-1 approver excluded at level 2 by "already approved"; no `ticket.approve` excluded; a ticket at an invisible centre excluded | Equal sets; non-vacuous |
| T-AW-002 | G2 | Queue filters and cards agree; invalid filters, arrays and a bad cursor give empty results | As listed |
| T-AW-003 | G3, G4 | Bulk approve of 3 tickets: one stale version, one the user may not act on, one good. Result: done 1, conflict 1, forbidden 1; the audit rows are per ticket. Bulk reject without remarks gives invalid, with nothing touched. 51 items give invalid. The route: counts in the redirect; foreign origin 403 | As listed |

**Timing:** `tests/ticket-timing.test.ts` gains the worst-case queue (4.1 s before), with a 500 ms budget.

**Smoke:** the approvals page renders its cards; `?cursor=junk` gives 200.

## Decisions

1.  **DD-1:** `app.actable_ticket_ids()` (migration 0024), proven equal to `ticket_may_act`.
2.  **DD-2:** queue filters and per-type cards.
3.  **DD-3:** bulk approve and reject through `act()` per ticket, up to 50 at a time (PMC). There is no bulk forward.
4.  **DD-4:** the course change, per-handler columns, and fund-transfer and exam queues are out of scope.

All four are recommended options under the standing instruction.

## Alternatives Considered

*   **One transaction for the whole batch.** Rejected: one failure would roll back every approval, and one handler error would block the rest.
*   **Keep the per-row `ticket_may_act` in the queue.** Rejected: measured at 4.1 s.

## Risks and Limits

*   `act()` still calls `ticket_may_act` once per ticket, so a 50-ticket batch makes 50 calls (cheap per ticket).
*   A long batch keeps the request open; 50 is the cap (PMC).
