# Ticket / approval engine: input brief for `/egm:egm-draft`

Prepared 2026-10-27 from the audit pack, as **input** for an EGM draft session. This is not a design: the design doc is written by `/egm:egm-draft` and reviewed by `/egm:egm-review`.

Evidence classes: SRC = stated in a source, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC)
WF6 (*GEMS Workflows for Manager Review*, pp. 11–12):

> One engine sits under most of GEMS: a Ticket Type defines a code, priority, whether a document is mandatory and up to four approval levels, each tied to a named user or a role, plus viewers who can see but not act. A centre raises a ticket numbered prefix, type code, sequence (for example TK-26/CMC/23642) and it appears in the Tickets Approval queue of the level 1 approver, who can approve, reject with remarks or forward it to another employee. When the last level approves, the system applies the change itself. 31 ticket types exist today and 16,542 tickets have been raised, of which 2,412 are pending.

**Legacy scale** (SPEC p.38, FR-094.03): 16,542 tickets in total; 14,011 approved, 2,412 pending, 119 rejected, 2 forwarded.

**31 types** (FR-094.01), including:
- student corrections: FNC, LNC, MNC, GPC, FPC, SMS, GDR, EMC, GNC, NC;
- course/scheme/mode changes: CMC, CSC, CC;
- exam requests: EPA, EBPA, IERA, AERA, RSEDR/RSEDRC, …;
- supply payments: VPA, MPA.

## 2. Requirements in scope (traceability matrix)

| Req | What | Evidence |
|---|---|---|
| FR-094.01 | Ticket Type: name, type code, main/sub category, document mandatory/optional, approval type user/role based, priority, levels 1–4 each with approver (user or role) plus viewers/collaborators | SRC |
| FR-094.02 | Main/sub categories; ticket prefix with start and current counter (current 23,652); exam-request certification mapping | SRC |
| FR-094.03 | Centre ticket management: KPIs, filters (region, area, centre, status, priority, type), new ticket, lists, exports; ID `{prefix}/{typecode}/{seq}` | SRC |
| FR-094.04 | Approval list: bulk remarks, select all, approve / reject / forward (pick employee) / view; type-specific approval modals (e.g. course change) | SRC |
| FR-094.05 | Ticket report/summary; action history and details | SRC |
| FR-095, FR-096, FR-118, FR-140.06, FR-142.05, FR-144, FR-223 | Domain handlers and queues built on the engine (corrections, course mode, exam queues, voucher/material payments, approval dashboards) | SRC |

**Stage placement** (audit 10): the **engine core is Stage 2**. Full workflows (all 31 types, queues, SLA, dashboards) are Stage 5. Per-type domain handlers arrive with their modules (Stages 3–6).

## 3. Acceptance tests already defined (audit 09)
| ID | Expected |
|---|---|
| T-TKT-001 | Raise without a mandatory document: rejected |
| T-TKT-002 | Ticket number: format per NP policy; counter continuity (NP-8) |
| T-TKT-003 | Level-1 queue shows only in-scope tickets |
| T-TKT-004 | L1 approve on a 2-level type: level advances; no domain change |
| T-TKT-005 | Final approve: domain change applied exactly once; history row; audit row |
| T-TKT-006 | Concurrent final approvals: one application; the other gets a conflict |
| T-TKT-007 | `apply` throws: ticket stays at its level; domain unchanged |
| T-TKT-008 | Reject: remarks mandatory; centre notified |
| T-TKT-009 | Forward: only to an in-scope employee |
| T-TKT-010 | Self-approval: blocked (D-TKT-4) |
| T-TKT-011 | Stale request: re-validated at apply; rejected with reason |
| T-TKT-012 | Viewer: read-only |
| T-TKT-013 | Role-based level: resolved at action time |
| T-TKT-014 | History: immutable |
| T-TKT-015 | Re-raise: new ticket linked to the rejected one (D-TKT-2) |
| T-TKT-016 | SLA reminder job: idempotent per ticket per day |
| T-TKT-017 | Per-type handler: correct domain effect (one sub-case per type) |
| T-TKT-018 | Bulk approve: per-ticket transactions; failures isolated and reported |

POC P5 (audit 11): the domain change happens only on final approval; concurrent approvals apply once; an apply failure rolls back fully. **Failure conditions:** partial state; double application; self-approval allowed.

## 4. Open decisions (audit 04; all PMC, none approved)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-TKT-1 | Approvers and levels per type | Migrate the current configuration | Operations/PRO |
| D-TKT-2 | Rejected: reopen, or a new ticket | New ticket linked to the rejected one | Operations |
| D-TKT-3 | SLA and escalation | Reminders on, no auto-escalation | Operations |
| D-TKT-4 ⛔ | Self-approval | Prohibited | Operations |
| NP-1…8 | Numbering policy for ticket numbers (scope, reset, gaps, format, legacy counter continuation) | Unset | Accounts + Certification |

## 5. Platform the design must fit (already built and tested; E-014…E-022)
- **Scope and isolation:** row-level security on every table with `centre_id`; scope derives from the session in the database (`app.visible_centre_ids`, `app.has_permission(perm, centre)`); filters can only narrow.
- **Writes:** `scopedAction()` = authorize → change → audit, in one transaction; denials are audited separately. Privileged writes are security-definer functions that recheck permission in the database (the RBAC pattern, migration 0005).
- **Audit:** only via `app.audit()` (actor, roles, scope, request id, IP, before/after, reason; redaction). Every new audit action must be added to `tests/audit-catalogue.ts` with a test, or CI fails.
- **Numbering:** `number_series` row-lock allocator inside the business transaction; policy (NP-1…8) stays a parameter.
- **Step-up:** `session_step_up_fresh()` for sensitive actions (RBAC uses 5 minutes).
- **HTTP:** same-origin POST route handlers through `safeRoute`; 404 for out-of-scope records (no existence oracle).
- **Tests:** `bash scripts/ci.sh` is green on every push (fresh DB, drift gate, real-server smoke).

## 6. Questions the design should answer explicitly
1. **Handler contract:** how a ticket type's domain effect (`validate` at raise, `revalidate` + `apply` at final approval) plugs in, while staying transactional and exactly-once.
2. **Approver resolution:** a level's approver is a named user or a role, resolved at action time (T-TKT-013), and must be in scope for the ticket's centre. What does "in scope" mean for a role-based level?
3. **Ticket numbering** without approved NP policy: format and series as parameters.
4. **Forward semantics:** does forwarding change the level? Who may forward, and to whom?
5. **Data model:** ticket, type, level configuration, history (immutable), viewers, documents (uploads do not exist yet).
6. **What Stage 2 delivers (core + one reference handler?)** versus what waits for Stage 5 and the domain modules.
7. **Migration of 16,542 legacy tickets, including 2,412 pending** (D-MIG; legacy DB access still blocked).
