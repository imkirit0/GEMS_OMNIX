# 12 Evidence and verification log

Append-only. Each entry records what was run or read, when, and the exact result. Nothing outside this log counts as verification.

## Summary as of 2026-10-26
| Category | Count |
|---|---|
| Application tests written | **0** |
| Application tests run | **0** |
| Documentation checks run | 1 (T-DOC-001), passing |
| Requirements in VER state | **0** |

## E-001 Repository inspection (2026-10-26)
- Command: `Get-ChildItem -Force -Recurse "D:\GEMS OMNIX"`; `git -C "D:\GEMS OMNIX" status`.
- Result:
  - The folder contains only the 2 PDFs.
  - Git reports `fatal: not a git repository`.
  - `docs/` was absent before this work.

## E-002 Source documents read in full
| File | Pages | SHA-256 |
|---|---|---|
| `D:\GEMS OMNIX\GEMS ERP Rebuild Specification.pdf` | 57 | 9074836f3fffad6d773682e90a66a114caef356e9557612a439e7f6b827262f1 |
| `D:\GEMS OMNIX\GEMS Workflows for Manager Review.pdf` | 24 | fe744e0671c866731952ac942a1083f1b567899c9568b07df5af9dcb2cd0175e |

Both PDFs were left unmodified. The WF PDF shows diagrams for WF1–8 only; WF9–17b appear as placeholder boxes.

## E-003 Additional evidence read (read-only; user-approved)
| File | Notes |
|---|---|
| `C:\Users\DELL\Downloads\GEMS-API-Data-Quality-Report.docx` (21 Sep 2026) | Text extracted via zipfile. The Desktop copy has identical text (`Compare-Object` printed no differences) |
| `C:\Users\DELL\Downloads\GEMS-API-Technical-Response.pdf` | GEMS-API-RESP-2026-09, 5 pp |
| `C:\Users\DELL\Downloads\GEMS_REQUEST.pdf` | 5 Oct 2026, 9 pp |

## E-004 Legacy XLS profile (2026-10-26)
- Command: `python -I <scratchpad>\xlsx_profile.py "D:\Legacy_Data\GEMS LEGACY DATA (2009-2026 March).xlsx"` (openpyxl 3.1.5, read-only; prints headers, counts, fill, distinct counts capped at 5000, and min/max dates; **no row values**).
- Run time: 108 s. Exit code 0.
- Result: 18 sheets, 20 columns, ≈1,218,203 rows (details in 08 §2 and `baseline/v1-audit.md` §A.7.1).

## E-005 Baseline preservation (2026-10-26)
- Command: `python -I tools/split_baselines.py <plan file> .` (refuses to overwrite).
- Output hashes:

| File | SHA-256 |
|---|---|
| `revisions/v1.1-corrections.md` | bfcd66c699ba97b254dd55984bc04ed8848c57d28fccf147c00aba1afc81b29e |
| `baseline/v1-audit.md` | d6eb3058765f126f8a23cd113345756cefcc5eaef06da119d12762614ec9bda5 |
| `baseline/v0-plan.md` | f8a3b01987c9ac2ce7ba6a02d96d70becf14cc1c5e00ec9615512b80151dafff |
| Plan file at the time of the split | ff0c45be02dd56ce3f0ff4f7019984f5af5c1af2afebc9f058f7cc8e014d3d5b |

- Re-hash at 14:37 matched for both baseline files.

## E-006 T-DOC-001: matrix build and ID consistency (2026-10-26T14:37:41+05:30)
- Command: `cd docs/audit && python -I tools/build_matrix.py .`
- Exit code: **0**.
- Result:
  - **rows 290; ERRORS 0; WARNINGS 12** (the 12 requirements with no possible test yet, listed in 03 §C).
  - Evidence: SRC 233, REC 50, mixed 7.
  - Stages: S0 11, S1 7, S2 14, S3 56, S4 61, S5 5, S6 56, S7 80.
  - 265 rows link to tests.
- Checks performed:
  - unique IDs;
  - parent and dependency references resolve;
  - every decision ID is defined in an audit `.md`;
  - every test ID is defined in an audit `.md`;
  - evidence class is valid;
  - no VER/IMP claims;
  - target or removal rationale present;
  - stage valid.
- Earlier runs on the same day:
  - Run 1: 0 errors, 317 warnings. Test IDs were not yet defined; 09 was written next.
  - Run 2: 0 errors, 12 warnings, after renaming `T-MIG-K4` to `T-MIG-004`.
- **Limit:** this verifies internal consistency of the documents only. It does not verify that page references match the PDFs (done manually) or any application behaviour.

## E-007 Prisma + Supabase setup (2026-10-26)
- Created at the project root: `package.json`, `package-lock.json`, `prisma/schema.prisma`, `prisma7.config.ts`, `.env` (gitignored by the generated `.gitignore`).
- Prisma init also created agent-skill folders: `.agents/`, `.claude/skills/`, `.windsurf/`, `skills-lock.json`.
- Installed versions:
  - `prisma@7.10.1` (exact).
  - `dotenv@18.0.9` (exact).
  - An earlier install pulled `prisma@8.0.0-rc.27` from the npm `latest` tag. It was removed along with every artifact it created.
- `npx prisma validate`: schema valid.
- `echo "select current_user, version();" | npx prisma db execute --stdin` via the session pooler (5432): **"Script executed successfully"**, exit 0. This confirms the credentials and connectivity only. The query output is not printed by `db execute`.
- Transaction pooler (6543) via the Prisma CLI: **hung past 180 s and was stopped. Not verified.** Prisma CLI commands are not meant for transaction-mode poolers. The runtime path (`@prisma/adapter-pg` over 6543) is still untested.
- No schema, migration or data was written to the database.

## E-008 POC P2 (RLS) and P3 (numbering), local run (2026-10-27)
- **Approval:** the user said "start working on it" on 2026-10-27; read as approval of the POC gate (11). Supabase was **not** touched.
- **Environment:** Docker. `postgres:17.11-alpine` and `edoburu/pgbouncer` 1.26.1 (`pool_mode = transaction`, `default_pool_size = 2`), both pinned by digest in `poc/docker-compose.yml`. Node 24.19.0, `pg` 8.16.3 (exact).
- **Data:** synthetic FX-BASE only (`poc/test/helpers.js`). No real PII. No XLS.
- **Command:** `cd poc && docker compose down -v && docker compose up -d --wait && node --test --test-concurrency=1 --test-reporter=spec --test-reporter=junit ... test/*.test.js`.
- **Run:** started 2026-10-27T12:01:22+05:30. Exit code **0**. Result: **tests 39, pass 39, fail 0, skipped 0**.
- **Raw output:** `poc/evidence/run-2026-10-27T120122.txt` and `.junit.xml`.
- **Metrics:** `poc/evidence/P2-rls-2026-10-27.json` and `P3-numbering-2026-10-27.json`.
- An earlier invocation (`run-2026-10-27T120107`) failed before any test ran. The `test/` directory argument is not accepted by Node 24, so the glob was fixed. It is kept for the record.

| Proof | Tests | Local result | Caveats |
|---|---|---|---|
| P2 | T-RLS-001…016, 018, plus an audit append-only check | pass | 013: raw `pg` client, not Prisma `$queryRaw`, because no Prisma client exists yet. 016: role-level only, no read replica. 011: export helper only, no route or permission keys |
| P2 | T-RLS-009 | 2,000 transactions (1,714 committed, 286 aborted), 2 server backends, **0 leaks, 0 dirty starts** | — |
| P2 | T-RLS-017 | measured: p95 0.635 → 0.814 ms (centre page, +28%); 0.528 → 0.772 ms (all-centre page, +46%); 300k students | **Exceeds the PROPOSED ≤10% threshold.** EXPLAIN shows a fixed InitPlan cost per statement (scope function evaluated once, PK index used). See v1.3 C-20 |
| P3 | T-NUM-001…010 × NP-3 {GAPLESS, UNIQUE} | pass (20) | 009 is parameterised. NP-5 (format, max length) is still unapproved |

**Mutation checks** (run to prove the tests are not vacuous; DB rebuilt afterwards):
1. Scope function replaced with "all centres", and FORCE RLS removed on `receipt`: **14/18 failed**. The 4 that passed (T-RLS-001, 010, 015 and the audit test) do not depend on the scope function.
2. `set_config(..., false)` (session-level) through PgBouncer: a later transaction saw a stale `app.session_id` in **199/200** cases. This proves the T-RLS-009 dirty-start check detects the leak class.
3. Allocator replaced by an unlocked `max(number)+1`: T-NUM-001, 002 and 003 failed.

**Not done:**
- Re-run on the Supabase transaction pooler (C-17).
- CI.
- P0/P1 (auth), P4–P8.
- The Supabase Postgres major version was not read. A read-only `select version()` was blocked by the local permission policy (TLS verification was disabled in the script). Local 17.11 is therefore **assumed**.

**Requirements in VER state: still 0.** These are POC-local mechanism results. 11's exit criteria (CI plus the Supabase re-run) are not met.

File SHA-256 at run time:

| File | SHA-256 |
|---|---|
| poc/sql/01-roles.sql | 8f36443cc57116a092329d0a708d93d7ef50cd191c458342ab8c39581240a274 |
| poc/sql/02-schema.sql | 3ba56f9ed1785e75fedbd2389a3fee42ea2df7994308f71b687fd22b78c080bc |
| poc/src/db.js | a461dc45b0f1778b9e699d4d2055f221b32fa35b5e033592c872e4662bbcea58 |
| poc/src/export.js | 0f6a6f71ec01a6c7d1b31928ba3a61231fc23014ef10a1e0a210ade0fcd8b947 |
| poc/src/numbering.js | f66d8bbd30bb946d7d57544a7336f841348e91451390e8be24ad4fb2f358c315 |
| poc/src/receipts.js | 9cae25cd4fd92c53fd005b17612f629008275963f92ffa8fd2703886a0059088 |
| poc/test/helpers.js | 0def5a272c53a018c717ab578fd059f6f9218fb683bf341bb0edd8da3e4faee5 |
| poc/test/rls.test.js | 72baededf5669b271791829734c5b215b1b6ccaab2757c97bfadf17eaf8b0e8a |
| poc/test/num.test.js | d6697bdb612cff17fe94c9643d283b052e024f0a129d11f7b1d6b5dde652dd68 |
| poc/test/perf.test.js | b601be3550a34b52de1aa0dea1c8658c28201f03831a1001b4562673cb23be18 |
| poc/docker-compose.yml | 8ba32d217d3b50b6ff97ead4d89e266b4168e820c667c1564eb70d1db4e1d869 |

## E-009 Supabase pre-flight for the C-17 re-run (2026-10-27, read-only)
- **TLS:** verified (`rejectUnauthorized: true`) against `certs/supabase-prod-ca-2021.crt`. Fetched from `https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt`; CN = Supabase Root 2021 CA; valid until 2031-04-26; SHA-256 fingerprint 80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA.
- **Version:** `PostgreSQL 17.6 on aarch64`. This matches the local major (17), so **v1.3 C-22 is resolved**.
- **Connected role** `postgres`: not superuser, BYPASSRLS, CREATEROLE, member of `pg_signal_backend`. `session_replication_role` can be set.
- **Roles with BYPASSRLS or superuser:** postgres, service_role, supabase_admin, supabase_etl_admin, supabase_read_only_user. The `supabase_read_only_user` bypass is relevant to T-RLS-016.
- **PUBLIC has TEMP** on the database (local POC revoked it).
- **`max_connections`:** 60.
- **The project is not empty.** It contains another application's objects:
  - schema `drizzle` (`__drizzle_migrations`);
  - `public.arena_round`, `attempt`, `career_event`, `evidence`, `interview_response`, `profile`, `readiness_snapshot`;
  - `auth.users` = 4.
  Only names and counts were read; no row contents.
- **No GEMS objects exist** (0 `gems%` roles, no `app` schema). Nothing was written.
- **Consequence:** C-16 says POC and dry runs never run against a project in real use. The re-run is paused pending the user's choice of target.

## E-010 Supabase project wiped; P2/P3 re-run on Supabase poolers (2026-10-27)

**Wipe.** Explicit user instruction: "delete the contents and make it completely new". The user then confirmed "Wipe, no backup".
- **Inventoried first:**
  - schema `drizzle` (1 table, 1 sequence);
  - 7 tables in `public`;
  - no custom functions, types, policies or triggers;
  - 4 `auth.users`, 4 identities, 6 sessions;
  - storage bucket `resumes` with 4 objects.
- **One transaction:** `drop schema drizzle cascade`; drop the 7 `public` tables with cascade; `delete from auth.users`. Result: DELETE 4, COMMIT.
- **Verified:** 0 `public` relations, no `drizzle` schema, 0 users, identities and sessions.
- **Not deleted:** the 4 storage objects in bucket `resumes`. Supabase blocks SQL deletes on storage (a delete would orphan the files), so **the user must delete the bucket in the dashboard.** No backup exists.

**Provisioning** (`poc/supabase.mjs setup`):
- roles `gems_owner`, `gems_app`, `gems_job`, `gems_report_ro` with random 24-byte passwords. Only client-computed SCRAM verifiers were sent; the passwords lived in `poc/.env.supabase` (gitignored) for the run only;
- schema `app` from the same `sql/02-schema.sql`;
- `anon`, `authenticated` and `service_role` revoked on `app`.
- TLS verified against the Supabase root CA (E-009).

**Runs** (`POC_TARGET=supabase`; "direct" = session pooler 5432, pooled = Supavisor transaction pooler 6543):

| Run | Result | Failure |
|---|---|---|
| supabase-run-2026-10-27T122612 (exit 1) | 38/39 pass | T-RLS-009 aborted with `ECONNRESET` in `pool.connect` after 22 s. No leak was observed before the abort |
| T-RLS-009 alone, ×2 | pass, pass | — (2,000 transactions; 1,714 committed, 286 aborted; **0 leaks, 0 dirty starts, 16 distinct server backends**) |
| supabase-run-2026-10-27T123257 (exit 1) | 38/39 pass | T-NUM-003 (GAPLESS) failed with `Connection terminated unexpectedly`. T-RLS-009 passed in this run |
| T-NUM-003 alone, ×3 (both modes) | 6/6 pass | — |

- **Every test passed on Supabase in at least one full run**, but **no single full run was green.**
- Two runs had a dropped connection in different tests. The cause is **not determined** (v1.4 C-26).
- **No failure showed wrong data:** no leaked row, no duplicate or gapped number.
- **T-RLS-017 on Supabase** (300k rows; client in India, so RTT is included): p95 51.0 vs 49.2 ms and 51.4 vs 50.4 ms (RLS was faster in both cases). The network noise (~±2 ms) exceeds the RLS cost measured locally (~0.2 ms).
- **Evidence:** `poc/evidence/supabase-run-*.txt/.junit.xml`, `P2-rls-supabase-2026-10-27.json`, `P3-numbering-supabase-2026-10-27.json`.
- The `*-mixed-*.json` files hold merged local and Supabase values because of an evidence-naming bug that is now fixed (files are named by target). Local figures of record are in E-008.

**Teardown** (`poc/supabase.mjs teardown`): `app` schema and the 4 roles dropped, `.env.supabase` deleted. Verified: 0 `app` schema, 0 `gems%` roles, 0 `public` relations, 0 users.

**Requirements in VER: still 0.** The 11 exit criteria (CI, repeatable green on Supabase) are not met.

## E-011 New source REFS read and compared (2026-10-27)
- **File:** `C:\Users\DELL\Downloads\GEMS 2.0_Refs.pdf`, 332,004 B, 17 pp. "Module-wise Architecture of GEMS Project 2.0", Proposal G-290725 V1.0.1, dated 29-07-2025.
- **SHA-256:** 049d5e7a0b85ba7e16bf014a3dd07d1163cfc14ecd340beb1d0b79d1ccb1f9d1. Read-only; text extracted with `pdftotext -layout` into the scratchpad.
- **Compared** against the 290-row matrix and decision register 04. Every term with no matrix hit was grepped in the SPEC/WF text.
- **Output:** `revisions/v1.5-refs-gap-analysis.md` (SHA-256 2049774d16e6bc414e88c7c856130375f3677c87b125563d0787b34e26cafe71).
  - 117 REFS items: MATCH 41, PARTIAL 44, NEW 25, CONFLICT 7, counted from the tables with `awk`.
  - Proposed decisions D-REFS-1…7 and questions Q-REFS-1…4.
- **Matrix:** unchanged. T-DOC-001 re-run: `python -I tools/build_matrix.py .` gave **ERRORS (0)**.
- **Limit:** the mapping is a manual reading by one reviewer, and capability-level only (REFS has no screens or rules). Second-reviewer spot checks are recommended before new R-IDs are created.

## E-012 Q-REFS-1 answered (2026-10-27)
- The user answered "older proposal kept for reference".
- `revisions/v1.5-refs-gap-analysis.md` §G was appended with the consequences: REFS is reference-only; NEW and PARTIAL extras go to the backlog; D-REFS-1…7 are closed or withdrawn.
- No matrix or decision-register edits.

## E-013 BRD and FRD drafts v0.1 (2026-10-27)
- **User request:** "create a full BRD file and FRD file to check".
- **BRD:** hand-written from audit 01, 03–10 and the revisions. Every rule carries its evidence class. Objectives BO-2…8 are marked PROPOSED.
- **FRD:**
  - §1–4 are hand-written (`src/frd-front.md`).
  - §5–8 are generated by `python -I docs/requirements/tools/build_frd.py .` from the 290-row matrix, with workflows from 05, invariants from 07 and NFRs from v1.1 C-06.
  - Generator output: "290 requirements in 19 modules; 162 linked to a workflow".
- **Word copies:** made with pandoc (`--toc`). The FRD .docx contains 290 `FR-` headings (checked by converting back to markdown).
- **Fixes made while building:**
  1. The generator first dropped 4 rows. Four matrix TSVs have no header line, so the generator now uses the same header rule as `build_matrix.py` and asserts 290.
  2. BRD §4.1 module counts were corrected from the FRD table (5 rows changed: 8.1, 8.2, 8.5, 8.6, 8.7).
- T-DOC-001 re-run: ERRORS (0). Matrix unchanged.
- REFS appears only in BRD Appendix A, as backlog.

| File | SHA-256 |
|---|---|
| docs/requirements/BRD-GEMS-OMNIX.md | 654e4df3c4325a2b3f789131830bd3e7d75f7cbf5c7a2266e996e3dc0d8dec9c |
| docs/requirements/FRD-GEMS-OMNIX.md | 72f5306437da2aac88d1586714a4f5f4d44a81ad2ad481acfda6f51e8ed1047e |
| docs/requirements/BRD-GEMS-OMNIX.docx | ea85f16a3c331e913745f8773e3a665ebe278cfaefcc75900377ed9b6c2a0cb5 |
| docs/requirements/FRD-GEMS-OMNIX.docx | 202c3b6b078dd2047d12ee6fae22e43eeebc0a5f50cc26453e3654aab1cd2129 |
| docs/requirements/tools/build_frd.py | 02124671725af4148c76d87c437a56ac17a82804879b3bcf8279b63236ace679 |
| docs/requirements/src/frd-front.md | 3eac5b0c6423deeb6fe06aaa89fed227271d52c7eacbe03c4f9703fd8ba911e1 |

## E-014 Build started: application foundation (2026-10-27)
- **Request:** the user said "Start the build of the project".
- **Roadmap position:**
  - Stage 0 (discovery) is **blocked**: no legacy MySQL access.
  - This work is the **decision-free part of Stages 1–2**: platform skeleton, organisation and access schema, RLS, scoped DB access, the authorization gate, audit and numbering.
  - **No authentication code** was written (ADR-001 bake-off pending).
  - No business module, and no unapproved policy (NP-1…8 and D-ORG-1 remain parameters or labelled defaults).
- **Stack** (exact pins in `package.json`): Next.js 16.4.2, React 19.3.1, TypeScript 6.0.3, Prisma 7.10.1 + @prisma/adapter-pg, pg 8.23.1, zod 4.6.7, Vitest 4.1.12.
  - TypeScript 7.0 was skipped (new native compiler; Next compatibility unverified).
  - npm `allowScripts` approved only for `prisma` and `@prisma/engines`.
- **Git:** `git init` at the repo root. **No commits.**
- **Safety:**
  - `prisma7.config.ts` now requires an explicit `MIGRATE_URL` (local values in gitignored `.env.local`). It can no longer fall back to the Supabase URL in `.env`.
  - **Supabase was not touched.**
- **Local dev database:** `docker-compose.yml` (project `gems-omnix-dev`), Postgres 17.11 on 127.0.0.1:54320, PgBouncer 1.26.1 (transaction mode) on 127.0.0.1:64320.
- **Migrations:**
  - `0001_foundation` (generated by `prisma migrate diff`): schema `app` with region, area, centre, app_user, role, permission, role_permission, role_assignment, app_session, audit_log, number_series.
  - `0002_security` (hand-written):
    - runtime roles NOLOGIN-if-missing;
    - anon/authenticated revoked;
    - scope-shape CHECK;
    - definer functions `session_user_id`, `scoped_centre_ids`, `visible_centre_ids` and `has_permission` (ALL/REGION/AREA/CENTRE);
    - FORCE RLS on `centre` and `number_series`;
    - append-only audit triggers;
    - minimal grants.
- **Code:**
  - `src/server/db.ts`: `withScope` is the only DB entry point; the raw client is not exported.
  - `src/server/action.ts`: `scopedAction` = authorize → change → audit in one transaction; DENIED audited separately.
  - `src/server/numbering.ts`.
  - `app/`: placeholder page that reads no data.
- **Run** (`evidence/foundation-2026-10-27T154926.txt`), on a fresh DB:
  - migrate deploy applied 2/2;
  - `tsc --noEmit` 0 errors;
  - **Vitest: 19 passed, 0 failed**;
  - `next build` succeeded (routes / and /_not-found, static).
- **Tests:**
  - T-RLS-001, 002, 005, 006/007, 008, 009 (400 pooled tx), 010, 018;
  - permission × scope truth table;
  - T-AUD same-transaction and append-only;
  - T-NUM-001, 002, 006 in both NP-3 modes;
  - T-NUM-007 and 009.
- **Mutation checks:**
  - (1) a scope function returning all centres failed 4 tests;
  - (2) `set_config(..., false)` (session-level) failed 2 tests (006/007, 009).
  - Code and DB were restored and rebuilt before the clean run.
- **Not covered yet:**
  - authentication (ADR-001);
  - T-RLS-003/004/011–017 (no views, exports, jobs or perf yet);
  - Supabase run (C-26 open);
  - CI.
- **Requirements VER: still 0.** These are foundation mechanism tests run locally, not module acceptance.

| File | SHA-256 |
|---|---|
| prisma/schema.prisma | 2e0d202b1f82926aaf3481fbef2c402123f4e3c297226c16acdd0d358b5602b2 |
| prisma/migrations/0001_foundation/migration.sql | 00422b55b30722fd43614af8fc7efcd319f252eedf29c94f379f7dcf6cfb5a32 |
| prisma/migrations/0002_security/migration.sql | ed312e21d0086229e90770d8488e4fd4d09af99163dd4831becfb180e7db672c |
| src/server/action.ts | fa30a4ad3e7e9b9910e1f7c46e8e8bdc940e986517d905b2d6be6dba9894d051 |
| src/server/db.ts | f9633d14c58bc9d50f3972dcdfd20823d4bd48286d04b0fad799f650873f6f20 |
| src/server/numbering.ts | 2fd3ac7e1c3c046bd9c5415ddac1f2be76f7efaa427645c1951460695ad6e58e |
| tests/fixtures.ts | f53a4f6fe5fd2d232c2b72fa7da19c98a34e2efe2a46374fdfdb055e600da442 |
| tests/foundation.test.ts | 1bd95832261e775b5f4a2525bd6a7c22e4065622571f46fae18e7c71a3631115 |
| evidence/foundation-2026-10-27T154926.txt | 1dc5e1bb21f0d984f15ad82c37aef7c4e9d0d45306a0f38b52e8f8b8f3a2bd20 |

## E-015 ADR-001 authentication bake-off (2026-10-27, branch `adr-001-bakeoff`)
- **Request:** the user said "start the ADR-001 auth bake-off".
- **Branch:** all work is on the throwaway branch `adr-001-bakeoff`. **No auth code is on `main`.**

**Candidate C (Auth.js v5)**
- `next-auth@5.0.0-beta.32` depends only on `@auth/core@0.41.3`.
- Probe: `bakeoff/probes/authjs-credentials-db-session.mjs`, run in an isolated scratch install.
- Result: Credentials + `session.strategy "database"` gave HTTP 500, `UnsupportedStrategy: Signing in with credentials only supported if JWT strategy is enabled`, and 0 adapter calls.
- **DR-14 closed: C fails the mandatory DB-session/revocation criterion.**

**Candidates A and B**
- **A:** Better Auth 1.7.12 (pinned a week behind 1.7.14).
- **B:** first-party module on `@node-rs/argon2` 2.2.2, `@oslojs/otp` 1.1.0 and `@oslojs/encoding` 1.1.0.
- Both use one contract and one suite (T-AUTH-001…011, 013–015, 018–020). T-AUTH-012/016/017 are platform tests and are not compared.

**Final run** (`bakeoff/evidence/run-2026-10-27T162143.txt`, fresh DB):
- `tsc`: 0 errors.
- **53 tests: 51 passed, 2 failed.**
  - Foundation: 19/19.
  - B: 17/17.
  - A: 15/17, failing T-AUTH-001 (raw session token at rest) and T-AUTH-006 (TOTP replay accepted).
- A alone, first, on another fresh DB: 15/17 again.

**Suite validity** (mutations on B, restored afterwards):
- No replay check: T-AUTH-006 failed.
- Login audit not awaited: T-AUTH-020 failed.

**My own defects found and fixed during the bake-off** (none changed a candidate's capabilities):
1. Fixture sessions counted as live (suite).
2. Better Auth username minimum length 3 versus the 2-character fixture login (set `minUsernameLength: 1`).
3. Reset outbox mapped to lowercase e-mail.
4. Wrong internal API (`deleteSessions` instead of `deleteUserSessions`).
5. In-memory rate limits carried across tests (switched A to database storage).
6. The first Set-Cookie taken instead of the last.
7. Backup codes read from the wrong call.
8. Better Auth instance built before its tables existed (now lazy).
9. A depended on a column created only by B's setup.

**Discarded run:** `run-2026-10-27T162044` showed A at 2/17 due to defect 9. It was deleted and replaced by the run above.

**Surface**
- Own code: B 372 lines; A 295 lines of glue at 19 sites.
- Added packages: A 20 (~7.5 MB), plus argon2; B 6 (~0.2 MB), plus the argon2 binary (~0.6 MB, shared).

**Better Auth source findings A1–A8:** see the ADR §4.

**Proposed decision:** B (`docs/adr/ADR-001-authentication.md`, status **Proposed**, approval blank).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| bakeoff/contract.ts | 04c50b7aa3f86c6e9b1f9c95bd85298cd239e4612437db9b21ff8d7c989266b3 |
| bakeoff/suite.ts | 5558b6d6c362d34a99b46526cf9c6c730e671493b826979c68d9e269e2aca0dd |
| bakeoff/a-better-auth/index.ts | a2560050591a065cf347aaed8993b23f115a3f24844225df498bef8cb6064ce0 |
| bakeoff/b-firstparty/index.ts | 14f806e8ee4146f799597ac2e1b139a1eca1b499929d7c4b52a1fc3337a76490 |
| bakeoff/b-firstparty/schema.sql | c85db6a22ddfd4547337f1cd540415a4ca7538d86bf78bd11590281330d1c3a2 |
| bakeoff/sql/shared.sql | 79f220a67aaea3397a717730fdb6e6987f49d96132589d2bf474cdf1e2189b1a |
| bakeoff/probes/authjs-credentials-db-session.mjs | 2064ba67eefba8fb20d27fa2e44794bb1868381d0d7377715cc7dbb2b2d7f2e2 |
| bakeoff/evidence/A-better-auth-results.json | 997bda8448d2223da5deb3fed489e5d9b1497b55e27b26992802977b5e8e7abe |
| bakeoff/evidence/B-first-party-results.json | cd59000c7f1004066b978d37d6f9f592ce8f87428e742012d0ad789086fa1e24 |
| bakeoff/evidence/C-authjs-probe.json | 4a3a7cc47457c259d615720a5d5b33eeb3e9b3eeae93a88dd5bce3205f50acc1 |
| bakeoff/evidence/run-2026-10-27T162143.txt | 6dc3b5b1dc83d3b32217b1a0ff51ef0f9da7af77b0e7ad3f9f5dc61d0b403b1f |
| docs/adr/ADR-001-authentication.md | aee81ff5a33e22148ee4c57201e1bd7984a7d41594aaa7107d501e604ef29a86 |

## E-016 ADR-001 accepted (B) and auth ported into the app (2026-10-27)
- **Approval:** the user said "approve B and commit". The ADR is marked **Accepted** (project-owner approval in chat; named IT/Sponsor signatures still blank).
- **Bake-off commit:** `cc4766f` (all three candidates kept in history), fast-forwarded to `main`.
- **Port:**
  - migration `0003_auth`: tables and columns generated by `prisma migrate diff`, plus a hand-written security section (role `gems_auth`, kind CHECK, column-level grants);
  - production module: `src/server/auth/index.ts` (`createAuth`, `hashPassword`) and `src/server/auth/policy.ts` (PMC policy values);
  - test hooks moved out of production code into `tests/auth/harness.ts`;
  - suite now in `tests/auth/`;
  - audit fault trigger is test-only (`tests/sql/audit-fault.sql`).
- **Removed:**
  - Better Auth adapter, Auth.js probe and bake-off test files;
  - `better-auth` package (`npm uninstall`).
- **Kept:** `bakeoff/evidence/`.
- **`gems_auth`** is now routed through the local PgBouncer: userlist entry added; `AUTH_DATABASE_URL` points at 64320.
- **Run** `evidence/auth-port-2026-10-27T162701.txt`, fresh DB:
  - 3 migrations applied;
  - `prisma migrate diff` database → schema: **empty (no drift)**;
  - `tsc`: 0 errors;
  - **Vitest: 2 files, 36 passed, 0 failed** (foundation 19, T-AUTH 17);
  - `next build` succeeded.
- **Tracker created:** `docs/STATUS.md`. It is updated with every change.
- **Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/schema.prisma | 6a9eeb53fcb41bac2a4a87b9e0541c762d4c19f0fdc43ded7ac3efb031242ef1 |
| prisma/migrations/0003_auth/migration.sql | 1275110c0ed6d21620c6693c0051885eef1747fda82fcb99e5071fe2aeb1dc5c |
| src/server/auth/index.ts | 8110be5f32301d88af4334a3dd4dbd96d9bc0b4b8d6b63f78c34c15c5a7edafb |
| src/server/auth/policy.ts | 0aa80554f280da6a7e4056c09a6660c5cd2e3d99af6d85a93f4744ae9afac6fc |
| tests/auth/contract.ts | ebfb78b5677d0a4a96783a795f0e87d645798a066cdc635040b46efde90680fc |
| tests/auth/harness.ts | 88da2955337ca6a0baf175e0e594bc2f0479a76f8c9c907a03f6fd1abdd6824e |
| tests/auth/suite.ts | 4210d0a886e6fa9488a6c3b631645341253e798ef3c3ebdbcacb64a4431ce258 |
| tests/auth.test.ts | ae1858807f67abbf0186033cfbb1058da65369fee0cdf7afd87c2a4851182f25 |
| tests/sql/audit-fault.sql | 6132ee6d5f0a1b29ee55cd4884dc7ce180f5beda3f6c3037ed37dd965cf51a20 |
| evidence/auth-port-2026-10-27T162701.txt | c6c497abb50385e6ee1dd4e230595e9e916095f56b22b7d459236c25087bbca4 |
| docs/STATUS.md | 4b52592e8769550e41329f423d4e491fbfaa590b27c5288fdbb0a0dbd072497c |

## E-017 Auth follow-ups and sign-in screens (2026-10-27)
- **Request:** the user said "push it and continue with the auth follow-ups".
- **Push:** `a47eaf8..4558768` to `origin/main`. Verified with `git ls-remote`.

**Migration `0004_auth_hardening`**
- Second-factor failure columns.
- `app.idle_minutes()` (30, PMC; a test asserts it equals `POLICY.idleMinutes`).
- `app.account_usable(user)`: active, and at least one assignment that is wider than a centre or on an ACTIVE centre.
- `app.session_user_id()` now enforces the idle timeout and `account_usable` in the database.
- The test-only table `bakeoff_audit_fault` is deliberately not dropped.

**Module**
- Second-factor guesses are counted per user across challenges (5, then a 15-minute lock; TOTP and recovery codes share the counter).
- `account_usable` is used on every path.
- Password minimum (12, PMC) is enforced in `changePassword` and `confirmReset`.
- New: `enrolmentSecret` and `profile`.

**Defect found by the new timing test (T-AUTH-002b)**
- `signIn` short-circuited for unknown logins (`!user || …`), so the dummy-hash comparison never ran.
- Median ratio known/unknown was **2.62** (17.4 vs 6.6 ms), a user-enumeration oracle.
- Fixed by always running the hash check. Ratio after the fix: 1.07, 1.14, 1.07 (three runs) and 0.99 (final run).

**HTTP layer**
- `src/server/auth/http.ts`: same-origin check, cookies, IP; `TRUST_PROXY_HEADERS` gates `x-forwarded-for`.
- Route handlers: `/auth/{login,verify,enrol/start,enrol/confirm,logout,reset/request,reset/confirm}`.
- Pages: `/login`, `/login/verify`, `/login/enrol`, `/reset`, `/reset/confirm`, and `/`, which requires a session.
- The challenge sits in a 5-minute `__Host-` cookie. The TOTP secret is read back from the encrypted pending record. Recovery codes are rendered once (`no-store`).

**Mutation checks**
- `sameOrigin` returning true: T-AUTH-016 failed.
- The timing test failed before the fix.

**Real-server smoke** (`next start -p 3101`, curl):
1. `GET /` with no session: 307 to /login.
2. `/login` renders the form.
3. Foreign-Origin login: 403.
4. Same-origin login: 303 to /, `Set-Cookie: __Host-gems_session=…; Path=/; HttpOnly; Secure; SameSite=Lax`.
5. `GET /`: "Signed in as User A (uA)".
6. Logout: 303 to /login.
7. Revoked cookie: 307 to /login.

(The first attempt at step 4 returned `error=invalid` because the preceding test run had reset the user's password. It was re-run with the current password.)

**Final run** (`evidence/auth-followups-2026-10-27T163706.txt`, fresh DB):
- migrations 0001–0004 applied;
- drift: empty migration;
- `tsc`: 0 errors;
- **Vitest: 3 files, 45 passed, 0 failed**;
- `next build` compiled.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0004_auth_hardening/migration.sql | 52c4e817c47581c0db788ea493e1cef442d95de2e0a01aa27f473f7fc321a5c3 |
| src/server/auth/http.ts | b1942c88bee578e09695acb398c4819a5f32622410d4e571d98b2df3e43236dd |
| src/server/auth/index.ts | e3aa495b622ae72051354d08526414f158f778d4729d513fab0022d2f808b8c2 |
| src/server/auth/policy.ts | 12aace5dd47e5f1619dd481536fa2722d45d7561cfccc60406ee8455e7617a8a |
| src/server/auth/session.ts | 4264d6914ced3e7f1009f51a4f6b10e31962efb100fc4d3a18651220ecdf00c8 |
| app/auth/login/route.ts | 8effc6e7f0abd8611b0921f245995afb118b1ecb23b6bf16edfb34ec94c39891 |
| app/auth/logout/route.ts | 285f6ed6e63c4b4b04867a6f18f7395831f066d4101ed746f837652ba38ab4a3 |
| app/auth/verify/route.ts | 39314d9f4660e1f9655e9591fea62e699648d06ef30c4cb2e64a8da6f044b851 |
| app/auth/enrol/confirm/route.ts | b3809932c4a3a11bbb4b14fc228a98df25f08f5527c5594edbb059d3610be194 |
| app/auth/enrol/start/route.ts | 2c041ae76ab967c5670d37808fb657b93d0179e4c6833d3b9b10005e75225167 |
| app/auth/reset/confirm/route.ts | cde729688269169d0eef8ef92a55684b568adb4e454411abf8023dada508f094 |
| app/auth/reset/request/route.ts | dc28ccf76b4f2e2f2f6b1022256b3a666f1a2b615aa62c8e4122b84523930a01 |
| tests/auth-http.test.ts | 90528a6d85a7871ef0010d6e545f408143431816f38cc8b9db38c2374529f66e |
| tests/auth/suite.ts | 11ea7753980b3b9b1c95853c30e015a067e0a8494a37e182c31d55af48f1d8d9 |
| evidence/auth-followups-2026-10-27T163706.txt | 6e6ff0ced3263fcd2d7e90beb8d97e8424a572037824f45ac0d0eca7b780a702 |

## E-018 User and role administration (2026-10-27)
- **Request:** the user said "push it and continue with user and role administration".
- **Push:** `4558768..6e1d30b` to `origin/main`.

**Migration `0005_rbac`**
- `permission.sensitive` column.
- Logins stored lowercase (CHECK).
- Admin permission catalogue: `rbac.view`, `rbac.user.manage` (sensitive), `rbac.role.manage` (sensitive).
- Security-definer API:
  - `rbac_create_user`, `rbac_set_user_status` (no self-disable; disabling revokes sessions);
  - `rbac_assign` and `rbac_unassign` (no over-grant via `can_grant_permission`; removal is symmetric; target sessions revoked; `requires_totp` recomputed);
  - `rbac_create_role`, `rbac_set_role_permissions` (only permissions held network-wide; all holders signed out);
  - `rbac_issue_setup_token`;
  - `session_step_up_fresh`.
- `gems_app` reads only identity columns of `app_user` and `role_assignment`, under RLS (rbac.view or own row). `gems_auth` keeps full access by policy.

**App**
- `src/server/rbac.ts`: every write = scopedAction (authorize + audit) + fresh step-up + DB function. DB errors are mapped by SQLSTATE: 42501 → Forbidden (audited DENIED); 23505 → duplicate; P0002 → not found.
- Pages: `/admin/users`, `/admin/users/[id]`, `/admin/roles`, `/admin/roles/[id]` (404 for non-admins), `/stepup`.
- POST routes under `/admin/*` and `/auth/stepup` (same-origin, `safeNext` against open redirects).
- One-time set-up link page (`no-store`, `no-referrer`).
- `scripts/bootstrap-admin.mjs`: first admin only; refuses when one exists; no password; TOTP required; audited.
- `scripts/smoke-admin.sh`: real-server journey.

**Defects found and fixed while building** (none shipped):
1. Prisma's adapter cannot decode `void` results, so void functions are now called with `$executeRaw`.
2. Unique violations carry `originalCode`, not `code`.
3. Fixtures inserted explicit ids without advancing sequences, so `createRole` collided.
4. `adminPost` consumed the body before the permissions route re-read it.
5. `$queryRawUnsafe` replaced by `Prisma.raw` (rule T-RLS-013).

**Test changes**
- Inventory tests updated deliberately: T-RLS-005 now pins 19 definer functions; T-RLS-001 asserts admin reads are RLS-filtered and that hash/secret columns stay unreadable.
- Fixture logins are lowercase.

**Mutation checks** (DB rebuilt afterwards):
1. `can_grant_permission` → true: the over-grant test failed.
2. `revoke_user_sessions_internal` no-op: T-E2E-X13 and the role-editing test failed.
3. `session_step_up_fresh` → true: the step-up test failed.

**Real-server smoke** (`scripts/smoke-admin.sh` on a fresh DB, `next start -p 3101`):
1. Set-up link: 303 to /login?reset=ok.
2. Sign-in: 303 to /login/enrol.
3. Enrolment start: 303.
4. Enrolment page shows a 32-character key.
5. Confirm: 10 recovery codes.
6. Home shows the admin link.
7. `/admin/users`: 200.
8. Create user: 303 to /admin/users/<id>?created=1.
9. The new user is listed.
10. No session: 307 to /login.

**Final run** (`evidence/rbac-2026-10-27T173016.txt`, fresh DB):
- migrations 0001–0005 applied;
- drift: empty;
- no `RawUnsafe` in src/ or app/;
- `tsc`: 0 errors;
- **Vitest: 5 files, 59 passed, 0 failed**;
- `next build` compiled.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0005_rbac/migration.sql | 29f1ab7183d88f5607afa401a5ea0372913ab54a6dddfc2eb4b85ff86ec97806 |
| src/server/rbac.ts | 4eb6570cc5ee2a96a6a237022fb2e58d7f32318111e5b2578c95c3d13ccdaf01 |
| src/server/admin-http.ts | 898c0805555da6914df11a3afe3cee20fbca67ee2cafa508251a132c5ba457ae |
| src/server/admin-page.ts | e887edae45fd263c267bfc917280933015aa0c1b3842f0cefc7412fe9e336aa0 |
| scripts/bootstrap-admin.mjs | e8b42d3d6f594af212d2a3f35f47ef619e833e3349147afc70c8dbf8122b87e4 |
| scripts/smoke-admin.sh | d3d15c003dc8d2d6e9deec67f58751307280cddc35a74ae7fac7fcb99249cc9e |
| tests/rbac.test.ts | a5da586656a1efc58eacd3630f2f8d7b64f7f50616f991cda8aaae1ca523a799 |
| tests/admin-http.test.ts | 0e522d0dd5e568fd874792bafc7ba95cbec758b0d7130f7d987069b90fb5a633 |
| evidence/rbac-2026-10-27T173016.txt | 6661f148595ab6d6ba8d9a25ae65e53a1313f7c933c0ff5987459dd5ed976e6e |

## E-019 Continuous integration (2026-10-27)
- **Request:** the user said "push it and continue with CI".
- **Push:** `6e1d30b..9e93ce2` to `origin/main`.

**`scripts/ci.sh`** is the single definition of green. In order:
1. T-DOC-001 (0 errors).
2. Matrix CSV in sync with its generator (`git diff --exit-code`).
3. FRD in sync with its generator.
4. `prisma generate`.
5. Fresh Docker DB (`down -v`, then `up --wait`) and `migrate deploy`.
6. Drift gate (`prisma migrate diff … --exit-code`).
7. No `(query|execute)RawUnsafe` in src/ or app/.
8. `tsc --noEmit`.
9. `vitest run`.
10. `next build`.

**Workflow `.github/workflows/ci.yml`**
- Triggers: push to `main`, and pull requests.
- `permissions: contents: read`; `persist-credentials: false`.
- `actions/checkout` pinned to `3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), and `actions/setup-node` to `949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0). Tags were resolved through the annotated-tag objects.
- Node 24.19.0 with npm cache; `npm ci`, honouring the `allowScripts` already in package.json.
- Per-run random `AUTH_ENC_KEY`. The DB URLs are the throwaway Docker credentials from `docker-compose.yml`.
- Concurrency cancel.

**`.gitattributes`:** `* text=auto eol=lf`, binaries marked. `git add --renormalize .` changed no files.

**Local run** of `bash scripts/ci.sh`: exit 0; ERRORS (0); no drift; no unsafe SQL; tsc 0 errors; 5 files, 59 tests passed; build compiled.

**Gate checks (each must fail):**
- G1, a Prisma field added without a migration: exit 1, "schema drift" with the ALTER shown.
- G2, a hand edit to the generated FRD:
  - first attempt **not caught**, because the script regenerated over an *uncommitted* edit and so compared equal to HEAD;
  - re-tested with the edit staged (as a commit would carry it): exit 1, "FRD is stale".
- G3, a `$queryRawUnsafe` call in `src/`: exit 1, "unsafe raw SQL is banned".

**GitHub run 40501900222** (commit `b77d262`):
- `completed` / `success`; job `build` 12:12:08Z → 12:13:10Z.
- All steps success: checkout, setup-node, key, `npm ci`, `bash scripts/ci.sh`.
- Read from the public API without authentication. Step logs need a GitHub login, so the CI-side test count was not read; the script exits non-zero on any failing test.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| scripts/ci.sh | 849f1d3880f0ec00bdaab160a7e609e8663bd948b4f1acb0ff67fd94182da808 |
| .github/workflows/ci.yml | 27be054457ec4c6dcbb6fa92062de0894a931aec1a04d0a0e1d6d9f18f0228b7 |
| .gitattributes | b1ac1a6247d134514af85157cbe58715710b3a07abfd02d0566d1eacdd83fd8e |

## E-020 T-SEC suite for existing surfaces; CI real-server stage; CI defect fixed (2026-10-27)
- **Request:** the user said "push it and continue with the T-SEC suite".
- **Push:** `b77d262..e753f44`.
- **GitHub CI runs:** 40501900222 (`b77d262`) and 40503305157 (`e753f44`), both `completed / success` (public API).

**Built**
- `proxy.ts`: a fresh nonce per request in a strict CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, `form-action 'self'`, `object-src 'none'`). It follows the CSP guide bundled with Next 16.4.2; `upgrade-insecure-requests` is omitted so plain-http localhost works.
- `next.config.ts`: HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `poweredByHeader: false`.
- `src/server/safe-route.ts`: every route handler (15) wrapped; unexpected errors give a generic 500 plus a reference id; details are logged under that id.
- `app/error.tsx`: generic message plus digest. `app/not-found.tsx`: a single 404.
- Migration `0006_centre_view`: catalogue entry `org.centre.view`.
- `src/server/centres.ts` and the pages `/centres`, `/centres/[id]` (FR-022, FR-022.02, read-only). RLS **and** `has_permission('org.centre.view', id)`; filters can only narrow. The admin page helper was renamed to `src/server/page-read.ts`.
- `scripts/scan-client-bundle.mjs` (T-SEC-017) and `scripts/smoke-security.mjs` (13 real-server checks).
- `scripts/ci.sh` new stages: bundle scan; fresh DB → `next start` → `smoke-admin.sh` + `smoke-security.mjs` → server stopped by trap.

**Tests** (`tests/sec.test.ts`): T-SEC-001, 005, 007, 012, 013. The rest are mapped to the feature each needs in STATUS §4a.

**Mutation checks** (all restored):
1. Permission gate removed from the centre queries: T-SEC-001 failed. This needed a new case (in scope by RLS, but without `org.centre.view`), because no fixture role exercised that gate.
2. A server DB URL inside a client component: the bundle scan exited 1 (3 hits).
3. `proxy.ts` removed: 4 smoke checks failed (CSP, nonce freshness, script nonces, frame-ancestors).

**My defects found and fixed**
1. **CI gate defect:** `npx tsc --noEmit && echo "0 errors"` under `set -e` does not stop on failure. A type error (here, stale `.next/types` from the probe page) let CI continue to green. Fixed: commands run alone; `rm -rf .next` at the start. Proven: an injected type error now gives exit 2 before the tests. The earlier local runs had printed "0 errors", so they were genuine passes. The GitHub runs' typecheck output was not readable without a login.
2. The 404-parity check compared raw HTML. The two 404s differ only in the per-request nonce and the echoed requested id (route param `"k"`, path segments `"c"`, nonce inside the React payload). Normalising exactly those made the bodies identical: no existence oracle.
3. A regex mangled by Python string escaping (fixed with an exact edit).

**Final run** `evidence/tsec-2026-10-27T180310.txt` (`bash scripts/ci.sh`, fresh DB, set-up token redacted):
- exit 0; T-DOC-001 ERRORS (0); no drift; no unsafe SQL; tsc 0 errors;
- **6 files, 64 tests passed**;
- build compiled; no secrets in the client bundle;
- admin journey 10/10; security smoke 13/13.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| proxy.ts | 001730a48016f054e2ebbbc4488c92f3333c66ea072f3ebeade841c7dfb038f1 |
| next.config.ts | 310059f369c8240f6defe952fa8e2ad29507279d9db7632d680d4d540a092317 |
| src/server/safe-route.ts | 514dc7ede963daf6db3a3a9c1239fb00a915f9bcc478430384f7d4bd705202f6 |
| src/server/centres.ts | 9bab1eff122a15fc95d2921df7185505822d9d8516bb8d01b929311d71ea0e76 |
| src/server/page-read.ts | b28e5565db189ab2aba809bb8cf7ec17f7f3e6ab9aec0b149bb7a60441f5631f |
| prisma/migrations/0006_centre_view/migration.sql | 5a0f3db8c394917b902decf38c36e4d102072f811e70b9c4ccdec4ae91a4867b |
| app/error.tsx | be950cd611517e9f066719bc837f6c898af8581dc7b8eefc45e33acfe9e9a717 |
| app/not-found.tsx | 6f1e26cb005c8cf4a3517e2f93b5c06203c0ef6184594621b0fd55ae48bee55e |
| app/centres/page.tsx | 0be74c4a30b89703d37c235d0810baf84d9664fc7499eede5949351611acb565 |
| app/centres/[id]/page.tsx | bf99ee669271d6381c2a0e590d8876b300547f5a2bdd1b218a621e63c687a35d |
| tests/sec.test.ts | 09d06f25093f60a0a89f76b6497b02b770e81537c0d307c593b00b2e5587b06d |
| scripts/scan-client-bundle.mjs | 054378a9ec733d94df9c20569e9ba5ef78202025f62072c64d76fe8b66d312b0 |
| scripts/smoke-security.mjs | 0a5e69013b15fa4511fdf46fa169d28c34fec3ee140919ecc27e902e17026f08 |
| scripts/ci.sh | a1d8f2fed94920f123eb0acb8b5beed5d0450659f09cc4ea003f2c6c891de4c5 |
| evidence/tsec-2026-10-27T180310.txt | ab30e3c9e9fa3ed09e118266f1899af65f68ad1c87dddb1d3c37a1288dd1dd54 |

## E-021 Exports (Stage 1 P7) (2026-10-27)
- **Request:** the user said "push it and continue with exports".
- **Push:** `e753f44..b1c5962`. GitHub run 40508221829 for `b1c5962`: `completed / success` (first run with the real-server stage).

**Built**
- Migration `0007_exports`:
  - permissions `org.centre.export`, `rbac.user.export` (sensitive), `pii.export` (sensitive);
  - `app.recent_export_count(minutes)`, a definer function counting the caller's own export audit rows (the rate-limit source);
  - `scoped_centre_ids` granted to `gems_app`;
  - `rbac_read` policies rewritten to evaluate `has_permission` once (sub-select).
- `src/server/exports.ts` (dataset registry):
  - permission per dataset; PII columns only with `pii.export`, otherwise omitted and recorded as `piiOmitted`;
  - one transaction with a server-side cursor; `ReadableStream` with `highWaterMark: 0` (pull-driven), so the transaction opens on the first read and the producer never runs ahead;
  - audit row `export.<dataset>` with the requested filters, actual scope, columns, rows and cancelled flag;
  - 10 exports per 10 min per user (PMC); CSV formula-injection guard;
  - `withScope` gained a `timeoutMs` option (120 s for exports).
- `POST /export/[dataset]`: same-origin; 404 for unknown and forbidden alike; 429 with `Retry-After`; `attachment` + `no-store`.
- Download buttons on `/centres` (carrying the current filters) and `/admin/users`, shown only when allowed.
- The centre list query switched to the same set-based scope filter.

**Tests** (`tests/exports.test.ts`, 10):
- T-SEC-006 / T-RLS-011 / T-RPT-010: tampered filters and the audit of the actual scope;
- permission and DENIED audit;
- T-RPT-011: PII gate;
- T-RPT-012: 1,234 rows in batches of 100, no duplicates or losses;
- T-RPT-013: 200,000 rows in about 1.2 s, **0 batches fetched while the reader was stalled**, peak heap growth about 78 MB (PERF-04 PROPOSED ≤ 512 MB);
- cancellation audited with the partial row count;
- an unread export holds no transaction;
- T-SEC-015 rate limit; formula injection;
- the HTTP route.

The real-server smoke gained 2 export checks (15 in total).

**Defects found and fixed while building:**
1. **Quadratic scope filter.** `has_permission()` per row rebuilt the caller's centre set for every row: 200,000 rows took 131 s and hit the timeout. Replaced by a set computed once and hash-joined.
2. **`42P18` untyped parameters** inside `DECLARE CURSOR` and `jsonb_build_object`; casts added.
3. **Cancelled export went unaudited:** an enqueue after cancel threw and rolled the transaction back. Sending is now skipped once cancelled.
4. **An unread export held a transaction open** for up to 120 s. First a lazy start in `pull()`; that was insufficient because streams call `pull()` eagerly up to `highWaterMark`. Fixed with `highWaterMark: 0`. Regression test added; the mutation back to `highWaterMark: 2` failed it.
5. **My test design:** the bounded-memory test was moved from 200,000 centres to 200,000 users (production has ~327 centres); the 64 MB heap guess was replaced by the spec's PROPOSED 512 MB plus a structural backpressure assertion.
6. **My tooling:** Python-on-Windows edits broke a JS line (CRLF inside a string literal); a crafted smoke filter (region R2 with centre A) made a correct empty export look like a failure; a `&&`-chained command skipped the timestamp and wrote `evidence/exports-.txt` (deleted, as were the superseded run files).

**Also:** T-RLS-005 pins 20 definer functions now; `recent_export_count` was reviewed (caller's own rows, fixed `search_path`).

**Final run** `evidence/exports-2026-10-27T185028.txt` (`bash scripts/ci.sh`, fresh DB, set-up token redacted):
- exit 0; ERRORS (0); no drift; no unsafe SQL; tsc 0 errors;
- **7 files, 74 tests passed**;
- build compiled; no client secrets;
- admin journey 10/10; security smoke 15/15.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0007_exports/migration.sql | 7cfbf530b546ed108b9477f349c836eff364de44267aff87e6580bdf16b21827 |
| src/server/exports.ts | 38dc450544b316c363e1020c532e84d88dfd05446435ff65ca11ec83f1a09979 |
| src/server/db.ts | e1ad131c7ae7c9802593830078464ba7931dda35118cf2c12e1e7afb2e183ef5 |
| src/server/centres.ts | 02cb136bf39ab66a0f43ab2956668aee95432542e6c606cdc98f1703f755c562 |
| app/export/[dataset]/route.ts | a7f3b3a78224fa99cbf852c24284644954d767daca1ceb8c5a381a68fc0014df |
| tests/exports.test.ts | b483bf3e1e91056fffee4a7f9c824b9900340b8191d56ad27b5a279969bfcaaf |
| scripts/smoke-security.mjs | 6636d0167decf244c4084e0b207e10a63876f4ca2dbd7c4d16a186db6780f118 |
| tests/foundation.test.ts | 2f0d67158eefce5c87e3420b475af50b0161240c89505b7e92f586389e38396e |
| evidence/exports-2026-10-27T185028.txt | e7f7c432695acbb6da509bf8e0ee2c1741973dd67ffb5d57ebe4af70f1763b24 |

**E-021 correction (same day):** `evidence/exports-2026-10-27T184726.txt` was *not* deleted, contrary to the line above (its `rm` was skipped by a failed `&&`). It is kept as the record of a failed run: 74/74 tests passed, but the security smoke failed with a SyntaxError in `scripts/smoke-security.mjs` (the CRLF defect, item 6). Deleted: `exports-.txt` and `exports-2026-10-27T184937.txt` (the wrong smoke filter).

## E-022 Audit trail: T-AUD-001…005 and 009 (2026-10-27)
- **Request:** the user said "push it and continue with the audit tests".
- **Push:** `b1c5962..857b51a`. GitHub run 40511940652 for `857b51a`: `completed / success`.

**Migration `0008_audit_fields`**
- New `audit_log` columns: `actor_kind`, `actor_roles`, `actor_scope`, `session_hash`, `request_id`, `client_ip`, `reason`, `before`, `after`.
- `app.redact(jsonb)`: masks values under Aadhaar, PAN, bank/account, IFSC, password, secret, token, TOTP/OTP, salt, API-key and recovery-code keys, recursively.
- `app.audit(…)`, a security-definer function that is **the only way app code writes audit rows**. Actor, session hash, roles, scope, request id and client ip come from the session and transaction settings, never from the caller. Direct `INSERT` is revoked from `gems_app` and `gems_job`, so the actor can no longer be forged by app code. `gems_auth` keeps its own inserts, because it runs before any session exists.

**App**
- `proxy.ts` gives every request an `x-request-id` (request and response headers).
- `src/server/request-context.ts` carries the request id and ip in `AsyncLocalStorage`, filled by `safeRoute` and `pageRead`.
- `withScope` sets `app.request_id` and `app.client_ip` transaction-locally.
- `scopedAction` audit extras: `before`, `after` and `reason` go to their own columns.
- RBAC: user status change records before/after status and a reason (now a required field on the form); role permission change records the before/after permission sets.
- `safeRoute` logs pass through `redactText` (Aadhaar, PAN, long numbers, credentials in DB URLs).
- Audit action names are now literals everywhere, so the gate can read them.

**Tests** (`tests/audit.test.ts`, 6):
- T-AUD-001: field set and one row per action; streamed export read outside the request context.
- T-AUD-004: `gems_app`, `gems_job` and `gems_auth` cannot UPDATE/DELETE/TRUNCATE; app/job cannot insert directly; the owner is stopped by the trigger.
- T-AUD-005: redaction in DB rows and logs.
- T-AUD-009: every catalogued action is written by its real event, plus the coverage gate (`tests/audit-catalogue.ts`, 28 actions: code ⇔ catalogue ⇔ tests).

T-AUD-002 and 003 were already covered (foundation, rbac, exports tests). 006/007/008/010 are pending (STATUS §4b).

**Gaps found by the new gate**
- First run: 12 catalogued actions had no test asserting them (`auth.login.locked`, `auth.password.rehash`, `auth.totp.failure`, `auth.recovery.failure`, `auth.recovery.regenerate`, `auth.reset.complete`, `auth.stepup`, `auth.stepup.failure`, `auth.sessions.revoked`, `rbac.user.enable`, `rbac.assignment.delete`, `rbac.role.create`).
- All are now exercised by triggering the real event.

**Defect found by the real-server smoke (fixed)**
- A streamed export's audit row had `request_id = null` over HTTP.
- Cause: Next reads the response body after the handler returns, outside its `AsyncLocalStorage` context.
- Fix: `exportCsv` captures the context at creation and restores it when the transaction starts.
- The failing run (`evidence/audit-2026-10-27T190239.txt`) showed `X-Request-Id 64686377-e037-46aa-8c92-c8c2093411c2 vs null`. That file was deleted before the rerun; this entry is its record.
- A regression test (export created in context, read outside it) was added; it fails when the capture is removed.

**Mutation checks** (all restored):
1. `app.redact` as identity: T-AUD-005 failed.
2. An audit action renamed in code without a catalogue entry: T-AUD-009 failed.
3. Request id not passed to the transaction: T-AUD-001 failed.
4. Context capture removed from exports: the stream regression test failed.

**My defects:**
- Test-design faults: changing a role the acting admin holds signed the admin out mid-test (correct product behaviour), so the test was reordered.
- The gate first picked up permission keys and a bootstrap SQL literal; it was narrowed.
- Inline Python edits failed twice on escaping and were replaced by exact edits.

**Final run** `evidence/audit-2026-10-27T190404.txt` (`bash scripts/ci.sh`, fresh DB, set-up token redacted):
- exit 0; ERRORS (0); no drift; no unsafe SQL; tsc 0 errors;
- **8 files, 80 tests passed**;
- build compiled; no client secrets;
- admin journey 10/10; security smoke **16/16**, including X-Request-Id = audit `request_id`.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0008_audit_fields/migration.sql | f07c744c6dec4992998462b7b72e640bf6338cc54b666a2b2a49774a2a1724c5 |
| src/server/action.ts | c6cad1342f8d09bfe9c73012f801269920f3f838f44165c4e3f6c6e2f55f04b9 |
| src/server/request-context.ts | 9c3cfea223679ebcdbf6a8751caaef783bb30eff32d5e5f0b671fc74c6816f3e |
| src/server/db.ts | 7bb0ccd98e58a75750fd53951421612ae39b55f8ccb8cad8b36665c059d2999d |
| src/server/safe-route.ts | 5dafa84ac1313ef39e73d0a7116c2740a09bd6f51d54f760a1bad79f0cb7e49e |
| src/server/page-read.ts | 2400d73aa410f0faabf6addcb9cd3e03746926ffe36f9ed7208a6dba4f960e36 |
| src/server/exports.ts | 730e05b4aaadbc211676d03ff8e7ad2abc49bcf1c298e0f2be55aa5e99d38b7e |
| src/server/rbac.ts | 9139a44f7be5a7ead3a21dcdbe32742b72021f8f5b600f771722418e8d810235 |
| proxy.ts | 1e6b3b37be8a3d61a93aa1f31c63e77a2d2ed82422b16103a10c71c773142e91 |
| tests/audit.test.ts | 19b7d968e9fed8bad38f634d0caf84fa750e93e8d4291c84ddd490105ffb1aa8 |
| tests/audit-catalogue.ts | 3e91aefff312ff6459a73b2ea6c022d0a1edf8af656beb35dc5c69d70a2351cc |
| scripts/smoke-security.mjs | 4211b7066e3af15ca0c5c9470ae94b040dcd93e1a6bd77e8c6c3f73feab095b1 |
| evidence/audit-2026-10-27T190404.txt | 5e92225d012be6f6da092fd38d4c9db1a89920837bfdea176983fc6b78137a24 |

## E-023 Ticket-engine design approved; build phase P1 (2026-10-28)
- **Request:** the user said "do next step" and, when asked, answered "Approve, start P1" for `docs/designs/ticket-engine/ticket-engine.md`.
- **Design:** the EGM review ran stages 5 to 9, each with fresh-context reviewers, and every finding was resolved; the reports are in `docs/designs/ticket-engine/`. The design status is now **Approved** by the project owner in session. Its business parameters (PMC) stay unsigned.
- **P1 (documentation), commit `eeb42b2`:**
  - `docs/adr/ADR-002-document-storage.md`, status **Proposed**; the owner, IT and Legal signatures are blank.
  - Audit 04 gains **D-STO-1** (upload limits, IT + Legal), which brings the open decisions to 116 (108 D-/PR- + NP-1…8). It also records the ticket notes on NP-1/NP-5 (DD-8, DD-10), D-TKT-2 (DD-9) and D-TKT-4 (DD-14). All of these stay PMC and not approved.
  - Audit 09 gains T-TKT-019…022, and marks the parts of T-TKT-002 (NP-8) and T-TKT-008 (notification) that are deferred out of Stage 2.
  - The matrix rows R-094.03 and R-094.04 gain the new tests, and R-094.03 gains D-STO-1. `02-requirements-traceability-matrix.csv` and the FRD were regenerated.
- **Checks:**
  - `python -I docs/audit/tools/build_matrix.py docs/audit`: ERRORS (0); WARNINGS 12, the same as before the change.
  - `bash scripts/ci.sh` exit 0 on a fresh local database. Tests 80/80 (8 files); no schema drift; build; no client secrets (10 files, 9 values, 4 patterns); real-server smoke 16/16.
  - The first CI run failed only because the regenerated CSV was not yet committed. That is the gate working as designed.
- **Code:** none. Phases P2 to P5 are not started.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| docs/designs/ticket-engine/ticket-engine.md | 6428616800f9e8f0f1f0fdda7d1184848269b5f7734a599e45d3b4bfe86f730f |
| docs/adr/ADR-002-document-storage.md | 7e6436ec3c0834051804d3656341c0aa3a07fcfb635e025bd408a61ae6d3978e |
| docs/audit/04-manager-decision-register.md | 5c543cf13297c733c86946ccf97ceb3ad0ecdea5c04fe7357af87b0b75344154 |
| docs/audit/09-test-strategy-and-acceptance-criteria.md | 234b02b93694bc8c41c33daea9d070a9207e306aa723b25eb3db5b3fcf714ab4 |
| docs/audit/data/matrix-04-logs-tickets-exams-supply.tsv | fc95d376bab7d99f0f2a59d4538714ad98c2bf55f472e82aa1328c8b86053af3 |
| evidence/ci-p1-2026-10-28T121950.txt | 9ebc04a9e8f9cee949de34eea31b152fa6bf4cca636faf70edbe9c46f98aee07 |

## E-024 Ticket engine build phase P2: schema, migration 0009, fixtures (2026-10-28)
- **Request:** "start that then", which started P2 of the approved design.
- **Commit `9ff5d54`:**
  - **`prisma/schema.prisma`:** ten ticket models and three enums. `AuditOutcome` gains `FAILED`.
  - **Migration `0009_tickets`, generated part:** the tables, keys, indexes and foreign keys came from `prisma migrate diff --from-config-datasource --to-schema` on a fresh database at 0008. That gives serial ids, Prisma constraint names (`ticket_pkey`, `ticket_document_upload_id_key`, `ticket_reraise_of_key`) and `ON DELETE RESTRICT`. `ADD VALUE 'FAILED'` was moved first, and nothing in 0009 uses it.
  - **Migration `0009_tickets`, hand-written part:**
    - shape checks;
    - RLS on the five per-ticket tables (the 0002 loop) and on the four setup tables (everyone reads; writes need `ticket.type.manage` network-wide, in `select`-wrapped form);
    - guard triggers `ticket_guard` (insert and update) and `ticket_level_guard` (insert);
    - `ticket_immutable` on `ticket_event` and `ticket_document`, for update, delete and truncate;
    - the internal `user_centre_ids` helper and the six definer functions;
    - five permissions, the grants, and usage on the five sequences.
  - **Tests:**
    - `tests/sql/ticket-test-handler.sql`.
    - `reset()` truncates the ticket tables and the counter (`test_ticket_counter` via `to_regclass`) and re-seeds the five ticket permissions.
    - Nine ticket fixture users with roles 10 to 16; existing fixtures are unchanged.
    - `setStepUp`, `newSession` and `rows` moved into `fixtures.ts`.
    - The T-RLS-002 table list and the T-RLS-005 definer inventory are updated.
- **Probe on the live database** (transaction rolled back), 11 cases:
  - refused: an insert that is not OPEN; a level past `level_count`; a level insert after the RAISE event; an update without a version bump; approval below the last level; a jump of two levels; a change to a closed ticket; an update to `ticket_event` (message "ticket_event is append-only");
  - succeeded: the legal path (level 1 → 2, then APPROVED at the last level, version 3);
  - `ticket_type_lock` returned the row.
- **Ad-hoc check:** this throwaway test is not committed. Every fixture session resolves to its intended centres. As `gems_app`, the eligibility functions return false or nothing for an unknown ticket.
- **Findings while building, written back into the design:**
  1. `app.account_usable()` refuses a session for a user with no role assignments, so the "viewer" fixture gets a role with no permissions (`tk_member`).
  2. `ticket_may_receive` also refuses a target who already approved the ticket. Under DD-14 that target could not act, so the ticket would be stranded.
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: T-DOC-001 0 errors; no schema drift; typecheck; **80/80** tests (8 files); build; no client secrets; real-server smoke passed.
- **Not yet tested by the suite:** the triggers and functions get their permanent tests in P3 (`tests/tickets.test.ts`, design item 19).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0009_tickets/migration.sql | ecc557304c7bf305a8154fee4e5bc576c23442d815200088c2fb6b4ed015cd0a |
| prisma/schema.prisma | 132795a24d489079fe7239b23c6514db77320929deeb7504079a84a489e1e582 |
| tests/fixtures.ts | 12f567f8032482de78bde3db05e88c4457e1a2ec0461241b300b2b728f77b051 |
| tests/foundation.test.ts | 5ce18f6f63cb306f8314943400003bbfe8b25717a71e8b244a11890e6a28e24c |
| tests/sql/ticket-test-handler.sql | 641be5d44197631a08142afba2e530713a67113da96a61374b1dd4c6981e6264 |
| evidence/ci-p2-2026-10-28T123134.txt | 9907f2c96183968a552f12b6d0c091ec4700fcc22c1eb67034b6d2370832cf1c |

## E-025 Ticket engine build phase P3: server modules and tests (2026-10-28)
- **Request:** "do next step", which started P3 of the approved design.
- **Commit `3ec391e`:**
  - `src/server/tickets/engine.ts` (requestUpload, raise, act, reassign, the reads, documentLink, ticketDb)
  - `src/server/tickets/setup.ts`, `handlers.ts`, `test-handler.ts`, `policy.ts`
  - `src/server/storage.ts`, `storage-fake.ts`
  - `action.ts`: the onFailure hook (FAILED); a failed audit write no longer masks the original error
  - `rbac.ts`: `adminWrite` exported; the `RbacError` message key
  - `numbering.ts`: ticket number allocation and format
  - `tests/tickets.test.ts`
  - the audit catalogue (+15 actions) and the gate scan of the ticket modules
  - `STORAGE_DRIVER=fake` in CI, required by `ci.sh`
- **Tests:** `tests/tickets.test.ts` has 30 passing tests and 3 `todo`:
  - T-TKT-001…015 and 019…022;
  - the guard triggers, idempotent raise, the upload gate, deactivation, setup refusals and message keys, the handler change with open tickets, the failure hook (DENIED vs FAILED, an exhausted P2034 writes no FAILED row, an audit fault does not mask Forbidden), 404 parity, the eligibility property (queue ⇔ approve succeeds, exactly {l1, both}), no leaks across centres, and the load guards;
  - `todo`: T-TKT-016/017/018 (Stage 5 and the domain modules).
- **First run:** 4 failures, all in the tests or the API shape, none in the engine logic, all fixed:
  - an update matching no rows fires no row trigger;
  - a "lying browser" case declared the true size;
  - an assertion on the first audit row (DENIED) instead of the OK row;
  - synchronous validation throws in `setup.ts`, now `async`.
- **Mutation checks (POC P5):** all three caught; record `evidence/mutation-p5-2026-10-28T124459.txt`.
  - Exactly once: T-TKT-006 failed, and the guard trigger still refused the second change.
  - All or nothing: T-TKT-007 failed.
  - Self-approval: T-TKT-010 failed.
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: T-DOC-001 0 errors; no drift; typecheck; **110 passed + 3 todo** (9 files); build; no client secrets; real-server smoke passed.
- **Not yet:** routes, screens, CSP and the HTTP-level checks (P4); the manual Supabase run (P5).

**Requirements VER: still 0.** These are engine-level tests on synthetic data; marking R-094 rows VER waits for the routes (P4) and for a handler from a domain module.

| File | SHA-256 |
|---|---|
| src/server/tickets/engine.ts | f0b82a1dfab9700f45fda30c5ae5e69a8c686d0d8ac4e56920b390affae7af91 |
| src/server/tickets/handlers.ts | 920e2b61224a223ef91e92625d52fafdcee0eee0fea461c3bb5a27543da7978f |
| src/server/tickets/policy.ts | 30b9d2e34579bd617128c663fbbc21969bfc872702d6d39eba1bb46cce9f2338 |
| src/server/tickets/setup.ts | 2f1e7d97335e5c2d238d9beb0462761755dd9c10201952d5a0f4952747138096 |
| src/server/tickets/test-handler.ts | 975f4a92113a9cd90e6a25533cfa6cbca2f900abccac7a3eef39066e925969e7 |
| src/server/storage.ts | de2bc610373dba35fa2ac27ccd743ae509c573f5f940c58d94ea9c5fa7f04802 |
| src/server/storage-fake.ts | 7ca76f66de8b11635e3045e0ea5ad76448e4a3b489a042b60d1d5830a0326bb4 |
| src/server/action.ts | 1ea134a5383e478605f0c84c336fdd5ca97de579c804abdba10473b3d0842210 |
| tests/tickets.test.ts | fc90aa139b31fd5289a10f92338adcf91a0830cf67eefbbb3efe49c07e5c1bb6 |
| evidence/ci-p3-2026-10-28T124459.txt | 84abc47fa30b121db8255c7ac2906e4fcb0f46f8c7a6b2b4509bcb6cb4525798 |
| evidence/mutation-p5-2026-10-28T124459.txt | 38d969cd5f0464a8a45f316bf4838f380df69993549990fffb6f4e7037679463 |

## E-026 Ticket engine build phase P4: routes, screens, CSP, HTTP-level checks (2026-10-28)
- **Request:** "do next step", which ran P4 after P3 was green.
- **Commits `00ab8a0` and `6fbab77`:**
  - **Routes**, each exporting `POST = safeRoute(...)`: the JSON upload request, raise (idempotent form id; `getAll("uploadId")`), act, administrator reassign, and document download (a same-origin POST answered by 303 to a signed URL); ticket-type create and save, which dispatches on `op`.
  - **Pages:** ticket list; the two-step raise form, including re-raise; ticket detail with history, documents and the act and reassign forms; the approvals queue; ticket-type administration; the upload client component; home links.
  - **`adminPost`:**
    - maps ticket errors (`?error=ticket.<reason>`, plus a `detail` key for stale) and `TicketNotFound` → 404, `TicketDuplicate` → redirect;
    - uses the `RbacError` key;
    - `back` can be a function of the posted fields.
  - The ticket message texts were added. The shared `forbidden` text is now generic, and the RBAC hint is shown on the four RBAC pages.
  - `pageRead` maps `TicketNotFound` to 404.
  - `buildCsp` (`src/server/csp.ts`) adds the storage origin to `connect-src` and `form-action` only when `SUPABASE_URL` is set.
  - `scripts/storage-setup.mjs` reads its limits from `policy.ts`. Checked that Node 24 imports a `.ts` file from `.mjs` (`10485760 application/pdf,image/jpeg,image/png`).
  - The bundle scan adds `SUPABASE_SERVICE_KEY` and `sb_secret_` keys, and decodes JWTs to look for `role = service_role`. The decoder was checked against a constructed service-role token, which is detected, and an anon token, which is ignored.
- **Tests:**
  - a CSP unit test (`tests/sec.test.ts`);
  - all seven new POST routes in the same-origin loop, with the ticket tables counted (`tests/admin-http.test.ts`);
  - in the real-server smoke, a ticket at a hidden centre gives a 404 page identical to a missing one, and the own-centre ticket gives 200.
- **First CI run:** exit 1. Only the new smoke parity check failed, and the cause was in the check, not the app. Fetched by hand from a running `next start`, the two pages were identical. The smoke's shared `normal()` strips digits after `"k":"`, which cut ticket uuids that start with digits, so the failure was intermittent. The fix, in `6fbab77`, replaces uuids first.
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: T-DOC-001 0 errors; no drift; typecheck; **111 passed + 3 todo** (9 files); build; bundle scan (11 files, 9 values, 6 patterns, nothing found); real-server smoke **18/18**.
- **Not yet:** P5, the manual Supabase run and its evidence, which needs a Supabase project and service key.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| src/server/admin-http.ts | d257343193d67edd7a66e85d3f908f635a0829908f293d74a089e5001c4e8c3c |
| src/server/csp.ts | 769c5e87fcaed3b84473990c7e34aadfe93aefa7b53f66a32a5ea85b089113df |
| src/server/page-read.ts | 97c9a307e139732ccb9028489cb777018809cdc63d132af795e4a572b474e43d |
| scripts/smoke-security.mjs | 1e83bf0a29c4e81118f1d23e03107486cebecb38823528675588b6afded4f3fb |
| scripts/scan-client-bundle.mjs | 4ab0b777240aebec979235526d36a0ede29f9343c03b64bb29282d5702c51e22 |
| scripts/storage-setup.mjs | 1310b9d5767ceafc00787e46b2156efc80ed0404a93b28294e93c053a6909247 |
| evidence/ci-p4-2026-10-28T125409.txt | 1b0efedfa2830ff4b8dcdf7112e7d6432cc6ba7b8d0bfde078546ee6c4cf54a6 |

## E-027 Ticket engine build phase P5: manual Supabase run (2026-10-28)
- **Request:** "do next step". The owner put the Supabase settings in place. The `.env.local` save did not land, so the owner pasted the keys in chat and Claude wrote them to the git-ignored `.env.local`. **The keys must be rotated** (STATUS §5).
- **Project:** the same Supabase project as the existing `.env` database URL. The new bucket is `ticket-documents`, created by `scripts/storage-setup.mjs`: private, 10,485,760 bytes, PDF/JPEG/PNG. A second run reported "already matches".
- **Part 1** (`scripts/manual-supabase-storage-probe.mts`, through `src/server/storage.ts`):
  - signed upload 200; upload link valid **7,200 s**;
  - second PUT to the same key 400, and a new upload link for an existing key refused (400);
  - Range 206 `bytes 0-15/64`; `head()` signature and size correct; a missing object gives null;
  - signed download 200 with identical bytes;
  - `text/plain` refused by the bucket (400); public URL refused (400);
  - **DD-15 Data API check: passed.** The OpenAPI listing shows no `app` tables, and `Accept-Profile: app` gives 406 PGRST106.
  - Test objects deleted.
- **Part 2** (`scripts/manual-supabase-run.mts` against `next start`, with the production build, `TICKET_TEST_HANDLER=1`, real storage and the local database reset to the fixtures):
  - the CSP carries the storage origin in `connect-src` and `form-action`;
  - the raise form shows the handler field;
  - upload request 200, PUT to Supabase 200;
  - raise 303 to the ticket `TK-26/FNC/1`, with the document stored as `application/pdf`, 74 bytes; resubmitting the same form id redirects and creates no second ticket;
  - approvals at level 1 and level 2 without errors: APPROVED, version 3, domain change applied once;
  - the download is a 303 to a signed storage URL, with identical bytes;
  - audit: `upload.request` 1, `raise` 1, `approve` 2, `document.download` 1, all OK;
  - the uploaded object was deleted; the server log has no errors.
- **Not covered:** a real browser (the upload component's PUT under CORS, and following the download 303 under CSP `form-action`). Recorded as open in STATUS.
- The DD-7 harness (test handler) was switched on only for this local run. The scripts read secrets from the environment and contain none; the evidence file contains no keys (checked).

**Requirements VER: still 0.** No production handler exists; the R-094 rows need a domain module's handler and its tests.

| File | SHA-256 |
|---|---|
| evidence/manual-supabase-run-2026-10-28T130635.txt | 6f3ad2e1721117b239c59e4aed24e534575c285f955bb018daca2451523b17d4 |
| scripts/manual-supabase-storage-probe.mts | ef70f7f50313bcced5beaa0031dd3cb1d8e3fed999f2ae2b7d5831d0b3e59add |
| scripts/manual-supabase-run.mts | cf91d42a5a2ee526b25254f8c4f213315d945654510427d0f6ba484011a5a9ac |

## E-028 Ticket engine: real-browser check (2026-10-28)
- **Request:** "do next step". This was the last open technical item of the engine core: the real-browser part of the manual Supabase run, which E-027 left open.
- **Setup:** Chrome, driven through Claude in Chrome, against `next start` on localhost with the production build, `TICKET_TEST_HANDLER=1` and real Supabase Storage. The local database was reset to the test fixtures with one active document-required test type. Sign-in used the fixture test session tokens as the session cookie, on localhost only; the cookie was cleared afterwards.
- **Results:**
  - **Upload under CORS:** the upload component's cross-origin PUT to Supabase succeeded ("certificate.pdf: uploaded"), and the server attached the document only after reading the stored object back.
  - **Approval:** at level 1 the page showed "Level 2 of 2", then at level 2 "APPROVED", with no errors.
  - **Download under the CSP `form-action` rule:** the browser followed the 303 to the signed Supabase URL (GET 200), with no CSP messages in the console.
  - **Database:** APPROVED, version 3; events RAISE, APPROVE, APPROVE; document `application/pdf`; counter 1.
  - **Audit:** `upload.request` 1, `raise` 1, `approve` 2, `document.download` 1, all OK.
- **Cleanup:** the storage object was deleted, the tab closed and the server stopped (its log has no errors). No test files were left in the repository.
- **Code:** none changed.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| evidence/browser-check-2026-10-28T131230.txt | f96c61a8abd4dcac5aeec01cd12a534e5529d92a7eb9daaec0af613910b2de8d |

## E-029 Search rate limit, T-SEC-015 search part (2026-10-28)
- **Request:** "do the search rate limit", chosen by the owner after async large exports were deferred.
- **Commit `eed7d01`:**
  - **Migration `0010_search_rate_limit`:** `app.rate_hit`, with no grant to any app role, and `app.rate_take(bucket, max, minutes)`. That definer function checks and records in one step for the session's own user, prunes that user's old hits, and returns false without a session.
  - **`src/server/rate-limit.ts`:** `SEARCH_POLICY` 30 per minute per user (PMC, D-OPS-1). `listCentres` counts a search only when there is a search term.
  - **The centres page** shows "Too many searches" over the limit. **Deviation from the T-SEC-015 wording ("429"):** a Next.js page cannot set its status. The module throws the same `RateLimited` as exports, which do answer 429.
  - **Known ceiling:** concurrent calls may both pass at the last slot, because there is no lock. This is documented in the migration.
- **Tests:**
  - T-SEC-015 search: 30 searches pass and the 31st is refused (`retryAfterSeconds` 60); a plain list is not counted; budgets are per user; the window frees it; old hits are pruned; the app role cannot delete from the table.
  - T-RLS-005 inventory: adds `rate_take`.
  - `reset()` truncates `rate_hit`.
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: no drift; typecheck; **112 passed + 3 todo**; build; bundle scan (10 secret values including the now-configured Supabase key, 6 patterns, nothing found); real-server smoke passed. The saved log contains no keys (checked).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0010_search_rate_limit/migration.sql | b6f9a425f27c7e08bbeae7a8bb5256ec49491c36bebd1feeca29b76feebb012a |
| src/server/rate-limit.ts | bafdbdf184419f15c7af2f06f106ea0f26da4a55d1d7a68dd026ba6595ac2d20 |
| src/server/centres.ts | 898a0a31eec294166aab05a46486338200464cfb01dd35be225d1e8645be088b |
| evidence/ci-search-limit-2026-10-28T134450.txt | ce306b57309bfca0f7a9913d06fe0a20b4d299491013b0f3cab6d4b0b11eed2f |

## E-030 C-26 investigation: Supabase connection drops (2026-10-28)
- **Request:** "do next step", then explicit permission to provision the POC schema and roles on Supabase, run the investigation and tear down.
- **Setup:** `poc/supabase.mjs setup` on the existing project.
  - Pre-check: no `app` schema, no `gems_*` roles, no `public` tables; buckets `resumes` (old) and `ticket-documents`.
  - The database allows **60 connections**. The proof's "direct" connections go through the **session pooler** (5432); its pooled ones through the **transaction pooler** (Supavisor, 6543).
- **Three full runs** (`poc/evidence/c26-supabase-fullrun{1,2,3}-2026-10-28.txt`):
  - **Runs 1 and 2: 39/39 green.** These are the first fully green runs on Supabase (E-010 had none).
  - **Run 3: 34/39.**
    - The one real failure is T-NUM-001 (UNIQUE mode, 200 concurrent allocations through 16 pooled clients): `read ECONNRESET`.
    - T-NUM-002…005 then failed with `deadlock detected` inside `reset()`: a server session orphaned by the drop held a lock that `TRUNCATE` waited for. This is a harness knock-on, not a product fault.
- **Experiment** (`poc/c26-experiment.mjs`; `poc/evidence/c26-pool-experiment-2026-10-28.txt`): the T-NUM-001 workload repeated at client pool 16, then 12.
  - Size 16, runs 1–6: all clean (200/200 committed and distinct, no errors, about 33 s each).
  - **Run 7 stalled indefinitely.** After about 75 minutes the process still held **2 established TCP connections to the transaction pooler (6543)**, while `pg_stat_activity` showed **0 client sessions** for `gems_*` or `postgres`. The process was killed; size 12 never ran.
- **Finding:**
  - The drops come from **Supabase's transaction pooler under sustained concurrent load**, not from Postgres or our code. Sometimes it resets the client connection (`ECONNRESET`). Sometimes it silently stops answering: the client waits forever, while the database has no session doing the work.
  - The pool-size hypothesis (16 clients against a server pool of about 15) is **not confirmed**: six runs at 16 were clean, and the stall left no server sessions, which is not how pool exhaustion looks.
  - **No run, now or in E-010, showed wrong data:** no leaked rows, no duplicate or skipped numbers.
- **Consequence for the app:** a request can fail, or hang until the platform's function timeout, when the pooler drops it. Mitigation, not built yet (STATUS):
  - client-side connection and query timeouts with TCP keepalive, so a stalled connection fails fast instead of hanging;
  - treat a connection error before COMMIT as retryable in `withScope`. A drop **during** COMMIT leaves the outcome unknown, which the existing idempotency keys cover for receipts and numbers.
- **Teardown:** `poc/supabase.mjs teardown`. Verified: `app` schema 0, `gems_*` roles 0, `poc/.env.supabase` deleted. The evidence files contain no credentials (checked).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| poc/evidence/c26-supabase-fullrun1-2026-10-28.txt | b9cf099e273117cebdf3955c8ad8e1557c5c1b333f0d81fd35c63c2990669708 |
| poc/evidence/c26-supabase-fullrun2-2026-10-28.txt | 04a75eb9e11f1d9aedbf3e472ddf6f8d9cc8498e124e2468b5db56dcaffb4c82 |
| poc/evidence/c26-supabase-fullrun3-2026-10-28.txt | ac2bb2c48493685c896b8db0a492671a748c5ed1ce0e316966cf6603fa4615cc |
| poc/evidence/c26-pool-experiment-2026-10-28.txt | 9c49f5db69ac2fda28b3bbdd0d6c94d32ee52f748c020ceb9ee9a59236f3b92e |
| poc/c26-experiment.mjs | b30424af25e933915554a8030435a2d0e999d6f334a23530e91af37fdaa951c3 |

## E-031 C-26 mitigation in the app (2026-10-28)
- **Request:** "push to github and do the mitigation". Commit `d97cc2c` was pushed first.
- **Commit `c9f2a30`:**
  - **`src/server/db.ts`:** `DB_POLICY` on the pg pool (connect 10 s, per-query 60 s, TCP keepalive; PMC, D-OPS-1). `isConnectionLost()` recognises the adapter kinds (`ConnectionClosed`, `SocketTimeout`), socket codes, Postgres 57P01/02/03 and 08000/08003/08006, and the pg driver's messages, across the error chain.
  - **`withScope`** retries an attempt whose connection was lost **before** COMMIT, using a flag set after `fn` returns. A loss during COMMIT is not retried, because its outcome is unknown. P2034 retries are unchanged.
  - **Ticket engine:** a lost connection inside `handler.apply` passes through to be retried instead of becoming `ApplyFailed`.
- **Probe** (local, PgBouncer): killing the server backend mid-transaction reaches the app as `Error: Client has encountered a connection error and is not queryable` (no code). The detector covers that message.
- **Tests:**
  - `tests/foundation.test.ts` "lost connections (C-26)":
    - a killed backend mid-transaction is retried and the allocation commits exactly once (2 calls, counter 1);
    - with retries off, the loss is recognised; an ordinary error is not retried (1 call);
    - the detector accepts 8 lost-connection shapes and rejects 6 others (including P2034 and a unique violation).
  - `tests/tickets.test.ts`: a lost connection inside `apply` is retried 4 times and writes no FAILED row.
- **Mutation check:** removing the lost-connection clause from `withScope` made the retry test fail. The original was restored (`cmp` equal) and passed again.
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: no drift; **115 passed + 3 todo**; build; bundle scan; real-server smoke passed.
- **Limit:** not proven against the real Supabase pooler failure, which reproduces only rarely (E-030). The local test reproduces the same event, a server connection killed mid-transaction.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| src/server/db.ts | 9e5f2c485987555b68de3db47a921479055cf4401e03c81465aa2de7abd570cc |
| src/server/tickets/engine.ts | 0c18ae5a88b003569920b9219b416727a15f4c3c04469270729cd923e6c005b0 |
| tests/foundation.test.ts | 5b06b16bcf53a203fd1444c4e803e406ace1a6cf7bfa7ca360032133301ccba0 |
| evidence/ci-c26-mitigation-2026-10-28T153135.txt | ca49e6f7bd09e5d64be37fe80eac6c82283e18c3fb731f83c8983ec6e29e9866 |

## E-032 Person, admission and registration core built (2026-10-28)
- **Request:** "approved, start building". The design `docs/designs/person-core/person-core.md` was marked Approved (EGM Stages 5–9 resolved, reports in the same folder) and built in phases Q1–Q4, each ending with `bash scripts/ci.sh` exit 0.
- **Q1 (commit `00c7e47`, documents):** T-PER-001…005 in audit 09; T-PER links on R-029, R-150, R-095 (T-NUM-007/010 kept on R-029); D-STU-5 (person merge) added to audit 04, D-STU-4 and NP rows annotated; superseded note in the ticket-engine design; matrix and FRD regenerated (0 T-DOC errors).
- **Q2 (commit `902b369`, schema):** migration 0011. `ticket_number_series` renamed to `global_number_series` (series `TICKET` added, primary key (series, period)), hand-edited so the counter survives; `person`, `admission`, `registration` generated from the Prisma schema (composite foreign key registration (admission_id, centre_id) → admission (id, centre_id)); `app.person_match_key` (immutable) and its trigger; the academic-year check; RLS (0002 loop on admission and registration, person through an admission, insert needs `student.admit`, no delete); permissions `student.view`, `student.admit` (`sensitive = false`, PMC under D-SEC-4); grants (update only on the six identity columns). `allocateGlobal` replaces `allocateTicketNumber`. No drift.
- **Q3 (commit `fb6b2c2`, server):** `src/server/people.ts`: `admit` (one `scopedAction`, advisory lock on the match key, duplicate check in the caller's `student.admit` scope, linking needs `student.admit` where the person is already admitted, chained ADMISSION years, REGISTER `mustExist`), `changeIdentity` (bound to the ticket's centre through `assertAdmittedAt`, returns changed fields before/after), `getPerson`, `findMatches`, `personDb` error mapping. Audit action `person.admit` catalogued and scanned by T-AUD-009.
- **Tests:** `tests/people.test.ts`, 7 tests: T-PER-001…005 (T-PER-003 in three parts) and the first CI test of T-NUM-010 (first Register No 2064113, first Admission No GTEC262743888 from the cutover-style seeds). Fixtures: role 17 `student_admin`, users `sa` (A), `sb` (B), `sr` (REGION 1), `sh` (ALL); `hoAll` unchanged.
- **Mutation checks** (each restored afterwards; the file compared equal and the suite passed again):

  | Mutation | Test that failed |
  |---|---|
  | person select policy `using (true)` | T-PER-004 |
  | skip `findMatches` in `admit` | T-PER-002 |
  | allocate the Register No in a separate transaction | T-PER-003 (rollback) |
  | drop the centre check in `changeIdentity` | T-PER-005 |
  | ignore `previous` in `allocateGlobal` | T-PER-003 (numbers) |

- **Supabase check (design item 4, K7):** `scripts/manual-supabase-matchkey.mjs`, read-only, evaluated the name rule on the hosted database (PostgreSQL 17.6, `lc_ctype` `en_US.UTF-8`, same as local `en_US.utf8`): a Malayalam name stays two whole words and matches when swapped; Latin swap and single name as locally. Migration 0011 was **not** applied to Supabase.
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: no drift; **123 passed + 3 todo**; build; bundle scan; real-server smoke passed.
- **Limits:** functions only (DD-3), no screen; the cutover seeds (REGISTER, ADMISSION 2026-27) wait for NP-8; after a move the old centre's registrations stay ACTIVE until the Stage 3 transfer ticket (recorded limit).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| src/server/people.ts | d422be4745f6599aa69b071f871dcd5349c20cc3215664d1bd87d6945fcd8808 |
| src/server/numbering.ts | 4885fcd577739bb44d91616d7c1599eed668e4b29b5e6c472062626225922d89 |
| prisma/migrations/0011_person_core/migration.sql | 62c1c60f60619b47e423df4499a7f71e9d55dfbb94da27c41b9599a58b2b212d |
| tests/people.test.ts | 7dd55013c338d70b0f8fb8e549e922474c141113e48773bee57c9848349d5046 |
| scripts/manual-supabase-matchkey.mjs | 5cfed23d066d6228b756a0157cf421322200b0005f4bc6e3872058e7a0c81a03 |
| evidence/ci-person-core-2026-10-28T165401.txt | e5379e92960a1412eeba582833922eb2b58d4d6391835b5a5c2c7101c0347f1c |
| evidence/supabase-matchkey-2026-10-28.txt | 5976dc689a159d4cb1a7ae80c36154b406cc825d78207822d6e0d0ae299a9628 |

## E-033 Migration framework (ETL foundation and P8) built (2026-10-28)
- **Request:** "Approve, start building" (design `docs/designs/migration-framework/migration-framework.md`, Approved after EGM review steps 5–9; reports in the same folder). Built in phases M1–M4, each ending with `bash scripts/ci.sh` exit 0.
- **M1 (commit `fc37d91`, documents):** audit 09 T-MIG table gains a `Stage 2` column (P8 on synthetic data for 001–006 and 009; Stage 4 for 007/008; legacy data for 010/011); T-RLS-015 note (setup-script confinement, go-live drop, no RLS on `raw`/`migration`). No matrix change.
- **M2 (commit `45e5225`, setup):** `scripts/etl/setup.mjs` (schema owner via `MIGRATE_URL`; creates `gems_etl` with defaults plus `login bypassrls noinherit`, checks its attributes, sets the password with `format(%L, $1::text)`, runs `setup.sql`, grants CONNECT), `setup.sql` (schemas `raw`, `migration`; the five migration tables; the P8 source tables; revokes from public/anon/authenticated; column-level grants so `gems_etl` can register but never approve a rule), `reset.sql` (keeps `migration.rule`). `ci.sh` runs setup after both `migrate deploy` calls; three new variables in `ci.yml`, the required-variable loop and the bundle scan.
- **M3 (commit `3d374d9`, runner):** `etl/run.ts` (`run()`, steps 0–7: advisory lock, empty-database and counter preflight, rule registration with code hash, raw load, identities field by field with `identityField()`, match keys from `app.person_match_key`, rules centre → admission/person → registration, one write transaction, counters from the highest number on any raw row, checks, digest, artifacts, two audit rows with `actor_kind = migration:<run>`); `etl/checks.ts` (K1–K6, `validateResults`, `k5`, `runStatus`); `etl/canonical.ts` (code-point canonical rows, `inputHash`, `digest`, `fingerprint`, `codeHash`); `etl/ids.ts` (UUIDv5); three rules; `etl/fixture.ts` (mulberry32, 2,014 admissions, 3,006 course rows, planted defects). `people.ts` exports `identityField`, `isoDate`, `IDENTITY_KEYS`, `StoredIdentity`, `ACADEMIC_YEAR_RULE` (no behaviour change; `tests/people.test.ts` green).
- **Tests:** `tests/etl.test.ts`, 11 tests: units (RFC 9562 UUIDv5 vector, code-point canonical form, rules on hand-written rows, `k5`, `validateResults`, `runStatus` per gate); P8 (two dry runs, every defect's disposition and reason, no PII in the exceptions CSV, no person without an admission, `unparsedNumbers` and `laterYearNumbers`, equal digests, `admit()` continues at GTEC262743888 / 2064113); T-MIG-002 duplicate key-map row refused (23505); audit rows; refusals (cutover without approvals leaves no rule or run row; same version with changed code refused in dry mode; existing counter; non-empty database); a cutover with approved rules on the fixture ends FAILED; G6 (no Prisma migration mentions `gems_etl`, it owns nothing, it cannot insert an approved rule, approve one, or write `key_map.approved_by`: 42501).
- **Evidence run** (`ETL_EVIDENCE=1 npx vitest run tests/etl.test.ts`, P8 run 2): status PASSED; digest `3c856639…aee8974f`, equal to run 1; `lc_ctype` en_US.utf8. Dispositions: centre 3 IMPORTED, 1 EXCLUDED, 2 REJECTED; person 2,006 IMPORTED, 2 MERGED, 6 REJECTED; admission 2,008 IMPORTED, 6 REJECTED; registration 2,997 IMPORTED, 9 REJECTED. K1 ×4, K2 ×36, K3 ×3, K4, K6 ×3 passed; K7/K8/K10/K11 not applicable; K9 digest. Counters seeded REGISTER 2,064,112 and ADMISSION 2026-27 43,887 (both from excluded GDEMO rows). 24 exception rows, fingerprints only (the CSV contains none of the planted raw values).
- **Mutation checks** (`evidence/mutation-etl-2026-10-28.txt`; each file restored afterwards and the suite passed again in CI):

  | Guarantee | Mutation | Test that failed |
  |---|---|---|
  | Determinism | `randomUUID()` in `uuidv5` | P8 (T-MIG-001…009), T-MIG-002, audit rows |
  | No silent drop | no key-map row for REJECTED keys | P8 |
  | Provenance | an unmapped person inserted before the checks | P8 |
  | No lost target | the first registration batch skipped | P8 |
  | Duplicate disposition | unique index dropped | T-MIG-002 |
  | Merge integrity | MERGED pointing at a non-imported survivor | P8 |
  | No unreachable person | the person of an unusable row imported | P8 |
  | Cutover approval | approval check skipped | G5 refusal |

  (The audit-rows test also failed under several mutations because it expects a PASSED finish row.)
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: no drift; **134 passed + 3 todo**; build; bundle scan; real-server smoke passed.
- **Limits:** synthetic data only (no legacy access until Stage 0); K5 has no case in the Stage 2 targets (unit-tested); K7/K8 wait for Stage 4, K10/K11 for legacy data, so a cutover run cannot pass yet (by design); setup has not run on Supabase (first rehearsal); no command-line launcher (DD-11).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| etl/run.ts | 5a860b5690a031dad5b7057ff8be4ee23c190d88828a01b257f382ea13246f3e |
| etl/checks.ts | a2a45ef919804179fcf61dcfba9487818119e411b872b5b689da54da8619df6f |
| etl/canonical.ts | fd87a94cddba2e8dfa0cf143851376510e44d03c02147af316fb31f0838cbe68 |
| etl/rules/admission.ts | 86efc832912c80ec902e0eabc0816da107e0ec6dd819cfe9897995acb7c0bb81 |
| etl/rules/centre.ts | 34b4591797494835dafbc6301834ad1f6e18844dc87ebe7e8c917bbcd6b5e6a7 |
| etl/rules/registration.ts | 6ddbe4fd46d79a4683be930214d700d7977058181458e7601641c346632dedc6 |
| etl/fixture.ts | cfdbc62a93393e5728a9f4eae905dc88f2333c4dc65f45c36c37729320553c53 |
| scripts/etl/setup.sql | 069a4c0183fad1a8d8c2d0f448071689dff0a0c6967890b119f35fea5259573b |
| scripts/etl/setup.mjs | 00a69efc29befbda0e220c2b61bf511e4f7b3df58577d49a148a59977149e0a7 |
| scripts/etl/reset.sql | f2292499eb2c8f6edb969d6eb71327d82fb24015b20937a9857f491e9808aa22 |
| tests/etl.test.ts | 8f44fa74cb17a95b39586cdda4322c33c23a80b5de14ceaf90e0d7b54f8c7171 |
| evidence/etl-19b6d7c9-9da5-4e44-9a6e-3e3f335a0d9e.json | c4349320ef52482d5b925586e790c66da8733a65b74032e6ce1bbfabca182530 |
| evidence/etl-19b6d7c9-9da5-4e44-9a6e-3e3f335a0d9e-exceptions.csv | e1882ec7450c43441af446e406509adf08477b2cf613bc4ed2d87b8804a5485c |
| evidence/mutation-etl-2026-10-28.txt | 5059d8ded971b2894d67779f86b0da2298afd041004a61a4de30523efeaafd60 |
| evidence/ci-migration-framework-2026-10-28T181602.txt | 7b78b3f6179c53bba30f7d68f8d50b470e51508b25e601725d84163f2d8a472a |

## E-034 Centre and catalogue skeleton built (2026-10-29)
- **Request:** "start with next steps" (2026-10-29), taken as the design owner's build approval of `docs/designs/catalogue-skeleton/catalogue-skeleton.md` after EGM review steps 5–9 (reports in the same folder). Built in phases C1–C4, each ending with `bash scripts/ci.sh` exit 0.
- **C1 (documents):** audit 09 gains the T-CAT table (001–004); matrix Tests column: T-CAT-001…004 on R-090, T-CAT-001/004 on R-033.06–.08, T-CAT-001/002 on R-028; CSV and FRD regenerated (0 errors).
- **C2 (schema):** migration `0012_catalogue`: tables `course_category`, `course_division`, `centre_class`, `course`, `academic_year`; foreign keys `registration.course_code → course(code)`, `admission.academic_year → academic_year(code)`, `centre.centre_class_id → centre_class(id)` (all restrict on delete and update); `centre.centre_class` dropped behind a guard that refuses if it holds values; named code, name, year and date checks; setup-table RLS (no delete policy); column-level update grants (codes never updatable); `catalogue.manage` (sensitive) granted to `system_admin`. `scripts/bootstrap-admin.mjs` adds `catalogue.manage` (DD-12); `scripts/etl/setup.sql` grants `gems_etl` select on `app.course`, `app.academic_year` (0012 does not mention `gems_etl`). Fixtures seed GEN/GEN/METRO, five courses, years 2024-25…2028-29, role 18 `catalogue_admin` held by `ca` at ALL.
- **C3 (server and rules):** `people.ts` exports `normCode()` and `CODE_RULE`; `admit()` normalises course codes and, first in its transaction, refuses a closed or unknown year (`academicYear: not open`) and an inactive or unknown course (`courses[i].courseCode: no such course`). `src/server/catalogue.ts`: nine functions behind `adminWrite()` with literal actions `catalogue.create/update/activate/deactivate`. ETL: `ctx.courses`, `ctx.academicYears` (existence only, DD-11), empty-catalogue preflight, course and year checks, `normCode` from `people.ts` everywhere (local copies removed), all three rules at version 2; P8 fixture gains the `XYZ` course row and a `2030-31` admission.
- **Tests:** `tests/catalogue.test.ts` (T-CAT-001 agreement of `normCode()`/`CODE_RULE` with the database on 16 samples incl. tab, newline, `\x01`, NBSP, É, ß, ı; 23514 on all four code tables; duplicates. T-CAT-002 the three named foreign keys, restrict on code update, inactive course and closed/unknown year refused, existing registration kept, lower-case code stored upper-case. T-CAT-003 every function audited with exact before/after/reason; Forbidden + DENIED; StepUpRequired; unknown `kind` incl. `constructor`/`__proto__` refused with no session; database gate: 42501 on inserts by a centre user, 0-row updates, 42501 on code update, delete and `centre_class_id` update by the catalogue admin. T-CAT-004 a centre user reads all five tables). `tests/etl.test.ts`: unit row for a deactivated course imports; P8 asserts the two new defects and `laterYearNumbers` `["2027-28", "2030-31"]`; the empty-catalogue refusal; `rule centre v2`. T-AUD-009 scans `catalogue.ts`.
- **Mutation checks** (`evidence/mutation-catalogue-2026-10-29.txt`; each restored and the test passed again):

  | Guarantee | Mutation | Test that failed |
  |---|---|---|
  | Code normalised | drop `course_code_check` | T-CAT-001 |
  | Real courses | drop `registration_course_code_fkey` and the `admit()` check | T-CAT-002 |
  | Controlled writes | `setup_insert` on `course_category` with check (true) | T-CAT-003 |
  | Audited | audit skipped for OK `catalogue.*` actions | T-CAT-003 |

- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: no drift; 0 type errors; **139 passed + 3 todo** (12 files); build; bundle scan; real-server admin journey and security smoke passed (`evidence/ci-catalogue-skeleton-2026-10-29.txt`).
- **Limits:** functions only, no screens (Stage 3); no catalogue mapping rule (needs legacy data); not yet run on Supabase (the hosted database needs 0012 and the one `gems_etl` grant by hand); the T-CAT-003 database-gate statements use a `gems_app` client with the session setting, as `tests/rbac.test.ts` does, not `withScope`. Follow-up kept: `ticket.type.manage` and `student.admit` have the same first-holder gap as DD-12.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0012_catalogue/migration.sql | 705a529fca51d6d9f568aeb4debe42ef453a455d3fb063e41e6b33ac76baf25d |
| src/server/catalogue.ts | a45779e2e74cffa7cda23e8ec42df36a981d246fa8788815afd0c7cdff54e504 |
| src/server/people.ts | 6b439105e5780930e17ee5023077be6b2c84a731491b151bf859420ce52381c7 |
| etl/run.ts | d19458b1fbf199654c2f1234de482a03c9c4ec43c053288635d6eb8f62606d41 |
| etl/checks.ts | 064e11be36e456507f9f77e415090c4e668a28f88cfdb1d4d9d79df179c731bb |
| etl/rules/centre.ts | 452ba2a5b515c77b4dbb7c3e4df9e7692fef6cb84dd0c38d890d38653be38555 |
| etl/rules/admission.ts | 4629ec2f2364607b0c22762b17ee59873bb5800f9f2a7450027ff79136c932c6 |
| etl/rules/registration.ts | be33f1a6b015057f8197992dc03d809816d8adabb94113aad40dce5f6fb5c3f4 |
| etl/fixture.ts | a1cf79e5292f399d6ef9d28cf398162d89ae5be4ab92607a8cb0c34a1ea23212 |
| tests/catalogue.test.ts | d6e8c11f0ea4adce8dec7827f2f746f8c3062e63355888fb7288fb69384f4b34 |
| tests/etl.test.ts | b487a344fc88c0e6425eb8abef62e0deef240127dc944194a03873b779c98d53 |
| tests/fixtures.ts | 1c71423e54ee50a7798f737db78535ad3b22196ec4dcb247afd32e28f503cb42 |
| evidence/mutation-catalogue-2026-10-29.txt | 41db3c2667068546b5f2ecb00a94634cfa529eed459b248430506023a3e0e774 |
| evidence/ci-catalogue-skeleton-2026-10-29.txt | 9aaf27477bfa90380497662331819c660fe3e019b566902f46255b7c5158ffd1 |

## E-035 System administrator holds every permission (2026-10-29)
- **Finding:** `app.rbac_set_role_permissions` (0005) lets an administrator grant only permissions they hold network-wide. The first administrator held 4 of the 15 permissions (`rbac.view`, `rbac.user.manage`, `rbac.role.manage`, `catalogue.manage`), so the other 11 (`org.centre.view`, `org.centre.export`, `ticket.raise/view/approve/document.view/type.manage`, `student.view`, `student.admit`, `pii.export`, `rbac.user.export`) could never be granted through the app. The E-034 follow-up had named only two of them.
- **Decision:** project owner, in chat, 2026-10-29: "Admin holds all" (chosen over a separate grant right and over script-only grants). **PMC under D-SEC-1** (IT/Ops): stays a parameter until the role matrix is signed.
- **Change:** migration `0013_system_admin_all` grants every `app.permission` row to an existing `system_admin` role (a no-op on a database not yet bootstrapped); `scripts/bootstrap-admin.mjs` grants every permission instead of a fixed list.
- **Tests** (`tests/admin-http.test.ts`): the bootstrap role holds every permission; the 0013 SQL run on a role holding the old four leaves none missing; every migration after 0013 that inserts into `app.permission` also mentions `system_admin`.
- **Mutation checks:** 0013 replaced by `select 1` → the 0013 test failed; bootstrap limited to `rbac.%` → the bootstrap test failed; both restored, 8/8 passed.
- **Checks:** `bash scripts/ci.sh` exit 0 on a fresh database: no drift; 0 type errors; **140 passed + 3 todo**; build; bundle scan; real-server smoke passed (`evidence/ci-system-admin-2026-10-29.txt`).
- **Risk accepted:** the system administrator is a network-wide super-user (personal-data export, admissions, ticket approval). Mitigations: TOTP mandatory (sensitive permissions), fresh step-up on admin writes, every action audited. Not yet applied to Supabase.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0013_system_admin_all/migration.sql | addc1b65c30d149f474d057012282105ca707e44586c277776ffee6bbb0ae229 |
| scripts/bootstrap-admin.mjs | 55cc925ac052d52a1c81bd52764be8351aec5731caa813a3024aa38e916eb92a |
| tests/admin-http.test.ts | b09c5b2d7ad5a112116ae855b9b518881cfd8d54a39aa75cef23562b2339a376 |
| evidence/ci-system-admin-2026-10-29.txt | 98ea2fe7194d0f356f69c801517c212d060aca9fc7f35af47fd9a912f8783180 |

## E-036 GitHub CI red since 2026-10-28: cause and fix (2026-10-29)
- **Observed** (public Actions API): runs for `3fa1d84` (2026-10-28 13:09 UTC, the first push containing the migration framework), `9b4ab7b`, `8dc48dc` (40822634495) and `0078b45` (40822990576) all failed in step "Run bash scripts/ci.sh"; the last green run was `8e7f8d2`. Local `ci.sh` runs were green throughout, so **the "CI green" claims in STATUS and in E-033…E-035 held locally only, not on GitHub.**
- **Reproduced:** a fresh `git clone` with only the `ci.yml` variables (no `.env.local`) failed the same way: 6 tests in `tests/etl.test.ts`, `permission denied for table bakeoff_audit_fault` at `etl/run.ts` audit insert.
- **Cause:** `tests/sql/audit-fault.sql` (T-AUTH-020b fault injection, applied by the auth suite) leaves a `before insert` trigger on `app.audit_log` whose (invoker) function reads `app.bakeoff_audit_fault`, granted only to `gems_auth` and `gems_app`. When the ETL tests run after the auth suite, `gems_etl`'s audit insert fails. Test files ran in a different order locally.
- **Fix:** `grant select on app.bakeoff_audit_fault to public` (a test-only, normally empty flag table), so every audit writer passes the trigger. A first attempt (`security definer` on the trigger function) was rejected by T-RLS-005's inventory of privileged functions, correctly, and reverted.
- **Checks:** clean clone with the `ci.yml` environment, `bash scripts/ci.sh` exit 0: no drift; **140 passed + 3 todo**; build; bundle scan; real-server smoke passed (`evidence/ci-clean-clone-2026-10-29.txt`). Confirmed on GitHub: run 40823530322 for `85e15aa` (the commit carrying this entry) completed with conclusion success.
- **Process change:** STATUS now counts a change as green only after a clean-clone run or a passing GitHub run.

| File | SHA-256 |
|---|---|
| tests/sql/audit-fault.sql | cb60220ec58b8bd029cb31bebe300864856115ce12e512355e2889045d89d392 |
| evidence/ci-clean-clone-2026-10-29.txt | 6b397afb90a931784271eb42cb2e2d0928ec7900eac3532dd064b02ea2b3ebad |

## E-037 Admission screens built (first Stage 3 piece) (2026-10-29)
- **Request:** the design owner approved `docs/designs/admission-screens/admission-screens.md` for build (2026-10-29, "Approve, build it") after EGM review steps 5–9 (reports in the same folder; 16 owner decisions DD-1…DD-16). Built in phases A1–A4.
- **A1 (documents):** audit 09 T-ADM-001…006; matrix links on R-150, R-001, R-229; CSV and FRD regenerated (0 errors).
- **A2 (server):** migration `0014_admission_unique` (unique index `admission_person_centre_year_key`, DD-16; no drift). `people.ts`: `PersonError` gains `field`/`rule`; `AdmissionExists`; `AdmitInput.admissionId` (the form id as the admission's primary key, lower-cased; form lock `hashtext('admit-form:'||id)` and existence check first in the transaction, DD-10) and `confirmNew: string[]` (only shown candidates are dismissed); `personDb` maps `admission_pkey` and the DD-16 key; failure hook audits `person.admit` FAILED for `duplicate` (candidate ids) and `already_submitted` (DD-15); `getPerson` adds centre code and course name; `admitOptions()`, `listAdmissions()` (student.view scope, exact numbers, escaped name prefix, mobile, 100 rows, search rate limit), `istToday` exported. `pageRead()` maps `PersonError` notfound to 404; `hasOrigin()` for actions; `src/server/admission-form.ts` (`submitAdmission`: form mapping, errors to inputs or form messages, DOB/mobile required for a new person, "submit again" on a COMMIT-time connection loss). ETL: admission rule rejects a second admission of one person at one centre and year; all rules v3; P8 merge pairs pinned to different centres and a planted Vani pair. Existing tests adapted: T-PER-001 re-admits in 2027-28; `confirmNew` call sites; the duplicate refusal's FAILED row asserted.
- **A3 (pages):** `/students` (newest 100; search by Server Action only, DD-13), `/students/new` (client form with `useActionState`, hidden form id from the state, "Admit" as the first submit button, duplicate list after it), `/students/[personId]`; "Students" link on the home page; actions files export only `admitAction` and `searchAction`.
- **Tests:** `tests/admission-screens.test.ts`, 7 tests (T-ADM-001…004, 006, incl. a connection terminated at COMMIT by a deferred constraint trigger, the primary-key and existence-check paths of the guard, the `student.view` filters with an extra ticket role, the rate limit). Real server (`scripts/smoke-security.mjs`), 10 new checks: multipart action posts with the rendered $ACTION_* fields: foreign Origin 500 (Next), no Origin 404 (app), nothing written; same Origin 303 to the learner, one OK audit row; no personal data in the redirect; the same form re-posted before hydration says "already saved"; duplicate list with "Admit" first; learner 404 parity (other centre = missing; malformed 404); list without a GET search form.
- **Mutation checks** (`evidence/mutation-admission-screens-2026-10-29.txt`): 20 vitest mutations, 1 database mutation and 3 real-server mutations, all caught; control run passed. A first real-server round wrongly reported two misses because a stale `next start` still held port 3101; repeated after stopping it by port.
- **Checks:** fresh clone with the `ci.yml` environment, `bash scripts/ci.sh` exit 0: no drift; 0 type errors; **147 passed + 3 todo** (13 files); build; bundle scan; admin journey and all security smoke checks passed (`evidence/ci-admission-screens-2026-10-29.txt`). Confirmed on GitHub: run 40830027742 for `0d5d5d0` succeeded.
- **Limits:** unstyled pages (DD-2); existing person fields only (DD-1); no documents, fees, edits or enquiry conversion; the search scans the caller's admissions (index when a search exceeds 1 s); not yet on Supabase (migrations 0012–0014, the `gems_etl` grant).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0014_admission_unique/migration.sql | c9ad36d6e6615a0d1187789a4a3614324193a397b5d20e2c5fc54a9142bab6e2 |
| src/server/people.ts | 18b3d43e3eed87f989face8ab282ee446cf7a21aba10c120d21177c5d9333bfb |
| src/server/admission-form.ts | c765605bf8c9c8e3c89c46275943a25c40f4d28eb4a4e534be52d42bc7b65338 |
| src/server/page-read.ts | 3c705f868b342a2815f8e016349997ed79075a17f78c6efcdd8689adc53ef0bf |
| src/server/auth/http.ts | c1cfb1fdbaacb89fbf7b13cfa4b4914f3ad50b9a1b0344debee0c51e3d5a163b |
| app/students/new/actions.ts | 816ab70c4047217a3350e64c94f0625556954270cbc6ec6226c9a4b6a8c8bbfd |
| app/students/new/form.tsx | 82ad3e07d125ffae15254dad3d3a47addd3acfb18f80b01cc8b224afb8fff003 |
| app/students/actions.ts | d244dab73f546b749dc5938db33a5772344c88b1a1fcc8915dabe593cbb02878 |
| etl/rules/admission.ts | 060cd96cb697935eda7fe577dfbe457d68c715e7e245d1c9471113c34989828c |
| etl/fixture.ts | c9d4d35862f241af7264cc45e883212ee94e576304574713422ab17b44e5b03d |
| tests/admission-screens.test.ts | 68cd3b28e66d1a38cfd6c5d6e94046fe5a12ac66399f3d290eb46fab28bd7cc5 |
| scripts/smoke-security.mjs | 8d943207a71d59aa76840e5efaa76516ad2fd168ccdada05e548ad227d67be10 |
| evidence/mutation-admission-screens-2026-10-29.txt | 184bcaff55e26eb1de653ef2d3709c4b67d431f49dc454437d1f767e804e08d0 |
| evidence/ci-admission-screens-2026-10-29.txt | d78597f3cf75df21c53bf8572ece2953059a459a21d2eda89f62cc724d56dfc5 |

## E-038 Learner details built (second Stage 3 piece) (2026-10-29)
- **Request:** the design owner approved `docs/designs/learner-details/learner-details.md` for build (2026-10-29, "Approve, build it") after EGM review steps 5–9 (reports in the same folder; 15 owner decisions; DD-9 revised by DD-14, DD-13/DD-14 revised at step 8). Built in phases D1–D4.
- **D1:** audit 09 T-LD-001…004 (T-ADM-006 now three action functions); R-150.02 linked; CSV and FRD regenerated (0 errors).
- **D2 (server):** migration `0015_person_detail` (table, restrict foreign key; checks named `person_detail_<column>_check` with the JS trim set written out, no regex flag, control-character clauses, `char_length`; nationality format only; RLS: select as person, insert/update only with `student.admit` at a centre where the person is admitted; no `person_id` update grant). `src/server/person-rules.ts` (exactly what the mapping rules import) re-exported by `people.ts`; `HASHED_WITH_EVERY_RULE` = `person-rules.ts`, `ids.ts`; rules v4; an import guard test. `src/server/details.ts` (lists incl. `NOT_KNOWN`, 249 ISO codes, `detailField`, `countryOptions`). `admit()` saves details for a new person after the admission, and for an existing person only when none exist (person lock), audited as `detailFields`; `getPerson()` adds `details`, `detailsVersion`, `editCentreId`; `updateDetails()` (digits-only centre and version, `assertAdmittedAt`, person lock, version guard, static SQL, audit `{ fields }` only); `personDb` maps detail check violations to field errors. `reset.sql` truncates `person_detail`; T-RLS-002 covers the new table.
- **D3 (pages):** `DetailsFields` client component (imports only `details.ts`; empty first option on every select); admit form sections and the duplicate-list note; IN default via the initial state; the learner page's details and "Edit details" link; `/students/[personId]/details` with `saveDetailsAction` over `submitDetails()` (required on every edit; absent inputs keep their value). Existing tests and the smoke learner gained the three required fields.
- **Tests:** `tests/learner-details.test.ts`, 7 tests (domain and form level, direct-SQL scope as gems_app, concurrent first edits, existing-learner admit racing a first edit, app/database agreement on list values and locale-sensitive samples, the check-violation mapping, the reset). Real server: 7 new checks (IN default; own edit page 200; other centre's edit page 404 identical to a missing one; a view-only user has no edit link and gets 404; Origin-less details post 404, nothing written; same-origin post 303 and the saved value shown).
- **Mutation checks** (`evidence/mutation-learner-details-2026-10-29.txt`): 19 code, 7 database, 2 real-server mutations, all caught; control passed. Two would first have survived (no `notFound()` on the edit page; no version comparison); the missing view-only smoke user and the stale-version-without-row test were added, then both were caught.
- **Checks:** fresh clone with the `ci.yml` environment, `bash scripts/ci.sh` exit 0: no drift; 0 type errors; **155 passed + 3 todo** (14 files); build; bundle scan; admin journey and all security smoke checks passed (`evidence/ci-learner-details-2026-10-29.txt`). Confirmed on GitHub: run 40844166410 for `a21596b` succeeded.
- **Limits:** unstyled; previous marks, mother tongue, last school, state/district and the sensitive fields not included; no legacy details migrated; fixed lists are PMC; not yet on Supabase (migrations 0012–0015).

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| prisma/migrations/0015_person_detail/migration.sql | 6bc82dbe58bb78dd05cffcb729ede5660e0f58872706bdaea3176c6cff61ce88 |
| src/server/person-rules.ts | 1a65e5535e56106a94e6b6fbdb13c1a6047bcd68bd5c13223c73a5fe067be930 |
| src/server/details.ts | 55afab2ab46cdce0d36778a2c8864c35ab286d44f9fa3749a8a0c4c6f57f29eb |
| src/server/people.ts | df48b6be84cd45ef9caf5a2c48a5cf3e741c1b6d8e2bb59907f0c755de7878c2 |
| src/server/admission-form.ts | a146161e36ebab283163548927e1bec0ac62a68e7cb63cc175c44caf97a933aa |
| app/students/details-fields.tsx | 91131603c280a3897b2a2e0889db778cdf3b47e3897dfc753249d60c5f28c1e0 |
| app/students/[personId]/details/page.tsx | 9c5999e4e097c2478bfd871a1c2d7f1ffc61f3231f7ad7150ae12beef8bc0939 |
| app/students/[personId]/details/actions.ts | 2cfd264b07658df1cf122d5924b9a9f9c1668172478e0a899f7f5fb8fbce731f |
| etl/canonical.ts | 1efc7e07a0c789012409263b54628d601a706b4e1e70d4a22cd2e70e729b5657 |
| scripts/etl/reset.sql | 0a45506a3b8158134fdea27654b776c14d04a5757f9664e84fcbce458b7eb985 |
| tests/learner-details.test.ts | 7daca77bdbad47885cdfbb302ec41a938f1931456e0cb69cddc2b45581df41ac |
| scripts/smoke-security.mjs | 1b5674d8599bc9e4defb88edb2a0d003ef0e6a2ca687c9fe45d83ef1dab5ee0b |
| evidence/mutation-learner-details-2026-10-29.txt | e2aba3f5b4b6f9ff5e740fa620748b4a4e8ad5da5def2103515418893f85656d |
| evidence/ci-learner-details-2026-10-29.txt | c456b7019e66d4aacf1cbeb3b1cec0a0e1e7ed85e339dd96f86491f22b5e93b5 |

## E-039 Correction tickets built (third Stage 3 piece) (2026-10-29)
- **Request:** the design owner approved `docs/designs/correction-tickets/correction-tickets.md` for build (2026-10-29, "Approve, build it") after EGM review steps 5–9 (reports and the file-by-file plan in the same folder; 19 owner decisions). Built in phases C1–C4.
- **C1:** audit 09 T-COR-001…006; R-095 linked, with the DD-19 note (proof-less correction types before ADR-002 are a temporary deviation for PRO to confirm); CSV and FRD regenerated (0 errors).
- **C2 (engine):** `tickets/errors.ts` (no imports; re-exported); `TicketHandler<P, R>` with optional `prepare`, `review`, `describe`, `invalidMessages`, `valuesPermission` and select fields; `raise()` reads the re-raise source `for update` and checks status and raiser before `parse`/`prepare`; `getTicket()` returns the payload only to those who act or hold the handler's permission, plus `described` and `hasReview`; `ticketReview()` as an audited `scopedAction` (`ticket.review.duplicates`, matches only; failures degrade to one line, audited FAILED; lost connection, expired session and refusal rethrown); `adminPost` passes invalid keys as `detail`; `TICKET_GATES` (committed `false`) and `gateRefusal()` in `setTypeActive`, `updateType` and `requestUpload`, for every ticket type and environment. The existing ticket tests open the gates in `beforeAll`.
- **C3 (handlers):** `tickets/identity-handlers.ts`: six handlers from one factory (given/family name, date of birth, gender select, mobile, email); `prepare` (student.view at the centre, Admission No at the centre, same learner on re-raise, old value from the record, same value refused); `revalidate` under the person lock (stale `changed`/`format`); `apply` (advisory lock on the corrected key, `changeIdentity`, field names only in the audit); `review` via `approverMatches()` (Admission No and centre; names only with student.view; "not possible" without a key); registered in every environment.
- **C4 (pages):** raise page select fields and the handler's own message; ticket page "Request hidden" / described table / JSON, and the duplicate check for those who may act; the manual Supabase run's header notes the gates.
- **Tests:** `tests/corrections.test.ts`, 9 tests (gates and their committed defaults; review audit and degradation; payload visibility; raising and every refusal key, incl. the route's `detail`; stale in turn and concurrently with a held person lock; re-raise rules incl. a non-raiser; apply and `ApplyFailed`; the duplicate review's scope and naming). Real server: 5 new checks (gender select; the specific message for an unknown number; a valid raise; the approver's described request and audited duplicate check; "Request hidden" for a viewer).
- **Mutation checks** (`evidence/mutation-correction-tickets-2026-10-29.txt`): 24 code and 2 real-server mutations, all caught; control passed. Three cases were added because their mutations would otherwise have survived (one was first reported MISSED, then CAUGHT after the case was added). Not covered by a test: the advisory lock in `apply`, the re-raise of a payload of another shape.
- **Checks:** fresh clone with the `ci.yml` environment, `bash scripts/ci.sh` exit 0: no drift; 0 type errors; **164 passed + 3 todo** (15 files); build; bundle scan; admin journey and all security smoke checks passed (`evidence/ci-correction-tickets-2026-10-29.txt`).
- **Limits:** in production no ticket type can be switched on until the numbering policy is signed and the counter seeded (DD-18); proof-requiring types also wait for ADR-002 and the engine's DD-16 safeguards (DD-14); unmapped legacy codes (GPC, FPC, GNC, MNC, NC, SMS); unstyled screens; not yet on Supabase.

**Requirements VER: still 0.**

| File | SHA-256 |
|---|---|
| src/server/tickets/errors.ts | a66b472a38b1527472878b523be7e0e78c4b9445881ab7db9531ce22bd771d12 |
| src/server/tickets/handlers.ts | 5999e97481c1b6128b19e6541e299634b24e0b3cbe4f91e0010706b21c2a32c4 |
| src/server/tickets/identity-handlers.ts | 3145e2e2416456116fafc4e2b48920163eeff752b49427bc122d21b11f4e6c13 |
| src/server/tickets/engine.ts | 7fa0fdc5a5b91b8026fb5292d232212d46364408279d0765b5c43ac3968a1f04 |
| src/server/tickets/setup.ts | a57d5b2bc08c791ef927f2617e65216e07ea3ae79d16e519484acc7130e47bd9 |
| src/server/tickets/policy.ts | 3de5e01fda92b174bee5e6706cf0fc065c948800ab97883a6b51d51f34cf292c |
| src/server/admin-http.ts | 5190c02ef606fe61c8c0eedfa42d1c95b5568edc33c3495eb45b98fef1863f0c |
| src/server/people.ts | eff7943b94f8596634fecec775ddf72c92e005ce151e989ce3d16e43f9a6831a |
| app/tickets/new/page.tsx | 7dd0bc95599f7c9607309e4aec4806a3b962df8614a406eb5600d2eb3727c0bb |
| app/tickets/[id]/page.tsx | c5fbbf157eda5980f396fe5ded0824b23a066c88cf6468100e5766a21ef23f7c |
| tests/corrections.test.ts | e6a328c70279c3b2b1bde7de56aea143f3996815ca7da62f9d7538f51c2f5e91 |
| scripts/smoke-security.mjs | fab263149307083294c10c894423ed3a3ddb914d487a9299e7a2de539ede90b9 |
| evidence/mutation-correction-tickets-2026-10-29.txt | a3323b28e161f3548269e1b113cd91c12859b3fe8e422f0206a0e0bb17159fd2 |
| evidence/ci-correction-tickets-2026-10-29.txt | 24961f8c75c78f4da1b118a8af58f7e591b98767c09ec27980d6ae021cdd4ea0 |
