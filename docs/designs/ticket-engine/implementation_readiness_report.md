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
