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
