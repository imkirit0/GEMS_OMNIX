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
with remarks, or forward the ticket to another employee (in this document
"employee" and "user" both mean an `app.app_user` account). When the last level
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

"Stage N" in this document always means a stage of the implementation
roadmap (`docs/audit/10-implementation-roadmap.md`). The design review that
shaped some decisions is called the **zoom-out review**; its finding IDs
(B1, M1, M2, M4) refer to
[`zoom_out_report.md`](zoom_out_report.md).

### Terms and references

| Term | Meaning | Where |
|---|---|---|
| SPEC, WF6 | The legacy specification PDF and its workflow 6 ("Tickets"), pp. 11–12 of *GEMS Workflows for Manager Review* | `docs/audit/00-README.md` lists the sources |
| FR-xxx, R-xxx | Requirement rows in the traceability matrix | `docs/audit/02-requirements-traceability-matrix.csv` |
| D-xxx | Open business decisions, each with an owner and a proposed default | `docs/audit/04-manager-decision-register.md` (NP-1…8 are listed there as one row) |
| D-TKT-1…4 | Approver setup per type; reject = new linked ticket; SLA and escalation; self-approval | audit 04 |
| D-COMM-1, D-SEC-4, D-MIG-x | Message providers; storage of personal identifiers; legacy migration choices | audit 04 |
| NP-1…8 | Numbering policy: 1 series scope, 2 reset period, 3 gap rule, 4 cancelled numbers, 5 format and maximum length, 6 receipt prefixes, 7 register numbers, 8 continuing legacy counters | `docs/audit/revisions/v1.1-corrections.md` §C-02.1 |
| ⛔ prod-gate | A decision that must be signed before production deployment | audit 04, top of file |
| T-TKT-xxx, T-SEC-xxx, T-RLS-xxx, T-AUD-xxx, T-DOC-001 | Acceptance and security tests (T-DOC-001: the audit pack's consistency check) | `docs/audit/09-test-strategy-and-acceptance-criteria.md` |
| POC P2, P3, P5 | Proofs of concept: RLS isolation, numbering, ticket core | `docs/audit/11-proof-of-concept-specification.md` |
| RLS | Postgres row-level security; every centre-scoped table is filtered by `app.visible_centre_ids()` | `prisma/migrations/0002_security` |
| RBAC | Roles, permissions and scoped role assignments (ALL, REGION, AREA, CENTRE) | `src/server/rbac.ts`, migration 0005 |
| ADR | Architecture decision record | `docs/adr/` |
| SLA, KPI | Response-time targets; dashboard measures (both Stage 5) | audit 04 D-TKT-3 |
| `scopedAction()`, `Forbidden` | Authorise, change, audit in one transaction; a denial is audited as DENIED | `src/server/action.ts` |
| `withScope()`, `Tx`, P2034 | Opens the scoped transaction (5 s timeout), retries on a write conflict (Prisma error P2034) | `src/server/db.ts` |
| `requireFreshStepUp`, step-up | Re-entering the second factor before a sensitive admin write | `src/server/rbac.ts`, `/stepup` |
| `adminPost`, `safeRoute`, `pageRead()` | Form-POST plumbing (same-origin check, session, error mapping); generic error wrapper for routes; scoped page reads that turn out-of-scope into 404 | `src/server/admin-http.ts`, `src/server/safe-route.ts`, `src/server/page-read.ts` |
| Drift gate, unsafe-SQL ban, catalogue gate, real-server smoke, client-bundle scan | Stages of `scripts/ci.sh`: schema matches migrations; no `$queryRawUnsafe`/`$executeRawUnsafe`; every audit action catalogued and tested; HTTP checks against `next start`; no secrets in browser code | `scripts/ci.sh` |
| 404 parity | A record outside your scope gives the same 404 as one that does not exist | T-SEC-001 |
| Audit redaction | Personal identifiers and secrets are masked in audit data and logs | T-AUD-005; `app.redact()` in migration 0008, `redactText()` in `src/server/safe-route.ts` |

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
    purpose** (owner decision after the zoom-out review, finding M2): no ticket type goes
    live in Stage 2 (DD-2), so nothing uploads in production yet. Storage stays
    in Stage 2 to settle ADR-002 early and to prove the upload path before
    domain modules depend on it.
*   **DD-5: Approver for a role-based level (was Q3).** The actor qualifies if
    they hold the level's role through an assignment whose scope covers the
    ticket's centre. The scope rule (ALL, REGION, AREA, CENTRE) is the one
    `app.scoped_centre_ids` uses, but that function only answers for the
    session's user and filters by permission, so migration 0009 adds an
    internal helper, `app.user_centre_ids(user, permission, role)`, with the
    same body generalised to any user and to a role filter (see Eligibility
    and visibility). A user who holds the role elsewhere and can merely see
    the centre does not qualify.
*   **DD-6: Files go straight from the browser to Supabase.** Vercel caps a
    function's request body at 4.5 MB, so uploads skip our server. The server
    hands out a short-lived signed upload URL for each file. The bucket itself
    enforces the size limit and allowed types. At raise, the server reads only
    the first bytes of each object to check its real size and file signature
    before linking it to a ticket. Rejected: uploading through our server with
    a 4 MB cap.
*   **DD-7: The screens are built in Stage 2 as the manual test harness**
    (owner decision after the zoom-out review, finding M4). With no production handler
    they cannot be used for real. For the manual Supabase check, a dev-only
    setting `TICKET_TEST_HANDLER=1` registers the test handler. The engine
    refuses to start with that setting on any Vercel deployment (`VERCEL_ENV`
    set, production or preview).
*   **DD-8: One network-wide ticket counter** (owner decision after the
    zoom-out review, finding B1). This matches the legacy counter
    (TK-26/CMC/23642, current 23,652). Whether it resets each period (NP-2)
    and the starting value (NP-8) stay NP parameters.

**Taken by the project owner (gtm) on 2026-10-28**, after the comprehension
review; proposed by Claude, approved by the owner in session. Each is PRO
until the design is approved, and DD-9 and DD-10 remain PMC defaults under
D-TKT-2 and NP-5 until their business owners sign. These answer gaps the
review found (C4, C6, C8, C14 in
[`comprehension_report.md`](comprehension_report.md)):

*   **DD-9: Re-raise rules (C4, under D-TKT-2).** Only the person who raised
    the rejected ticket may re-raise it, and they must still hold
    `ticket.raise` for its centre. The new ticket always gets the rejected
    ticket's type and centre (the form does not offer them). The raise form
    is pre-filled with the old payload, which the user may edit. Documents
    are not copied: the user attaches them again, and the old ticket's
    documents stay readable on the old ticket. A rejected ticket can be
    re-raised once (`reraise_of` is unique). Re-raising is a normal raise,
    audited as `ticket.raise` with `reraiseOf` in the audit detail.
*   **DD-10: Number format defaults (C6, NP-5 parameters).** `number` is
    stored as the formatted text, unique. The sequence part is not padded
    (`numberPad: 0`, as in the legacy 23642) and the whole number may be at
    most 30 characters (`numberMaxLength: 30`). `number_prefix` is fixed
    text per type: `TK-26` is the legacy prefix value as configured
    (R-094.02). Whether its `26` means 2026 is unknown until the legacy
    database is readable; the engine never computes it.
*   **DD-11: Editing a type (C8).** Name, category, priority and
    `document_required` can change at any time; they affect only tickets
    raised afterwards. Levels and viewers can also change at any time,
    because levels are copied onto each ticket at raise, and a viewer change
    is meant to take effect at once. `handler_key` can change only while the
    type is inactive **and has no OPEN tickets**, because it decides what
    `apply` does with payloads written for the old handler.
*   **DD-12: Deactivating a type (C14).** Deactivation is the rollback
    switch. It stops new raises and stops final approvals of that type's
    open tickets (`ticket.inactive`), so its handler's `apply` cannot run.
    Approvals below the last level, rejects and forwards still work, so
    open tickets can be rejected or moved on while the type is off.
    Reactivating allows final approvals again.

## Open Questions

*   **Q2: Ticket numbering policy (NP-1…8).** The series scope is settled:
    one network-wide counter (DD-8). Still open, as parameters: whether the
    counter resets each period (NP-2; default: never, as legacy appears to),
    whether numbers must be gapless (NP-3; default: unique only, so a
    rolled-back raise may leave a gap), the format and length (NP-5;
    defaults in Numbering), and whether it continues from the legacy value
    23,652 (NP-8). NP-1 (series scope) still needs its owners' signature.
*   **Q4: Self-approval (D-TKT-4, ⛔ prod-gate: must be signed before production).** It ships as "prohibited" through a code
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

Column types: setup ids are `int` identity (like `role` and `centre`);
`ticket.id` and `ticket_upload.id` are `uuid`, generated by the app before
the insert so the audit row can name them; `ticket_event.id` and
`ticket_document.id` are `bigint` identity. User references are `uuid`,
role references `int`, centre references `int`. Text columns are `text`;
times are `timestamptz` defaulting to `now()`. Every reference is a foreign
key with `on delete restrict` (tickets are never deleted).

| Table | Key columns | Notes |
|---|---|---|
| `ticket_category` | id, parent_id (null = main), name | Main and sub categories (FR-094.02) |
| `ticket_type` | id, code (unique), name, category_id, priority, document_required, handler_key, number_prefix, active | `handler_key` must name a registered handler before the type can be made active |
| `ticket_type_level` | type_id, level (1–4), approver_user_id, approver_role_id | Check: exactly one of user or role is set. "No gaps" (levels are 1…n) cannot be a row check; `setTypeLevels` replaces the whole set and refuses gaps, and activation checks it again |
| `ticket_type_viewer` | type_id, user_id or role_id | Read-only access (T-TKT-012) |
| `ticket` | id (uuid), number (text, unique), type_id, centre_id, raised_by, status (OPEN, APPROVED, REJECTED), current_level (int), level_count (int), assigned_user_id, payload (jsonb), reraise_of (uuid, unique), version (int, starts at 1), created_at, closed_at | `assigned_user_id` is set by a forward and cleared when the level advances. `closed_at` is set on APPROVED and on REJECTED |
| `ticket_level` | ticket_id, centre_id, level, approver_user_id, approver_role_id | **Copied from the type at raise**, so later setup edits do not move tickets already in progress. Role holders are still resolved when someone acts (T-TKT-013) |
| `ticket_event` | id, ticket_id, centre_id, at, actor_id, action (RAISE, APPROVE, REJECT, FORWARD), level (int), remarks, to_user_id, detail (jsonb) | Append-only (trigger, same pattern as `app.audit_immutable()`) (T-TKT-014). `level` is the level acted at. `to_user_id` is set only on FORWARD. `remarks` is required on REJECT, optional otherwise. `detail` is `{}` except: RAISE `{reraiseOf}` when re-raised, final APPROVE `{final: true}` |
| `ticket_upload` | id (uuid), centre_id, uploaded_by, storage_key, file_name, declared_size (bigint), created_at | One row per signed upload URL issued (DD-6). Only the user who requested it can attach it, once |
| `ticket_document` | id, ticket_id, centre_id, upload_id (unique), content_type, size_bytes (bigint), at | Append-only link from a ticket to a checked upload. Key, file name and uploader are read through `upload_id`. The unique `upload_id` stops one upload being attached twice |
| `ticket_number_series` | period (text, primary key), current (bigint) | The network-wide counter (DD-8). No `centre_id` and no RLS; `gems_app` may select, insert and update it |

**Guard trigger on `ticket`** (the database half of DD-1). Every update must
add exactly 1 to `version`. `status` may only move from OPEN to APPROVED or
REJECTED, and a closed ticket cannot change. `current_level` may only stay the
same or rise by one, and never past `level_count`. `number`, `type_id`,
`centre_id`, `raised_by`, `payload` and `reraise_of` cannot change. Deletes are
refused.

**Grants.** `gems_app` gets select and insert on the per-ticket tables,
update on `ticket` only, and select, insert and update on
`ticket_number_series`. On the four setup tables `gems_app` gets select,
insert, update and delete (delete because `setTypeLevels` and
`setTypeViewers` replace whole sets), and an RLS write policy limits every
write to holders of `ticket.type.manage`:
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
  fields: { name: string; label: string; kind: "text" | "number" | "date" }[]; // what the raise form shows
  parse(payload: Record<string, string>): P;        // shape check; throws TicketError("invalid")
  toFields(p: P): Record<string, string>;           // reverse of parse, to pre-fill the form on re-raise
  validate(tx: Tx, t: { centreId: number; payload: P }): Promise<void>;   // at raise
  revalidate?(tx: Tx, t: TicketRow<P>): Promise<void>;                    // at final approval, after the row lock; defaults to validate
  apply(tx: Tx, t: TicketRow<P>): Promise<{ before: unknown; after: unknown }>; // domain change; result goes to the audit row
};
```

The raise form has two steps without client JavaScript. `/tickets/new`
first shows a GET form choosing the type (active types only) and the centre
(centres where the user holds `ticket.raise`, from
`app.scoped_centre_ids('ticket.raise')`). Submitting it reloads
`/tickets/new?type=<id>&centre=<id>`, which renders one input per entry in
the type's handler `fields`, named `p.<name>`.
The raise route collects every `p.*` form field into a
`Record<string, string>` (prefix removed) and passes it to `parse`. The
parsed value is stored as `payload`. `TicketRow<P>` is the `ticket` row as
the engine reads it: `{ id, number, typeId, centreId, raisedBy, status,
currentLevel, levelCount, assignedUserId, payload: P, reraiseOf, version,
createdAt }`.

Rules for every handler:

1.  **Database work only, through the given `tx`.** `withScope()` retries the
    whole transaction on a write conflict (P2034). A handler that sent an
    e-mail or called an outside service could therefore do it twice. Outside
    effects wait for an outbox, which is not part of this design.
2.  **`revalidate` refuses with a message** (`TicketError("stale", message)`, T-TKT-011).
    The message is short fixed text with no personal data (for example
    "The voucher is already paid"), because it is shown to the approver
    through the URL. The
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
trigger). The same pre-read also checks `app.ticket_may_view`; a ticket in a
visible centre that the user may not view also gives 404.

**Audit fields.** Every ticket action audits with `targetType: "ticket"` and
`targetId` set to the ticket id. For a raise the app generates the ticket's
uuid before calling `scopedAction()`, so the id is known up front. The upload
request audits `targetType: "ticket_upload"` with the new upload id, and a
download audits `targetType: "ticket_document"`. Approvals at every level use
one audit action, `ticket.approve`; whether it was the final one is recorded
in the audit detail as `final: true|false` with the `level`. This avoids
choosing the action name before the row lock shows which level it is.
`before`/`after` per action:

| Action | `before` | `after` |
|---|---|---|
| Raise | none | `{number, typeId, level: 1}` |
| Approve, not last | `{level, assignedUserId}` | `{level, assignedUserId: null}` |
| Approve, last | from `handler.apply` | from `handler.apply` |
| Reject | `{status: "OPEN", level}` | `{status: "REJECTED"}` |
| Forward | `{assignedUserId}` | `{assignedUserId}` |

**Errors.** Engine failures are `TicketError(reason, message)`, where
`reason` is one of the codes below and `message` is optional text. Form
routes return to the page with `?error=ticket.<reason>`; for `stale` they
also add `&detail=<message>` (URL-encoded, cut to 200 characters), which the
page shows as plain escaped text. A ticket that does not exist or that the
user may not view throws `TicketNotFound`, which `adminPost` turns into a
404 response. The upload route returns JSON `{error: "<reason>"}`.

| Situation | Error | Form route | Upload route | Audit row |
|---|---|---|---|---|
| Ticket missing, out of scope, or not viewable; document download without `ticket.document.view` | `TicketNotFound` | 404 | not used | none |
| Upload route: cross-origin request; no or expired session | | | 403; 401 | none |
| No `ticket.raise` / `ticket.approve` for the centre; `ticket_may_act` false; self-approval blocked | `Forbidden` | `?error=forbidden` | 403 | DENIED (existing path) |
| Payload fails `parse`; blank reject remarks; forward target refused by `ticket_may_receive`; re-raise of a ticket that is not REJECTED, already re-raised, or raised by someone else | `invalid` | `?error=ticket.invalid` | 400 | none |
| Required document missing; upload not the actor's, other centre, already attached, too big, too many, or wrong signature | `document` | `?error=ticket.document` | 400 | none |
| Type inactive, or its `handler_key` no longer registered, at raise or at final approval (DD-12) | `inactive` | `?error=ticket.inactive` | not used | none |
| Ticket not OPEN, or `version` differs | `conflict` | `?error=ticket.conflict` | not used | none |
| `revalidate` refuses | `stale` | `?error=ticket.stale&detail=…` | not used | none |
| `handler.apply` throws | `ApplyFailed` | generic error page with reference id (`safeRoute`) | not used | FAILED `ticket.apply_failed` |

A user who may view a ticket but not act on it sees no action buttons. If
they post an action anyway, they get `?error=forbidden` on the ticket page,
not 404, because the ticket is visible to them.

**Raise** (`ticket.raise` for the centre):
1.  **Before raise, for each file** (`ticket.raise` for the centre): the
    browser asks `POST /tickets/uploads` with the file name, size and type.
    The server refuses sizes over the limit and types that are not allowed.
    It inserts a `ticket_upload` row with key
    `uploads/{centreId}/{uploadId}` and returns a signed upload URL. Its
    validity is set by Supabase, not by us (the sign call takes no expiry);
    the manual check records the actual period. A long-lived URL is
    accepted: it can only write that one key, and only its requester can
    attach the result. The browser then PUTs the file straight to Supabase.
2.  **At raise, outside the transaction:** for each upload id sent, read the
    `ticket_upload` row. It must belong to the actor and the same centre, and
    must not be attached yet. Then fetch only the first 16 bytes of the object
    (a Range request). The response gives the object's real total size, which
    is checked against the limit, and the bytes give its file signature, which
    is checked against the allowed types: PDF starts `25 50 44 46 2D`
    (`%PDF-`), JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`. The
    `content_type` stored on `ticket_document` comes from the detected
    signature, never from what the browser declared; the declared type is
    used only for the bucket's own check and is not stored. Doing this before the transaction
    keeps outside calls out of it, which matters because of the retry rule
    above.
3.  In the transaction: the type must be active. Run `handler.parse` and
    `handler.validate`. If the type requires a document, at least one must be
    present (T-TKT-001); at most `TICKET_POLICY.maxFilesPerTicket` (5, PMC)
    may be attached. Allocate the number (see Numbering), insert the ticket, copy the
    levels into `ticket_level`, insert document rows and a RAISE event. Audit
    `ticket.raise`.
4.  Objects that are uploaded but never attached stay in `uploads/`. No
    `ticket_document` row points to them and nobody can get a link to them,
    so they are harmless. Deleting them is a Future Improvement.

**Act** (`ticket.approve` for the centre). Input: ticket id, action, the
`version` the user saw, remarks, and the forward target.
1.  `select … from app.ticket where id = $1 for update`. If the ticket is not
    OPEN or `version` differs from what the user saw, throw `TicketError("conflict")`
    (T-TKT-006: the second of two racing approvers waits on the lock, then
    sees the new version).
2.  **Who may act:** `app.ticket_may_act(ticket_id, blockSelfApproval)` must be true for the
    session's user (see Eligibility and visibility). It includes the
    `ticket.approve` check for the ticket's centre, so it agrees with
    `scopedAction()`'s own check. If it is false, throw `Forbidden`, so the
    attempt is audited as DENIED.
3.  **Self-approval.** If `TICKET_POLICY.blockSelfApproval` is set, the person
    who raised the ticket cannot act on it at all (approve, reject or
    forward) at any level (T-TKT-010); the attempt throws `Forbidden`. The
    engine passes the flag to `app.ticket_may_act(ticket, block_self)`, which
    returns false for the raiser when it is true. So the queue, `canAct` on
    the detail page, and `act()` all use one rule, and a ticket in your
    queue is always one you can act on. A raiser who wants to withdraw a
    ticket asks an approver to reject it.
4.  **Approve, not the last level:** `current_level + 1`, clear
    `assigned_user_id`, APPROVE event (T-TKT-004).
5.  **Approve, last level:** the type must be active (DD-12). Then
    `handler.revalidate`, then `handler.apply`, then
    status APPROVED with `closed_at`, APPROVE event. The audit row takes
    `before` and `after` from `apply` (T-TKT-005). If anything throws, the
    whole transaction rolls back. The engine wraps the call to
    `handler.apply` and rethrows its errors as `ApplyFailed` (a class in
    `engine.ts` that keeps the original as `cause`), except a write conflict
    (Prisma code P2034), which passes through unchanged so `withScope()` can
    retry. If the retries run out, that P2034 reaches the user as a generic
    error and writes no FAILED row, because it is not `ApplyFailed`. For `ApplyFailed`
    only, a `ticket.apply_failed` audit row with outcome FAILED (a new
    `AuditOutcome` value) is written in its own transaction (T-TKT-007),
    through a new optional failure-audit hook on `scopedAction()`. The row
    carries `{level, error: cause.name}`, not the message, which may contain
    personal data. A `stale` refusal from `revalidate` or a `conflict`
    changed nothing and writes no audit row; the user sees the reason.
6.  **Reject:** remarks must not be blank (T-TKT-008). Status REJECTED with
    `closed_at`, REJECT event. Notifying the centre waits for D-COMM-1.
7.  **Forward:** the target must be active, must not be the actor or the
    person who raised the ticket, and must hold `ticket.approve` over the
    ticket's centre (T-TKT-009), all checked by
    `app.ticket_may_receive(ticket_id, user_id)`; otherwise
    `TicketError("invalid")`. Set `assigned_user_id` and write a FORWARD
    event.
8.  Every update is
    `update app.ticket set …, version = version + 1 where id = $1 and version = $seen`.
    The guard trigger checks the transition.

**Re-raise** (D-TKT-2, PMC; rules in DD-9): a raise with `reraiseOf` set.
The pre-read takes the rejected ticket's `centre_id`, which is also the
centre `scopedAction()` authorises `ticket.raise` against. Inside the
transaction the rejected ticket is locked and must be REJECTED, raised by the
actor, and not yet re-raised; the new ticket takes its type and centre
(T-TKT-015).

### Reads

*   **Approval queue** (T-TKT-003): OPEN tickets where
    `app.ticket_may_act(id, blockSelfApproval)` is true for the session's user. Row-level
    security limits rows to the actor's centres first. Oldest first
    (`created_at`, then `id`), 50 per page, keyset pagination.
*   **Ticket list and detail:** tickets where `app.ticket_may_view(id)` is true
    (T-TKT-012). List filters are optional `status`, `typeId`, `priority` and
    `centreId`; newest first (`created_at desc`, then `id`), 50 per page,
    keyset pagination. The cursor is opaque to the browser: base64url of
    `<created_at ISO>|<id>` of the last row shown. The detail page shows the
    history and the documents.
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

`app.scoped_centre_ids` answers only for the session's user and filters by
permission. The ticket functions must also ask about other users (forward
targets) and about roles (role-based levels and viewers). So 0009 adds one
internal helper with the same body, generalised:

```sql
-- illustrative; not granted to any app role, called only by the four functions below
app.user_centre_ids(p_user uuid, p_permission text default null, p_role int default null) returns int[]
-- centres covered by p_user's role assignments, keeping only assignments whose role
-- has p_permission (if given) and is p_role (if given); same ALL/REGION/AREA/CENTRE join as 0002
```

"Holds role R over the ticket's centre" below means
`centre_id = any(app.user_centre_ids(user, null, R))`, the DD-5 rule.

| Function | True when | Used by |
|---|---|---|
| `app.ticket_may_act(ticket, block_self)` | For the session's user (`app.session_user_id()`; no user parameter, so it cannot be asked about others): the ticket is OPEN, the user is not its raiser when `block_self` is true, the user holds `ticket.approve` over its centre, and either `assigned_user_id` is the user, or no one is assigned and the user is the current level's named user or holds its role through an assignment covering the ticket's centre (DD-5) | Act step 2, the approval queue, `canAct` on the detail page |
| `app.ticket_may_receive(ticket, user)` | `user` is active, is not the caller, is not the person who raised the ticket, and holds `ticket.approve` over the ticket's centre | Forward step 7 |
| `app.ticket_forward_candidates(ticket)` | Returns id and display name of every user for whom `ticket_may_receive` is true | The forward picker |
| `app.ticket_may_view(ticket)` | The caller holds `ticket.view` over the centre; or raised the ticket; or is the named user on any of its `ticket_level` rows, or holds one of their roles over the centre; or was ever a forward target (`ticket_event.to_user_id`); or is a viewer of its type (named user, or holds the viewer role over the centre) | List, detail, document download |

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
    `TICKET_BUCKET`. Every server call sends `Authorization: Bearer <key>`
    and `apikey: <key>`. The calls are:
    *   `POST /storage/v1/object/upload/sign/{bucket}/{key}` returns
        `{url}`, a path with a token relative to `/storage/v1`; the browser
        PUTs the file to `SUPABASE_URL + "/storage/v1" + url`.
    *   `GET /storage/v1/object/authenticated/{bucket}/{key}` with
        `Range: bytes=0-15` returns the first bytes; the total size is in
        `Content-Range`.
    *   `POST /storage/v1/object/sign/{bucket}/{key}` with body
        `{expiresIn: seconds}` returns `{signedURL}`, also relative to
        `/storage/v1`.

    These shapes are checked first in the manual Supabase check (DD-7).
    The bucket is created once per environment by
    `scripts/storage-setup.mjs`, run by hand by whoever holds the key. It
    makes `TICKET_BUCKET` private with `file_size_limit` 10485760 and
    `allowed_mime_types` `application/pdf`, `image/jpeg`, `image/png` (the
    Q9 defaults), and does nothing if the bucket already matches. So
    oversized or wrong-type uploads are refused before our check runs. The
    browser never receives the key. Signed URLs do contain the bucket name
    and the object key; that is accepted, because keys are random ids and
    the URLs expire.
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

*   **No seeding step** (zoom-out finding M1). The first raise in a new period creates the row.
    The row lock taken by the upsert serialises concurrent raises, and a
    rolled-back raise releases its number, exactly as with `allocate()`.
*   **Period.** Stage 2 uses one period key, `ALL`: the counter never resets.
    A yearly reset (NP-2) is not offered yet, because the format has no
    period in it and a reset would repeat numbers. If NP-2 chooses a reset,
    the period is added to the format in the same change; the `period`
    column is already there for it.
*   **Continuing from legacy (NP-8).** If signed, a one-line seed in the
    migration-day script sets `current` to the legacy value. Nothing in
    Stage 2 depends on it.
*   **Format.** SRC: `{prefix}/{typecode}/{seq}`. The prefix comes from
    `ticket_type.number_prefix` and is fixed text (DD-10). Padding
    (`numberPad`, default 0) and maximum length (`numberMaxLength`, default
    30) are NP-5 parameters in `TICKET_POLICY`. The formatted text is what
    `ticket.number` stores. `formatNumber()` builds a different shape
    (centre/doc/period/number), so tickets get `formatTicketNumber()` next to
    it.

### Screens (unstyled, as with admin)

`/tickets` (list with filters for status, type, priority and centre),
`/tickets/new`, `/tickets/[id]` (detail, history, documents, action buttons),
`/tickets/approvals` (queue), and `/admin/ticket-types` (setup; step-up
required, as for RBAC writes). In Stage 2 these are the manual test harness
(DD-7). The pages and routes are always deployed and are not hidden behind
a flag. Without a registered handler no type can be activated, so
`/tickets/new` shows "No ticket types are available" and the lists are
empty. `/admin/ticket-types` works as normal: types can be created and
configured, but stay inactive. Only `TICKET_TEST_HANDLER=1` (refused on
Vercel) makes a type activatable for the manual check.

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
    a handler. Rolling back means deactivating the type, which stops new raises
and final approvals but leaves reject and forward available (DD-12).

--------------------------------------------------------------------------------

### Additional Resources

*   `docs/designs/ticket-engine/input-brief.md` (the drafting input)
*   WF6, *GEMS Workflows for Manager Review*, pp. 11–12; SPEC p.38
*   In `docs/audit/`: 04 (D-TKT-1…4), 06 (`06-security-threat-model.md`),
    09 (T-TKT-001…018), 10 (stage placement), 11 (POC P5);
    NP-1…8 in `revisions/v1.1-corrections.md` §C-02.1
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
    counter (DD-8), pending the NP owners' signature; against D-TKT-2 the
    re-raise rules (DD-9); and against NP-5 the format defaults (DD-10). Then re-run
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
    *   The ten tables in the Technical Plan, with the column types and
        foreign keys listed there, and check constraints: exactly one of user
        or role per level and per viewer, level 1–4,
        `current_level <= level_count`. Unique: `ticket.number`,
        `ticket.reraise_of`, `ticket_document.upload_id`, `ticket_type.code`.
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
    *   The internal helper `app.user_centre_ids(user, permission, role)`
        (Eligibility and visibility), revoked from public and granted to no
        app role.
    *   The four definer read functions in Eligibility and visibility
        (`ticket_may_act`, `ticket_may_receive`,
        `ticket_forward_candidates`, `ticket_may_view`), built on
        `app.user_centre_ids` and `app.visible_centre_ids`, each returning
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
    "document" | "inactive", message)` (when each is raised: Actions,
    Errors), and
    `HANDLERS: Record<string, TicketHandler<unknown>>`, which is empty in
    production. Tests add their handler under the key `test.counter`. When
    `TICKET_TEST_HANDLER=1`, the module also registers `test.counter` from
    `test-handler.ts`, and throws at load on any Vercel deployment
    (`VERCEL_ENV` set) (DD-7).

#### 6a. `src/server/tickets/test-handler.ts` (Create)

*   **Type / Scope**: TypeScript module (test and manual-harness only).
*   **Proposed Changes**: The `test.counter` handler. Its `fields` are
    `key` (text), `failApply` and `failRevalidate` (text; `"1"` means
    yes), and its payload is `{key: string, failApply: boolean,
    failRevalidate: boolean}`. `apply` adds 1 to the
    `app.test_ticket_counter` row for (ticket centre, `key`), creating it at
    1, and returns the old and new value as `before`/`after`. With
    `failApply` it throws after the increment (T-TKT-007: the increment must
    roll back); with `failRevalidate`, `revalidate` throws
    `TicketError("stale")` (T-TKT-011).
    Used by `tests/tickets.test.ts` and by the manual harness (DD-7).

#### 7. `src/server/tickets/engine.ts` (Create)

*   **Type / Scope**: TypeScript module (core).
*   **Proposed Changes**:
    *   `TICKET_POLICY` constant, PMC, in the same style as `EXPORT_POLICY` in
        `exports.ts`: `blockSelfApproval: true`,
        `maxFileBytes: 10 * 1024 * 1024`,
        `allowedSignatures: [pdf, jpeg, png]` (bytes in Actions, Raise),
        `maxFilesPerTicket: 5`,
        `downloadUrlSeconds: 60`, `numberPad: 0`, `numberMaxLength: 30`
        (DD-10).
    *   Writes: `requestUpload(session, {centreId, fileName, size,
        contentType})`, `raise(session, {typeId, centreId, payload,
        uploadIds, reraiseOf?})` and `act(session, {ticketId, action,
        seenVersion, remarks?, forwardTo?})`. Each follows the steps in the
        Technical Plan through `scopedAction()`, with the audit fields and
        errors in Actions. `raise` generates the ticket id first. `act`
        wraps `handler.apply` so its errors become `ApplyFailed`, and passes
        a failure-audit hook that returns `ticket.apply_failed` only for
        `ApplyFailed`.
    *   Reads: `approvalQueue(session, cursor?)`, `listTickets(session,
        {status?, typeId?, priority?, centreId?, cursor?})` (order and page
        size in Reads),
        `getTicket(session, id)` (detail, levels, history, documents,
        `canAct`, forward candidates) and `documentLink(session, ticketId,
        documentId)` (audited, returns a signed URL).
    *   Audit actions: `ticket.upload.request`, `ticket.raise` (also used
        for re-raise), `ticket.approve` (every level; `final` in the
        detail), `ticket.reject`, `ticket.forward`, `ticket.apply_failed`
        and `ticket.document.download`.

#### 8. `src/server/tickets/setup.ts` (Create)

*   **Type / Scope**: TypeScript module (type setup).
*   **Proposed Changes**: `createCategory({name, parentId?})`,
    `createType({code, name, categoryId, priority, documentRequired,
    handlerKey, numberPrefix})` (created inactive),
    `updateType(typeId, {name, categoryId, priority, documentRequired,
    handlerKey})`, `setTypeLevels(typeId, levels: {level, userId? |
    roleId?}[])`, `setTypeViewers(typeId, viewers: {userId? | roleId?}[])` and
    `setTypeActive(typeId, active)`. Editing follows DD-11: `updateType`
    refuses a `handlerKey` change while the type is active or has OPEN
    tickets. `createType` and `updateType` refuse a prefix and code whose
    number could exceed `numberMaxLength` with a 10-digit sequence.
    `setTypeLevels` replaces the whole set and refuses gaps (levels must be
    1…n, 1 ≤ n ≤ 4; an empty set is refused). Activation refuses a `handler_key` that is not in
    `HANDLERS` and a type with no levels or with gaps. All writes use
    `scopedAction()` with `ticket.type.manage`, need fresh step-up (reuse
    `requireFreshStepUp` from `rbac.ts` by exporting it), and record before
    and after in the audit row. Audit actions: `ticket.type.create`,
    `ticket.type.update`, `ticket.type.levels`, `ticket.type.viewers`, `ticket.type.activate`,
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

#### 9a. `scripts/storage-setup.mjs` (Create)

*   **Type / Scope**: Operator script, run by hand once per environment; not
    run by CI.
*   **Proposed Changes**: Reads `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and
    `TICKET_BUCKET`. Creates the bucket with `POST /storage/v1/bucket`
    (`public: false`, `file_size_limit: 10485760`, `allowed_mime_types`
    PDF, JPEG, PNG), or updates it with `PUT /storage/v1/bucket/{id}` if
    its settings differ. Prints what it did. The values match
    `TICKET_POLICY`; ADR-002 records them.

#### 10. `src/server/numbering.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: Adds `allocateTicketNumber(tx, period)` (the upsert
    in Numbering) and `formatTicketNumber({prefix, typeCode, number, pad,
    maxLength})`, which returns `{prefix}/{typeCode}/{seq}` and rejects
    over-length values like `formatNumber`. `pad` and `maxLength` come from
    `TICKET_POLICY` (DD-10); NP-2 and NP-5 stay parameters.

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
    written today. Precedence: a `Forbidden` error writes DENIED and the
    hook is not called. The hook sees the final error once, after
    `withScope()` has finished its P2034 retries, because it wraps the whole
    `withScope()` call. Existing callers do not change.

#### 12. `src/server/admin-http.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: `adminPost` also maps `TicketError` to
    `?error=ticket.<reason>`, and `ADMIN_MESSAGES` gains `ticket.invalid`,
    `ticket.document`, `ticket.inactive`, `ticket.stale` (followed by the
    handler's reason) and `ticket.conflict` ("This ticket changed since you
    opened it"). The `ticket.` prefix keeps them apart from the existing
    RBAC `invalid` text. The
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
    centre, one `p.<name>` input per handler field, file picker; POST
    fields `typeId`, `centreId`, `p.*`, `uploadId`, and `reraiseOf` when
    opened as `?reraise=<id>`, which fixes type and centre and pre-fills the
    fields with `toFields` per DD-9; on a re-raise `raise` ignores any
    `typeId`/`centreId` sent and uses the rejected ticket's), the detail page (history, documents,
    and an action form with fields `action` (approve, reject, forward),
    hidden `seenVersion`, `remarks` and `forwardTo` (the forward picker))
    and the approval queue. All reads go through
    `pageRead()`, so anything out of scope gives 404.

#### 15. `app/tickets/new/upload.tsx` (Create)

*   **Type / Scope**: Client component (the only client JavaScript in this
    design).
*   **Proposed Changes**: For each chosen file, it calls
    `POST /tickets/uploads`, PUTs the file to the returned URL, and adds the
    upload id to the raise form as a hidden `uploadId` field (one per
    file). It shows a per-file error
    when something is refused.

#### 16. `app/tickets/uploads/route.ts`, `app/tickets/create/route.ts`, `app/tickets/[id]/act/route.ts`, `app/tickets/[id]/documents/[docId]/route.ts` (Create)

*   **Type / Scope**: Route handlers, all wrapped in `safeRoute`.
*   **Proposed Changes**: The upload request (same-origin JSON POST,
    returning `{uploadId, url}`, or the statuses in Actions, Errors), raise (form POST through `adminPost`), act
    (form POST through `adminPost`; a conflict returns the user to the
    ticket with a "changed since you opened it" message) and document
    download (GET, 302 to the signed URL, 404 when out of scope).

#### 17. `app/admin/ticket-types/page.tsx`, `app/admin/ticket-types/[id]/page.tsx`, `app/admin/ticket-types/create/route.ts`, `app/admin/ticket-types/[id]/save/route.ts` (Create)

*   **Type / Scope**: Admin pages and routes.
*   **Proposed Changes**: List and create types and categories. Edit levels
    (1–4, user or role each), viewers, name, category, priority, document
    required, `handler_key` (a choice from `HANDLERS`, editable per DD-11)
    and active. The page has one form per part, and the save route reads a
    hidden `op` field (`details`, `levels`, `viewers`, `active`) to call
    `updateType`, `setTypeLevels`, `setTypeViewers` or `setTypeActive`.
    These follow the `/admin/roles` pages.

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
        for NP-2 and NP-8.
    *   Re-raise (DD-9): only the raiser, only once, only from REJECTED;
        type and centre come from the rejected ticket.
    *   Deactivation (DD-12): raise and final approval give `inactive`;
        reject, forward and a non-final approval still work.
    *   `updateType` refuses a `handlerKey` change on an active type; gaps
        in levels are refused.
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
    secrets in CI. `.env.local` is ignored by git (`.env.*` in
    `.gitignore`), so this is a step each developer does locally.

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
    real Supabase Storage, after running `scripts/storage-setup.mjs`: activate a `test.counter` type, upload, raise,
    approve at two levels and download. Recorded as evidence (DD-7).

*Drafted with EGM*
