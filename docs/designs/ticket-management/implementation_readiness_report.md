# Ticket management: EGM step 9 implementation readiness report

**Reviewed:** commit c25914d, 2026-10-30.

**Verdict:** ready once the fixes are applied. There are no blockers, 7 major findings and 8 nits; all were applied at build. These claims were checked and hold:
* `TicketError` stays in use.
* `listTickets` has two callers, and the test caller stays valid.
* `ty.priority` has type `app."TicketPriority"`.
* A reassign writes `{admin: true}`.
* RLS facts: geo is open; centre and event visibility follow `visible_centre_ids`.
* T-DOC-001 needs the T-TM ids defined in audit 09.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Major | `page()` is typed `TicketListRow[]`, so the area and region fields are lost and the build breaks. | Make `page` generic. |
| R2 | Major | The guard refuses changes to `created_at`, so the IST test cannot backdate tickets. | Backdate as admin under `session_replication_role = replica`. |
| R3 | Major | Repeated GET parameters arrive as arrays: a 500, or a widened filter. | `parseFilter` refuses anything that is not a string. Test it and add a smoke check. |
| R4 | Major | `""` means "not given" in one place and "invalid" in a test. | `""` means not given; the test uses `" 1"` instead. |
| R5 | Major | The options query shape is open, which risks four scans. | One distinct scan of (centre, type), then lookups by id. |
| R6 | Major | `Date.parse` accepts 2026-02-30. | Exact round-trip expression. The same latent bug exists in `listEnquiries`. |
| R7 | Major | The timing run has no home, user or seed. | `tests/ticket-timing.test.ts`, skipped unless `TICKET_TIMING`; seed as admin; an ALL-scope reviewer; median of 5 runs; EXPLAIN as gems_app. |
| R8 | Nit | Reassign needs a step-up. | `setStepUp`. |
| R9 | Nit | `raiseAt` hard-codes centre A. | Pass `centreId` in `extra`; grant first. |
| R10 | Nit | No test shows the type picker hides types. | A type raised only at B. |
| R11 | Nit | A selected value that is not an option is not shown. | Render an extra option. |
| R12 | Nit | Number escaping. | Build the pattern in JS. Test that `TK_26` and `TK%` match nothing. |
| R13 | Nit | `count` returns bigint. | `::int` casts. |
| R14 | Nit | The smoke checks have no position or assertions. | After the T-SEC-001 block, with explicit markers. |
| R15 | Nit | An invalid filter returns before the session check. | Parse inside `withScope`. |

**Plan:**
* **T1, docs:** audit 09 T-TM; `matrix-04` lines 16 (R-094.03) and 18 (R-094.05); regenerate.
* **T2, server and tests:** `engine.ts` (generic `page`, `parseFilter`, the three reads); `tests/ticket-management.test.ts`.
* **T3, page, smoke and timing:** `app/tickets/page.tsx`; smoke checks; `tests/ticket-timing.test.ts`.
* **T4:** 26 mutation checks:
  * visibility in the summary and in the options;
  * every filter;
  * the IST bounds;
  * escaping, `ilike` and prefix matching;
  * the forwarded rules;
  * invalid inputs, arrays and the cursor.
