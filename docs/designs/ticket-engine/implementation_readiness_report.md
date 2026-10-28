# EGM Stage 9: Implementation Readiness report

- **Target:** `docs/designs/ticket-engine/ticket-engine.md`, DetailedRange (lines 1070..1505 as of commit `1cd516f`)
- **Reviewers (fresh context, in parallel):**
  - `egm-implementation-readiness`: 0 Blocker, 10 Major, 8 Nit (IR1 to IR18)
  - `egm-codebase-details`: 4 Blocker, 9 Major, 8 Nit (CD1 to CD21). It checked every claim against the code.
  - `egm-style`: 2 Blocker, 10 Major, 3 Nit (W1 to W15)
- **Total:** 54 findings: **6 Blocker**, 29 Major, 19 Nit. Both content reviewers judged the plan "not ready".
- **Date:** 2026-10-28.

**Status: resolved (2026-10-28).** The owner said "apply all fixes when the reviews are done". No finding was contested. None changed an owner decision; they correct the plan against the real code or fill gaps. The Detailed Implementation Plan was rewritten, and the Technical Plan was corrected where the findings reached it.

## Blockers

| ID | Finding | Resolution |
|---|---|---|
| CD1 | Ids were "identity"; the code uses `SERIAL`/`BIGSERIAL`. No sequence `usage` grants, so inserts by `gems_app` fail with 42501 | Data model says `serial`/`bigserial` (`@default(autoincrement())`). Item 4 step 12 and §Grants add `usage` on every sequence `gems_app` inserts into |
| CD2 | The document route was GET, but T-SEC-012 requires `export const POST = safeRoute(` on every route | The download is now a same-origin **POST** form, like the export downloads (which avoid cross-site GETs for the same reason). The T-SEC check is unchanged |
| CD3 = IR2 | The catalogue gate's scanner never reads the ticket files, so adding 15 actions fails equality; permission keys that equal action names pass trivially | Item 21 extends the `action:`-slice scan to `engine.ts` and `setup.ts`. Actions must be literals on `action:` lines (no ternaries; `setTypeActive` makes two separate calls). Item 19 asserts every action by its audit row |
| CD4 = IR9 | `reset()` truncates `app.permission`, wiping the ticket permissions, and never clears `ticket_number_series`. There are no shared session or step-up helpers | Item 20: re-seed the five permissions, truncate the ticket tables and the counter, add the ticket roles, and move the `session`/`stepUp` helpers into `fixtures.ts` |
| W1 | Item 14 described four pages in one sentence with three-deep parentheses | One sub-bullet per page; re-raise behaviour split out |
| W2 | Item 9 used passive voice and an ambiguous "it" for two drivers | Rewritten per driver, with the actor named; "the manual Supabase run" defined |

## Major

| ID | Finding | Resolution |
|---|---|---|
| IR1 | "Every step stays green" was false given the item dependencies | Five **build phases** (P1 to P5), with CI green at the end of each |
| IR3 | `pageRead()` does not map `TicketNotFound`, so a hidden ticket gives 500 | New item 12a: `pageRead()` maps it to `notFound()`; the download route maps it to 404 |
| IR4 | Idempotent raise collided with the `ticket_level` guard; return value and other-raiser case missing | §Idempotent raise: an existence pre-read (no write, no audit), then `TicketDuplicate` on a racing `ticket_pkey` 23505, then a redirect. `raise` returns `{id, created}` |
| IR5 = CD6 | "P2002" is wrong for raw SQL; the repo reads SQLSTATE through `db()` | New §Database errors table (23505 per constraint, 42501; guard refusals unmapped) using `db()` from `rbac.ts` |
| IR6 | Setup refusals had no error codes, and the signatures omitted `session` | Item 8 refusal table (`RbacError` with message keys); every signature takes `session` |
| IR7 | No primary key for `ticket_type_level` or `ticket_type_viewer` (Prisma needs one) | Level PK `(type_id, level)`; viewer serial id plus unique `(type_id, user_id)` and `(type_id, role_id)` |
| IR8 = CD8 | `storage-setup.mjs` cannot import `TICKET_POLICY` from `engine.ts` | New dependency-free `src/server/tickets/policy.ts` (item 6b) with `{mime, signature}` pairs; Node 24.19 runs it directly |
| IR10 | The failure hook had no tests; `audit()` type; `level` source | Item 11a widens the type, keeps meta's target, and does not mask the original error. `ApplyFailed(level, cause)`. Item 19 adds three hook tests |
| CD5 | Wrapping `apply` errors loses P2034 | Item 7 states P2034 passes through, matching the Technical Plan |
| CD7 | `adminWrite` and `db()` already exist in `rbac.ts` | Item 11 exports and reuses them for setup and reassign |
| CD9 | Same-origin checks live in `admin-http.test.ts`, not `sec.test.ts` | New item 22a adds the five ticket routes to that loop |
| CD10 | `adminPost` cannot append `&detail=` | Item 12: `stale` appends `&detail=${encodeURIComponent(e.message)}` |
| CD11 = IR13 | The `forbidden` hint is shown by four RBAC pages that were not listed | `rbac.forbidden` key; the four pages are listed in item 12a; all message texts are given |
| CD12 | `gems_app` cannot read other users' names without `rbac.view` | New definer function `app.ticket_people(ticket)` for names; setup pickers require `rbac.view` (stated) |
| CD13 | Test handler registration was ambiguous | Tests mutate `HANDLERS`; the environment flag is only for the manual Supabase run; the load-guard test uses `vi.stubEnv` + `vi.resetModules()` + a dynamic import |
| W3 | One procedure had six names | "manual Supabase run" throughout, defined in the Verification Plan |
| W4 | Terms drifted (`handlerKey`/`handler_key`, target, administrator) | `handlerKey` in TypeScript, the column name in SQL; "reassign target"; "`ticket.type.manage` holder" |
| W5 | Cross-references read as plain nouns | `§Section` form |
| W6 | "raised" used for errors; who registers the test handler | "thrown"; registration rewritten (CD13) |
| W7 | Item 11a used passive voice and an ambiguous "it" | Rewritten with `scopedAction()` as the subject |
| W8 | Mixed grammatical mood; the record list chained with semicolons | Descriptive mood; sub-bullets |
| W9 | The item 7 Writes bullet was overloaded | One sub-bullet per function |
| W10 | The over-length rule was ambiguous | Spelled out as `{prefix}/{typeCode}/{seq}` with a 10-digit `seq` |
| W11 | Unclear pronouns; a garden-path sentence in item 19 | Rewritten as suggested |
| W12 | Five routes in one sentence | One sub-bullet per route |

## Nit

| ID | Resolution |
|---|---|
| IR11 | `ApplyFailed` lives in `handlers.ts`, in both places |
| IR12 | Reassign omits `centreId` (ALL scope only); pre-read needs only RLS. `requestUpload` permission stated |
| IR14 | Success and error redirects stated; both lists share one cursor format; loss of typed values accepted for Stage 2 |
| IR15 | `head()` shape and missing-object case; fake driver test API; absolute upload URL; lazy driver choice; streamed-read cut-off |
| IR16 | Indexes listed; `set search_path` on every definer function; the test handler's `validate`; RAISE event level is 1 (§Data model note 3 already says events record the level acted at) |
| IR17 | Missing tests added (setup refusals, viewer gets forbidden, level guard, CSP with `SUPABASE_URL` stubbed); deferred parts of T-TKT-002/008 marked in audit 09; matrix `tests` column updated |
| IR18 | Mutation checks named in a table |
| CD14 | Covered in item 11a |
| CD15 | New `app.ticket_immutable()` naming the table; truncate trigger added |
| CD16 | `(select app.has_permission(...))` form required |
| CD17 | `user_centre_ids` is `security definer` with a fixed `search_path`, so it belongs in the T-RLS-005 inventory |
| CD18 | `ADD VALUE 'FAILED'` first; nothing else in 0009 uses it |
| CD19 | `SUPABASE_SERVICE_KEY` added to `SECRET_ENV`, plus two exact patterns |
| CD20 | `STORAGE_DRIVER` added to the required variables in `ci.sh`; an unset driver fails on first use |
| CD21 | The upload and download routes follow `app/export/[dataset]/route.ts` |
| W13 to W15 | Passive voice, line wrapping, `TICKET_POLICY` as a list, and vague references fixed as suggested |

## Re-audit (2026-10-28)

The one allowed Stage 9 re-audit was run by the same three reviewer types, fresh, on the rewritten plan (lines 1099..1744 at `6cf9805`):
- readiness: 3 Blocker, 7 Major, 8 Nit (RA1 to RA18)
- codebase: 3 Blocker, 7 Major, 8 Nit (RC1 to RC18)
- style: 0 Blocker, 6 Major, 14 Nit (RW1 to RW20)

That makes 56 findings, of which **6 are blockers**. Two blockers were found independently by both content reviewers. Most prior findings were confirmed fixed. The style reviewer confirmed W1–W15 except W4, which was only partly fixed (RW2). The content reviewers named IR1, IR2/CD3, IR5/CD6, CD4/IR9, CD9, IR15 and IR17 as only partly resolved, and the fixes below complete them.

**Status: resolved (2026-10-28).** All were applied under the owner's instruction "apply all fixes when the reviews are done". The re-audit cap is now reached, so Stage 9 runs no further reviews. The fixes have not been reviewed again.

| Finding | Resolution |
|---|---|
| RA1 (blocker) | `select … for share` on `ticket_type` is filtered by the setup tables' UPDATE policy, so the row vanished for everyone without `ticket.type.manage`. Locking now goes through a new definer function, `app.ticket_type_lock(type)`, added to §Eligibility, item 4 and the T-RLS-005 inventory, with a test that a non-admin raiser and approver can raise and give the last-level approval |
| RA2 (blocker) | `form-action 'self'` would block the download's 303 to Supabase. `buildCsp` adds the Supabase origin to `form-action` as well as `connect-src`, and the manual run confirms the redirect is followed |
| RA3 = RC1 (blocker) | `db()` cannot tell constraints apart. The new `ticketDb()` in the engine reads the constraint name from `originalMessage`, maps the rows in order and rethrows the rest. `db()` stays for setup and reassign only |
| RC2 = RA6 (blocker) | The fake driver moves to its own module, `storage-fake.ts` (item 9b), which throws at import on Vercel. `storage.ts` imports it lazily, and the test imports it directly |
| RC3 (blocker) | The helper names were false. The real helpers are `setStepUp(token, ageSeconds)` and `newSession(userId, token)`, plus `rows(action)`, and they move into `fixtures.ts` under those names |
| RA4 = RC4, RW1 | Item 6b, item 9b and item 24 (`STORAGE_DRIVER=fake`) moved into P3 |
| RA5 | Item 3 regenerates and commits the FRD, which `ci.sh` compares against the matrix |
| RA7 = RC6 | Item 13 exports `buildCsp`, and item 22 unit-tests it |
| RA8 | Item 20 has a fixture table of users, tokens, roles, permissions and scopes; existing fixtures are unchanged |
| RA9, RC14 | `act()` writes its action as a literal ternary on one `action:` line; the scan pattern is `/"(ticket\.[a-z0-9_.]+)"/`, with `action:` before `permission:` |
| RA10 = RC10 | 404 parity is specified: the smoke fixture insert order, the three pages compared, the `normal()` rules, plus `getTicket` cases in the unit tests |
| RC5 | `adminPost` accepts `back` as a function of the posted fields |
| RC7 | The service-role check decodes every JWT-shaped string instead of using a fixed base64 pattern |
| RC8 | Added `raiseOptions`, `listTypes` and `getType` |
| RC9 = RA13 | All seven new POST routes go in the same-origin loop, and `count()` includes the ticket tables |
| RA11–RA18, RC11–RC18 | Absolute URLs and the fake URL format; the `RbacError` key mapping; delete refusal by grant vs trigger; `to_regclass` and `create table if not exists`; 22P02 → `invalid`; a document not on the ticket → 404; `test.counter` `parse`; the safe import cycle; `canReassign` and reassign form fields; `getAll("uploadId")`; the DENIED-path change acknowledged and tested; `rows()` reuse; NP notes go in the grouped row; `FAILED` in schema.prisma; DDL generated with `prisma migrate diff`; ticket-specific fallback and duplicate texts; `select` grant listed |
| RW2–RW20 | Terms, pronouns, overloaded bullets split, time-relative words, cross-references, list punctuation and quote punctuation, as suggested |
