# EGM Stage 7: Critic report (correction tickets)

- **Target:** `docs/designs/correction-tickets/correction-tickets.md` (commit `3425172`, after steps 5–6).
- **Reviewer:** `egm-design` (fresh context, adversarial). Read the design, both reports, `src/server/tickets/*`, `admin-http.ts`, `action.ts`, `db.ts`, `people.ts`, `person-rules.ts`, `app/tickets/**`, the ticket-type save route, migrations 0009 and 0011, `tests/tickets.test.ts`, the ticket-engine design (DD-7, DD-9, DD-14, DD-16, Q2, numbering), ADR-002.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 6 Major, 8 Nit** (D1–D14); OWNER on D3, D4, D5, D10, D11. Verdict: right size, sound in most parts; not ready before the contract fixes and the owner's calls on exposure and numbering.
- **Held up:** no deadlock cycle (ticket → type → person; details and admit lock person then details, never tickets); retries replay only database work; concurrent approvals on one field correctly stale; ticket centre, `ticket_may_act` and `assertAdmittedAt` agree; self-approval and distinct approvers enforced in SQL; no probe for users without `student.view`; one class identity through the `errors.ts` re-export; URL details carry fixed keys only.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major | Re-raise checks ran after `prepare`: a non-raiser could learn which learner a ticket concerns | Re-raise source read and status/raiser checks moved ahead of `parse`/`prepare`; test |
| D2 | Major | A failing `review` would abort `getTicket`'s transaction | `ticketReview()` in its own `withScope`; only non-connection, non-scope errors caught |
| D3 | Major, OWNER | Old/new values visible to ticket viewers without `student.view`; payload never erasable | **Owner: hidden from them (DD-16);** `canSeeValues`; T-COR-006 |
| D4 | Major, OWNER | Duplicate lines disclose other learners' names and DOB across the approver's scope | **Owner: Admission No and centre, audited (DD-17);** name/DOB only with `student.view` |
| D5 | Major, OWNER | New types would restart numbering, colliding with legacy numbers (NP-8) | **Owner: gate until NP is signed (DD-18):** `numberingSigned` |
| D6 | Major | The proof gate failed open (env-based) and missed uploads | Fail closed in every environment for identity types; guard in `requestUpload` |
| D7 | Nit | `changeIdentity` skips the match-key advisory lock | `apply` takes it for key fields |
| D8 | Nit | Stale or format-failed tickets stuck with a generic error | `revalidate` re-checks the format → stale `format` with a reject hint |
| D9 | Nit | Old tickets may meet a changed handler | `source` shape checked; `describe` falls back on error |
| D10 | Nit, OWNER | "HO approves" only by configuration | Setup guidance and a Risks row |
| D11 | Nit, OWNER | Proof-less running departs from R-095 | **Owner: recorded deviation (DD-19)** |
| D12 | Nit | `test-handler.ts` import; flag override mechanism unnamed | `test-handler` imports `errors.ts`; mutable `TICKET_GATES` |
| D13 | Nit | Identity-specific fallback text in the generic engine | "Review unavailable" |
| D14 | Nit | Hard-to-change-later items unrecorded | Legacy pending, merges, multi-field codes in Non-Goals |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: D3 → DD-16, D4 → DD-17, D5 → DD-18, D11 → DD-19; D10 recorded as guidance. All fourteen applied.
