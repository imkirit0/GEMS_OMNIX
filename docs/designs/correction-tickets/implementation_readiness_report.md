# EGM Stage 9: Implementation readiness report (correction tickets)

- **Target:** `docs/designs/correction-tickets/correction-tickets.md` (commit `64c8f02`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check). Read the design and every file it changes or depends on (tickets engine, handlers, setup, policy, test handler, admin-http, action, db, page-read, people, person-rules, `app/tickets/**`, `app/admin/ticket-types/**`, migrations 0009 and 0011, `tests/tickets.test.ts`, `tests/fixtures.ts`, `tests/audit*.ts`, `scripts/smoke-security.mjs`, `scripts/scan-client-bundle.mjs`, audit 09, the R-095 matrix row, the ticket-engine design).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 8 Major, 11 Nit** (R1–R19); no OWNER items. Verdict: ready to build once the Majors are in the design.
- **Confirmed against the code:** the `errors.ts` move keeps every importer working with `export *` (`isolatedModules`); a one-line `scopedAction` meta passes the T-AUD-009 scan; the gates affect only `tests/tickets.test.ts` (both opened in its `beforeAll`) and the manual Supabase run (R5; verified); the smoke's SQL-inserted ticket type passes no gate; `payload: null` breaks no test or page; `approverMatches` rows are readable under RLS without `student.view`; an approver with only `ticket.approve` can apply through `changeIdentity`; no client bundle reaches server code; no fixture change is needed (grants in the test).

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | Major | A failing review cannot be audited inside its own aborted transaction | Catch outside `scopedAction`; `onFailure` writes FAILED in a fresh transaction; lost connection, `ScopeError`, `Forbidden` rethrown |
| R2 | Major | No recipe for "a review whose SQL fails" and "apply meets a PersonError" | `test.review` handler with `select 1/0`; an OPEN identity ticket at A for a person admitted only at B |
| R3 | Major | Where `describe` runs and its fallback | In `getTicket`: `described` (caught), `payload | null`, `hasReview`; page renders from them |
| R4 | Major | `revalidate` with no person row | Missing row → stale `changed` |
| R5 | Major | The manual Supabase run uploads, so a closed gate breaks it (verified) | Usage note: open `documentsLive` locally, never commit; a committed-defaults test |
| R6 | Major | Gate order and the `updateType` condition | After the existing checks; numbering before storage; exact conditions given |
| R7 | Major | C1 omits regeneration and the matrix's column rules | R-095 tests and details edited; both generators run |
| R8 | Major | Page-level expectations untestable in vitest | vitest asserts route locations and `getTicket` fields; rendered text in the smoke |
| R9–R19 | Nit | Normalised `newValue`; camelCase aliases; empty `validate`; local `IdentityKey`; `IdentityChanges` cast; `approverMatches` excludes the person; `ticketReview` checks `ticket_may_act`; `apply` re-reads identity; the handler trusts its own field constant; engine messages in `detail` harmless; the advisory lock untested | Applied; R18 accepted; R19 recorded as untested |

## File-by-file plan (each phase ends with `bash scripts/ci.sh` exit 0)

### C1 Documents
1. `docs/audit/09-test-strategy-and-acceptance-criteria.md`: `### T-COR: correction tickets` after T-LD, rows T-COR-001…006 from the design.
2. `docs/audit/data/matrix-04-logs-tickets-exams-supply.tsv` (R-095): tests += `T-COR-001…006`; details += `; until ADR-002, proof-less correction types may go live (correction-tickets DD-19: temporary deviation, PRO to confirm)`; 17 cells.
3. Regenerate and commit the matrix CSV and the FRD.

### C2 Engine
1. `src/server/tickets/errors.ts` (new, no imports): the five error types moved verbatim from `handlers.ts`.
2. `handlers.ts`: `export * from "./errors"`; the design's `TicketField` and `TicketHandler<P, R = P>`; comment updated.
3. `test-handler.ts`: imports `TicketError` from `./errors`, the type from `./handlers`.
4. `policy.ts`: mutable `TICKET_GATES = { numberingSigned: false, documentsLive: false }` and `gateRefusal()` (numbering first).
5. `setup.ts`: `setTypeActive` gate after the existing handler and levels check; `updateType`: `before.active && u.documentRequired && !before.document_required && !TICKET_GATES.documentsLive` → `ticket.setup.storage`.
6. `admin-http.ts`: `detail` also for `invalid`; `ADMIN_MESSAGES["ticket.setup.numbering"]`, `["ticket.setup.storage"]`.
7. `engine.ts`: `requestUpload` gate first in the `inactive` condition; `raise` reordered (re-raise source `for update` and checks first, then `parse`, `prepare`, `validate`, …); `getTicket` with `handlerKey`, visibility, `described`, `hasReview`; `ticketReview(session, id): Promise<string[]>` (one-line meta; `ticket_may_act` check; `onFailure`; outer catch).
8. `tests/audit-catalogue.ts`: `"ticket.review.duplicates"`.
9. `tests/tickets.test.ts`: both gates opened in `beforeAll`.
10. `tests/corrections.test.ts` (new): committed defaults; T-COR-005 (refusal and success for each site, `ticket_upload` rows 0); T-COR-004 engine part (`test.review`: OK row with `matches`; `1/0` → "Review unavailable" and a FAILED row; lost connection rejects; approval still works); T-COR-006 engine part (viewer null, raiser with role 17 and `TK.l1` see it, a throwing `describe` → `described` null); a route case for `detail`.

### C3 Handlers
1. `src/server/people.ts`: `approverMatches(tx, key, personId)` (`p.match_key = key`, `p.id <> personId`, `a.centre_id = any (app.scoped_centre_ids('ticket.approve'))`, `named` per admission; ordered by Admission No).
2. `src/server/tickets/identity-handlers.ts` (new): local `IdentityKey`; the factory with `readIdentity(tx, id, lock)` (camelCase aliases), `corrected()`; `parse` storing the normalised value; `prepare` steps 1–4; `validate(){}`; `revalidate` (missing row → stale); `apply` (re-read, advisory lock when the key is not null, `changeIdentity(... as IdentityChanges)`, field names only); `review` for name, DOB and mobile; `describe`; `invalidMessages`; `staleMessages`; `valuesPermission`; `IDENTITY_HANDLERS`.
3. `handlers.ts`: registers `IDENTITY_HANDLERS` at the top level; comments in `handlers.ts` and `engine.ts` updated.
4. `tests/corrections.test.ts`: T-COR-001…004, 006 with the real handlers (types by SQL; learners by SQL; grants in the test: role 17 to `TK.raiser` at A, role 11 to `TK.l1` at B, role 16 to `TK.l1` at A2); the concurrent T-COR-002 case with an admin-held person lock; the PersonError recipe; every thrown key present in `invalidMessages`.

### C4 Pages and evidence
1. `app/tickets/new/page.tsx`: invalid text by handler scan; `select` fields.
2. `app/tickets/[id]/page.tsx`: "Request hidden" / described table / JSON; `ticketReview` lines under "Duplicate check" when `canAct && hasReview`.
3. `scripts/smoke-security.mjs`: an active `identity.givenName` and gender type by SQL; raise page shows the select; an unknown Admission No → `detail=admission.unknown` and its text; a valid raise 303; the approver sees the described table and a duplicate line, one review audit row; a viewer without `student.view` sees "Request hidden".
4. `scripts/manual-supabase-run.mts`: the gate note in the header.
5. Evidence E-039 (CI, mutation checks, R19 untested, T-COR-003's "same transaction" holds by construction).

## Mutation checks

| # | Mutation | File | Must fail |
|---|---|---|---|
| 1 | `gateRefusal` always null | policy.ts | T-COR-005 |
| 2 | `numberingSigned: true` committed | policy.ts | committed-defaults check |
| 3 | No `requestUpload` gate | engine.ts | T-COR-005 upload |
| 4 | No `updateType` storage gate | setup.ts | T-COR-005 |
| 5 | No `student.view` check in `prepare` | identity-handlers.ts | T-COR-001 |
| 6 | Admission lookup without the centre | identity-handlers.ts | T-COR-001 |
| 7 | No re-raise person check | identity-handlers.ts | T-COR-002 |
| 8 | Raiser check after `prepare` | engine.ts | T-COR-002 non-raiser |
| 9 | No `for update` in `revalidate` | identity-handlers.ts | T-COR-002 concurrent |
| 10 | No `oldValue` comparison / format re-check | identity-handlers.ts | T-COR-002 |
| 11 | Raw value kept, or `""` for clearable | identity-handlers.ts | T-COR-001 |
| 12 | Values in apply's before/after | identity-handlers.ts | T-COR-003 |
| 13 | `named` ignored | identity-handlers.ts / people.ts | T-COR-004 |
| 14 | `approverMatches` by `visible_centre_ids()` | people.ts | T-COR-004 (A2 member-only match) |
| 15 | No `p.id <> personId` | people.ts | T-COR-004 none case |
| 16 | `ticketReview` without `onFailure` / catch inside | engine.ts | T-COR-004 FAILED row |
| 17 | Lost connection swallowed | engine.ts | T-COR-004 |
| 18 | `valuesPermission` ignored | engine.ts | T-COR-006 |
| 19 | Payload always null | engine.ts | T-COR-006 positive controls |
| 20 | No catch around `describe` | engine.ts | T-COR-006 |
| 21 | No invalid `detail` in `adminPost` | admin-http.ts | route case |
| 22 | One `invalidMessages` entry deleted | identity-handlers.ts | message coverage |
| 23 | `lockHandler`'s `!handler` throw or the `VERCEL_ENV` throw removed | engine.ts / handlers.ts | existing tests |
| 24 | Review action not catalogued | audit-catalogue.ts | T-AUD-009 |

## Resolution

**Status: resolved (2026-10-29).** All findings applied in the design (contract notes) and this plan; EGM review complete; awaiting the owner's build approval.
