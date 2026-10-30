# Approvals workbench: EGM step 9 implementation readiness report

**Reviewed:** commit 45ecbfd, 2026-10-30.

**Verdict:** ready with fixes. There are no blockers. The 0024 SQL matches `ticket_may_act` branch for branch. All the findings below are applied at build.

**Checked against the code:**
* The callers of `approvalQueue` (three tickets tests and the timing test) stay valid. Only the existing page breaks, because it passes a string cursor.
* `locate` throws `TicketNotFound` for a non-UUID id.
* `failApply` is a payload flag. `failRevalidate` throws `stale`.
* `withRequestContext` lives in `src/server/request-context.ts`.
* In `matrix-04`, line 17 is R-094.04 and line 62 is R-144.
* The definer inventory is sorted, so `actable_ticket_ids` goes second.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Major | The existing approvals page passes a string cursor, so the new signature breaks the build. | In W2, change it to `{ cursor }`; rewrite the page in W3. |
| R2 | Major | The 50-ticket timing would time failures: the test handler is not loaded and the payload has no key. | Load the handler, seed payload keys, and assert `done === 50`. |
| R3 | Major | The design does not say how to expire the session in the middle of a batch. | Add a test-local handler that expires the session in `revalidate`. |
| R4 | Major | The queue's key whitelist has no place in the code. | Add `QUEUE_KEYS`; any other key makes the filter invalid. |
| R5 | Major | The route's back path, redirect, button and item formats are not specified. | Build them with `URLSearchParams`; `name="action"`; `getAll("item")` plus a regex. |
| R6 | Minor | The item shapes at engine level are not stated. | Non-UUID counts as `forbidden`, a bad version as `invalid`, a duplicate as `conflict`. |
| R7 | Minor | The page's error display is not specified. | Use `ADMIN_MESSAGES[error] ?? ticket.invalid`. |
| R8 | Minor | A bad queue cursor used to throw, and now gives an empty page. | State the behaviour change. |
| R9 | Nit | A record cannot repeat a key, so the route test cannot post repeated `item`s that way. | Build `URLSearchParams` from pairs. |
| R10 | Nit | The Total card's link and "Select All" are not specified. | Total links without `type`. Select All is out of scope (no JavaScript). |

**Plan:**
* W1, docs: audit 09 T-AW rows; matrix lines 17 and 62; regenerate.
* W2, database and engine:
  * migration 0024;
  * `manageWhere(p, base)`, `cursorOf`, `QUEUE_KEYS`;
  * `approvalQueue`, `queueCards` and `bulkAct`;
  * the minimal page fix;
  * the inventory entry;
  * tests.
* W3: page rewrite, bulk route, smoke checks, timing.
* W4: 32 mutation checks:
  * each branch of the set;
  * the inventory and grant;
  * base, keys and cursor;
  * cards;
  * IST;
  * the counting buckets;
  * per-ticket transactions;
  * route repeated fields and the version regex;
  * origin.
