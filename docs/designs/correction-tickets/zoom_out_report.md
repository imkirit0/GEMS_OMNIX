# EGM Stage 5: Zoom-Out report (correction tickets)

- **Target:** `docs/designs/correction-tickets/correction-tickets.md` (commit `8954419`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Read the design, the brief, `tickets/handlers.ts`, `engine.ts`, `test-handler.ts`, `setup.ts`, `app/tickets/new`, `app/tickets/[id]`, `admin-http.ts`, `app/tickets/create/route.ts`, `people.ts`, `person-rules.ts`, `db.ts`, migrations 0002, 0009, 0011, `tests/tickets.test.ts`, the ticket-engine design, ADR-002.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major, 5 Nit** (Z1–Z9); OWNER on Z2, Z3, Z9 (and Z4 by choice). Verdict: right size (one factory, `changeIdentity` reused, no migration); `prepare` and `review` justified, `select` small, `describe` optional. RLS confirmed workable for raiser and approver.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major | Concurrent approvals of two tickets on one learner: `revalidate` read without the person lock (READ COMMITTED), so the second overwrites the first | `revalidate` reads `for update` on the person row; concurrent case in T-COR-002 |
| Z2 | Major, OWNER | Duplicate list scoped by `student.view`, which an approver may lack: silently empty | **Owner: the approver's `ticket.approve` scope (DD-10);** an explicit "none" line; test approver without `student.view` |
| Z3 | Major, OWNER | Registering handlers ends "empty in production" and the test-harness screens; proof types need ADR-002 (Proposed) | **Owner: proof types gated on ADR-002 (DD-11)** in `setTypeActive`; screens become production; comments updated; T-COR-005 |
| Z4 | Major | The specified raise messages never reach users (generic text) | **Owner: show the specific reason (DD-12):** `invalidMessages` fixed list, passed like stale messages |
| Z5 | Nit | `prepare` is a `validate` that returns | Kept as DD-4 (owner decision) |
| Z6 | Nit | `describe` cosmetic | Kept (DD-6, owner-accepted) |
| Z7 | Nit | Import cycle handlers ↔ identity-handlers | `TicketError` only inside functions, stated |
| Z8 | Nit | Which fields may be cleared unclear | givenName, dateOfBirth, gender required; familyName, mobile, email may be cleared; gender select without an empty option |
| Z9 | Nit, OWNER | Raising reveals current values without `student.view` | **Owner: require `student.view` (DD-13);** same answer as an unknown number |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: Z2 → DD-10, Z3 → DD-11, Z4 → DD-12, Z9 → DD-13. All nine applied (Z5, Z6 kept by owner decision).
