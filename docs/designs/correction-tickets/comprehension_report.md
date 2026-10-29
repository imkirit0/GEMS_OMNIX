# EGM Stage 6: Comprehension report (correction tickets)

- **Target:** `docs/designs/correction-tickets/correction-tickets.md` (commit `b880af8`, after step 5).
- **Reviewer:** `egm-comprehension` (fresh context, naive reader). Read the design, the step 5 report, `tickets/handlers.ts`, `engine.ts`, `setup.ts`, `policy.ts`, `test-handler.ts`, `admin-http.ts`, `app/tickets/new`, `app/tickets/create/route.ts`, `app/tickets/[id]`, `app/admin/ticket-types/**`, `people.ts`, `person-rules.ts`, `tests/tickets.test.ts`, the ticket-engine design, migrations 0002 and 0011.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 12 Major, 7 Nit** (C1–C19); OWNER on C19 and C8. Verdict: right size; not buildable without the exact contracts.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Major | Parse key `admissionNo: required` did not match the message list | Keys unified (`admissionNo.required`); over 40 characters → `admission.unknown` |
| C2 | Major | Empty check vs `identityField` order (`identityField("mobile", "")` throws) | Empty handled first; only non-empty values through `identityField` |
| C3 | Major | Payload types and the `prepare` contract undefined | `TicketHandler<P, R = P>`; `R`, `P` and the call order in `raise()` stated |
| C4 | Major | How invalid keys reach the raise page | `adminPost` detail for `invalid`; `raiseOptions` carries `invalidMessages`; page lookup by type or source ticket |
| C5 | Major | `review`/`describe` cannot reach the handler from the ticket page | `getTicket` selects `handler_key`, returns `reviewLines`; a throwing review becomes one line |
| C6 | Major | The proof gate bypassable through `updateType` | `updateType` refuses ticking "document required" on an active type under the same condition |
| C7 | Major | Gate form underspecified (message, env read time, preview, layer) | Call-time `VERCEL_ENV`, `documentsLive()` injectable, admin message, Preview not gated |
| C8 | Major, OWNER | Stale lifecycle and re-raise unspecified | Approver rejects; re-raise reads the value afresh; **owner: same learner only (DD-15)**; approver-facing stale text |
| C9 | Major | "No duplicates" when the match key is null | "Duplicate check not possible" line |
| C10 | Major | Import cycle unsafe with top-level registration | `errors.ts` without imports; identity handlers import it, not `handlers.ts` |
| C11 | Major | `select <column>` impossible as a tagged template; type mismatch | One static read of the six columns as text |
| C12 | Nit | `has_permission` call and its reason not given | Given, with the RLS reason |
| C13 | Nit | Order of checks not stated | "Order of Checks" section |
| C14 | Nit | Stored JSON and `describe` labels not shown | Example payload; label map; `(empty)` |
| C15 | Nit | `select` contract loose; preselection | Union type; `required`; gender options; preselection noted |
| C16 | Nit | Field labels missing | Given |
| C17 | Nit | Terms table stale; PRO ambiguous | Updated; PRO defined |
| C18 | Nit | Admission No case sensitivity | Exact match, as stored |
| C19 | Major, OWNER | Engine DD-16 go-live items not covered by the gate | **Owner: ADR-002 and DD-16 both (DD-14);** `documentsLive` flag, injectable for tests |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: C19 → DD-14, C8 → DD-15. All 19 applied; the Technical Plan was rewritten with the contracts.
