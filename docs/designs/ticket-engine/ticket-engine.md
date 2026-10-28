# Ticket and approval engine (Stage 2 core)

*   **Author:** gtm
*   **Status:** Proposed
*   **Date:** 2026-10-27
*   **Last updated:** 2026-10-28

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source),
INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its
business owner to sign). The project owner has **accepted** the decisions
listed below. Nothing here is approved for build until the design itself is
approved.

--------------------------------------------------------------------------------

## Overview

Most change requests in GEMS go through one shared approval engine (WF6, SRC).
A centre raises a ticket against a ticket type, such as a student name
correction (FNC) or a course change (CMC). The ticket then moves through up to
four approval levels. At each level the approver is either a named user or
anyone holding a given role. The approver can approve, reject with remarks,
or forward the ticket to another user. When the last level approves, the
system makes the requested change itself. Viewers can see a ticket but cannot
act on it.

In the legacy system (SPEC p.38, SRC) there are 31 ticket types and 16,542
tickets: 14,011 approved, 2,412 pending, 119 rejected and 2 forwarded.

This design covers the **engine core**, which is Stage 2 in audit 10:

*   the ticket model;
*   type and level setup;
*   approver resolution;
*   the approve, reject and forward actions;
*   immutable history;
*   numbering;
*   the contract that each ticket type's handler plugs into;
*   plain screens for raising, viewing and approving tickets (DD-7).

The full set of 31 types, SLA reminders, bulk approval and dashboards are
Stage 5. Each type's domain handler is built with the module that owns its
data, in Stages 3 to 6.

"Stage N" in this document always means a stage of the implementation
roadmap (`docs/audit/10-implementation-roadmap.md`). Review findings are
cited by ID from the review reports in this folder:
[`zoom_out_report.md`](zoom_out_report.md) (B1, M1, M2, M4),
[`comprehension_report.md`](comprehension_report.md) (C-, R-) and
[`critic_report.md`](critic_report.md) (D-, S-, W-).

**Proposed solution (PRO):** one engine, built on the platform pieces that
already exist and pass tests. These are row-level security for scope,
`scopedAction()` for authorise, change and audit in one transaction,
`app.audit()` for audit rows, and a row-locked counter for numbering. The
last-level approval and the domain change run in **one database
transaction**, guarded so that only one last-level approval can succeed. Each
ticket type supplies a handler: `validate` runs when the ticket is raised;
`revalidate` (optional; defaults to `validate`) and `apply` run inside the
last-level approval transaction.

### Terms and references

| Term | Meaning | Where |
|---|---|---|
| User, actor | A `app.app_user` account ("employee" in the sources). The **actor** is the user making the current request: the session's user, `app.session_user_id()` | `src/server/db.ts` |
| Raiser | The user who raised a ticket (`ticket.raised_by`) | |
| Forward target | The user a ticket is forwarded to; becomes `ticket.assigned_user_id` | |
| Domain change | What the last-level approval changes outside the ticket tables, done by the handler's `apply` | |
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
| Outbox | A table of pending outside effects (e-mails, calls to other systems), written in the business transaction and sent later by a separate job, so a retried transaction cannot send twice | not built yet |
| Compensation logic | Code that undoes an earlier committed step when a later step fails, needed when steps do not share one transaction | |
| `scopedAction()`, `Forbidden` | Authorise, change, audit in one transaction; a denial is audited as DENIED | `src/server/action.ts` |
| `withScope()`, `Tx`, P2034 | Opens the scoped transaction (5 s timeout), retries on a write conflict (Prisma error P2034) | `src/server/db.ts` |
| `requireFreshStepUp`, step-up | Re-entering the second factor before a sensitive admin write | `src/server/rbac.ts`, `/stepup` |
| `adminPost`, `safeRoute`, `pageRead()` | Form-POST plumbing (same-origin check, session, error mapping); generic error wrapper for routes; scoped page reads that turn out-of-scope into 404 | `src/server/admin-http.ts`, `src/server/safe-route.ts`, `src/server/page-read.ts` |
| Drift gate, unsafe-SQL ban, catalogue gate, real-server smoke, client-bundle scan | Stages of `scripts/ci.sh`: schema matches migrations; no `$queryRawUnsafe`/`$executeRawUnsafe`; every audit action catalogued and tested; HTTP checks against `next start`; no secrets in browser code | `scripts/ci.sh` |
| 404 parity | A record outside your scope gives the same 404 as one that does not exist | T-SEC-001 |
| Audit redaction | Personal identifiers and secrets are masked in audit data and logs | T-AUD-005; `app.redact()` in migration 0008, `redactText()` in `src/server/safe-route.ts` |

## The Problem

Without one engine, each module would build its own approval flow. The audit
pack names four ways this goes wrong, and each one already has an acceptance
test (audit 09, POC P5):

1.  **Half-applied changes.** A last-level approval updates the ticket but the
    domain change fails, or the reverse. Today nothing guarantees that both
    happen together or neither does (T-TKT-005, T-TKT-007).
2.  **Changes applied twice.** Two approvers press "approve" on the same last
    level at the same moment, and the change runs twice: for example, two
    voucher payments (T-TKT-006).
3.  **Approving your own request.** The raiser approves their own ticket
    (T-TKT-010; decision D-TKT-4 is still open).
4.  **Acting outside your scope.** An approver sees or acts on tickets from
    centres they do not cover, or forwards a ticket to someone who should not
    see it (T-TKT-003, T-TKT-009).

A fifth problem comes from time. A ticket can wait for days between being
raised and its last-level approval. By then the data it was written against
may have changed: the student may have moved course, or the voucher may
already be paid. Applying the change without checking the current data
corrupts it (T-TKT-011).

## Goals

Each goal is met when its listed tests (or, for G8, requirements) pass in
`bash scripts/ci.sh`.

*   **G1: All or nothing.** A last-level approval and its domain change commit
    together or not at all. If `apply` fails, the ticket stays at its level and
    the domain data is unchanged (T-TKT-005, T-TKT-007).
*   **G2: Exactly once.** When two last-level approvals race, the change is
    applied once and the other approver gets a conflict error (T-TKT-006).
*   **G3: Scope holds everywhere.** Queues, ticket views, actions and forward
    targets respect the approver's centre scope. A ticket outside your scope
    returns 404, just like a ticket that does not exist (T-TKT-003, T-TKT-009,
    T-TKT-012).
*   **G4: Approvers resolved when they act.** A role-based level is checked
    against who holds the role *when they act*, not when the ticket was raised
    (T-TKT-013).
*   **G5: No self-approval, one approval per person.** The raiser cannot act on
    their ticket at any level (T-TKT-010), and nobody approves more than one
    level of the same ticket (DD-14). Both rules wait for their owner's
    signature (Q4).
*   **G6: Complete, immutable history.** Every action writes a history row that
    cannot be changed or deleted, plus an audit row through `app.audit()`
    (T-TKT-005, T-TKT-014).
*   **G7: Stale requests caught.** `revalidate` runs at the last-level
    approval. If the request no longer fits the current data, it is refused
    with a reason and nothing changes (T-TKT-011).
*   **G8: Types are configuration.** A new ticket type with its levels,
    approvers, viewers and priority can be set up as data. Only its domain
    change needs code, in the form of a handler (FR-094.01, FR-094.02).
*   **G9: Reject and forward rules.** Rejection requires remarks (T-TKT-008).
    Forwarding works only to an in-scope user (T-TKT-009).
*   **G10: No ticket is stranded.** An OPEN ticket whose approver has left can
    be reassigned by an administrator (DD-13).

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

Each decision records the choice and its reason. The mechanics live in the
Technical Plan, which each decision points to.

### Drafting session and zoom-out review (2026-10-27)

Accepted by the project owner (gtm) in session.

*   **DD-1: Where rules are enforced.** In the TypeScript engine, inside
    `scopedAction()`. The database adds row-level security, a version check,
    a guard trigger on ticket inserts and updates, and append-only history.
    Rejected: database functions in the RBAC style, and writing everything in
    SQL including handlers (Alternatives A and B). **Known limit:** approver
    eligibility, self-approval and distinct approvers are enforced only by
    the engine. One shared SQL read function computes eligibility, but the
    engine is what refuses the action, so code that writes `app.ticket`
    without going through the engine bypasses those three checks. The guard
    trigger still enforces legal states and transitions (Technical Plan,
    Guard trigger). See Risks and Mitigations.
*   **DD-2: Stage 2 deliverable.** The engine plus a handler that exists only
    in tests and writes a test-only table. No user-visible ticket type ships
    until a domain module provides a handler.
*   **DD-3: Forward = reassign at the same level.** The ticket stays at its
    level and the forward target becomes the only person who can act at that
    level. They can approve, reject or forward again.
*   **DD-4: Documents are stored in Supabase Storage now**, in a private
    bucket, with access checked by our own code and short-lived signed
    download links. ADR-002 records it (Q9). **Built ahead of need on
    purpose** (zoom-out finding M2): no ticket type goes live in Stage 2
    (DD-2), so nothing uploads in production yet. Storage stays in Stage 2 to
    settle ADR-002 early and to prove the upload path before domain modules
    depend on it.
*   **DD-5: Approver for a role-based level (was Q3).** The actor qualifies
    only by holding the level's role through an assignment whose scope covers
    the ticket's centre. A user who holds the role elsewhere and can see the
    centre does not qualify. Mechanics: Technical Plan, Eligibility and
    visibility.
*   **DD-6: Files go directly from the browser to Supabase**, because Vercel
    caps a function's request body at 4.5 MB (Alternative I). The server
    checks each stored file before linking it to a ticket. Mechanics:
    Actions, Raise.
*   **DD-7: The screens are built in Stage 2 as the manual test harness**
    (zoom-out finding M4). With no production handler they cannot be used for
    real. A dev-only setting registers the test handler for the manual
    Supabase check, and is refused on any Vercel deployment. Mechanics:
    Screens.
*   **DD-8: One network-wide ticket counter** (zoom-out finding B1), matching
    the legacy counter (TK-26/CMC/23642, current 23,652). This settles NP-1
    for tickets on the owner's side; it stays PMC until the NP owners sign
    (Q2). Mechanics: Numbering.

### After the comprehension review (2026-10-28)

Proposed by Claude and accepted by the project owner in session, answering
comprehension findings C4, C6, C8 and C14. DD-9 and DD-10 also stay PMC
under D-TKT-2 and NP-5 until their business owners sign.

*   **DD-9: Re-raise rules (C4, under D-TKT-2).** Only the raiser of the
    rejected ticket may re-raise it, once, and they must still hold
    `ticket.raise` for its centre. The new ticket keeps the rejected ticket's
    type and centre. In Stage 2 the form opens blank with type and centre
    fixed; pre-filling it with the old request waits for the first domain
    module (narrowed after the zoom-out finding Z5). Documents are attached
    again; the old ticket keeps its own. Mechanics: Actions, Re-raise.
*   **DD-10: Number format defaults (C6, NP-5 parameters).** No padding of the
    sequence (as in the legacy 23642), at most 30 characters, and a prefix
    that is fixed text per type. The legacy prefix `TK-26` (R-094.02) is kept
    as text; whether its `26` means 2026 is unknown until the legacy database
    is readable. Mechanics: Numbering.
*   **DD-11: Editing a type (C8; tightened by R9).** Everything can change at
    any time except `handler_key`, which can change only while the type is
    inactive and has no OPEN tickets, because the handler decides what
    `apply` does with payloads written for the old one. Levels can change
    because they are copied onto each ticket at raise.
*   **DD-12: Deactivating a type (C14).** Deactivation is the rollback switch:
    it stops new raises and last-level approvals, so the handler's `apply`
    cannot run. Rejects, forwards and approvals below the last level still
    work, so open tickets can be cleared while the type is off.

### After the critic review (2026-10-28)

Proposed by Claude and accepted by the project owner in session, answering
critic findings D1, D4, D6 and D7.

*   **DD-13: Administrator reassign (D1).** A ticket becomes stranded when its
    named approver or forward target leaves or loses `ticket.approve`,
    because nobody else passes `ticket_may_act`. A holder of
    `ticket.type.manage`, after step-up, may reassign the current level of an
    OPEN ticket to any user who passes `ticket_may_receive`. Mechanics:
    Actions, Reassign.
*   **DD-14: Distinct approvers (D4; PMC under D-TKT-4).** Nobody may approve
    more than one level of the same ticket, whether by holding several
    levels' roles or by being forwarded the next level. Without this, a
    multi-level chain can collapse to one person. Built into
    `ticket_may_act`, like self-approval. Mechanics: Eligibility and
    visibility.
*   **DD-15: Supabase service key, with limits (D6).** The server keeps the
    Supabase service key for storage calls. That key can also bypass RLS
    through Supabase's Data API, so ADR-002 requires a recorded check that
    the Data API does not expose schema `app`. Storage-only S3 keys are the
    noted alternative (Alternative J). See Risks and Mitigations.
*   **DD-16: Upload retention and cap (D7; narrowed after zoom-out finding
    Z1).** Uploads that are never attached may hold personal data. In Stage
    2 no upload is possible at all: the upload route refuses unless the type
    is active and requires a document, and no such type exists yet. Before
    the first type with `document_required` goes live, two things are a
    **go-live gate**: the job that deletes unattached uploads, and a per-user
    limit on upload requests (PMC, reusing the export rate-limit pattern).
    Mechanics: Actions, Raise.

## Open Questions

Q1, Q3, Q5 and Q6 were settled during drafting and became DD-1 to DD-6 (Q3
became DD-5); the exact mapping of the others was not recorded. Each open
question lists its owner, what it blocks, and the default that ships.

*   **Q2: Ticket numbering policy (NP-1…8).** Owner: Accounts and
    Certification. Blocks: production (unsigned NP). Defaults: NP-1 one
    network-wide counter (DD-8); NP-2 never resets; NP-3 unique only, so a
    rolled-back raise may leave a gap; NP-5 per DD-10; NP-8 not continued
    until signed. Mechanics: Numbering.
*   **Q4: Self-approval and distinct approvers (D-TKT-4, ⛔ prod-gate).**
    Owner: Operations. Blocks: production. Default: both prohibited, built
    into `app.ticket_may_act`, so turning either off needs a migration and
    review, not a click. Mechanics: Actions, Act step 3, and Eligibility and
    visibility.
*   **Q7: Legacy migration (D-MIG).** Owner: IT and Operations. Blocks: the
    migration design, not Stage 2. It covers 16,542 tickets, 2,412 of them
    pending, and waits for read access to the legacy MySQL database. Default:
    no migration-only columns now; the migration design adds what it needs,
    such as the legacy ticket number.
*   **Q8: Approvers and levels per type (D-TKT-1).** Owner: Operations.
    Blocks: the first live ticket type. Default: copy the legacy setup once it
    can be read. Stage 2 provides the type setup screen only.
*   **Q9: Storage ADR and limits (D-STO-1).** Owner: IT and Legal. Blocks:
    production uploads. ADR-002 records Supabase Storage, the service-key
    check (DD-15) and the file limits, which are PMC: maximum size 10 MB;
    allowed types PDF, JPEG and PNG, checked by file signature, not by the
    name the browser sends; retention; and whether a virus scan is required
    before go-live. Documents may contain personal data (D-SEC-4).

## Critical User Journeys (CUJs)

### CUJ 1: Raise a ticket with a document

*   **Given**: An active ticket type that requires a document and has two
    levels, and a centre user holding `ticket.raise` for centre C.
*   **When**: The user picks the type and centre, fills in the request and
    chooses a PDF. The browser uploads the PDF to the private bucket using a
    signed upload URL. The user then submits.
*   **Then**: The server checks the stored PDF and creates the ticket with the
    next number, linked to the document. The type's level setup is copied onto
    the ticket, and the current level is 1. A RAISE history row and an audit
    row are written. Without a document, the raise is refused: no ticket and
    no document row is created (T-TKT-001).

### CUJ 2: Two-level approval applies the change once

*   **Given**: The ticket from CUJ 1, a level-1 approver named by role, and a
    different level-2 approver named as a user. Both are in scope for C, and
    neither is the raiser.
*   **When**: The level-1 approver approves, then the level-2 approver
    approves.
*   **Then**: After level 1 the ticket is at level 2 and no domain data has
    changed (T-TKT-004). After level 2 the handler's `revalidate` and `apply`
    run in the same transaction as the status change. The ticket is APPROVED,
    and the domain change, the history row and the audit row exist exactly
    once (T-TKT-005).

### CUJ 3: Race and failure

*   **Given**: A ticket at its last level and two eligible approvers.
*   **When**: Both approve at the same moment. In a second run, the handler's
    `apply` throws instead.
*   **Then**: In the first run, one approval wins and the other gets a conflict
    error; the change is applied once (T-TKT-006). In the second run, the
    whole transaction rolls back. The ticket stays OPEN at its level, the
    domain data is unchanged, and a separate audit row records the failure
    (T-TKT-007).

### CUJ 4: Forward and reject

*   **Given**: An open ticket at level 1.
*   **When**: The approver forwards it to user E, and E then rejects it.
*   **Then**: The forward works only if E holds `ticket.approve` over the
    ticket's centre and is neither the raiser nor the forwarder (T-TKT-009).
    After the forward, only E can act at level 1. E's rejection needs remarks
    (T-TKT-008). The ticket becomes REJECTED and the raiser can re-raise it as
    a new ticket linked to this one (T-TKT-015, D-TKT-2).

### CUJ 5: A stranded ticket is reassigned

*   **Given**: An open ticket at level 2, whose level-2 approver is a named
    user who has since been disabled.
*   **When**: A ticket-type administrator opens the ticket, completes step-up
    and reassigns level 2 to user F.
*   **Then**: The reassign works only if F passes the same checks as a forward
    target. F can now act at level 2. A FORWARD history row marked as an
    administrator reassign and a `ticket.reassign` audit row are written
    (DD-13).

## Technical Plan (Architecture)

### Components

```text
 Browser (unstyled pages)                    Supabase Storage (private bucket)
   │  same-origin POST / GET                        ▲ put / signed URL
   ▼                                                │ (server key, server only)
 Route handlers (safeRoute) ──────────────► src/server/storage.ts
   │                                         (Supabase adapter | fake in CI)
   │  browser PUTs files directly to the bucket using a signed upload URL (DD-6)
   ▼
 src/server/tickets/engine.ts   raise · act(approve|reject|forward) · reassign · queue · view
   │   uses scopedAction() = authorise → change → audit, one transaction
   │   uses allocateTicketNumber() for numbers
   │   calls handler.validate / revalidate / apply   ◄── src/server/tickets/handlers.ts
   ▼                                                    (registry: key → handler)
 Postgres (schema app)
   ticket_category · ticket_type · ticket_type_level · ticket_type_viewer   (setup)
   ticket · ticket_level · ticket_event · ticket_upload · ticket_document   (per ticket)
   ticket_number_series                                                     (network-wide counter)
   RLS by centre · guard triggers · append-only triggers · app.audit()
```

### Data model (migration `0009_tickets`)

The setup tables and the ticket counter apply to every centre, so they
have no `centre_id`. The per-ticket tables carry `centre_id`, and row-level
security limits them to `app.visible_centre_ids()`, the same way
`number_series` is limited today.

Column types: setup ids are `serial` (Prisma `@default(autoincrement())`, as
for `role` and `centre` in migration 0001);
`ticket.id` and `ticket_upload.id` are `uuid`, generated by the app before
the insert so the audit row can name them; `ticket_event.id` and
`ticket_document.id` are `bigserial` (as for `audit_log`). User references are `uuid`,
role references `int`, centre references `int`. Text columns are `text`;
times are `timestamptz` defaulting to `now()`. Every reference is a foreign
key with `on delete restrict` (tickets are never deleted).

| Table | Key columns | Notes |
|---|---|---|
| `ticket_category` | id, parent_id (null = main), name | Main and sub categories (FR-094.02) |
| `ticket_type` | id, code (unique), name, category_id, priority, document_required, handler_key, number_prefix, active | `handler_key` must name a registered handler before the type can be made active |
| `ticket_type_level` | type_id, level (1–4), approver_user_id, approver_role_id; primary key (type_id, level) | Exactly one of user or role is set (see note 1) |
| `ticket_type_viewer` | id (serial), type_id, user_id or role_id; unique (type_id, user_id) and (type_id, role_id) | Read-only access (T-TKT-012) |
| `ticket` | id (uuid), number (text, unique), type_id, centre_id, raised_by, status (OPEN, APPROVED, REJECTED), current_level (int), level_count (int), assigned_user_id, payload (jsonb), reraise_of (uuid, unique), version (int, starts at 1), created_at, closed_at | See note 2 |
| `ticket_level` | ticket_id, centre_id, level, approver_user_id, approver_role_id; primary key (ticket_id, level) | **Copied from the type at raise**, so later setup edits do not move tickets already in progress. Role holders are still resolved when someone acts (T-TKT-013) |
| `ticket_event` | id, ticket_id, centre_id, at, actor_id, action (RAISE, APPROVE, REJECT, FORWARD), level (int), remarks, to_user_id, detail (jsonb) | Append-only (trigger, same pattern as `app.audit_immutable()`) (T-TKT-014). See note 3 |
| `ticket_upload` | id (uuid), centre_id, uploaded_by, storage_key, file_name, declared_size (bigint), created_at | One row per signed upload URL issued (DD-6). Only the user who requested it can attach it, once |
| `ticket_document` | id, ticket_id, centre_id, upload_id (unique), content_type, size_bytes (bigint), at | Append-only link from a ticket to a checked upload. Key, file name and uploader are read through `upload_id`. The unique `upload_id` stops one upload being attached twice |
| `ticket_number_series` | period (text, primary key), current (bigint) | The network-wide counter (DD-8). No `centre_id` and no RLS; `gems_app` may select, insert and update it |

Notes:

1.  "No gaps" (levels are 1…n) cannot be a row check. `setTypeLevels`
    replaces the whole set and refuses gaps, and activation checks it again.
2.  `assigned_user_id` is set by a forward or reassign, and cleared when the
    level rises. `closed_at` is set on APPROVED and on REJECTED.
3.  `level` is the level acted at. `to_user_id` is set only on FORWARD.
    `remarks` is required on REJECT and optional otherwise. `detail` is `{}`
    except: RAISE `{reraiseOf}` when re-raised; last-level APPROVE
    `{final: true}`; administrator reassign `{admin: true}`.

**Guard triggers** (the database half of DD-1).

*   On `ticket` insert: status OPEN, `current_level` 1, `version` 1,
    `assigned_user_id` and `closed_at` null.
*   On `ticket` update:
    *   `version` rises by exactly 1;
    *   `status` moves only from OPEN to REJECTED, or from OPEN to APPROVED
        when `old.current_level = level_count`; a closed ticket cannot change;
    *   `current_level` stays or rises by one, never past `level_count`;
        when it rises, `assigned_user_id` must become null;
    *   `number`, `type_id`, `centre_id`, `raised_by`, `payload`,
        `level_count` and `reraise_of` cannot change.
*   On `ticket_level` insert: allowed only while the ticket has no
    `ticket_event` rows yet (raise inserts levels before its RAISE event),
    and only with `level <= level_count`.
*   Deletes are refused on all per-ticket tables.

These enforce legal states and transitions for any writer. They do not
check *who* acts; that is the engine's job (DD-1). Exactly-once rests on the
row lock in Act step 1 together with "a closed ticket cannot change".

**Grants.** `gems_app` gets select and insert on the per-ticket tables,
update on `ticket` only, and select, insert and update on
`ticket_number_series`, and `usage` on the sequences behind its serial
ids. On the four setup tables `gems_app` gets select,
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
  validate(tx: Tx, t: { centreId: number; payload: P }): Promise<void>;   // at raise
  revalidate?(tx: Tx, t: TicketRow<P>): Promise<void>;                    // at last-level approval, after the row lock; defaults to validate
  apply(tx: Tx, t: TicketRow<P>): Promise<{ before: unknown; after: unknown }>; // domain change; result goes to the audit row
  staleMessages: Record<string, string>;            // fixed texts revalidate may refuse with, by key
};
```

The raise route collects every `p.<name>` form field into a
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
2.  **`revalidate` refuses with a message key**
    (`TicketError("stale", key)`, T-TKT-011), where `key` is in the handler's
    `staleMessages`. Only the key travels in the URL; the page looks up the
    text, so a crafted link cannot place free text on the page. The engine
    rolls back and the ticket stays OPEN, so an approver can then reject it
    with remarks.
3.  **`apply` runs at most once per ticket.** The engine guarantees this
    because `apply` runs only inside the transaction that holds the ticket's
    row lock and moves it from OPEN to APPROVED (see Act). Handlers do not
    need their own duplicate protection.

### Actions

All actions are `scopedAction()` calls with the ticket's `centre_id`.
`scopedAction()` needs the centre before it authorises, so Act, Reassign and
Re-raise first read `centre_id` under row-level security. A hidden ticket
returns nothing there and the route gives 404, the same as a ticket that does
not exist. Reading `centre_id` first cannot leak or misdirect anything,
because `centre_id` cannot change (guard trigger). The same pre-read also
checks `app.ticket_may_view`; a ticket in a visible centre that the actor may
not view also gives 404.

**Audit fields.** Every ticket action audits with `targetType: "ticket"` and
`targetId` set to the ticket id. The upload request audits
`targetType: "ticket_upload"` with the new upload id, and a download audits
`targetType: "ticket_document"`. Approvals at every level use one audit
action, `ticket.approve`; the audit detail records `level` and
`final: true|false`. This avoids choosing the action name before the row
lock shows which level it is. `before`/`after` per action:

| Action | `before` | `after` |
|---|---|---|
| Raise | none | `{number, typeId, level: 1}` |
| Approve, not last | `{level, assignedUserId}` | `{level, assignedUserId: null}` |
| Approve, last | from `handler.apply` | from `handler.apply` |
| Reject | `{status: "OPEN", level}` | `{status: "REJECTED"}` |
| Forward, reassign | `{assignedUserId}` | `{assignedUserId}` |

**Errors.** Engine failures are `TicketError(reason, message)`, where
`reason` is one of the codes below and `message` is optional (for `stale`,
the handler's message key). Form routes return to the page with
`?error=ticket.<reason>`; for `stale` they add `&detail=<key>`, and the page
shows the handler's text for that key, or a generic text for an unknown key.
A ticket that does not exist or that the actor may not view throws
`TicketNotFound`, which `adminPost` turns into a 404 response. The upload
route returns JSON `{error: "<reason>"}`.

| Situation | Error | Form route | Upload route | Audit row |
|---|---|---|---|---|
| Ticket missing, out of scope, or not viewable | `TicketNotFound` | 404 | not used | none |
| Upload route: cross-origin request; no or expired session | not used | not used | 403; 401 | none |
| No `ticket.raise` / `ticket.approve` / `ticket.document.view` / `ticket.type.manage` for the centre; `ticket_may_act` false (includes self-approval and distinct approvers) | `Forbidden` | `?error=forbidden` | 403 | DENIED (existing path) |
| Payload fails `parse`; blank reject remarks; forward or reassign target refused by `ticket_may_receive`; re-raise of a ticket that is not REJECTED, already re-raised, or raised by someone else | `invalid` | `?error=ticket.invalid` | 400 | none |
| Required document missing; upload not the actor's, other centre, already attached, too big, too many, or wrong signature | `document` | `?error=ticket.document` | 400 | none |
| Type inactive, or its `handler_key` no longer registered, at raise or at last-level approval (DD-12); upload request for a type that is not active or needs no document (DD-16) | `inactive` | `?error=ticket.inactive` | 400 | none |
| Ticket not OPEN, `version` differs, or the update matched 0 rows | `conflict` | `?error=ticket.conflict` | not used | none |
| `revalidate` refuses | `stale` | `?error=ticket.stale&detail=<key>` | not used | none |
| `handler.apply` throws | `ApplyFailed` | generic error page with reference id (`safeRoute`) | not used | FAILED `ticket.apply_failed` |

An actor who may view a ticket but not act on it sees no action buttons. If
they post an action anyway, they get `?error=forbidden` on the ticket page,
not 404, because the ticket is visible to them.

**Raise** (`ticket.raise` for the centre):

1.  **Before raise, for each file:** the browser calls
    `POST /tickets/uploads` with the type id, centre, file name, size and
    type.
    *   The server refuses with `inactive` unless the ticket type is active
        and `document_required` (DD-16), so in Stage 2 every upload request
        is refused. It refuses sizes over the limit and types that are not
        allowed.
    *   It inserts a `ticket_upload` row with key
        `uploads/{centreId}/{uploadId}` and returns a signed upload URL,
        created with overwriting turned off (`x-upsert: false`), so a stored
        object cannot be replaced after it is checked.
    *   Supabase sets the URL's validity period, not us; the manual Supabase run
        records it. A long-lived URL is a listed risk (Risks and
        Mitigations).
    *   The browser then PUTs the file directly to Supabase.
2.  **At raise, outside the transaction**, for each upload id sent:
    *   **Ownership.** The `ticket_upload` row must belong to the actor and
        the same centre, and must not be attached yet.
    *   **Size and signature.** Fetch only the first 16 bytes of the object
        (a Range request). The response gives the object's real total size,
        checked against the limit. The bytes give its file signature,
        checked against the allowed types:

        | Type | First bytes |
        |---|---|
        | PDF | `25 50 44 46 2D` (`%PDF-`) |
        | JPEG | `FF D8 FF` |
        | PNG | `89 50 4E 47 0D 0A 1A 0A` |

    *   **Stored type.** `ticket_document.content_type` comes from the
        detected signature, never from what the browser declared. The
        declared type is used only for the bucket's own check and is not
        stored.
    *   **Why outside.** Doing this before the transaction keeps outside
        calls out of it, which matters because of handler rule 1 (retries).
3.  **In the transaction:**
    *   Read the type `for share` (so a deactivation waits for this raise to
        finish); it must be active, with a registered handler.
    *   Run `handler.parse` and `handler.validate`.
    *   If the type requires a document, at least one must be present
        (T-TKT-001); at most `TICKET_POLICY.maxFilesPerTicket` (5, PMC) may be
        attached.
    *   Allocate the number (see Numbering). Insert the ticket with it and
        with the id from the form (see Idempotent raise), copy the levels into
        `ticket_level`, insert the document rows, and write the RAISE event.
        Audit `ticket.raise`.
4.  **Unattached uploads.** Objects uploaded but never attached stay in
    `uploads/`. No `ticket_document` row points to them, so no user can get a
    link to them, but they use storage and may hold personal data. Deleting
    them is a go-live gate (DD-16; Future Improvements).

**Idempotent raise** (D2). The raise form carries a hidden `ticketId`, a
uuid generated when the form is rendered. The sequence is:

1.  Before `scopedAction()`, read whether a ticket with that id exists
    (under RLS). If it does, `raise` returns `{id, created: false}` without
    writing anything or auditing, and the route redirects to `/tickets/{id}`.
    That page applies its own visibility rule, so another user's ticket gives
    404.
2.  Otherwise run the raise. If two identical submits race, the second
    ticket insert fails on the primary key; the engine maps that to
    `TicketDuplicate`, the transaction rolls back (releasing its number), and
    the route redirects as in step 1.
3.  On success `raise` returns `{id, created: true}`.

**Database errors.** Ticket writes are raw SQL (`$queryRaw`/`$executeRaw`),
like the rest of the server, so Postgres errors arrive as SQLSTATE codes.
They are read the way `db()` in `src/server/rbac.ts` reads them
(`meta.driverAdapterError.cause.originalCode`), and mapped:

| SQLSTATE | Constraint | Becomes |
|---|---|---|
| 23505 | `ticket_pkey` | `TicketDuplicate` (redirect, step 2 above) |
| 23505 | `ticket_document_upload_id_key` | `TicketError("document")` |
| 23505 | `ticket_reraise_of_key` | `TicketError("invalid")` (already re-raised) |
| 42501 | any (row-level security) | `Forbidden` |
| other, including a guard-trigger refusal | | not mapped: generic error page with reference id, because a guard refusal means an engine bug |

**Act** (`ticket.approve` for the centre). Input: ticket id, action, the
`version` the actor saw, remarks, and the forward target.

1.  **Lock.** `select … from app.ticket where id = $1 for update`. If the
    ticket is not OPEN or `version` differs from what the actor saw, throw
    `TicketError("conflict")` (T-TKT-006: the second of two racing approvers
    waits on the lock, then sees the new version).
2.  **Who may act.** `app.ticket_may_act(ticket_id)` must be true
    for the actor (Eligibility and visibility). It includes the
    `ticket.approve` check for the ticket's centre, so it agrees with
    `scopedAction()`'s own check. If it is false, throw `Forbidden`, so the
    attempt is audited as DENIED.
3.  **Self-approval and distinct approvers.** Both are built into
    `ticket_may_act` (rule 1). The raiser cannot act on their ticket at all
    (approve, reject or forward) at any level (T-TKT-010). An actor who
    already has an APPROVE event on the ticket cannot act on it again
    (DD-14). Because the queue, `canAct` on the detail page and `act()` all
    call the same function, a ticket in your queue is always one you can act
    on. A raiser who wants to withdraw a ticket asks an approver to reject it.
4.  **Approve, not the last level.** `current_level + 1`, clear
    `assigned_user_id`, APPROVE event (T-TKT-004).
5.  **Approve, last level.**
    1.  *Order.* Read the type `for share`; it must be active with a
        registered handler (DD-12). Then `handler.revalidate`, then
        `handler.apply`, then status APPROVED with `closed_at`, then the
        APPROVE event. The audit row takes `before` and `after` from `apply`
        (T-TKT-005). If anything throws, the whole transaction rolls back.
    2.  *Error mapping.* The engine wraps `handler.apply` and rethrows its
        errors as `ApplyFailed(level, cause)` (a class in `handlers.ts`, with
        the other ticket errors, that keeps the
        original as `cause`). A write conflict (Prisma code P2034) passes
        through unchanged, so `withScope()` can retry.
    3.  *Retries exhausted.* A P2034 that survives the retries reaches the
        actor as a generic error and writes no FAILED row, because it is not
        `ApplyFailed`.
    4.  *FAILED row.* For `ApplyFailed` only, a `ticket.apply_failed` audit
        row with outcome FAILED (a new `AuditOutcome` value) is written in
        its own transaction (T-TKT-007), through a new optional
        failure-audit hook on `scopedAction()`. It carries
        `{level, error: cause.name}`, not the message, which may contain
        personal data.
    5.  *No row.* A `stale` refusal or a `conflict` changed nothing and
        writes no audit row; the actor sees the reason.
6.  **Reject.** Remarks must not be blank (T-TKT-008). Status REJECTED with
    `closed_at`, REJECT event. Notifying the centre waits for D-COMM-1.
7.  **Forward.** `app.ticket_may_receive(ticket_id, user_id)` must be true
    for the target (T-TKT-009); otherwise `TicketError("invalid")`. Set
    `assigned_user_id` and write a FORWARD event.
8.  **Every update** is
    `update app.ticket set …, version = version + 1 where id = $1 and version = $seen`.
    If it affects 0 rows, throw `TicketError("conflict")`. The guard trigger
    checks the transition.

**Reassign** (DD-13; `ticket.type.manage`, network-wide, with step-up).
Input: ticket id, `version` seen, target user. Unlike the other actions, the
`scopedAction()` call omits `centreId`, so only an ALL-scope grant of
`ticket.type.manage` counts; that grant also makes every centre visible, so
the pre-read needs only RLS, not `ticket_may_view`. Lock the ticket as in Act
step 1; it must be OPEN. The target must pass `app.ticket_may_receive`. Set
`assigned_user_id`, write a FORWARD event at the current level with
`detail {admin: true}`, and audit `ticket.reassign`. The reassign form is
shown on every OPEN ticket to `ticket.type.manage` holders, and the
administrator decides when it is needed; a list of stranded tickets waits for
Stage 5 (Future Improvements).

**Re-raise** (D-TKT-2, PMC; rules in DD-9): a raise with `reraiseOf` set.
The pre-read takes the rejected ticket's `centre_id`, which is also the
centre `scopedAction()` authorises `ticket.raise` against. Inside the
transaction the rejected ticket is locked and must be REJECTED, raised by the
actor, and not yet re-raised. The new ticket takes its type and centre
(T-TKT-015).

### Reads

*   **Approval queue** (T-TKT-003): OPEN tickets where
    `app.ticket_may_act(id)` is true for the actor. Row-level security
    limits rows to the actor's centres first. Oldest first (`created_at`,
    then `id`), 50 per page, keyset pagination.
*   **Ticket list and detail:** tickets where `app.ticket_may_view(id)` is true
    (T-TKT-012). List filters are optional `status`, `typeId`, `priority` and
    `centreId`; newest first (`created_at desc`, then `id`), 50 per page,
    keyset pagination. The cursor is opaque to the browser: base64url of
    `<created_at ISO>|<id>` of the last row shown. The detail page shows the
    history and the documents.
*   **Document download:** a same-origin POST from a button on the ticket
    page, as export downloads are (a cross-site GET could otherwise write
    audit rows in the victim's name). A pre-check that the ticket passes
    `app.ticket_may_view` (otherwise 404). Then a `scopedAction()` with
    `ticket.document.view` for the centre: without it, `Forbidden`, a DENIED
    row and `?error=forbidden` on the ticket page. With it, the document row
    must be readable (RLS), a `ticket.document.download` audit row is
    written, and the route redirects (303) to a signed URL valid for 60
    seconds (PMC).

### Eligibility and visibility (one rule, one place)

The rule for whether an assignment covers a centre (ALL, REGION, AREA or
CENTRE) already lives in SQL: `app.scoped_centre_ids` (migration 0002) and
`app.target_centre_ids` (migration 0005). The ticket rules are built on it
once, as `SECURITY DEFINER` read functions in migration 0009. They need
definer rights (they run with their owner's privileges) because the actor
cannot read other users' assignments. They only read and never write, so
DD-1 still holds.

`app.scoped_centre_ids` answers only for the session's user and filters by
permission. The ticket functions must also ask about other users (forward
targets, names) and about roles (role-based levels and viewers).
So 0009 adds one internal helper with the same body, generalised:

```sql
-- illustrative; not granted to any app role, called only by the ticket functions below
app.user_centre_ids(p_user uuid, p_permission text default null, p_role int default null) returns int[]
-- centres covered by p_user's role assignments, keeping only assignments whose role
-- has p_permission (if given) and is p_role (if given); same ALL/REGION/AREA/CENTRE join as 0002
```

"Holds role R over the ticket's centre" below means
`centre_id = any(app.user_centre_ids(user, null, R))`, the DD-5 rule.

| Function | Answers | Used by |
|---|---|---|
| `app.ticket_may_act(ticket)` | May the actor act on this ticket now? (rule 1) | Act step 2, the approval queue, `canAct` on the detail page |
| `app.ticket_may_receive(ticket, user)` | May this user be made the forward or reassign target? (rule 2) | Forward step 7, Reassign |
| `app.ticket_forward_candidates(ticket)` | Id and display name of every user for whom rule 2 holds | The forward and reassign pickers |
| `app.ticket_may_view(ticket)` | May the actor see this ticket? (rule 3) | List, detail, document download |
| `app.ticket_people(ticket)` | Id and display name of every user the ticket refers to (raiser, level users, event actors and targets, assigned user); nothing unless rule 3 holds | Names in the list, detail and history. `gems_app` can read other users only with `rbac.view` (policy `rbac_read`), so plain joins to `app_user` would return nothing |

1.  **May act**, for the actor only (`app.session_user_id()`; the function
    has no user parameter, so it cannot be asked about others). All of:
    1.  the ticket is OPEN;
    2.  the actor is not the raiser (self-approval, Q4);
    3.  the actor has no APPROVE event on the ticket (distinct approvers,
        DD-14);
    4.  the actor holds `ticket.approve` over the ticket's centre;
    5.  either `assigned_user_id` is the actor, or no one is assigned and
        the actor is the current level's named user or holds its role over
        the ticket's centre (DD-5).
2.  **May receive**, for `user`. All of: `user` is active; is not the actor;
    is not the raiser; holds `ticket.approve` over the ticket's centre.
3.  **May view**, for the actor. Any of:
    1.  holds `ticket.view` over the ticket's centre;
    2.  is the raiser;
    3.  is the named user on any of the ticket's `ticket_level` rows, or holds
        one of their roles over the centre;
    4.  was ever a forward target (`ticket_event.to_user_id`);
    5.  is a viewer of its type: the named user, or holds the viewer role
        over the centre.

Every one of these returns false, or nothing, when the ticket's centre is not
in the actor's `visible_centre_ids()`. So none of them can be used to learn
whether a user holds rights at a centre the actor cannot see.

### Storage

`src/server/storage.ts` exposes `signedUploadUrl(key)`, `head(key, bytes)`
(returns the first bytes and the object's total size) and
`signedDownloadUrl(key, seconds)`. It has two implementations:

*   **Supabase:** calls the Storage REST API with `fetch`, so no new
    dependency is needed. It uses a server-only key read from
    `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` and a private bucket set in
    `TICKET_BUCKET`. Every server call sends `Authorization: Bearer <key>`
    and `apikey: <key>`. The calls are:
    *   `POST /storage/v1/object/upload/sign/{bucket}/{key}` with header
        `x-upsert: false` returns `{url}`, a path with a token relative to
        `/storage/v1`; the browser PUTs the file to
        `SUPABASE_URL + "/storage/v1" + url`.
    *   `GET /storage/v1/object/authenticated/{bucket}/{key}` with
        `Range: bytes=0-15` returns the first bytes; the total size is in
        `Content-Range`.
    *   `POST /storage/v1/object/sign/{bucket}/{key}` with body
        `{expiresIn: seconds}` returns `{signedURL}`, also relative to
        `/storage/v1`.

    The manual Supabase run (DD-7) confirms these shapes first, and also
    that a second PUT to an existing key is refused.
    The bucket is created once per environment by
    `scripts/storage-setup.mjs`, run by hand by whoever holds the key. It
    makes `TICKET_BUCKET` private with the size limit and MIME types from
    `TICKET_POLICY` (`src/server/tickets/policy.ts`, the Q9 defaults), and does nothing if the bucket
    already matches. So
    oversized or wrong-type uploads are refused before our check runs. The
    browser never receives the key. Signed URLs do contain the bucket name
    and the object key (Risks and Mitigations).
*   **Fake:** an in-memory map used when `STORAGE_DRIVER=fake`, the CI
    setting. Tests put objects into the map directly and call the engine.
    The browser upload component is covered by the manual Supabase run against
    real Supabase (DD-7), recorded in the evidence log.

The Content-Security-Policy in `proxy.ts` currently allows connections only
to the app itself (`default-src 'self'`). It needs `connect-src 'self'` plus
the Supabase origin, or the browser will block the upload.

### Numbering

One network-wide counter (DD-8). `app.number_series` cannot hold it, because
`centre_id` is part of its primary key (Alternative K). So tickets get their
own one-table counter, `ticket_number_series`, and
`allocateTicketNumber(tx, period)` in `numbering.ts`, which works like
`allocate()`:

```sql
-- illustrative
insert into app.ticket_number_series (period, current) values ($period, 1)
on conflict (period) do update set current = ticket_number_series.current + 1
returning current;
```

*   **No seeding step** (zoom-out finding M1). The first raise in a new
    period creates the row. The row lock taken by the upsert serialises
    concurrent raises, and a rolled-back raise releases its number, as with
    `allocate()`.
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
    30) are NP-5 parameters in `TICKET_POLICY`. `ticket.number` stores the
    formatted text. `formatNumber()` builds a different shape
    (centre/doc/period/number), so tickets get `formatTicketNumber()` next to
    it.

### Screens (unstyled, as with admin)

`/tickets` (list with filters for status, type, priority and centre),
`/tickets/new`, `/tickets/[id]` (detail, history, documents, action buttons,
and the reassign form for `ticket.type.manage` holders),
`/tickets/approvals` (queue), and `/admin/ticket-types` (setup; step-up
required, as for RBAC writes).

**Raise form.** It has two steps and needs no client JavaScript apart from
the upload component. `/tickets/new` first shows a GET form choosing the
type (active types only) and the centre (centres where the actor holds
`ticket.raise`, from `app.scoped_centre_ids('ticket.raise')`). Submitting it
reloads `/tickets/new?type=<id>&centre=<id>`, which renders one input per
entry in the type's handler `fields`, named `p.<name>`, plus the hidden
`ticketId`.

**Stage 2 use.** These screens are the manual test harness (DD-7). The pages
and routes are always deployed and are not hidden behind a flag. Without a
registered handler no type can be activated, so `/tickets/new` shows "No
ticket types are available" and the lists are empty. `/admin/ticket-types`
works as normal: types can be created and configured, but stay inactive.
Only `TICKET_TEST_HANDLER=1` makes a type activatable for the manual Supabase run.
The engine refuses to start with that setting on any Vercel deployment
(`VERCEL_ENV` set, production or preview).

## Alternatives Considered

### Alternative A: Rules in database functions (RBAC pattern)

*   **Pros**: Eligibility, self-approval and level changes are checked again in
    the database, as migration 0005 does for RBAC. Code that bypasses the
    engine cannot bypass the rules.
*   **Cons**: The logic is split between SQL and TypeScript. Handlers' `apply`
    still runs in TypeScript, so the definer function and the handler have to
    agree on lock order inside one transaction. It is more SQL to write and
    review.
*   **Reason for Rejection**: The guard triggers and the row lock already
    cover the failures with the worst outcome (double application and
    illegal states), and the engine is the only write path. The remaining
    risk is listed in Risks and Mitigations. The owner accepted this (DD-1).

### Alternative B: Everything in SQL, including handlers

*   **Pros**: All logic, including handlers, runs in one database transaction
    in one language.
*   **Cons**: 31 domain handlers in plpgsql (Postgres's procedural language)
    would tie every domain module to SQL. They are harder to test and review,
    and the team writes the rest of the app in TypeScript.
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
*   **Cons**: The five problems in The Problem would be solved, or missed,
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
    when someone acts (T-TKT-013). Copying can still strand a ticket when a
    named approver leaves; administrator reassign (DD-13) covers that.

### Alternative F: Forward as consult-only, or as an extra level

*   **Pros**: Approval rights never move (consult), or the original approvers
    are kept (extra level).
*   **Cons**: Consult-only stops the forward target from finishing the job,
    which may not match legacy use. An extra level makes level numbers drift
    from the type's setup.
*   **Reason for Rejection**: Reassigning at the same level keeps level
    numbers stable and lets the target finish. Its risk, giving approval
    rights by forwarding, is reduced by requiring the target to hold
    `ticket.approve` over the centre and by distinct approvers (DD-14). The
    owner accepted this (DD-3).

### Alternative G: Document references only, or blocking types that need documents

*   **Pros**: A smaller Stage 2 with no storage component or storage ADR.
*   **Cons**: References only gives a T-TKT-001 that can pass while no file
    exists. Blocking would push storage to the first domain handler that
    needs it.
*   **Reason for Rejection**: Building storage now settles ADR-002 early and
    proves the upload path before any module depends on it. The owner
    accepted this, on purpose ahead of need (DD-4).

### Alternative H: Supabase JavaScript SDK instead of `fetch`

*   **Pros**: Typed client, retries.
*   **Cons**: A new dependency for three REST calls. Its storage access rules
    assume Supabase Auth, which we do not use (ADR-001).
*   **Reason for Rejection**: Three `fetch` calls are smaller, and Supabase can
    be swapped out behind `storage.ts`.

### Alternative I: Upload through our own server

*   **Pros**: One request path; the server sees every byte and can check it
    while receiving.
*   **Cons**: Vercel caps a function's request body at 4.5 MB, below the
    proposed 10 MB limit, so files would be capped at about 4 MB. Large
    bodies also hold a function open for the whole upload.
*   **Reason for Rejection**: The cap is lower than the size the business
    needs. Direct upload with a check before attaching keeps the limit at
    10 MB (DD-6).

### Alternative J: Another document store

*   **Options**: Postgres `bytea` columns; Vercel Blob; Supabase Storage
    through storage-only S3 access keys instead of the service key.
*   **Pros**: `bytea` keeps documents in the transaction and under RLS. Vercel
    Blob is native to the host. S3 keys cannot touch the database (DD-15).
*   **Cons**: `bytea` bloats the database and its backups and still meets the
    4.5 MB body cap. Vercel Blob would add a second vendor next to Supabase.
    S3 keys need request signing (SigV4) by hand without an SDK.
*   **Reason for Rejection**: Supabase Storage is already contracted and
    reached with three `fetch` calls. The final choice, and the key type, are
    recorded in ADR-002 (Q9).

### Alternative K: Reuse `number_series`, or a Postgres sequence

*   **Pros**: `number_series` already exists and is tested (POC P3). A
    sequence (`nextval`) needs no row lock.
*   **Cons**: `number_series` has `centre_id` in its primary key, so it cannot
    hold one network-wide counter without a fake centre. A sequence is not
    transactional: it cannot reset per period (NP-2) and cannot be gapless if
    NP-3 chooses that.
*   **Reason for Rejection**: A one-row counter table supports every NP-2 and
    NP-3 option. At ticket volumes (about 16,500 tickets over the legacy
    system's life) the row lock costs little.

## Risks and Mitigations

| Risk | Impact | Mitigation | Residual / owner |
|---|---|---|---|
| Code writes tickets without the engine | Eligibility, self-approval and distinct-approver checks skipped | The engine is the only write path; guard triggers still enforce legal states (DD-1) | Accepted by owner (DD-1); Alternative A if a second write path appears |
| Handler sends an outside effect and the transaction is retried | Effect happens twice | Handler rule 1: database work only; outbox later | Each domain module's review |
| Named approver or forward target leaves | Ticket stranded | Administrator reassign (DD-13), offered on every OPEN ticket | Operations to watch; SLA escalation in Stage 5 |
| One person approves several levels | Multi-level control collapses | Distinct approvers (DD-14) | PMC, Operations sign-off (Q4) |
| Raiser approves their own ticket | Fraud | Built into `ticket_may_act` (Act step 3) | ⛔ prod-gate, Operations (Q4) |
| Double submit of the raise form | Two tickets, two changes | Idempotent raise with a form-carried id | none |
| Object replaced after its check | Unchecked file attached | `x-upsert: false`; manual Supabase run proves a second PUT is refused | ADR-002 |
| Upload URL valid longer than needed | Someone holding the URL can write that one key until it expires | The URL writes only its own key; only the requester can attach it; checks run at attach | Accepted by owner with ADR-002 (Q9) |
| Signed URLs show bucket name and object key | Names visible to the user | Keys are random ids; URLs expire; the bucket is private | Accepted by owner with ADR-002 (Q9) |
| Supabase service key leaks from the server | Full storage access, and RLS bypass through the Data API | Key never reaches the browser (bundle scan); recorded check that the Data API does not expose schema `app` (DD-15) | IT, ADR-002; S3 keys as fallback (Alternative J) |
| Unattached uploads pile up | Personal data kept without limit; storage cost | No upload is possible until a document type is live; then the deletion job and a per-user limit are a go-live gate (DD-16) | IT and Legal (Q9) |
| Handler swapped under open tickets | Old payloads reach new code | `handler_key` changes only on an inactive type with no OPEN tickets (DD-11) | none |
| Deactivation races a last-level approval | Change applied after "off" | Type read `for share` in raise and last-level approval | none |
| Queue slows as tickets grow | Slow approver page | Measure it; switch to a set-returning query (see NFR) | Stage 5 |

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
    ticket: about 2,400 calls for a network-wide approver at legacy volumes.
    If the queue page's 95th-percentile response time exceeds 1 second (PMC),
    turn the function into a set-returning query (one query returning all
    eligible tickets); the rule stays in one place.
*   **Transaction time.** File checks run before the transaction opens, so the
    transaction holds the row lock only for database work and stays within
    `withScope`'s default 5 s.
*   **Rollout.** A ticket type is inactive until an administrator activates it,
    and activation requires a registered handler. Stage 2 registers none
    outside tests (DD-2), so nothing reaches users until a domain module ships
    a handler. Rolling back means deactivating the type (DD-12).

## Additional Resources

*   `docs/designs/ticket-engine/input-brief.md` (the drafting input)
*   Review reports: `zoom_out_report.md`, `comprehension_report.md`,
    `critic_report.md` in this folder
*   WF6, *GEMS Workflows for Manager Review*, pp. 11–12; SPEC p.38
*   In `docs/audit/`: 04 (D-TKT-1…4), 06 (`06-security-threat-model.md`),
    09 (T-TKT-001…018), 10 (stage placement), 11 (POC P5);
    NP-1…8 in `revisions/v1.1-corrections.md` §C-02.1
*   ADR-001 (first-party authentication); migrations 0002 (scope functions)
    and 0005 (RBAC pattern)

## Future Improvements

*   **Deleting uploads that were never attached**: a daily job that removes
    `uploads/` objects older than 24 hours with no `ticket_document`.
    **Go-live gate** for the first type with `document_required` (DD-16),
    together with a per-user limit on upload requests that reuses
    `app.recent_export_count` and `RateLimited` (429) from
    `src/server/exports.ts`.
*   **Stranded-ticket list**: a list for administrators of OPEN tickets on
    which no active user can act, with SLA escalation (Stage 5). In Stage 2
    the administrator decides when to reassign (DD-13).
*   **Outbox for outside effects**: needed for centre notifications
    (T-TKT-008, D-COMM-1) and any handler that must call another system.
*   **Database-side eligibility checks** (Alternative A), if a second write
    path to tickets ever appears.
*   **Virus scanning** of uploads, if Q9 requires it.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

### Build phases

`bash scripts/ci.sh` must be green at the end of each phase, not after each
item. The items in one phase land together, because they depend on each
other.

| Phase | Items | Why they go together |
|---|---|---|
| P1 Decisions | 1, 2, 3 | Documentation only. The matrix and decision counts must stay consistent (T-DOC-001) |
| P2 Schema | 4, 5, 18, 20, 20a | The migration changes the exact lists in T-RLS-002/005, and `reset()` must re-seed the ticket permissions the migration adds |
| P3 Server | 10, 11, 11a, 6, 6a, 9, 7, 8, 19, 21 | The engine adds audit actions, which the catalogue gate refuses until it knows and tests them |
| P4 Web | 12, 12a, 13, 14, 15, 16, 17, 22, 22a, 23, 24, 9a | Routes, pages, CSP and the security checks that cover them |
| P5 Evidence | 25 | After the manual Supabase run |

### Target Files to Create/Modify

#### 1. `docs/adr/ADR-002-document-storage.md` (Create)

*   **Type / Scope**: Architecture decision record, same layout as ADR-001,
    status "Proposed" until the owner signs.
*   **Proposed Changes**: Records:
    *   DD-4 and DD-6: Supabase Storage as the private store; direct browser
        upload through signed upload URLs; the check before attaching;
        60-second download links; the fake driver in CI.
    *   DD-15: the server-only service key, and the recorded check that
        Supabase's Data API does not expose schema `app`; storage-only S3
        keys as the fallback.
    *   The `x-upsert: false` rule and its check in the manual Supabase run.
    *   DD-16: uploads refused until a document type is live; the deletion
        job and a per-user limit as the go-live gate.
    *   The Q9 limits as PMC.

#### 2. `docs/audit/04-manager-decision-register.md` (Modify)

*   **Type / Scope**: Decision register.
*   **Proposed Changes**:
    *   Adds **D-STO-1** for upload limits (size, types, retention, virus
        scan), owner IT + Legal, defaults from Q9.
    *   Records against existing entries:
        *   NP-1: one network-wide ticket counter, accepted by the project
            owner (DD-8), pending the NP owners' signature.
        *   D-TKT-2: the re-raise rules (DD-9).
        *   D-TKT-4: the distinct-approver default (DD-14).
        *   NP-5: the format defaults (DD-10).
    *   The change also re-runs
        `python -I docs/audit/tools/build_matrix.py docs/audit` (T-DOC-001
        checks that every referenced ID exists) and updates the decision
        count in `docs/STATUS.md`.

#### 3. `docs/audit/09-test-strategy-and-acceptance-criteria.md` and `docs/audit/data/matrix-04-logs-tickets-exams-supply.tsv` (Modify)

*   **Type / Scope**: Acceptance tests and the traceability matrix.
*   **Proposed Changes**:
    *   Adds four tests:
        *   T-TKT-019: a document download needs `ticket.document.view` for
            the centre, gives 404 outside scope, and is audited.
        *   T-TKT-020: an upload is refused when the stored object's real
            size or signature breaks the limit, when it belongs to another
            user or centre, or when it is already attached.
        *   T-TKT-021: one user cannot approve two levels of one ticket
            (DD-14).
        *   T-TKT-022: a `ticket.type.manage` holder reassigns a ticket
            whose named approver was disabled, and the new assignee can act
            (DD-13).
    *   Marks the parts deferred out of Stage 2: T-TKT-002's legacy
        continuity (NP-8) and T-TKT-008's "centre notified" (D-COMM-1).
    *   Adds T-TKT-019…022 to the `tests` column of the R-094 rows in the
        matrix file, then re-runs `build_matrix.py`.

#### 4. `prisma/migrations/0009_tickets/migration.sql` (Create)

*   **Type / Scope**: SQL migration.
*   **Proposed Changes**, in this order:
    1.  `alter type app."AuditOutcome" add value 'FAILED'` first. A value
        added this way cannot be used in the same transaction, so nothing
        else in 0009 refers to `'FAILED'`.
    2.  Enums `TicketStatus` (OPEN, APPROVED, REJECTED), `TicketAction`
        (RAISE, APPROVE, REJECT, FORWARD) and `TicketPriority` (LOW, MEDIUM,
        HIGH until the legacy list is readable).
    3.  The ten tables in §Data model, with the column types, keys and
        foreign keys listed there, and check constraints: exactly one of user
        or role per level and per viewer; level 1–4;
        `current_level <= level_count`. Unique: `ticket.number`,
        `ticket.reraise_of`, `ticket_document.upload_id`, `ticket_type.code`,
        and the two viewer pairs. Constraint names as in §Database errors.
    4.  Indexes: `ticket(status, created_at, id)` (queue),
        `ticket(created_at desc, id)` (list), `ticket_event(ticket_id)`,
        `ticket_document(ticket_id)`, `ticket_upload(uploaded_by,
        created_at)`. `ticket_level` is covered by its primary key.
    5.  RLS on the five per-ticket tables (`ticket`, `ticket_level`,
        `ticket_event`, `ticket_upload`, `ticket_document`) with the loop
        from 0002, which creates all four policies by
        `visible_centre_ids()`. Grants limit what the app can really do:
        insert on all five, update on `ticket` only, delete on none.
    6.  RLS on the setup tables: select for all app users; insert, update
        and delete only when
        `(select app.has_permission('ticket.type.manage', null))`, wrapped in
        `select` so it is evaluated once per statement, as 0007 does.
    7.  Triggers `app.ticket_guard()` (insert and update on `ticket`) and
        `app.ticket_level_guard()` (insert on `ticket_level`), with the rules
        in §Guard triggers. They raise with SQLSTATE `P0001`.
    8.  A new function `app.ticket_immutable()`, raising
        `'% is append-only', TG_TABLE_NAME`, as row triggers on update and
        delete, and as a statement trigger on truncate, for `ticket_event`
        and `ticket_document` (the pattern of `app.audit_immutable()` in
        0002, whose message names `audit_log` and so cannot be reused).
    9.  The internal helper `app.user_centre_ids(user, permission, role)`:
        `security definer`, `set search_path = pg_catalog, app`, revoked
        from public, granted to no app role.
    10. Five definer read functions in §Eligibility and visibility:
        `ticket_may_act(ticket)`, `ticket_may_receive(ticket, user)`,
        `ticket_forward_candidates(ticket)`, `ticket_may_view(ticket)` and
        `ticket_people(ticket)`. Each is `security definer` with
        `set search_path = pg_catalog, app`, returns false or nothing
        outside the actor's `visible_centre_ids()`, and is granted to
        `gems_app` only.
    11. Permission rows `ticket.raise`, `ticket.view`, `ticket.approve`,
        `ticket.document.view` and `ticket.type.manage` (sensitive), with
        `on conflict (key) do nothing`, as in 0007.
    12. Grants as in §Grants, plus `usage` on every sequence behind a serial
        id that `gems_app` inserts into: `ticket_category`, `ticket_type`,
        `ticket_type_viewer`, `ticket_event` and `ticket_document` (as 0002
        grants `usage` on `audit_log_id_seq`).

#### 5. `prisma/schema.prisma` (Modify)

*   **Type / Scope**: Prisma schema.
*   **Proposed Changes**: Models, enums, keys and indexes mirroring 0009
    (serial ids as `@default(autoincrement())`, composite keys as `@@id`), so
    the drift gate in `scripts/ci.sh` passes.

#### 6. `src/server/tickets/handlers.ts` (Create)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**:
    *   The `TicketHandler<P>` type and `TicketRow<P>` (§Handler contract).
    *   The ticket error classes: `TicketError(reason: "invalid" | "stale"
        | "conflict" | "document" | "inactive", message?)`,
        `TicketNotFound`, `TicketDuplicate(id)` and `ApplyFailed(level,
        cause)`. When each is thrown: §Actions › Errors and §Database
        errors.
    *   `HANDLERS: Record<string, TicketHandler<unknown>>`, empty in
        production and mutable.
    *   Tests register the test handler themselves with
        `HANDLERS["test.counter"] = testCounter` in a `beforeAll`.
    *   For the manual Supabase run only, `TICKET_TEST_HANDLER=1` makes the
        module register `test.counter` from `test-handler.ts` when it loads.
        With `VERCEL_ENV` set, the module throws at load instead (DD-7).

#### 6a. `src/server/tickets/test-handler.ts` (Create)

*   **Type / Scope**: TypeScript module, used only by tests and the manual
    Supabase run.
*   **Proposed Changes**: The `test.counter` handler.
    *   `fields`: `key` (text), `failApply` and `failRevalidate` (text; `"1"`
        means yes). Payload: `{key: string, failApply: boolean,
        failRevalidate: boolean}`.
    *   `validate`: accepts any parsed payload.
    *   `apply`: adds 1 to the `app.test_ticket_counter` row for `key`,
        creating it at 1, and returns the old and new value as
        `before`/`after`. With `failApply`, it throws after the increment
        (T-TKT-007: the increment must roll back).
    *   `revalidate`: with `failRevalidate`, throws
        `TicketError("stale", "test")`; `staleMessages` is
        `{test: "Test refusal"}` (T-TKT-011).

#### 6b. `src/server/tickets/policy.ts` (Create)

*   **Type / Scope**: TypeScript module with no imports, so a plain Node
    script can import it too (Node 24.19, used locally and pinned in
    `.github/workflows/ci.yml`, runs erasable TypeScript directly).
*   **Proposed Changes**: `TICKET_POLICY` (PMC), styled like `EXPORT_POLICY`
    in `exports.ts`, the one source for these values:
    *   `maxFileBytes: 10 * 1024 * 1024` (Q9 default);
    *   `fileTypes: [{mime: "application/pdf", signature: [0x25, 0x50, 0x44,
        0x46, 0x2d]}, {mime: "image/jpeg", signature: [0xff, 0xd8, 0xff]},
        {mime: "image/png", signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a,
        0x1a, 0x0a]}]`;
    *   `maxFilesPerTicket: 5`, `downloadUrlSeconds: 60`;
    *   `numberPad: 0`, `numberMaxLength: 30` (DD-10).

#### 7. `src/server/tickets/engine.ts` (Create)

*   **Type / Scope**: TypeScript module (core). Each write follows its steps
    in §Actions through `scopedAction()`, with the audit fields and errors
    listed there, and maps database errors with `db()` from `rbac.ts`
    (§Database errors).
*   **Proposed Changes**:
    *   `requestUpload(session, {typeId, centreId, fileName, size,
        contentType})`: `ticket.raise` for the centre; refused with
        `inactive` unless the type is active and `document_required`.
        Returns `{uploadId, url}`, where `url` is absolute
        (`SUPABASE_URL + "/storage/v1" + …`).
    *   `raise(session, {ticketId, typeId, centreId, payload, uploadIds,
        reraiseOf?})`: `ticket.raise` for the centre. Idempotent on
        `ticketId` (§Idempotent raise). Returns `{id, created}`.
    *   `act(session, {ticketId, action, seenVersion, remarks?,
        forwardTo?})`: `ticket.approve` for the ticket's centre.
        *   `act` wraps `handler.apply`, so any error thrown by `apply`
            becomes `ApplyFailed(level, cause)`, except P2034, which passes
            through for `withScope()` to retry.
        *   `act` passes `scopedAction()` a failure hook that returns
            `{action: "ticket.apply_failed", extra: {level, error:
            cause.name}}` for `ApplyFailed` only.
    *   `reassign(session, {ticketId, seenVersion, toUserId})`: through
        `adminWrite` (item 11), so `ticket.type.manage` at ALL scope and
        fresh step-up (DD-13).
    *   Reads:
        *   `approvalQueue(session, cursor?)`;
        *   `listTickets(session, {status?, typeId?, priority?, centreId?,
            cursor?})`;
        *   `getTicket(session, id)`: detail, levels, history, documents,
            `canAct`, forward candidates and names from `ticket_people`;
            throws `TicketNotFound` when the ticket is not viewable;
        *   `documentLink(session, ticketId, documentId)`: the pre-check and
            `scopedAction()` in §Reads; returns a signed URL.

        Both lists use the same cursor: base64url of `<created_at
        ISO>|<id>` of the last row shown (§Reads).
    *   Audit actions, each written as a string literal on an `action:` line
        so the catalogue gate can find it (item 21): `ticket.upload.request`,
        `ticket.raise` (also for re-raise), `ticket.approve` (every level;
        `final` in the detail), `ticket.reject`, `ticket.forward`,
        `ticket.reassign`, `ticket.apply_failed` and
        `ticket.document.download`.

#### 8. `src/server/tickets/setup.ts` (Create)

*   **Type / Scope**: TypeScript module (type setup).
*   **Proposed Changes**: Every write goes through `adminWrite` (item 11):
    `ticket.type.manage` at ALL scope, fresh step-up, database errors mapped
    by `db()`, before and after in the audit row.
    *   `createCategory(session, {name, parentId?})`.
    *   `createType(session, {code, name, categoryId, priority,
        documentRequired, handlerKey, numberPrefix})`, created inactive.
    *   `updateType(session, typeId, {name, categoryId, priority,
        documentRequired, handlerKey})`.
    *   `setTypeLevels(session, typeId, levels: {level, userId? |
        roleId?}[])` and `setTypeViewers(session, typeId, viewers: {userId? |
        roleId?}[])`; each replaces the whole set.
    *   `setTypeActive(session, typeId, active)`.
    *   Refusals, all `RbacError` so the existing `adminPost` mapping and
        page messages apply:

        | Refusal | Reason | Message key |
        |---|---|---|
        | `handlerKey` change while the type is active or has OPEN tickets (DD-11) | `invalid` | `ticket.setup.handler` |
        | Formatted number `{prefix}/{typeCode}/{seq}` would exceed `numberMaxLength` with a 10-digit `seq` | `invalid` | `ticket.setup.prefix` |
        | Levels with a gap, more than 4, or none | `invalid` | `ticket.setup.levels` |
        | Activation with a `handlerKey` not in `HANDLERS`, or invalid levels | `invalid` | `ticket.setup.activate` |
        | Duplicate `code` (SQLSTATE 23505) | `duplicate` | existing `duplicate` |

        `RbacError` gains an optional message key; `adminPost` sends
        `?error=<key>` when one is set.
    *   Audit actions, as literals on `action:` lines (item 21):
        `ticket.type.create`, `ticket.type.update`, `ticket.type.levels`,
        `ticket.type.viewers`, `ticket.type.activate`,
        `ticket.type.deactivate` (`setTypeActive` has two separate calls,
        one per action, not a ternary) and `ticket.category.create`.
    *   The level and viewer pickers list users with the existing
        `listUsers`, which needs `rbac.view`. A type administrator therefore
        also holds `rbac.view`; the `/admin/ticket-types` page says so when
        it is missing.

#### 9. `src/server/storage.ts` (Create)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**:
    *   `signedUploadUrl(key)`, `head(key, bytes)` returning `{bytes:
        Uint8Array, totalSize: number} | null` (null when the object does
        not exist, which the engine maps to `document`), and
        `signedDownloadUrl(key, seconds)`.
    *   The Supabase driver makes the three `fetch` calls listed in
        §Storage. It reads `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and
        `TICKET_BUCKET`.
    *   If Supabase does not honour Range requests (checked in the manual
        Supabase run), `head` reads the object as a stream and stops after
        `bytes` bytes or `TICKET_POLICY.maxFileBytes + 1` bytes, whichever
        gives the answer first.
    *   The fake driver is selected by `STORAGE_DRIVER=fake`. It exports
        `fakeStorage.put(key, bytes)` and `fakeStorage.clear()` for tests.
        It throws at load when `VERCEL_ENV` is set, so it can never run
        live; the check does not use `NODE_ENV`, because CI builds and runs
        the real-server smoke with `NODE_ENV=production` and the fake.
    *   The driver is chosen on first use, not at import, so `next build`
        never needs storage settings. With neither `STORAGE_DRIVER=fake`
        nor the three Supabase variables set, the first call throws a
        configuration error.

#### 9a. `scripts/storage-setup.mjs` (Create)

*   **Type / Scope**: Operator script, run by hand once per environment; not
    run by CI.
*   **Proposed Changes**: Imports `TICKET_POLICY` from
    `src/server/tickets/policy.ts`. Reads `SUPABASE_URL`,
    `SUPABASE_SERVICE_KEY` and `TICKET_BUCKET`. Creates the bucket with
    `POST /storage/v1/bucket` (`public: false`, `file_size_limit` and
    `allowed_mime_types` from `TICKET_POLICY`), or updates it with
    `PUT /storage/v1/bucket/{id}` if its settings differ, and prints what it
    did.

#### 10. `src/server/numbering.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: Adds `allocateTicketNumber(tx, period)` (the upsert
    in §Numbering) and `formatTicketNumber({prefix, typeCode, number, pad,
    maxLength})`, which returns `{prefix}/{typeCode}/{seq}` and throws
    `RangeError` on over-length, like `formatNumber`. `pad` and `maxLength`
    come from `TICKET_POLICY`.

#### 11. `src/server/rbac.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**: Exports `adminWrite` (permission + fresh step-up +
    `db()` mapping, audited) and `db()`, both private today, for
    `setup.ts`, `reassign` and the engine's error mapping. `RbacError` gains
    the optional message key (item 8). No behaviour change for existing
    callers.

#### 11a. `src/server/action.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**:
    *   `scopedAction()` gains an optional last argument
        `onFailure?: (e: unknown) => { action: string; extra: AuditExtra } |
        null`.
    *   The internal `audit()` outcome type widens to
        `"OK" | "DENIED" | "FAILED"`.
    *   When the business transaction throws and the hook returns a value,
        `scopedAction()` writes that audit row (same `centreId`,
        `targetType` and `targetId` as `meta`) with outcome FAILED in a
        separate transaction, as it does for DENIED rows today.
    *   A `Forbidden` error takes precedence: `scopedAction()` writes DENIED
        and does not call the hook.
    *   `scopedAction()` calls the hook once, with the final error, after
        `withScope()` has finished its P2034 retries, because the hook call
        sits outside the `withScope()` call.
    *   If writing the DENIED or FAILED row itself fails, `scopedAction()`
        logs that and rethrows the original error, so the cause is not
        masked.
    *   Existing callers do not change.

#### 12. `src/server/admin-http.ts` (Modify)

*   **Type / Scope**: TypeScript module.
*   **Proposed Changes**:
    *   `adminPost` maps `TicketError` to `?error=ticket.<reason>`; for
        `stale` it also appends `&detail=${encodeURIComponent(e.message)}`.
        It maps `TicketNotFound` to a 404 response and `TicketDuplicate` to
        a redirect to `/tickets/{id}`.
    *   `ADMIN_MESSAGES` gains:

        | Key | Text |
        |---|---|
        | `ticket.invalid` | Some values were missing or not allowed. Check the form and try again. |
        | `ticket.document` | A document is missing, too large, of a type that is not allowed, or already used. |
        | `ticket.inactive` | This ticket type is switched off. |
        | `ticket.stale` | The request no longer matches the current data. (The page then shows the handler's `staleMessages[detail]`, or this text alone for an unknown key.) |
        | `ticket.conflict` | This ticket changed since you opened it. |
        | `ticket.setup.handler` | The handler can change only while the type is off and has no open tickets. |
        | `ticket.setup.prefix` | The prefix and code would make ticket numbers too long. |
        | `ticket.setup.levels` | Levels must run 1, 2, 3… with no gaps, at most 4. |
        | `ticket.setup.activate` | The type needs a registered handler and valid levels before it can be switched on. |
        | `rbac.forbidden` | You can only grant roles where you hold every one of their permissions. |

    *   The shared `forbidden` text becomes "You are not allowed to do
        that.". The role-granting hint moves to `rbac.forbidden` (item 12a).
    *   Mapping `TicketError` in `adminPost` lets ticket form posts reuse
        the same-origin check, session and error plumbing.

#### 12a. `src/server/page-read.ts` and the four RBAC pages (Modify)

*   **Files**: `src/server/page-read.ts`, `app/admin/users/page.tsx`,
    `app/admin/users/[id]/page.tsx`, `app/admin/roles/page.tsx`,
    `app/admin/roles/[id]/page.tsx`.
*   **Proposed Changes**:
    *   `pageRead()` also maps `TicketNotFound` to `notFound()`, so
        `/tickets/[id]` keeps 404 parity (G3, T-SEC-001).
    *   The four RBAC pages show `ADMIN_MESSAGES["rbac.forbidden"]` under the
        generic `forbidden` text when `error=forbidden`.

#### 13. `proxy.ts` (Modify)

*   **Type / Scope**: Next.js proxy (CSP).
*   **Proposed Changes**: Adds `connect-src 'self' <SUPABASE_URL origin>`.
    When `SUPABASE_URL` is not set (CI), only `'self'` is allowed.

#### 14. Ticket pages (Create)

*   **Type / Scope**: Server-rendered pages (unstyled). All read through
    `pageRead()`, so an out-of-scope record gives 404.
*   **Proposed Changes**:
    *   `app/tickets/page.tsx`: the ticket list with filters.
    *   `app/tickets/new/page.tsx`: the raise form (§Screens).
        *   Inputs: type, centre, one `p.<name>` input per handler field,
            and the file picker.
        *   POST fields: `ticketId` (hidden; generated when the form is
            rendered), `typeId`, `centreId`, `p.*`, `uploadId` (one per
            file), and `reraiseOf`.
        *   Re-raise: opening the form as `?reraise=<id>` sets `reraiseOf`,
            fixes type and centre, and leaves the handler fields blank
            (DD-9). On a re-raise, `raise` ignores any `typeId` or
            `centreId` in the POST and uses the rejected ticket's.
        *   On error the route returns to
            `/tickets/new?type=<id>&centre=<id>` (plus `&reraise=<id>`); the
            typed values are lost, which is accepted for unstyled Stage 2
            screens.
    *   `app/tickets/[id]/page.tsx`: history and documents (with names from
        `ticket_people`), one download button per document (a POST form),
        and an action form with fields `action` (approve, reject, forward),
        hidden `seenVersion`, `remarks` and `forwardTo` (the forward
        picker). `ticket.type.manage` holders also see a reassign form on
        every OPEN ticket.
    *   `app/tickets/approvals/page.tsx`: the approval queue.

#### 15. `app/tickets/new/upload.tsx` (Create)

*   **Type / Scope**: Client component, the only client JavaScript in this
    design.
*   **Proposed Changes**: For each chosen file, it calls
    `POST /tickets/uploads`, PUTs the file to the returned URL, and adds the
    upload id to the raise form as a hidden `uploadId` field. It shows a
    per-file error when the server or storage refuses a file.

#### 16. Ticket routes (Create)

*   **Type / Scope**: Route handlers, each exporting
    `POST = safeRoute(...)`.
*   **Proposed Changes**:
    *   `app/tickets/uploads/route.ts`: same-origin JSON POST. It uses
        `sameOrigin`, `readCookie` and `SESSION_COOKIE` from
        `src/server/auth/http.ts` the way `app/export/[dataset]/route.ts`
        does, because `adminPost` is form-only. Returns `{uploadId, url}`,
        or the statuses in §Actions › Errors.
    *   `app/tickets/create/route.ts`: raise, through `adminPost`. Success
        redirects to `/tickets/{id}`.
    *   `app/tickets/[id]/act/route.ts`: act, through `adminPost`. Success
        and `conflict` return to the ticket page.
    *   `app/tickets/[id]/reassign/route.ts`: reassign, through `adminPost`;
        step-up as for RBAC writes. Success returns to the ticket page.
    *   `app/tickets/[id]/documents/[docId]/route.ts`: download, a
        same-origin form POST in the style of the export route. It redirects
        (303) to the signed URL; returns 404 when the ticket is not
        viewable; redirects to the ticket page with `?error=forbidden` when
        the actor lacks `ticket.document.view`; and sends an expired session
        to `/login?error=expired`.

#### 17. Ticket-type admin (Create)

*   **Files**: `app/admin/ticket-types/page.tsx`,
    `app/admin/ticket-types/[id]/page.tsx`,
    `app/admin/ticket-types/create/route.ts`,
    `app/admin/ticket-types/[id]/save/route.ts`.
*   **Proposed Changes**: List and create types and categories. Edit levels
    (1–4, user or role each), viewers, name, category, priority, document
    required, `handlerKey` (a choice from `HANDLERS`, editable per DD-11)
    and the active flag. The page has one form per part; the save route
    reads a hidden `op` field (`details`, `levels`, `viewers`, `active`) to
    call `updateType`, `setTypeLevels`, `setTypeViewers` or `setTypeActive`.
    These pages copy the structure of the `/admin/roles` pages.

#### 18. `tests/sql/ticket-test-handler.sql` (Create)

*   **Type / Scope**: Test-only SQL, applied by the admin connection, as
    `audit-fault.sql` is.
*   **Proposed Changes**: Table `app.test_ticket_counter(key text primary
    key, value int)`, with no `centre_id` and so no RLS, granted to
    `gems_app`. `tests/tickets.test.ts` applies it in `beforeAll` with
    `asAdmin`, as `tests/auth/suite.ts` does. For the manual Supabase run the
    developer applies it by hand to the local database.

#### 19. `tests/tickets.test.ts` (Create)

*   **Type / Scope**: Vitest suite against the Docker database.
*   **Setup**: `beforeAll` applies item 18, registers `test.counter` in
    `HANDLERS`, and uses `fakeStorage`; `beforeEach` calls `reset()`.
*   **Tests**: T-TKT-001…015 and 019–022, each asserting its audit rows by
    action name (for example `audits("ticket.raise")`), plus:
    *   T-TKT-006: two real concurrent sessions; the counter equals 1 and
        one call got `conflict`.
    *   Guard triggers, as `gems_app` directly, all refused:
        *   an update that skips the version, reopens a closed ticket, jumps
            two levels, or sets APPROVED below the last level;
        *   an insert that is not OPEN at level 1 with version 1;
        *   a `ticket_level` insert after the RAISE event, or with
            `level > level_count`.
    *   `ticket_event` update, delete and truncate are refused.
    *   Idempotent raise: the same `ticketId` posted twice gives one ticket
        and `created: false`; the same upload attached twice gives
        `document`.
    *   Distinct approvers (DD-14): a user holding the roles of levels 1 and
        2 can approve level 1 only. Forwarding level 1 to the level-2
        approver does not let that approver approve both levels.
    *   Reassign (DD-13): after a ticket's named approver is disabled, no one
        can act on it. Reassign needs `ticket.type.manage` and step-up,
        refuses a target failing `ticket_may_receive`, and lets the target
        act.
    *   Upload gate (DD-16): an upload request for an inactive type, or a
        type without `document_required`, is refused with `inactive`.
    *   Setup: each refusal in item 8's table; writes need step-up and
        `ticket.type.manage`; activation without a registered handler is
        refused.
    *   A viewer who posts an action gets `forbidden`, not 404.
    *   Failure hook (item 11a): `Forbidden` gives one DENIED row and no
        FAILED row; a forced P2034 gives no FAILED row; `ApplyFailed` gives
        exactly one FAILED `ticket.apply_failed` row with `{level, error}`.
    *   T-TKT-002: tickets raised at two different centres get consecutive,
        distinct numbers from the one counter (B1); concurrent raises get
        no duplicates; a rolled-back raise leaves no gap; the first raise of
        a new period creates its row (M1). Reset and legacy continuation
        wait for NP-2 and NP-8.
    *   Eligibility: for every fixture user, including the raiser and a
        holder of a level role who lacks `ticket.approve`, a ticket is in
        the queue exactly when `act(approve)` succeeds.
        `ticket_may_receive`, `ticket_forward_candidates` and
        `ticket_people` return false or nothing for a ticket at a centre the
        actor cannot see.
    *   Load guards: with `VERCEL_ENV` set (`vi.stubEnv`), and after
        `vi.resetModules()`, a dynamic import of the handler registry with
        `TICKET_TEST_HANDLER=1`, or of the fake storage driver, throws.
    *   T-TKT-016, 017 and 018: `test.todo` entries naming Stage 5 or the
        owning domain module.

#### 20. `tests/fixtures.ts` (Modify)

*   **Type / Scope**: Test fixtures.
*   **Proposed Changes**:
    *   `reset()` adds the ticket tables, `app.ticket_number_series` and
        `app.test_ticket_counter` (when present) to its truncate. It
        already runs in replica mode, so the append-only triggers do not
        fire.
    *   `reset()` re-inserts the five ticket permissions with their
        sensitive flag, because it truncates `app.permission`.
    *   It adds ticket roles and assignments: a level-1 role and a level-2
        role at centre A; a holder of a level role without
        `ticket.approve`; a type administrator with `ticket.type.manage`
        and `rbac.view` at ALL scope; and a viewer.
    *   It moves the `session(token, user)` and `stepUp(token, age)` helpers,
        now copied in `tests/rbac.test.ts` and `tests/admin-http.test.ts`,
        into `fixtures.ts`, and those suites import them.
    *   A helper creates a ticket type with levels.

#### 20a. `tests/foundation.test.ts` (Modify)

*   **Type / Scope**: Foundation RLS tests.
*   **Proposed Changes**: T-RLS-002's expected table list gains the five
    per-ticket tables. T-RLS-005's definer-function inventory gains
    `ticket_forward_candidates`, `ticket_may_act`, `ticket_may_receive`,
    `ticket_may_view`, `ticket_people` and `user_centre_ids`.

#### 21. `tests/audit-catalogue.ts` and `tests/audit.test.ts` (Modify)

*   **Type / Scope**: Audit coverage gate (T-AUD-009).
*   **Proposed Changes**:
    *   `AUDIT_CATALOGUE` gains the 15 ticket audit actions from items 7
        and 8.
    *   The gate's code scan in `audit.test.ts` also reads
        `src/server/tickets/engine.ts` and `src/server/tickets/setup.ts`,
        with the same `action:`-slice rule it uses for `rbac.ts`, so
        permission keys on the same line are not counted.
    *   The "a test asserts it" check stays as it is; item 19 asserts each
        action by its audit row, which also covers `ticket.raise` and
        `ticket.approve`, whose names equal permission keys.

#### 22. `tests/sec.test.ts` and `scripts/smoke-security.mjs` (Modify)

*   **Type / Scope**: T-SEC suite and real-server smoke.
*   **Proposed Changes**: Adds ticket pages and routes to the 404-parity
    checks. Checks that `connect-src` contains the storage origin when
    `SUPABASE_URL` is set (a unit test of the CSP builder with the variable
    stubbed, because CI never sets it) and only `'self'` otherwise. All
    ticket routes export `POST = safeRoute(...)`, so T-SEC-012's route check
    stays as it is.

#### 22a. `tests/admin-http.test.ts` (Modify)

*   **Type / Scope**: Same-origin checks.
*   **Proposed Changes**: Adds the five ticket routes, including the JSON
    upload route, to the `calls` loop that posts from a foreign origin and
    from a null origin and expects 403 with no rows written.

#### 23. `scripts/scan-client-bundle.mjs` (Modify)

*   **Type / Scope**: CI script.
*   **Proposed Changes**:
    *   Adds `SUPABASE_SERVICE_KEY` to `SECRET_ENV`, so its value is
        searched for whenever it is set.
    *   Adds two patterns that work in CI, where the key is unset:
        `/\bsb_secret_[0-9A-Za-z_-]{10,}/` (Supabase secret keys) and
        `/eyJ[0-9A-Za-z_-]*InJvbGUiOiJzZXJ2aWNlX3JvbGUi/` (a JWT whose
        payload contains `"role":"service_role"`).

#### 24. `.github/workflows/ci.yml`, `.env.local` and `scripts/ci.sh` (Modify)

*   **Type / Scope**: CI configuration and local environment.
*   **Proposed Changes**: Sets `STORAGE_DRIVER=fake` in the workflow and in
    `.env.local`, and adds `STORAGE_DRIVER` to the required variables that
    `scripts/ci.sh` checks. No Supabase secrets in CI. `.env.local` is
    ignored by git (`.env.*` in `.gitignore`), so each developer adds the
    line locally.

#### 25. `docs/STATUS.md` and `docs/audit/12-evidence-and-verification-log.md` (Modify)

*   **Type / Scope**: Tracker and evidence log.
*   **Proposed Changes**: A new evidence entry with the CI run, the test
    counts, the mutation checks and the manual Supabase run. STATUS gets the
    completed items, test count, Stage 2 progress and decision count.

### Verification Plan

*   **Compilation/Build**: `npx tsc --noEmit` and `npx next build`, both run
    by `bash scripts/ci.sh`.
*   **Unit and integration tests**: `npx vitest run`, which runs
    `tests/tickets.test.ts`, the extended audit, T-SEC, admin-HTTP and
    foundation suites, and the catalogue gate.
*   **Static checks**: the drift gate, the unsafe-SQL ban and the
    client-bundle secret scan in `scripts/ci.sh`.
*   **Coverage requirement**: every T-TKT test that applies to Stage 2 has a
    named test (001–015, 019–022); the others are `test.todo` entries naming
    their stage.
*   **Mutation checks** (POC P5). A mutation check breaks one guarantee on
    purpose, confirms the named test fails, restores the code, and confirms
    the test passes. The results go in the evidence log, as for P2 and P3.

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | Exactly once | Remove `for update` and the version check from Act step 1 | T-TKT-006 |
    | All or nothing | Commit the status change in its own transaction before `apply` | T-TKT-007 |
    | No self-approval | Drop the raiser condition from `ticket_may_act` | T-TKT-010 |

*   **E2E**: the real-server smoke on a fresh database (CI). E2E also
    includes one **manual Supabase run**, the only place real storage is
    exercised:
    1.  Run `scripts/storage-setup.mjs` against a Supabase project.
    2.  Start `next dev` with `TICKET_TEST_HANDLER=1`, the Supabase
        variables, and item 18 applied to the local database.
    3.  Confirm the storage call shapes in §Storage, that Range requests are
        honoured, and that a second PUT to an existing key is refused.
    4.  Activate a `test.counter` type with two levels and
        `document_required`, upload a PDF, raise, approve at both levels,
        and download.
    5.  Record the results in the evidence log (DD-7).

*Drafted with EGM*
