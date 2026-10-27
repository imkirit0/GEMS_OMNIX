# Ticket and approval engine (Stage 2 core)

*   **Author:** gtm
*   **Status:** Proposed
*   **Date:** 2026-10-27

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source),
INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its
owner to sign). Nothing in this draft is approved.

--------------------------------------------------------------------------------

## Overview

Most change requests in GEMS go through one shared approval engine (WF6, SRC).
A centre raises a ticket against a ticket type, such as a student name
correction (FNC) or a course change (CMC). The ticket then moves through up to
four approval levels. At each level the approver is either a named user or
anyone holding a given role. At each level the approver can approve, reject
with remarks, or forward the ticket to another employee. When the last level
approves, the system makes the requested change itself. Viewers can see a
ticket but cannot act on it.

In the legacy system (SPEC p.38, SRC) there are 31 ticket types and 16,542
tickets: 14,011 approved, 2,412 pending, 119 rejected and 2 forwarded.

This design covers the **engine core**, which is Stage 2 in audit 10. That is
the ticket model, type and level setup, approver resolution, the approve,
reject and forward actions, immutable history, numbering, and a contract that
each ticket type's handler plugs into, plus plain screens for raising,
viewing and approving tickets (DD-7). The full set of 31 types, SLA
reminders, bulk approval and dashboards are Stage 5. Each type's domain handler is built
with the module that owns its data, in Stages 3 to 6.

## The Problem

Without one engine, each module would build its own approval flow. The audit
pack names four ways that goes wrong, and each one already has an acceptance
test (audit 09, POC P5):

1.  **Half-applied changes.** A final approval updates the ticket but the
    domain change fails, or the reverse. Today nothing guarantees that both
    happen together or neither does (T-TKT-005, T-TKT-007).
2.  **Changes applied twice.** Two approvers press "approve" on the same final
    level at the same moment, and the change runs twice: for example, two
    voucher payments (T-TKT-006).
3.  **Approving your own request.** The person who raised a ticket approves
    it (T-TKT-010; decision D-TKT-4 is still open).
4.  **Acting outside your scope.** An approver sees or acts on tickets from
    centres they do not cover, or forwards a ticket to someone who should not
    see it (T-TKT-003, T-TKT-009).

A fifth problem comes from time. A ticket can wait for days between being
raised and its final approval. By then the data it was written against may
have changed: the student may have moved course, or the voucher may already
be paid. Applying the change blindly at that point corrupts data (T-TKT-011).

**Proposed solution (PRO):** one engine, built on the platform pieces that
already exist and pass tests. These are row-level security for scope,
`scopedAction()` for authorise, change and audit in one transaction,
`app.audit()` for audit rows, and the same row-lock allocation method as
`number_series` for numbering.
The final approval and the domain change run in **one database transaction**,
guarded so that only one final approval can succeed. Each ticket type supplies
a handler with `validate` when the ticket is raised, then `revalidate`
(optional; defaults to `validate`) and `apply` inside the final-approval
transaction.

## Goals

Each goal is met when its listed tests pass in `bash scripts/ci.sh`.

*   **G1: All or nothing.** A final approval and its domain change commit
    together or not at all. If `apply` fails, the ticket stays at its level and
    the domain data is unchanged (T-TKT-005, T-TKT-007).
*   **G2: Exactly once.** When two final approvals race, the change is applied
    once and the other approver gets a conflict error (T-TKT-006).
*   **G3: Scope holds everywhere.** Queues, ticket views, actions and forwarding
    targets respect the approver's centre scope. A ticket outside your scope
    returns 404, just like a ticket that does not exist (T-TKT-003, T-TKT-009,
    T-TKT-012).
*   **G4: Approvers resolved when they act.** A role-based level is checked
    against who holds the role *when they act*, not when the ticket was raised
    (T-TKT-013).
*   **G5: No self-approval.** The person who raised a ticket cannot approve it
    at any level (T-TKT-010). See Open Question Q4: the rule waits for its
    owner's signature.
*   **G6: Complete, immutable history.** Every action writes a history row that
    cannot be changed or deleted, plus an audit row through `app.audit()`
    (T-TKT-005, T-TKT-014).
*   **G7: Stale requests caught.** `revalidate` runs at final approval. If the
    request no longer fits the current data, it is refused with a reason and
    nothing changes (T-TKT-011).
*   **G8: Types are configuration.** A new ticket type with its levels,
    approvers, viewers and priority can be set up as data. Only its domain
    effect needs code, in the form of a handler (FR-094.01, FR-094.02).
*   **G9: Reject and forward rules.** Rejection requires remarks (T-TKT-008).
    Forwarding works only to an in-scope employee (T-TKT-009).

## Non-Goals

*   **The 31 domain handlers.** Each handler is built with its own module
    (Stages 3 to 6). Stage 2 ships the contract and a test-only handler
    (DD-2).
*   **SLA reminders and escalation** (T-TKT-016, D-TKT-3). These are Stage 5.
    The data model must not block them, but no job is built now.
*   **Dashboards, KPIs, reports and the ticket summary screen** (FR-094.03 KPIs,
    FR-094.05 summary, FR-223). These are Stage 5.
*   **Bulk approval screens** (FR-094.04 bulk, T-TKT-018). These are Stage 5.
    The single-ticket action is written so that bulk can later loop over it
    with one transaction per ticket.
*   **Type-specific approval pop-ups** (for example the course-change pop-up in
    FR-094.04). These belong to the domain modules.
*   **Notifications** (the "centre notified" part of T-TKT-008). There is no
    message channel yet (D-COMM-1). Stage 2 writes the event to history only.
*   **Migrating legacy tickets** (Q7). The legacy database cannot be read yet,
    so this design does not plan the migration.
*   **Visual design** of the screens. As with auth and admin, the screens are
    unstyled until a design system is chosen.

## Decisions Taken During Drafting

Taken by the project owner (gtm) in the drafting session on 2026-10-27. Each
one is PRO until the design is reviewed and approved.

*   **DD-1: Where rules are enforced.** In the TypeScript engine, inside
    `scopedAction()`. The database adds row-level security, a version check
    (compare-and-set), a trigger that rejects illegal state changes, and the
    append-only history trigger. Rejected: database functions in the RBAC style,
    and writing everything in SQL including handlers (see Alternatives).
    **Known limit:** approver eligibility and the self-approval rule are
    enforced only by the engine. Eligibility is *computed* by one shared SQL
    read function (see Technical Plan, Eligibility and visibility), but the
    engine is what refuses the action. Code that writes `app.ticket` without
    going through the engine bypasses them. The trigger still blocks illegal transitions, and a
    T-SEC test proves the app role cannot skip the version check.
*   **DD-2: Stage 2 deliverable.** The engine plus a handler that exists only
    in tests and writes a test-only table. No user-visible ticket type ships
    until a domain module provides a handler.
*   **DD-3: Forward = reassign at the same level.** The ticket stays at its
    level and the chosen employee becomes the only person who can act at that
    level. They can approve, reject or forward again.
*   **DD-4: Documents are stored in Supabase Storage now**, in a private bucket.
    Access is checked by our own code and downloads use short-lived signed
    links. This needs a storage ADR (ADR-002); see Q9. **Built ahead of need on
    purpose** (owner decision after the Stage 5 review, M2): no ticket type goes
    live in Stage 2 (DD-2), so nothing uploads in production yet. Storage stays
    in Stage 2 to settle ADR-002 early and to prove the upload path before
    domain modules depend on it.
*   **DD-5: Approver for a role-based level (was Q3).** The actor qualifies if
    they hold the level's role through an assignment whose scope covers the
    ticket's centre. This is the existing `app.scoped_centre_ids` rule applied
    to a role. A user who holds the role elsewhere and can merely see the
    centre does not qualify.
*   **DD-6: Files go straight from the browser to Supabase.** Vercel caps a
    function's request body at 4.5 MB, so uploads skip our server. The server
    hands out a short-lived signed upload URL for each file. The bucket itself
    enforces the size limit and allowed types. At raise, the server reads only
    the first bytes of each object to check its real size and file signature
    before linking it to a ticket. Rejected: uploading through our server with
    a 4 MB cap.
*   **DD-7: The screens are built in Stage 2 as the manual test harness**
    (owner decision after the Stage 5 review, M4). With no production handler
    they cannot be used for real. For the manual Supabase check, a dev-only
    setting `TICKET_TEST_HANDLER=1` registers the test handler. The engine
    refuses to start with that setting on any Vercel deployment (`VERCEL_ENV`
    set, production or preview).
*   **DD-8: One network-wide ticket counter** (owner decision after the Stage 5
    review, B1). This matches the legacy counter (TK-26/CMC/23642, current
    23,652). Whether it resets each year, and the starting value, stay NP
    parameters.

## Open Questions

*   **Q2: Ticket numbering policy (NP-1…8).** The series scope is settled:
    one network-wide counter (DD-8). Still open, as parameters: whether the
    counter resets each period (NP-3; default: never, as legacy appears to),
    the format and length (NP-5), and whether it continues from the legacy
    value 23,652 (NP-8). NP-1 itself still needs its owners' signature.
*   **Q4: Self-approval (D-TKT-4, ⛔).** It ships as "prohibited" through a code
    constant (`TICKET_POLICY.blockSelfApproval = true`), following the pattern
    in `src/server/auth/policy.ts`. It is not a runtime switch, so turning it
    off needs a code change and review, not a click. Operations must still sign
    before go-live.
*   **Q7: Legacy migration (D-MIG).** This covers 16,542 tickets, 2,412 of them
    pending. It is blocked on read access to the legacy MySQL database. The
    data model does not add migration-only columns now. The migration design
    will add what it needs, such as the legacy ticket number.
*   **Q8: Approvers and levels per type (D-TKT-1).** Proposed: copy the legacy
    setup, but that cannot be read yet. Stage 2 provides the type setup screen
    only.
*   **Q9: Storage ADR and limits.** ADR-002 has to record Supabase Storage. It
    also has to settle the file limits, which are PMC parameters: maximum size
    (proposed 10 MB), allowed types (proposed PDF, JPEG, PNG, checked by file
    signature, not by the name the browser sends), retention, and whether a
    virus scan is required before go-live. Documents may contain personal data
    (D-SEC-4).

## Critical User Journeys (CUJs)

### CUJ 1: Raise a ticket with a document

*   **Given**: An active ticket type that requires a document and has two
    levels, and a centre user holding `ticket.raise` for centre C.
*   **When**: The user fills in the request, attaches a PDF and submits.
*   **Then**: The file is stored in the private bucket. The ticket is created
    with the next number, the type's level setup is copied onto it, and the
    current level is 1. A RAISE history row and an audit row are written.
    Without the PDF, the request is refused and nothing is stored (T-TKT-001).

### CUJ 2: Two-level approval applies the change once

*   **Given**: The ticket from CUJ 1, a level-1 approver named by role, and a
    level-2 approver named as a user. Both are in scope for C, and neither
    raised the ticket.
*   **When**: The level-1 approver approves, then the level-2 approver
    approves.
*   **Then**: After level 1 the ticket is at level 2 and no domain data has
    changed (T-TKT-004). After level 2 the handler's `revalidate` and `apply`
    run in the same transaction as the status change. The ticket is APPROVED,
    and the domain change, the history row and the audit row exist exactly
    once (T-TKT-005).

### CUJ 3: Race and failure

*   **Given**: A ticket at its final level and two eligible approvers.
*   **When**: Both approve at the same moment. In a second run, the handler's
    `apply` throws instead.
*   **Then**: In the first run, one approval wins and the other gets a conflict
    error; the change is applied once (T-TKT-006). In the second run, the
    whole transaction rolls back. The ticket stays OPEN at its level, the
    domain data is unchanged, and a separate audit row records the failure
    (T-TKT-007).

### CUJ 4: Forward and reject

*   **Given**: An open ticket at level 1.
*   **When**: The approver forwards it to employee E, and E then rejects it.
*   **Then**: The forward works only if E holds `ticket.approve` over the
    ticket's centre and is neither the person who raised it nor the forwarder
    (T-TKT-009). After the forward, only E can act at level 1. E's rejection
    needs remarks (T-TKT-008). The ticket becomes REJECTED and can be re-raised
    as a new ticket linked to this one (T-TKT-015, D-TKT-2).

## Technical Plan (Architecture)

### Components

```text
 Browser (unstyled pages)                    Supabase Storage (private bucket)
   │  same-origin POST / GET                        ▲ put / signed URL
   ▼                                                │ (server key, server only)
 Route handlers (safeRoute) ──────────────► src/server/storage.ts
   │                                         (Supabase adapter | fake in CI)
   │  browser PUTs files straight to the bucket using a signed upload URL (DD-6)
   ▼
 src/server/tickets/engine.ts   raise · act(approve|reject|forward) · queue · view
   │   uses scopedAction() = authorize → change → audit, one transaction
   │   uses allocateTicketNumber() for numbers
   │   calls handler.validate / revalidate / apply   ◄── src/server/tickets/handlers.ts
   ▼                                                    (registry: key → handler)
 Postgres (schema app)
   ticket_category · ticket_type · ticket_type_level · ticket_type_viewer   (setup)
   ticket · ticket_level · ticket_event · ticket_upload · ticket_document   (per ticket)
   ticket_number_series                                                     (network-wide counter)
   RLS by centre · guard trigger · append-only triggers · app.audit()
```

### Data model (migration `0009_tickets`)

The setup tables and the ticket counter apply to every centre, so they
have no `centre_id`. The per-ticket tables carry `centre_id`, and row-level security
limits them to `app.visible_centre_ids()`, the same way `number_series` is
limited today.

| Table | Key columns | Notes |
|---|---|---|
| `ticket_category` | id, parent_id (null = main), name | Main and sub categories (FR-094.02) |
| `ticket_type` | id, code (unique), name, category_id, priority, document_required, handler_key, number_prefix, active | `handler_key` must name a registered handler before the type can be made active |
| `ticket_type_level` | type_id, level (1–4), approver_user_id, approver_role_id | Check: exactly one of user or role is set; levels have no gaps |
| `ticket_type_viewer` | type_id, user_id or role_id | Read-only access (T-TKT-012) |
| `ticket` | id (uuid), number (unique), type_id, centre_id, raised_by, status (OPEN, APPROVED, REJECTED), current_level, level_count, assigned_user_id, payload (jsonb), reraise_of, version, created_at, closed_at | `assigned_user_id` is set by a forward and cleared when the level advances |
| `ticket_level` | ticket_id, centre_id, level, approver_user_id, approver_role_id | **Copied from the type at raise**, so later setup edits do not move tickets already in progress. Role holders are still resolved when someone acts (T-TKT-013) |
| `ticket_event` | id, ticket_id, centre_id, at, actor_id, action (RAISE, APPROVE, REJECT, FORWARD), level, remarks, to_user_id, detail (jsonb) | Append-only (trigger, same pattern as `app.audit_immutable()`) (T-TKT-014) |
| `ticket_upload` | id (uuid), centre_id, uploaded_by, storage_key, file_name, declared_size, created_at | One row per signed upload URL issued (DD-6). Only the user who requested it can attach it, once |
| `ticket_document` | id, ticket_id, centre_id, upload_id (unique), content_type, size_bytes, at | Append-only link from a ticket to a checked upload. Key, file name and uploader are read through `upload_id`. The unique `upload_id` stops one upload being attached twice |
| `ticket_number_series` | period (primary key), current | The network-wide counter (DD-8). No `centre_id` and no RLS; `gems_app` may select, insert and update it |

**Guard trigger on `ticket`** (the database half of DD-1). Every update must
add exactly 1 to `version`. `status` may only move from OPEN to APPROVED or
REJECTED, and a closed ticket cannot change. `current_level` may only stay the
same or rise by one, and never past `level_count`. `number`, `type_id`,
`centre_id`, `raised_by`, `payload` and `reraise_of` cannot change. Deletes are
refused.

**Grants.** `gems_app` gets select and insert on the per-ticket tables,
update on `ticket` only, and select, insert and update on
`ticket_number_series`. Setup tables can only be changed by holders of
`ticket.type.manage`, enforced by an RLS write policy that calls
`app.has_permission('ticket.type.manage', null)`.

**Permissions** (inserted the same way as migration 0007):
`ticket.raise`, `ticket.view`, `ticket.approve`, `ticket.document.view`, and
`ticket.type.manage` (sensitive).

### Handler contract

Each ticket type names a handler by `handler_key`. A handler is a plain
TypeScript object registered in `src/server/tickets/handlers.ts`.

```ts
// illustrative, not production code
type TicketHandler<P> = {
  key: string;
  parse(payload: unknown): P;                       // shape check; throws InvalidRequest
  validate(tx: Tx, t: { centreId: number; payload: P }): Promise<void>;   // at raise
  revalidate?(tx: Tx, t: TicketRow<P>): Promise<void>;                    // at final approval, after the row lock; defaults to validate
  apply(tx: Tx, t: TicketRow<P>): Promise<{ before: unknown; after: unknown }>; // domain change; result goes to the audit row
};
```

Rules for every handler:

1.  **Database work only, through the given `tx`.** `withScope()` retries the
    whole transaction on a write conflict (P2034). A handler that sent an
    e-mail or called an outside service could therefore do it twice. Outside
    effects wait for an outbox, which is not part of this design.
2.  **`revalidate` refuses with a reason** (`StaleRequest`, T-TKT-011). The
    engine rolls back and shows the reason. The ticket stays OPEN, so an
    approver can then reject it with remarks.
3.  **`apply` runs at most once per ticket.** The engine guarantees this
    because `apply` runs only inside the transaction that holds the ticket's
    row lock and moves it from OPEN to APPROVED (see below). Handlers do not
    need their own duplicate protection.

### Actions

All actions are `scopedAction()` calls with the ticket's `centre_id`.
`scopedAction()` needs the centre before it authorizes, so Act and Re-raise
first read `centre_id` in a short read under row-level security. A hidden
ticket returns nothing there and the route gives 404, the same as a ticket
that does not exist. This is safe because `centre_id` cannot change (guard
trigger).

**Raise** (`ticket.raise` for the centre):
1.  **Before raise, for each file** (`ticket.raise` for the centre): the
    browser asks `POST /tickets/uploads` with the file name, size and type.
    The server refuses sizes over the limit and types that are not allowed.
    It inserts a `ticket_upload` row with key
    `uploads/{centreId}/{uploadId}` and returns a signed upload URL valid for
    2 minutes (PMC). The browser then PUTs the file straight to Supabase.
2.  **At raise, outside the transaction:** for each upload id sent, read the
    `ticket_upload` row. It must belong to the actor and the same centre, and
    must not be attached yet. Then fetch only the first 16 bytes of the object
    (a Range request). The response gives the object's real total size, which
    is checked against the limit, and the bytes give its file signature, which
    is checked against the allowed types. Doing this before the transaction
    keeps outside calls out of it, which matters because of the retry rule
    above.
3.  In the transaction: the type must be active. Run `handler.parse` and
    `handler.validate`. If the type requires a document, at least one must be
    present (T-TKT-001). Allocate the number (see Numbering), insert the ticket, copy the
    levels into `ticket_level`, insert document rows and a RAISE event. Audit
    `ticket.raise`.
4.  Objects that are uploaded but never attached stay in `uploads/`. No
    `ticket_document` row points to them and nobody can get a link to them,
    so they are harmless. Deleting them is a Future Improvement.

**Act** (`ticket.approve` for the centre). Input: ticket id, action, the
`version` the user saw, remarks, and the forward target.
1.  `select … from app.ticket where id = $1 for update`. If the ticket is not
    OPEN or `version` differs from what the user saw, return **Conflict**
    (T-TKT-006: the second of two racing approvers waits on the lock, then
    sees the new version).
2.  **Who may act:** `app.ticket_may_act(ticket_id)` must be true for the
    session's user (see Eligibility and visibility). It includes the
    `ticket.approve` check for the ticket's centre, so it agrees with
    `scopedAction()`'s own check.
3.  **Self-approval.** If `TICKET_POLICY.blockSelfApproval` is set, the person
    who raised the ticket cannot approve or forward at any level (T-TKT-010).
    The queue and the detail page apply the same rule: the queue leaves out
    tickets the user raised, and the detail page offers only the actions the
    engine would allow. So a ticket in your queue is always one you can
    approve.
4.  **Approve, not the last level:** `current_level + 1`, clear
    `assigned_user_id`, APPROVE event (T-TKT-004).
5.  **Approve, last level:** `handler.revalidate`, then `handler.apply`, then
    status APPROVED with `closed_at`, APPROVE event. The audit row takes
    `before` and `after` from `apply` (T-TKT-005). If anything throws, the
    whole transaction rolls back. If the error came from `handler.apply`, a
    `ticket.apply_failed` audit row with outcome FAILED (a new
    `AuditOutcome` value) is written in its own transaction (T-TKT-007). This uses a new optional failure-audit hook on
    `scopedAction()`, the same mechanism as its DENIED rows. A `StaleRequest`
    from `revalidate` or a Conflict changed nothing and writes no audit row;
    the user sees the reason.
6.  **Reject:** remarks must not be blank (T-TKT-008). Status REJECTED,
    REJECT event. Notifying the centre waits for D-COMM-1.
7.  **Forward:** the target must be active, must not be the actor or the
    person who raised the ticket, and must hold `ticket.approve` over the
    ticket's centre (T-TKT-009), all checked by
    `app.ticket_may_receive(ticket_id, user_id)`. Set `assigned_user_id` and write a FORWARD event.
8.  Every update is
    `update app.ticket set …, version = version + 1 where id = $1 and version = $seen`.
    The guard trigger checks the transition.

**Re-raise** (D-TKT-2, PMC): raise a new ticket with `reraise_of` set to the
rejected ticket, which must be REJECTED and in scope (T-TKT-015).

### Reads

*   **Approval queue** (T-TKT-003): OPEN tickets where
    `app.ticket_may_act(id, actor)` is true. Row-level security limits rows to
    the actor's centres first.
*   **Ticket list and detail:** tickets where `app.ticket_may_view(id)` is true
    (T-TKT-012). The detail page shows the history and the documents.
*   **Document download** (`ticket.document.view`): the ticket must pass
    `app.ticket_may_view` and the document row must be readable (RLS applies).
    Write a `ticket.document.download` audit row, then redirect to a signed
    URL valid for 60 seconds (PMC).

### Eligibility and visibility (one rule, one place)

The rule for whether an assignment covers a centre (ALL, REGION, AREA or
CENTRE) already lives in SQL: `app.scoped_centre_ids` (migration 0002) and
`app.target_centre_ids` (migration 0005). The ticket rules are built on it
once, as `SECURITY DEFINER` read functions in migration 0009. They need
definer rights because the actor cannot read other users' assignments. They
only read and never write, so DD-1 still holds.

| Function | True when | Used by |
|---|---|---|
| `app.ticket_may_act(ticket)` | For the session's user (`app.session_user_id()`; no user parameter, so it cannot be asked about others): the ticket is OPEN, the user holds `ticket.approve` over its centre, and either `assigned_user_id` is the user, or no one is assigned and the user is the current level's named user or holds its role through an assignment covering the ticket's centre (DD-5) | Act step 2, the approval queue, `canAct` on the detail page |
| `app.ticket_may_receive(ticket, user)` | `user` is active, is not the caller, is not the person who raised the ticket, and holds `ticket.approve` over the ticket's centre | Forward step 7 |
| `app.ticket_forward_candidates(ticket)` | Returns id and display name of every user for whom `ticket_may_receive` is true | The forward picker |
| `app.ticket_may_view(ticket)` | The caller holds `ticket.view` over the centre, raised the ticket, is or was named on one of its levels (user, or role over the centre), or is a viewer of its type | List, detail, document download |

Every one of these returns false, or nothing, when the ticket's centre is not
in the caller's `visible_centre_ids()`. So none of them can be used to learn
whether a user holds rights at a centre the caller cannot see.

### Storage

`src/server/storage.ts` exposes `signedUploadUrl(key)`, `head(key, bytes)`
(returns the first bytes and the object's total size) and
`signedDownloadUrl(key, seconds)`. It has two implementations:

*   **Supabase:** calls the Storage REST API with `fetch`, so no new
    dependency is needed. It uses a server-only key read from
    `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` and a private bucket set in
    `TICKET_BUCKET`. The bucket is created with Supabase's own
    `file_size_limit` and `allowed_mime_types`, so oversized or wrong-type
    uploads are refused before our check runs. The browser never receives the
    key or the bucket path.
*   **Fake:** an in-memory map used when `STORAGE_DRIVER=fake`, the CI
    setting. Tests put objects into the map directly and call the engine.
    The browser upload component is covered by the manual check against
    real Supabase (DD-7), recorded in the evidence log.

The Content-Security-Policy in `proxy.ts` currently allows connections only
to the app itself (`default-src 'self'`). It needs `connect-src 'self'` plus
the Supabase origin, or the browser will block the upload.

### Numbering

One network-wide counter (DD-8). `app.number_series` cannot hold it, because
`centre_id` is part of its primary key. So tickets get their own one-table
counter, `ticket_number_series`, and `allocateTicketNumber(tx, period)` in
`numbering.ts`, which works the same way as `allocate()`:

```sql
-- illustrative
insert into app.ticket_number_series (period, current) values ($period, 1)
on conflict (period) do update set current = ticket_number_series.current + 1
returning current;
```

*   **No seeding step (M1).** The first raise in a new period creates the row.
    The row lock taken by the upsert serialises concurrent raises, and a
    rolled-back raise releases its number, exactly as with `allocate()`.
*   **Period.** Stage 2 uses one period key, `ALL`: the counter never resets.
    A yearly reset (NP-3) is not offered yet, because the format has no
    period in it and a reset would repeat numbers. If NP-3 chooses a reset,
    the period is added to the format in the same change; the `period`
    column is already there for it.
*   **Continuing from legacy (NP-8).** If signed, a one-line seed in the
    migration-day script sets `current` to the legacy value. Nothing in
    Stage 2 depends on it.
*   **Format.** SRC: `{prefix}/{typecode}/{seq}`. The prefix comes from
    `ticket_type.number_prefix`; padding and maximum length are parameters
    (NP-5). `formatNumber()` builds a different shape
    (centre/doc/period/number), so tickets get `formatTicketNumber()` next to
    it.

### Screens (unstyled, as with admin)

`/tickets` (list with filters for status, type, priority and centre),
`/tickets/new`, `/tickets/[id]` (detail, history, documents, action buttons),
`/tickets/approvals` (queue), and `/admin/ticket-types` (setup; step-up
required, as for RBAC writes). In Stage 2 these are the manual test harness
(DD-7): they can only be used with `TICKET_TEST_HANDLER=1`, which is refused
on Vercel.

## Alternatives Considered

### Alternative A: Rules in database functions (RBAC pattern)

*   **Pros**: Eligibility, self-approval and level changes are checked again in
    the database, as migration 0005 does for RBAC. Code that bypasses the
    engine cannot bypass the rules.
*   **Cons**: The logic is split between SQL and TypeScript. Handlers' `apply`
    still runs in TypeScript, so the definer function and the handler have to
    agree on lock order inside one transaction. It is more SQL to write and
    review.
*   **Reason for Rejection**: The owner chose app code plus a database guard
    (DD-1). The guard trigger and the version check cover the failure modes
    with the worst outcome (double application and illegal transitions). The
    risk that remains is listed as a known limit.

### Alternative B: Everything in SQL, including handlers

*   **Pros**: A single atomic place, with no split logic.
*   **Cons**: 31 domain handlers in plpgsql would tie every domain module to
    SQL. They are harder to test and review, and the team writes the rest of
    the app in TypeScript.
*   **Reason for Rejection**: The cost grows with every ticket type, and
    Alternative A already gives database-side checks if they are ever needed.

### Alternative C: A workflow product or library (BPM engine, Temporal, state-machine library)

*   **Pros**: Ready-made levels, timers and escalation.
*   **Cons**: The flow is short and fixed: up to four linear levels with
    approve, reject or forward. A workflow product adds a separate runtime or
    store that does not share the business transaction. That breaks G1 (all or
    nothing) unless we add compensation logic, and it sits outside row-level
    security.
*   **Reason for Rejection**: It solves problems this engine does not have and
    weakens the guarantee it must keep.

### Alternative D: Each module builds its own approval flow

*   **Pros**: No shared contract to agree on.
*   **Cons**: The four failure modes in The Problem would be solved, or missed,
    up to 31 times. The legacy system already uses one engine (WF6, SRC).
*   **Reason for Rejection**: It multiplies the risk the engine exists to
    remove.

### Alternative E: Resolve the level setup live instead of copying it at raise

*   **Pros**: No `ticket_level` table. Setup fixes reach tickets already in
    progress at once.
*   **Cons**: Editing a type would change who must approve tickets that are
    halfway through. Removing a level could strand a ticket at a level that no
    longer exists. History could no longer show who was meant to approve.
*   **Reason for Rejection**: Copying is one small table and keeps every ticket
    tied to the rules it was raised under. Role *holders* are still resolved
    when someone acts (T-TKT-013).

### Alternative F: Forward as consult-only, or as an extra level

*   **Pros**: Approval rights never move (consult), or the original approvers
    are kept (extra level).
*   **Cons**: Consult-only stops the forwardee from finishing the job, which
    may not match legacy use. An extra level makes level numbers drift from
    the type's setup.
*   **Reason for Rejection**: The owner chose reassign at the same level
    (DD-3). Its risk, which is giving approval rights by forwarding, is reduced
    by requiring the target to hold `ticket.approve` over the centre.

### Alternative G: Document references only, or blocking types that need documents

*   **Pros**: A much smaller Stage 2 with no storage decision.
*   **Cons**: References only gives a T-TKT-001 that can pass while no file
    exists. Blocking would push storage to the first domain handler that
    needs it.
*   **Reason for Rejection**: The owner chose Supabase Storage now, on purpose
    ahead of need, to settle ADR-002 early and prove the upload path (DD-4).

### Alternative H: Supabase JavaScript SDK instead of `fetch`

*   **Pros**: Typed client, retries.
*   **Cons**: A new dependency for three REST calls. Its storage access rules
    assume Supabase Auth, which we do not use (ADR-001).
*   **Reason for Rejection**: Three `fetch` calls are smaller, and Supabase can
    be swapped out behind `storage.ts`.

--------------------------------------------------------------------------------

## Non-Functional Requirements

*   **Security and privacy.** Documents may contain personal data (D-SEC-4).
    The bucket is private. The server key never leaves the server, which the
    client-bundle scan (T-SEC-017) is extended to check. Downloads need
    `ticket.document.view` for the ticket's centre, are audited, and use
    60-second links. Every ticket read and action goes through row-level
    security, and records outside your scope give 404. Ticket remarks and
    payloads pass through the existing audit redaction.
*   **Concurrency.** One row lock per ticket. Bulk approval (Stage 5) loops
    over single-ticket transactions, so one failure does not block the rest
    (T-TKT-018).
*   **Queue cost.** The queue calls `app.ticket_may_act` once per visible OPEN
    ticket. With about 2,400 open tickets network-wide (legacy figure) that is
    acceptable. If the queue becomes slow, turn the function into a set-
    returning query; the rule stays in one place.
*   **Transaction time.** File checks run before the
    transaction opens, so the transaction holds the row lock only for database
    work and stays within `withScope`'s default 5 s.
*   **Rollout.** A ticket type is inactive until an administrator activates it,
    and activation requires a registered handler. Stage 2 registers none
    outside tests (DD-2), so nothing reaches users until a domain module ships
    a handler. Rolling back means deactivating the type.

--------------------------------------------------------------------------------

### Additional Resources

*   `docs/designs/ticket-engine/input-brief.md` (the drafting input)
*   WF6, *GEMS Workflows for Manager Review*, pp. 11–12; SPEC p.38
*   Audit 04 (D-TKT-1…4, NP-1…8), 06 (threat model), 09 (T-TKT-001…018),
    10 (stage placement), 11 (POC P5)
*   ADR-001 (first-party authentication); migrations 0002 (scope functions)
    and 0005 (RBAC pattern)

### Future Improvements

*   **Deleting uploads that were never attached**: a daily job that removes
    `uploads/` objects older than 24 hours with no `ticket_document`.
*   **Outbox for outside effects**: needed for centre notifications
    (T-TKT-008, D-COMM-1) and any handler that must call another system.
*   **Database-side eligibility checks** (Alternative A), if a second write
    path to tickets ever appears.
*   **Virus scanning** of uploads, if Q9 requires it.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Build order: decisions and schema first, then the server modules, then the
routes and screens, then the documentation. Every step leaves
`bash scripts/ci.sh` green.

### Target Files to Create/Modify

#### 1. `docs/adr/ADR-002-document-storage.md` (Create)

*   **Type / Scope**: Architecture decision record.
*   **Proposed Changes**: Records DD-4 and DD-6. It covers Supabase Storage as
    the private store, uploads straight from the browser through signed
    upload URLs, the server-side check before attaching, 60-second download
    links, the server-only key, and the fake driver in CI. It lists the Q9
    limits as PMC. It uses the same layout as ADR-001, with status
    "Proposed" until the owner signs.

#### 2. `docs/audit/04-manager-decision-register.md` (Modify)

*   **Type / Scope**: Decision register.
*   **Proposed Changes**: Adds **D-STO-1** for upload limits (size, types,
    retention, virus scan), with owner IT + Legal and proposed defaults from
    Q9. Records against NP-1 that the owner chose one network-wide ticket
    counter (DD-8), pending the NP owners' signature. Then re-run
    `python -I docs/audit/tools/build_matrix.py docs/audit`, because
    T-DOC-001 checks the counts, and update the decision count in
    `docs/STATUS.md`.

#### 3. `docs/audit/09-test-strategy-and-acceptance-criteria.md` (Modify)

*   **Type / Scope**: Acceptance tests.
*   **Proposed Changes**: Adds T-TKT-019, where a document download needs
    `ticket.document.view` for the centre, gives 404 outside scope, and is
    audited. Adds T-TKT-020, where an upload is refused when the stored
    object's real size or signature breaks the limit, when it belongs to
    another user or centre, or when it is already attached. Re-run
    `build_matrix.py`.

#### 4. `prisma/migrations/0009_tickets/migration.sql` (Create)

*   **Type / Scope**: SQL migration.
*   **Proposed Changes**:
    *   Enums `TicketStatus` (OPEN, APPROVED, REJECTED), `TicketAction`
        (RAISE, APPROVE, REJECT, FORWARD) and `TicketPriority` (values to
        match the legacy list; LOW, MEDIUM, HIGH until legacy is readable),
        and a new value FAILED on the existing `AuditOutcome` enum.
    *   The ten tables in the Technical Plan, with check constraints: exactly
        one of user or role per level and per viewer, level 1–4,
        `current_level <= level_count`.
    *   RLS on the five per-ticket tables (`ticket`, `ticket_level`,
        `ticket_event`, `ticket_upload`, `ticket_document`), using the loop
        pattern from 0002, which creates all four policies (select, insert,
        update, delete by `visible_centre_ids()`). What the app may actually
        do is limited by the grants: insert on all five, update on `ticket`
        only, delete on none.
    *   RLS on the setup tables: select for all app users, and insert, update
        and delete only when
        `app.has_permission('ticket.type.manage', null)`.
    *   Trigger `app.ticket_guard()`, with the rules listed in the Technical
        Plan.
    *   Append-only triggers on `ticket_event` and `ticket_document`, reusing
        the pattern of `app.audit_immutable()`.
    *   The four definer read functions in Eligibility and visibility
        (`ticket_may_act`, `ticket_may_receive`,
        `ticket_forward_candidates`, `ticket_may_view`), built on
        `app.target_centre_ids` / `app.scoped_centre_ids`, each returning
        false or nothing outside the caller's `visible_centre_ids()`. Granted
        to `gems_app` only.
    *   Permission rows `ticket.raise`, `ticket.view`, `ticket.approve`,
        `ticket.document.view` and `ticket.type.manage` (sensitive), using
        `on conflict do nothing`.
    *   Grants exactly as in the Technical Plan.

#### 5. `prisma/schema.prisma` (Modify)

*   **Type / Scope**: Prisma schema.
*   **Proposed Changes**: Models and enums mirroring 0009, so the drift gate in
    `scripts/ci.sh` passes.

#### 6. `src/server/tickets/handlers.ts` (Create)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: The `TicketHandler<P>` type, `TicketRow<P>`, the
    error class `TicketError(reason: "invalid" | "stale" | "conflict" |
    "document" | "notallowed", message)`, and
    `HANDLERS: Record<string, TicketHandler<unknown>>`, which is empty in
    production. Tests add their handler under the key `test.counter`. When
    `TICKET_TEST_HANDLER=1`, the module also registers `test.counter` from
    `test-handler.ts`, and throws at load on any Vercel deployment
    (`VERCEL_ENV` set) (DD-7).

#### 6a. `src/server/tickets/test-handler.ts` (Create)

*   **Type / Scope**: TypeScript module (test and manual-harness only).
*   **Proposed Changes**: The `test.counter` handler. It increments
    `app.test_ticket_counter` in `apply` and can be told, through its payload,
    to throw in `apply` (T-TKT-007) or to refuse in `revalidate` (T-TKT-011).
    Used by `tests/tickets.test.ts` and by the manual harness (DD-7).

#### 7. `src/server/tickets/engine.ts` (Create)

*   **Type / Scope**: TypeScript module (core).
*   **Proposed Changes**:
    *   `TICKET_POLICY` constant, PMC, in the same style as `EXPORT_POLICY` in
        `exports.ts`: `blockSelfApproval: true`,
        `maxFileBytes: 10 * 1024 * 1024`,
        `allowedSignatures: [pdf, jpeg, png]`, `uploadUrlSeconds: 120`,
        `downloadUrlSeconds: 60`, `numberPad`.
    *   Writes: `requestUpload(session, {centreId, fileName, size,
        contentType})`, `raise(session, {typeId, centreId, payload,
        uploadIds, reraiseOf?})` and `act(session, {ticketId, action,
        seenVersion, remarks?, forwardTo?})`. Each follows the steps in the
        Technical Plan through `scopedAction()`. `act` passes a failure-audit
        hook that writes `ticket.apply_failed` only for errors thrown by
        `handler.apply`.
    *   Reads: `approvalQueue(session)`, `listTickets(session, filters)`,
        `getTicket(session, id)` (detail, levels, history, documents,
        `canAct`, forward candidates) and `documentLink(session, ticketId,
        documentId)` (audited, returns a signed URL).
    *   Audit actions: `ticket.upload.request`, `ticket.raise`,
        `ticket.approve`, `ticket.approve.final`, `ticket.reject`,
        `ticket.forward`, `ticket.apply_failed` and
        `ticket.document.download`.

#### 8. `src/server/tickets/setup.ts` (Create)

*   **Type / Scope**: TypeScript module (type setup).
*   **Proposed Changes**: `createCategory`, `createType`,
    `setTypeLevels(typeId, levels[])`, `setTypeViewers` and
    `setTypeActive(typeId, active)`. Activation refuses a `handler_key` that
    is not in `HANDLERS` and a type with no levels. All writes use
    `scopedAction()` with `ticket.type.manage`, need fresh step-up (reuse
    `requireFreshStepUp` from `rbac.ts` by exporting it), and record before
    and after in the audit row. Audit actions: `ticket.type.create`,
    `ticket.type.levels`, `ticket.type.viewers`, `ticket.type.activate`,
    `ticket.type.deactivate` and `ticket.category.create`.

#### 9. `src/server/storage.ts` (Create)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: `signedUploadUrl(key)`, `head(key, bytes)` (a
    Range request for the first `bytes`; the total size comes from the
    `Content-Range` header) and `signedDownloadUrl(key, seconds)`. The
    Supabase driver uses `fetch` against `/storage/v1/object/upload/sign/…`,
    `/storage/v1/object/authenticated/…` and `/storage/v1/object/sign/…`.
    That Supabase honours Range requests on the authenticated endpoint is
    checked first in the manual check; if it does not, fall back to a
    streamed read that stops after the size limit. It is configured
    with environment variables `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and
    `TICKET_BUCKET`. The fake driver is selected by `STORAGE_DRIVER=fake`. It
    refuses to load on any Vercel deployment (`VERCEL_ENV` set), so the fake
    can never be live. The check is not tied to `NODE_ENV`, because CI's
    `next build` and real-server smoke run with `NODE_ENV=production` and the
    fake driver.

#### 10. `src/server/numbering.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: Adds `allocateTicketNumber(tx, period)` (the upsert
    in Numbering) and `formatTicketNumber({prefix, typeCode, number, pad,
    maxLength})`, which returns `{prefix}/{typeCode}/{seq}` and rejects
    over-length values like `formatNumber`. NP-3 and NP-5 are parameters.

#### 11. `src/server/rbac.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: Exports `requireFreshStepUp`, which is private
    today (`StepUpRequired` is already exported). No behaviour change.

#### 11a. `src/server/action.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: `scopedAction()` gains an optional last argument
    `onFailure?: (e: unknown) => { action: string; extra: AuditExtra } | null`.
    When the business transaction throws and the hook returns a value, that
    audit row is written with outcome FAILED in its own transaction, the same way DENIED rows are
    written today. Existing callers do not change.

#### 12. `src/server/admin-http.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: `adminPost` also maps `TicketError` to
    `?error=<reason>`, and `ADMIN_MESSAGES` gains the ticket reasons,
    including `conflict` ("This ticket changed since you opened it"). The
    shared `forbidden` text becomes generic ("You are not allowed to do
    that."); the role-granting hint moves to the RBAC pages.
    This lets ticket form posts reuse the same-origin check, session and error
    plumbing.

#### 13. `proxy.ts` (Modify)

*   **Type / Scope**: Next.js proxy (CSP).
*   **Proposed Changes**: Adds `connect-src 'self' <SUPABASE_URL origin>`.
    When `SUPABASE_URL` is not set (CI), only `'self'` is allowed.

#### 14. `app/tickets/page.tsx`, `app/tickets/new/page.tsx`, `app/tickets/[id]/page.tsx`, `app/tickets/approvals/page.tsx` (Create)

*   **Type / Scope**: Server-rendered pages (unstyled).
*   **Proposed Changes**: The ticket list with filters, the raise form (type,
    centre, payload fields, file picker, `?reraise=<id>`), the detail page
    (history, documents, action form with hidden `seenVersion`, and the
    forward picker) and the approval queue. All reads go through
    `pageRead()`, so anything out of scope gives 404.

#### 15. `app/tickets/new/upload.tsx` (Create)

*   **Type / Scope**: Client component (the only client JavaScript in this
    design).
*   **Proposed Changes**: For each chosen file, it calls
    `POST /tickets/uploads`, PUTs the file to the returned URL, and adds the
    upload id to a hidden field of the raise form. It shows a per-file error
    when something is refused.

#### 16. `app/tickets/uploads/route.ts`, `app/tickets/create/route.ts`, `app/tickets/[id]/act/route.ts`, `app/tickets/[id]/documents/[docId]/route.ts` (Create)

*   **Type / Scope**: Route handlers, all wrapped in `safeRoute`.
*   **Proposed Changes**: The upload request (same-origin JSON POST,
    returning `{uploadId, url}`), raise (form POST through `adminPost`), act
    (form POST through `adminPost`; a conflict returns the user to the
    ticket with a "changed since you opened it" message) and document
    download (GET, 302 to the signed URL, 404 when out of scope).

#### 17. `app/admin/ticket-types/page.tsx`, `app/admin/ticket-types/[id]/page.tsx`, `app/admin/ticket-types/create/route.ts`, `app/admin/ticket-types/[id]/save/route.ts` (Create)

*   **Type / Scope**: Admin pages and routes.
*   **Proposed Changes**: List and create types and categories. Edit levels
    (1–4, user or role each), viewers, priority, document required,
    `handler_key` (a choice from `HANDLERS`) and active. These follow the
    `/admin/roles` pages.

#### 18. `tests/sql/ticket-test-handler.sql` (Create)

*   **Type / Scope**: Test-only SQL, applied by the admin connection, as with
    `audit-fault.sql`.
*   **Proposed Changes**: Table `app.test_ticket_counter(centre_id, key,
    value)` with RLS by centre (all four policies, as in 0002), granted to
    `gems_app`, used by
    `test-handler.ts`. For the manual harness it is applied by hand to the
    local database.

#### 19. `tests/tickets.test.ts` (Create)

*   **Type / Scope**: Vitest suite against the Docker database.
*   **Proposed Changes**: T-TKT-001…015 and 019–020, plus:
    *   T-TKT-006 uses two real concurrent sessions and asserts that the
        counter equals 1 and that one call raised `conflict`.
    *   Guard trigger: a direct `update app.ticket` as `gems_app` that skips
        the version, reopens a closed ticket or jumps two levels is refused.
    *   `ticket_event` update and delete are refused.
    *   Activation without a registered handler is refused.
    *   T-TKT-002: tickets raised at two different centres get consecutive,
        distinct numbers from the one counter (B1); concurrent raises get no
        duplicates; a rolled-back raise leaves no gap; the first raise of a
        new period creates its row (M1). Reset and legacy continuation wait
        for NP-3 and NP-8.
    *   Eligibility: for every fixture user, including a level role holder
        without `ticket.approve` and the raiser, a ticket is in the queue
        exactly when `act(approve)` succeeds; `ticket_may_receive` and `ticket_forward_candidates` return
        false or nothing for a ticket at a centre the caller cannot see.
    *   Loading the handler registry with `TICKET_TEST_HANDLER=1`, or the
        fake storage driver, with `VERCEL_ENV` set throws.
    *   T-TKT-016, 017 and 018 are listed as Stage 5 or as belonging to the
        domain modules, not skipped silently.

#### 20. `tests/fixtures.ts` (Modify)

*   **Type / Scope**: Test fixtures.
*   **Proposed Changes**: Helpers to create a ticket type with levels, users
    with scoped approver roles, and sessions for each, reusing the existing
    user and session fixtures.

#### 20a. `tests/foundation.test.ts` (Modify)

*   **Type / Scope**: Foundation RLS tests.
*   **Proposed Changes**: T-RLS-002's expected table list gains the five
    per-ticket tables. `test_ticket_counter` also has `centre_id` and may
    exist when T-RLS-002 runs, so the test SQL gives it all four policies and
    the test excludes tables created by test SQL by name. T-RLS-005's
    definer-function inventory gains `ticket_forward_candidates`,
    `ticket_may_act`, `ticket_may_receive` and `ticket_may_view`.

#### 21. `tests/audit-catalogue.ts` and `tests/audit.test.ts` (Modify)

*   **Type / Scope**: Audit coverage gate.
*   **Proposed Changes**: Adds the 14 ticket audit actions from items 7 and 8.
    Each one is asserted by a test in `tickets.test.ts`, otherwise the
    catalogue gate fails.

#### 22. `tests/sec.test.ts` and `scripts/smoke-security.mjs` (Modify)

*   **Type / Scope**: T-SEC suite and real-server smoke.
*   **Proposed Changes**: Adds ticket pages and routes to the 404-parity and
    same-origin checks. Checks that `connect-src` contains the storage origin
    when `SUPABASE_URL` is set, and only `'self'` otherwise.

#### 23. `scripts/scan-client-bundle.mjs` (Modify)

*   **Type / Scope**: CI script.
*   **Proposed Changes**: Adds `SUPABASE_SERVICE_KEY` and the service-role
    token shape to the banned-in-bundle patterns.

#### 24. `.github/workflows/ci.yml` and `.env.local` (Modify)

*   **Type / Scope**: CI configuration and local environment.
*   **Proposed Changes**: Sets `STORAGE_DRIVER=fake` in both. No Supabase
    secrets in CI.

#### 25. `docs/STATUS.md` and `docs/audit/12-evidence-and-verification-log.md` (Modify)

*   **Type / Scope**: Tracker and evidence log.
*   **Proposed Changes**: A new evidence entry with the CI run, test counts and
    the manual Supabase upload check. Update STATUS completed items, test
    count, Stage 2 progress and decision count.

### Verification Plan

*   **Compilation/Build**: `npx tsc --noEmit` and `npx next build`, both run
    by `bash scripts/ci.sh`.
*   **Unit and integration tests**: `npx vitest run`, which runs the new
    `tests/tickets.test.ts`, the extended audit and T-SEC suites, and the
    catalogue gate.
*   **Static checks**: the drift gate, the unsafe-SQL ban and the client-bundle
    secret scan in `scripts/ci.sh`.
*   **Coverage requirement**: every T-TKT test that applies to Stage 2 has a
    named test (001–015, 019, 020). The others are listed with their stage.
    POC P5's failure conditions (partial state, double application,
    self-approval) are each tied to a failing-then-passing mutation check,
    recorded in the evidence log as was done for P2 and P3.
*   **E2E**: the real-server smoke on a fresh database (CI). Plus one manual
    run with `next dev`, `TICKET_TEST_HANDLER=1`, the test SQL applied and
    real Supabase Storage: activate a `test.counter` type, upload, raise,
    approve at two levels and download. Recorded as evidence (DD-7).

*Drafted with EGM*
