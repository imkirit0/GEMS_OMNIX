# Approvals workbench (Stage 5, second piece; R-094.04, R-144)

*   **Author:** gtm
*   **Status:** Approved for build on 2026-10-30 after the EGM review (steps 5–9), under the owner's standing instruction of 2026-10-29, re-confirmed 2026-10-30. Reports: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md) (steps 5–7 in parallel), [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md), [`implementation_readiness_report.md`](implementation_readiness_report.md) (R1–R10 applied at build).
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
*   **G4:** the page and route check the origin; bad filters give an empty page and a bad submit `error=ticket.invalid` (plus `detail`) [T-AW-003, smoke].

## Non-Goals

*   Bulk forward. Forwarding picks a person for each ticket.
*   "Select All" (no JavaScript on these pages; R10).
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
type QueueRow = TicketListRow & { version: number };                                     // approvalQueue only (Z2)
approvalQueue(session, f?: QueueFilter & { cursor?: string | string[] }): Promise<{ rows: QueueRow[]; next: string | null }>;
queueCards(session, f?: QueueFilter): Promise<{ total: number; byType: { typeId: number; code: string; name: string; count: number }[];
  byCentre: { centreId: number; code: string; name: string; count: number }[] }>;
type BulkItem = { ticketId: string; seenVersion: number };
bulkAct(session, b: { action: "approve" | "reject"; remarks?: string; items: BulkItem[] })
  : Promise<{ done: number; conflict: number; forbidden: number; invalid: number; failed: number }>;
```

**Refactor (Z1, C5).**
*   `manageWhere(p, base = VISIBLE)` takes its base set as a parameter. `ACTABLE = Prisma.sql\`t.id in (select app.actable_ticket_ids())\``.
*   The queue uses `manageFrom` and `manageWhere(p, ACTABLE)`. The area and region joins are harmless.
*   `parseFilter` is reused unchanged. The queue allows only the keys `type`, `centre`, `from` and `to`: any other key makes the filter invalid. The page passes only those keys and the cursor (Z4).
*   One small `cursorOf(cursor)` helper holds the cursor guard. An array, or a string `decodeCursor` refuses, yields `"invalid"`. `listTickets` and `approvalQueue` both use it (Z5).

**`approvalQueue`.** It selects `${listColumns}, t.version`. Rows are oldest first, with the keyset cursor as today. An invalid filter or a bad cursor gives `{ rows: [], next: null }`.

**`queueCards` (C6, C7, D8).** It works over the actable set with `from` and `to` applied:
*   `byType` ignores the `type` filter, so every card stays visible.
*   `byCentre` ignores the `centre` filter, so the centre select offers every centre that has something waiting.
*   `total` is derived, not queried (I4): the sum of `byType`, or that type's count when a `type` filter is set (both apply centre, from and to).

Counts are `::int`, ordered by code. An invalid filter gives zeros and empty lists.

**`bulkAct` (G3).**

*Up front, nothing touched (Z7).* The action must be `approve` or `reject`. There must be 1–50 items (PMC; the cap is confirmed by the timing run, D2). Remarks are trimmed and required to reject. Any failure throws `TicketError("invalid")`.

*Per item, in submitted order:* `act(session, { ticketId, action, seenVersion, remarks })` runs once per item, in its own transactions.

*Counting (C3; error classes are in `tickets/errors.ts`):*

| Outcome | Counted as |
|---|---|
| success | `done` |
| `TicketError` `conflict` or `stale` | `conflict` (the ticket or its data changed) |
| `TicketError` `invalid` | `invalid` |
| `TicketError` `inactive`, or `ApplyFailed` | `failed` |
| `Forbidden` or `TicketNotFound` | `forbidden` |
| `TicketError` `document` | cannot occur in `act()`; rethrown if it does (I6) |
| anything else | **rethrown**, which stops the batch (C4, D3, Z8). This includes `ScopeError` (an expired session: `locate` → `withScope`), a lost connection, and a guard's P0001. |

*A stopped batch.* The earlier approvals stay committed, and the counts are lost. The user sees the login page (expired session) or a generic error. Resubmitting the same form is safe: approved tickets have a new version, so they come back as `conflict` (T-AW-003 tests this).

*Audit (D5).*
*   Each `act()` writes its own row: OK, DENIED for `Forbidden`, or FAILED `ticket.apply_failed` for `ApplyFailed`.
*   `conflict`, `stale`, `invalid` and `inactive` outcomes, and a `TicketNotFound` from `locate`, leave no row (I5). So within `failed`, `inactive` leaves none while `ApplyFailed` leaves a FAILED row. The redirect's counts are their only trace.
*   All rows of one batch share the request's `request_id`, which links them. There is no separate batch row.

### Page and route

**`/tickets/approvals`:**
*   The `searchParams` type is `Record<string, string | string[] | undefined>` (C12).
*   The page picks `type`, `centre`, `from`, `to` and `cursor` (Z4), and runs `pageRead` with `Promise.all([approvalQueue, queueCards])`.
*   **Cards.** A Total card, then one card per type from `byType`. Each card links to the current filters with its own `type`.
*   **Filters (D8).**
    *   A type select over `byType`, and a centre select over `byCentre`.
    *   A selected value missing from the options is still shown.
    *   "Raised from" and "Raised to" (IST).
*   **List.** Each row has a tick box with value `<ticketId>:<version>` (Z9).
*   **Actions.** A remarks textarea, and the buttons "Approve selected" and "Reject selected".
*   **Hidden fields** carry the current `type`, `centre`, `from` and `to` (C9).
*   **Result line.** It is shown only when `done`, `conflict`, `forbidden`, `invalid` and `failed` are all integer strings `^\d{1,3}$` (D9): "Done: n. Not done: changed since you opened it a, not allowed b, invalid c, failed d."
*   **Next page.** The next-page link carries the filters.

**`POST /tickets/approvals/bulk`, through `adminPost` (same origin and session):**
*   Items come from `data.getAll("item")` (C1, D1). Each must match `^<uuid>:\d{1,9}$`, otherwise the whole batch is `ticket.invalid`. This covers a missing or blank version, which `Number("")` would have turned into 0 (C2, D6).
*   The `back` path is `/tickets/approvals` plus the posted filters.
*   On success the redirect is `back` plus the five counts.
*   A validation `TicketError` gives `back` plus `error=ticket.invalid` (and `adminPost`'s `detail`, I9).

**G4 restated (C8):**
*   Bad filters or a bad cursor give an empty page.
*   A bad submit gives `error=ticket.invalid`.
*   A foreign origin gives 403.
*   There are no 404s on this page.

### Tests (`tests/approvals-workbench.test.ts`)

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-AW-001 | G1 | `actable_ticket_ids()` compared with `select t.id from app.ticket t where t.status = 'OPEN' and app.ticket_may_act(t.id)`, without `distinct` (D7), for every fixture user and test-local ones. Branches, each reached alone:<ul><li>named approver;</li><li>role approver at that centre only;</li><li>role approver whose `ticket.approve` comes from another role (included) or covers another centre (excluded);</li><li>assigned user (included), with the level's approvers then excluded;</li><li>raiser excluded;</li><li>earlier approver excluded at level 2;</li><li>no `ticket.approve` excluded;</li><li>closed tickets excluded;</li><li>an invisible centre excluded.</li></ul> | Equal sets; non-vacuous |
| T-AW-002 | G2 | Queue filters by type, centre and IST dates. Cards: `byType` ignores `type`, `byCentre` ignores `centre`, `total` matches the list. Invalid filters, an extra key, arrays and a bad cursor give empty results | As listed |
| T-AW-003 | G3, G4 | One bulk approve with one ticket per bucket: done, conflict (a stale version), forbidden (a ticket the user may view but not act on, e.g. one they raised: DENIED row; and one they cannot view: `TicketNotFound`, no row) (I2), invalid (a test-local handler registered in the test whose `revalidate` throws `TicketError("invalid")`; test-handler.ts unchanged) (I1), failed (the test handler's `failApply` → `ApplyFailed`). Audit outcomes: OK, DENIED, FAILED, and none for the conflict, all with one non-null `request_id`: the engine case runs inside `withRequestContext`, as tests/audit.test.ts:41 (I7). A resubmit gives conflicts. An expired session mid-batch rethrows `ScopeError`. A reject without remarks, or 51 items, touches nothing. The route: 3 posted items give counts summing to 3; a blank version gives `error=ticket.invalid`; a foreign origin gives 403 | As listed |

**Timing (D2).** In `tests/ticket-timing.test.ts`:
*   The worst-case page reads, `Promise.all([approvalQueue, queueCards])`: 4.1 s before, budget 500 ms (I3).
*   A 50-ticket bulk approve. Its time is recorded, and the cap is lowered if it takes more than 10 s.

**Smoke.**
*   The approvals page renders the Total card.
*   `?cursor=junk` and `?type=abc` give 200.
*   A foreign-origin bulk post gives 403.

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

*   A batch makes 2–3 transactions per ticket; the 50 cap is set from the timing run (D2).
*   A batch stopped by an expired session or a lost connection loses its counts; resubmitting is safe (conflicts).
