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
each ticket type's handler plugs into. The full set of 31 types, the queues,
SLA reminders and dashboards are Stage 5. Each type's domain handler is built
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
`app.audit()` for audit rows, and the `number_series` allocator for numbering.
The final approval and the domain change run in **one database transaction**,
guarded so that only one final approval can succeed. Each ticket type supplies
a handler with three steps: `validate` when the ticket is raised, then
`revalidate` and `apply` inside the final-approval transaction.

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
    **Known limit:** approver eligibility and the self-approval rule are checked
    only in TypeScript. Code that writes `app.ticket` without going through the
    engine bypasses them. The trigger still blocks illegal transitions, and a
    T-SEC test proves the app role cannot skip the version check.
*   **DD-2: Stage 2 deliverable.** The engine plus a handler that exists only
    in tests and writes a test-only table. No user-visible ticket type ships
    until a domain module provides a handler.
*   **DD-3: Forward = reassign at the same level.** The ticket stays at its
    level and the chosen employee becomes the only person who can act at that
    level. They can approve, reject or forward again.
*   **DD-4: Documents are stored in Supabase Storage now**, in a private bucket.
    Access is checked by our own code and downloads use short-lived signed
    links. This needs a storage ADR (ADR-002); see Q9.
*   **DD-6: Files go straight from the browser to Supabase.** Vercel caps a
    function's request body at 4.5 MB, so uploads skip our server. The server
    hands out a short-lived signed upload URL for each file. At raise, it
    downloads the object and checks its real size, file signature and hash
    before linking it to a ticket. Rejected: uploading through our server with
    a 4 MB cap.
*   **DD-5: Approver for a role-based level (was Q3).** The actor qualifies if
    they hold the level's role through an assignment whose scope covers the
    ticket's centre. This is the existing `app.scoped_centre_ids` rule applied
    to a role. A user who holds the role elsewhere and can merely see the
    centre does not qualify.

## Open Questions

*   **Q2: Ticket numbering policy (NP-1…8).** No numbering policy is approved.
    One finding affects the design. The legacy counter (TK-26/CMC/23642, current
    23,652) looks like **one network-wide series**. The current allocator,
    `app.number_series`, has `centre_id` as part of its primary key, so it only
    supports per-centre series. Stage 2 uses a per-centre series (see Technical
    Plan, Numbering) and keeps the format as parameters. If NP-1 chooses one
    network-wide series, the allocator needs a series without a centre. That is
    a small schema change, but it should be decided before Stage 2 ships,
    because switching after tickets exist leaves two numbering schemes in use.
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
   │   uses allocate() for numbers
   │   calls handler.validate / revalidate / apply   ◄── src/server/tickets/handlers.ts
   ▼                                                    (registry: key → handler)
 Postgres (schema app)
   ticket_category · ticket_type · ticket_type_level · ticket_type_viewer   (setup)
   ticket · ticket_level · ticket_event · ticket_upload · ticket_document   (per ticket)
   RLS by centre · guard trigger · append-only triggers · app.audit()
```

### Data model (migration `0009_tickets`)

The setup tables apply to every centre (HO masters), so they have no
`centre_id`. The per-ticket tables carry `centre_id`, and row-level security
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
| `ticket_document` | id, ticket_id, centre_id, upload_id (unique), storage_key, file_name, content_type, size_bytes, sha256, uploaded_by, at | Append-only. Written only after the server has checked the stored object. The unique `upload_id` stops one upload being attached twice |

**Guard trigger on `ticket`** (the database half of DD-1). Every update must
add exactly 1 to `version`. `status` may only move from OPEN to APPROVED or
REJECTED, and a closed ticket cannot change. `current_level` may only stay the
same or rise by one, and never past `level_count`. `number`, `type_id`,
`centre_id`, `raised_by`, `payload` and `reraise_of` cannot change. Deletes are
refused.

**Grants.** `gems_app` gets select and insert on the per-ticket tables and
update on `ticket` only. Setup tables can only be changed by holders of
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
  revalidate(tx: Tx, t: TicketRow<P>): Promise<void>;                     // at final approval, after the row lock
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

All actions are `scopedAction()` calls with the ticket's `centre_id`. A ticket
that row-level security hides gives 404, the same as a ticket that does not
exist.

**Raise** (`ticket.raise` for the centre):
1.  **Before raise, for each file** (`ticket.raise` for the centre): the
    browser asks `POST /tickets/uploads` with the file name, size and type.
    The server refuses sizes over the limit and types that are not allowed.
    It inserts a `ticket_upload` row with key
    `staging/{centreId}/{uploadId}` and returns a signed upload URL valid for
    2 minutes (PMC). The browser then PUTs the file straight to Supabase.
2.  **At raise, outside the transaction:** for each upload id sent, read the
    `ticket_upload` row. It must belong to the actor and the same centre, and
    must not be attached yet. Then download the object and check its real size
    against the limit, its file signature against the allowed types, and
    compute its SHA-256. Doing this before the transaction keeps outside calls
    out of it, which matters because of the retry rule above.
3.  In the transaction: the type must be active. Run `handler.parse` and
    `handler.validate`. If the type requires a document, at least one must be
    present (T-TKT-001). Allocate the number, insert the ticket, copy the
    levels into `ticket_level`, insert document rows and a RAISE event. Audit
    `ticket.raise`.
4.  Objects that are uploaded but never attached stay in `staging/`. No
    `ticket_document` row points to them and nobody can get a link to them,
    so they are harmless. Deleting them is a Future Improvement.

**Act** (`ticket.approve` for the centre). Input: ticket id, action, the
`version` the user saw, remarks, and the forward target.
1.  `select … from app.ticket where id = $1 for update`. If the ticket is not
    OPEN or `version` differs from what the user saw, return **Conflict**
    (T-TKT-006: the second of two racing approvers waits on the lock, then
    sees the new version).
2.  **Who may act.** If `assigned_user_id` is set, only that user. Otherwise,
    for the current `ticket_level` row: a named user must be the actor, and a
    role means the actor holds that role through an assignment covering the
    ticket's centre (DD-5). The actor's own `role_assignment` rows are already
    readable under the existing RLS policy.
3.  **Self-approval.** If `TICKET_POLICY.blockSelfApproval` is set, the person
    who raised the ticket cannot approve or forward at any level (T-TKT-010).
4.  **Approve, not the last level:** `current_level + 1`, clear
    `assigned_user_id`, APPROVE event (T-TKT-004).
5.  **Approve, last level:** `handler.revalidate`, then `handler.apply`, then
    status APPROVED with `closed_at`, APPROVE event. The audit row takes
    `before` and `after` from `apply` (T-TKT-005). If anything throws, the
    whole transaction rolls back. The engine then writes a
    `ticket.apply_failed` audit row in its own transaction, the same way
    `scopedAction()` writes DENIED rows today (T-TKT-007).
6.  **Reject:** remarks must not be blank (T-TKT-008). Status REJECTED,
    REJECT event. Notifying the centre waits for D-COMM-1.
7.  **Forward:** the target must be active, must not be the actor or the
    person who raised the ticket, and must hold `ticket.approve` over the
    ticket's centre (T-TKT-009). Set `assigned_user_id` and write a FORWARD
    event. Because the actor cannot read other users' assignments, this check
    is a narrow `SECURITY DEFINER` read function,
    `app.ticket_can_act(user_id, centre_id) returns boolean`. The forward
    picker uses a sibling function, `app.ticket_forward_candidates(centre_id)`,
    which returns id and display name only. These two read helpers are the
    only definer functions in this design.
8.  Every update is
    `update app.ticket set …, version = version + 1 where id = $1 and version = $seen`.
    The guard trigger checks the transition.

**Re-raise** (D-TKT-2, PMC): raise a new ticket with `reraise_of` set to the
rejected ticket, which must be REJECTED and in scope (T-TKT-015).

### Reads

*   **Approval queue** (T-TKT-003): OPEN tickets where the actor is the
    assigned user. If no one is assigned, the actor must match the current
    level's named user or hold its role over the ticket's centre. Row-level
    security limits rows to the actor's centres first.
*   **Ticket list and detail:** visible to holders of `ticket.view` for the
    centre, to the person who raised it, to its approvers, and to the type's
    viewers (T-TKT-012). The detail page shows the history and the documents.
*   **Document download** (`ticket.document.view`): read the row (RLS applies).
    Write a `ticket.document.download` audit row, then redirect to a signed
    URL valid for 60 seconds (PMC).

### Storage

`src/server/storage.ts` exposes `signedUploadUrl(key)`, `read(key, maxBytes)`
and `signedDownloadUrl(key, seconds)`. It has two implementations:

*   **Supabase:** calls the Storage REST API with `fetch`, so no new
    dependency is needed. It uses a server-only key read from
    `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` and a private bucket set in
    `TICKET_BUCKET`. The browser never receives the key or the bucket path.
*   **Fake:** an in-memory map used when `STORAGE_DRIVER=fake`, the CI
    setting. Tests put objects into the map directly and call the engine.
    The browser upload component is covered by the manual check against
    real Supabase, recorded in the evidence log.

The Content-Security-Policy in `proxy.ts` currently allows connections only
to the app itself (`default-src 'self'`). It needs `connect-src 'self'` plus
the Supabase origin, or the browser will block the upload.

### Numbering

Each ticket number comes from `allocate()` inside the raise transaction, so a
rolled-back raise uses no number. The format follows SRC
(`{prefix}/{typecode}/{seq}`). The prefix comes from `ticket_type.number_prefix`
and the padding is a parameter. Stage 2 uses series key
(`centre_id`, `'TKT'`, period), the only shape the current allocator supports.
This is provisional until NP-1 (Q2). The current `formatNumber()` builds a
different shape (centre/doc/period/number), so tickets get a small formatter of
their own next to it.

### Screens (unstyled, as with admin)

`/tickets` (list with filters for status, type, priority and centre),
`/tickets/new`, `/tickets/[id]` (detail, history, documents, action buttons),
`/tickets/approvals` (queue), and `/admin/ticket-types` (setup; step-up
required, as for RBAC writes).

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
    exists. Blocking means no type that needs a document can go live, and most
    correction types need one.
*   **Reason for Rejection**: The owner chose Supabase Storage now (DD-4).

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
*   **Transaction time.** File checks and downloads run before the
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

*   **Deleting staged uploads that were never attached**: a daily job that
    removes `staging/` objects older than 24 hours with no `ticket_document`.
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
    Q9. Adds **D-TKT-5** for ticket numbering series scope (per centre or
    network-wide, Q2), cross-referenced to NP-1. Then re-run
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
        match the legacy list; LOW, MEDIUM, HIGH until legacy is readable).
    *   The nine tables in the Technical Plan, with check constraints: exactly
        one of user or role per level and per viewer, level 1–4,
        `current_level <= level_count`.
    *   RLS on the five per-ticket tables (`ticket`, `ticket_level`,
        `ticket_event`, `ticket_upload`, `ticket_document`), using the loop
        pattern from 0002 (select and insert by `visible_centre_ids()`, update
        on `ticket` only).
    *   RLS on the setup tables: select for all app users, and insert, update
        and delete only when
        `app.has_permission('ticket.type.manage', null)`.
    *   Trigger `app.ticket_guard()`, with the rules listed in the Technical
        Plan.
    *   Append-only triggers on `ticket_event` and `ticket_document`, reusing
        the pattern of `app.audit_immutable()`.
    *   Definer read functions `app.ticket_can_act(uuid, int)` and
        `app.ticket_forward_candidates(int)` (id and display name only, active
        users only), granted to `gems_app` only.
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
    production. Tests add their handler under the key `test.counter`.

#### 7. `src/server/tickets/engine.ts` (Create)

*   **Type / Scope**: TypeScript module (core).
*   **Proposed Changes**:
    *   `TICKET_POLICY` constant, PMC, in the same style as `EXPORT_POLICY` in
        `exports.ts`: `blockSelfApproval: true`,
        `maxFileBytes: 10 * 1024 * 1024`,
        `allowedSignatures: [pdf, jpeg, png]`, `uploadUrlSeconds: 120`,
        `downloadUrlSeconds: 60`, `numberPad`, `numberPeriod`.
    *   Writes: `requestUpload(session, {centreId, fileName, size,
        contentType})`, `raise(session, {typeId, centreId, payload,
        uploadIds, reraiseOf?})` and `act(session, {ticketId, action,
        seenVersion, remarks?, forwardTo?})`. Each follows the steps in the
        Technical Plan through `scopedAction()`. `act` writes a
        `ticket.apply_failed` audit row in its own transaction when the final
        step throws anything other than `Forbidden`.
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
*   **Proposed Changes**: `signedUploadUrl(key)`, `read(key, maxBytes)` (stops
    reading past `maxBytes`) and `signedDownloadUrl(key, seconds)`. The
    Supabase driver uses `fetch` against `/storage/v1/object/upload/sign/…`,
    `/storage/v1/object/authenticated/…` and `/storage/v1/object/sign/…`,
    with environment variables `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and
    `TICKET_BUCKET`. The fake driver is selected by `STORAGE_DRIVER=fake`. It
    refuses to run when `NODE_ENV=production`, so the fake can never be live.

#### 10. `src/server/numbering.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: Adds `formatTicketNumber({prefix, typeCode, number,
    pad, maxLength})`, which returns `{prefix}/{typeCode}/{seq}`. It rejects
    over-length values like `formatNumber`. NP-5 is a parameter.

#### 11. `src/server/rbac.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: Exports `requireFreshStepUp`, which is private
    today (`StepUpRequired` is already exported). No behaviour change.

#### 12. `src/server/admin-http.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: `adminPost` also maps `TicketError` to
    `?error=<reason>`, and `ADMIN_MESSAGES` gains the five ticket reasons.
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
    value)` with RLS by centre, granted to `gems_app`. The `test.counter`
    handler increments it in `apply` and can be told to throw (T-TKT-007) or
    to fail `revalidate` (T-TKT-011).

#### 19. `tests/tickets.test.ts` (Create)

*   **Type / Scope**: Vitest suite against the Docker database.
*   **Proposed Changes**: T-TKT-001…015 and 019–020, plus:
    *   T-TKT-006 uses two real concurrent sessions and asserts that the
        counter equals 1 and that one call raised `conflict`.
    *   Guard trigger: a direct `update app.ticket` as `gems_app` that skips
        the version, reopens a closed ticket or jumps two levels is refused.
    *   `ticket_event` update and delete are refused.
    *   Activation without a registered handler is refused.
    *   T-TKT-002 only for format and continuity within a series (Q2 limits
        the rest).
    *   T-TKT-016, 017 and 018 are listed as Stage 5 or as belonging to the
        domain modules, not skipped silently.

#### 20. `tests/fixtures.ts` (Modify)

*   **Type / Scope**: Test fixtures.
*   **Proposed Changes**: Helpers to create a ticket type with levels, users
    with scoped approver roles, and sessions for each, reusing the existing
    user and session fixtures.

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
*   **E2E**: the real-server smoke on a fresh database (CI), plus one manual
    upload, raise, two-level approve and download against real Supabase
    Storage, recorded as evidence.

*Drafted with EGM*
