# Migration framework: ETL foundation and P8 (Stage 2)

*   **Author:** gtm
*   **Status:** Approved for build by the design owner on 2026-10-28, after EGM review steps 5–9. Reviews so far: [`zoom_out_report.md`](zoom_out_report.md) (step 5), [`comprehension_report.md`](comprehension_report.md) (step 6), [`critic_report.md`](critic_report.md) (step 7), [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (step 8), [`implementation_readiness_report.md`](implementation_readiness_report.md) (step 9).
*   **Date:** 2026-10-28

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source), INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its decision owner to sign). Statements in the Technical Plan without a class are PRO. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

GEMS OMNIX replaces a legacy system that holds 17 years of learners, admissions, fees and certificates. A record lost or wrongly merged while moving that data is hard to detect after go-live. The audit documents therefore fixed one principle before any code (audit 08 §4, v1.1 C-03): **every legacy record gets exactly one recorded outcome, and nothing is ever dropped without a reason.**

In this document, "migration" alone means the legacy data migration; schema changes are always called "Prisma migration *n*".

This design covers the **migration framework** that roadmap Stage 2 asks for (`docs/audit/10-implementation-roadmap.md`, row 2: "ETL framework", "key map, rules, exceptions live", P8):

*   the bookkeeping: where each legacy record went, under which mapping rule, and why (the *key map*);
*   how mapping rules are written, versioned and approved;
*   a runner that loads a source, applies the mapping rules, and writes target rows with ids that come out the same on every run;
*   the reconciliation checks K1–K6 and K9, stored per run;
*   **P8**: a dry run on a synthetic, legacy-shaped dataset with planted defects, run twice in CI, resetting the raw, migration and target tables in between.

The real sources stay out of scope: there is no access to the legacy MySQL database until Stage 0 delivers it, and the 1.2M-row XLS needs separate approval (v1 audit §A.8). Each later roadmap stage (3–7) adds its own entity mappings on this framework.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Stage *n* | A roadmap stage. Stage 0 delivers legacy source access; Stage 4 builds fees and the ledger | `docs/audit/10-implementation-roadmap.md` |
| EGM review step | One of the review steps 5–9 this document goes through | `docs/designs/` (EGM workflow) |
| Audit 00…12, v0, v1, v1.1 | The audit documents: numbered files, and the successive audit versions (v0 plan, v1 audit, v1.1 corrections) | `docs/audit/`, `docs/audit/baseline/`, `docs/audit/revisions/v1.1-corrections.md` |
| DQR, XL-*n* | The legacy data-quality report, and the XLS findings in audit 08 §2 | audit 08 |
| Source key | The identity of one legacy record: source system, table and key | C-03.2 |
| Entity | The kind of target a mapping rule produces (centre, person, admission, registration). One source row can feed several entities | DD-7 |
| Disposition | The recorded outcome of one source key for one entity: IMPORTED, MERGED, SPLIT, ARCHIVED, EXCLUDED or REJECTED | C-03.1, audit 08 §4 |
| Key map | `migration.key_map`: one row per (source key, entity, target row) of a run | C-03.2 |
| Mapping rule | A versioned TypeScript module for one source table, producing one or more entities, with a rule owner, a code hash and an approval | C-03.2, DD-2 |
| Usable row | A row in which its mapping rule finds no error | this design |
| Exception | A rejected value, stored as a fingerprint, not the raw value | C-03.2 |
| K1…K11 | The reconciliation checks; T-MIG-001…011 test them | C-03.3, audit 09 §T-MIG |
| T-RLS-*n*, T-AUD-*n*, T-MIG-*n* | Test ids of the audit test catalogue | audit 09 |
| Run | One execution of the runner, identified by a run id; *dry* or *cutover* | this design |
| Run digest | A hash of a run's key map, exceptions and target rows without run ids; equal digests mean identical runs (K9) | [Canonical form](#canonical-form) |
| Migration environment | A database where migration runs: local Docker, CI, a rehearsal copy, and the new production database **before** go-live | audit 08 §6 |
| Schema owner | The role behind `MIGRATE_URL` that runs Prisma migrations and owns every schema object (superuser locally, `postgres` on Supabase) | Prisma migration 0002 |
| `gems_etl` | The database role the runner uses; it bypasses RLS, owns nothing, and exists only in a migration environment | T-RLS-015 |
| RLS | Postgres row-level security | Prisma migration 0002 |
| Drift gate | The CI check that the Prisma schema equals the migrated database | `scripts/ci.sh` |
| P8 | Proof of concept: repeatable dry run with reconciliation output | `docs/audit/11-proof-of-concept-specification.md`; v1 audit §A.8 |
| Person core | `person`, `admission`, `registration` (Prisma migration 0011) and `src/server/people.ts` | `docs/designs/person-core/person-core.md` |
| `app.person_match_key` | The database function that derives the duplicate-check key from name, date of birth and mobile | Prisma migration 0011 |
| Counter | A row of `app.global_number_series` (a number series), e.g. `REGISTER` or `ADMISSION` for one academic year | `src/server/numbering.ts` |
| Centres A, A2, B | The three centres `tests/fixtures.ts` creates: `KL2-25`, `KL3-07`, `TN1-03` | `tests/fixtures.ts` |
| Design owner, rule owner, decision owner | gtm, who accepts this design; the business role named on a mapping rule; the owner of a decision in audit 04 | — |
| R-xxx, D-xxx, NP-*n* | Requirements and open business decisions | `docs/audit/02-…csv`, `docs/audit/04-manager-decision-register.md` |
| DD-*n*, G*n* | Decisions and goals of this document. Ids of other documents keep their prefix ("person-core DD-7") | [Decisions](#decisions) |

## The Problem

1.  **Counting is not reconciling.** The v0 plan checked "record counts per entity" (v0 §7.4). Counts balance even when one record is lost and another duplicated (v1.1 L-23). The audit replaced counts with per-key dispositions and eleven checks.
2.  **The legacy data is known to be dirty** (audit 08 §2): whitespace and malformed centre codes, test centres, duplicate persons with no shared identifier (XL-1), dates in text columns (XL-4), status values that drift per year (XL-5). Each defect needs a recorded outcome, not a silent fix.
3.  **Reruns must be identical.** The operations team rehearses the migration at least twice before go-live, each time on a fresh database copy (audit 08 §6–7). If ids or outcomes change between runs, a rehearsal proves nothing about the final run (K9).
4.  **Exclusions and mapping rules need an approver** (C-03.1). Code must not be able to approve itself, and an approval must not carry over to changed logic.
5.  **The runner needs powers the app must never have.** Loading every centre's rows needs to bypass RLS. The role holding that power (`gems_etl`) must not exist in production after go-live (T-RLS-015).
6.  **Printed numbers must never be reissued.** Legacy Admission and Register Nos are on forms and certificates, including those of records that are not migrated.
7.  **No source access yet.** The framework must be built and proven before the legacy schema is known, so it cannot hard-code that schema.

## Goals

Each goal is met when the tests named in brackets pass in `bash scripts/ci.sh`; "P8" means the P8 test in `tests/etl.test.ts`.

*   **G1: Every source key has exactly one disposition per entity.** The key map covers every raw key, and the database refuses a second disposition for the same key and entity in a run [T-MIG-001 K1, T-MIG-002 K2].
*   **G2: Every target row has provenance, every recorded target exists, and no person is written without an admission** (such a person would be invisible under RLS). Merges point at an existing, imported survivor; source orphans end REJECTED [T-MIG-003 K3, T-MIG-004 K4, T-MIG-006 K6].
*   **G3: Reruns are identical.** Two runs on the same input, resetting in between, give the same run digest [T-MIG-009 K9].
*   **G4: Planted defects get their expected dispositions,** with an exception for each REJECTED key [P8, defects table].
*   **G5: Cutover runs need approved mapping rules.** A cutover run with one unapproved rule, or with code that differs from the approved code, is refused before writing [P8, refusal cases].
*   **G6: The ETL role is confined.** No Prisma migration creates `gems_etl`; it owns no objects; it cannot approve a mapping rule or record a per-record approval; the go-live drop is checked by the T-RLS-015 query [P8, G6 cases; T-RLS-015 at go-live].
*   **G7: The app continues the legacy numbers.** After a run, `admit()` issues the Register No and Admission No after the highest number on any legacy row [P8, continuity case].

## Non-Goals

*   **Real legacy data.** No MySQL access until Stage 0; the XLS needs separate approval (v1 audit §A.8) and its import mode is D-MIG-8.
*   **K7 and K8** (money control totals, ledger). There are no fee or ledger tables until Stage 4, behind the finance sign-off gate (G-FIN, audit 10). Stage 4 builds both checks (DD-4). P8 records them as not applicable.
*   **K10 and K11** (report parity, sampled field fidelity). They need legacy reports and real rows.
*   **ARCHIVED.** What is archived is D-MIG-1. Until then the runner refuses an ARCHIVED result and no `archive` schema exists (DD-8).
*   **Mappings for later stages:** catalogue, fees, exams, certificates, tickets, and creating or changing centres. Each roadmap stage adds its own.
*   **A person-merge tool** (D-STU-5). P8 merges duplicates only by a synthetic mapping rule on the match key; real merge maps are D-MIG-4.
*   **Files** (`/uploads/`). The stage that migrates their owning records moves them with their references.
*   **Cutover runbook, freeze and rollback** (audit 08 §7). The operations team writes them before the first rehearsal.

## Technical Plan (Architecture)

### Components

```text
 run({ mode: "dry" | "cutover", asOf, seedYears, legacyCurrent })                       etl/run.ts
   │  0. preflight     session advisory lock; database empty; options valid; counters absent;
   │                   mapping rules registered and hashes checked (rolled back if refused);
   │                   cutover: approvals → refused: RunRefused thrown, nothing kept
   │  1. load raw      etl/fixture.ts fills raw.legacy_* (the only source in Stage 2); input_hash
   │  2. start run     migration.run row (RUNNING); audit migration.run.start
   │  3. prepare       identityField() per field of every admission row; match keys of the valid ones
   │  4. apply rules   centre → admission (person + admission) → registration
   │  5. write         ONE transaction: person, admission, registration rows; key_map and
   │                   exception rows of all entities; counters (DD-6, DD-9)
   │  6. check         K1–K11 rows → migration.reconciliation; run digest
   │  7. finish run    status PASSED/FAILED, digest; artifacts; audit migration.run.finish
   ▼
 Postgres, same database (DD-1)
   raw.legacy_*  verbatim source rows (text)     migration.*   run, rule, key_map, exception, reconciliation
   app.*         target tables (person core today)
```

*   **Entry point (DD-11):** `etl/run.ts` exports `run(opts): Promise<RunResult>`; Stage 2 calls it only from `tests/etl.test.ts`. There is no command-line launcher: Node's type stripping cannot load `src/server/people.ts` (constructor parameter properties, extension-less imports), and no `tsx` is installed. The first rehearsal adds a `tsx` launcher.
*   **Options:**
    *   `mode` (required). The source (`fixture`) and the fixture seed (`20261028`) are constants in Stage 2; Stage 0 adds a `source` option;
    *   `asOf: string` (`YYYY-MM-DD`, required): the date against which `admitted_on` must not be later, so outcomes do not depend on the day the run happens;
    *   `seedYears: string[]` (default `["2026-27"]`, a fixed value, PMC under NP-8);
    *   `legacyCurrent?: { REGISTER?: bigint; ADMISSION?: Record<string, bigint> }`: the legacy counters read at the freeze;
    *   `artifactDir` (default `evidence/`).
*   **Result:** `{ runId, status: "PASSED" | "FAILED", digest, checks, artifactPaths, errors }`. A refused run throws `RunRefused(reasons: string[])`; it keeps no row anywhere and writes no audit or artifact.
*   **Reset (Z18):** `scripts/etl/reset.sql`, run as the schema owner, truncates the three `raw.legacy_*` tables, `migration.key_map`, `migration.exception`, `migration.reconciliation`, `migration.run`, `app.registration`, `app.admission`, `app.person`, and deletes the `REGISTER` and `ADMISSION` counters. It **keeps `migration.rule`** and its approvals. Operators use it between rehearsal runs on the same database, after a crash, and on the production database before go-live; P8 uses it between its runs. The usual sequence is: dry run (registers the mapping rules) → review and approve → reset → cutover run.

### Where It Runs (DD-1)

*   **Schemas** `raw` and `migration` in the GEMS database. No `stage` schema (DD-5); no `archive` schema (DD-8).
*   **Created by a setup script, not a Prisma migration.** `scripts/etl/setup.mjs` connects as the **schema owner** (`MIGRATE_URL`, loaded from `.env.local` with `dotenv` and never from `.env`, as `prisma7.config.ts` and `scripts/bootstrap-admin.mjs` do), once, on a fresh database, in a migration environment. The schema owner owns every object (Prisma migration 0002: runtime roles never own objects). The operator runs setup on the new production database before go-live only; the go-live checklist then runs `drop owned by gems_etl; drop role gems_etl` as the schema owner (this removes every privilege, including CONNECT) and the T-RLS-015 query below. The schemas and the key map stay as evidence; whether `raw` is kept is D-SEC-5. The Prisma datasource lists only `app`, so the drift gate is unaffected.
*   **Lock-down:** `setup.sql` revokes all on schemas `raw` and `migration` and on all their tables from `public` (and from `anon` and `authenticated` where those Supabase roles exist), mirroring both revokes Prisma migration 0002 makes for `app`.
*   **No RLS on these tables** (roadmap row 2 asks for an RLS coverage test on every new table): `raw` and `migration` have no `centre_id`, are reachable only by the schema owner and `gems_etl`, and are revoked from every other role; T-RLS-002 covers schema `app` only. This exemption is stated in audit 09 (item 1).
*   **`gems_etl`.** `setup.mjs` works in this order:
    1.  if missing, `create role gems_etl login bypassrls noinherit` (a role created by a non-superuser cannot be superuser, create databases or create roles, and those are the defaults; naming `nosuperuser` would itself need superuser on Supabase);
    2.  check `pg_roles`: `rolcanlogin` and `rolbypassrls` true, `rolsuper`, `rolcreatedb`, `rolcreaterole`, `rolinherit` false; otherwise stop with an error;
    3.  set the password: `select format('alter role gems_etl password %L', $1::text)` with `ETL_DB_PASSWORD`, then execute the result;
    4.  run `setup.sql` (extension-free DDL, revokes, grants), then `select format('grant connect on database %I to gems_etl', current_database())` and execute it (Docker revokes CONNECT from public in `docker/initdb`).

    The role owns nothing and holds only:
    *   `usage` on `raw`, `migration`, `app`;
    *   `select, insert` on the three `raw.legacy_*` tables, `migration.exception` and `migration.reconciliation`;
    *   `select, insert` on `migration.run` and `update (finished_at, status, digest)` on it;
    *   `select` and `insert (rule_id, version, source_table, entity_list, description, owner, dispositions, code_hash)` on `migration.rule`: it can register a mapping rule but neither approve nor change one;
    *   `select` on `migration.key_map` and `insert (run_id, entity, source_system, source_table, source_key, source_row_hash, disposition, rule_id, rule_version, target_table, target_id, survivor_target_id, reason)` on it;
    *   `select` on `app.centre`; `select, insert` on `app.person`, `app.admission`, `app.registration`, `app.global_number_series`;
    *   `insert` on `app.audit_log`, `usage` on `app.audit_log_id_seq`;
    *   `execute` on `app.person_match_key(text, text, date, text)` and `app.redact(jsonb)`, granted explicitly so a later `revoke … from public` cannot break the runner;
    *   `connect` on the database (step 4).

    No update (other than the three `migration.run` columns) and no delete anywhere.
*   **Go-live check (T-RLS-015)**, which the schema owner runs after the drop and records in the evidence log:

    ```sql
    select rolname from pg_roles where (rolbypassrls or rolsuper) and rolname <> 'postgres' order by 1;
    ```

    The result must equal the platform's pinned list (`poc/test/rls.test.js`: on Supabase `service_role`, `supabase_admin`, `supabase_etl_admin`, `supabase_read_only_user`). The schema owner also runs, and records, the reach check for the Supabase API roles on the two new schemas:

    ```sql
    -- same shape as poc/test/rls.test.js, with raw and migration in place of app; both counts must be 0
    select (select count(*) from pg_roles r cross join unnest(array['raw', 'migration']) s
             where r.rolname in ('anon', 'authenticated') and has_schema_privilege(r.rolname, s, 'USAGE')) schema_usage,
           (select count(*) from information_schema.role_table_grants
             where grantee in ('anon', 'authenticated') and table_schema in ('raw', 'migration')) table_grants;
    ```

### Data Model (`scripts/etl/setup.sql`, DDL in Substance)

```sql
create schema raw;
create schema migration;

-- The P8 source contract (synthetic, INF). Stage 0 replaces these with the real legacy shape in a new setup version.
create table raw.legacy_centre (source_key text primary key, code text, name text, status text);
create table raw.legacy_admission (source_key text primary key, centre_code text, admission_no text,
  academic_year text, admitted_on text, first_name text, last_name text, dob text, mobile text);
create table raw.legacy_course_row (source_key text primary key, admission_key text, course_code text,
  register_no text, join_date text, status text);

create table migration.run (
  run_id uuid primary key, mode text not null check (mode in ('dry', 'cutover')), source text not null,
  as_of date not null, input_hash text not null, lc_ctype text not null,
  started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'PASSED', 'FAILED')), digest text);

create table migration.rule (
  rule_id text not null, version int not null, source_table text not null, entity_list text[] not null,
  description text not null, owner text not null, dispositions text[] not null, code_hash text not null,
  approved_by text, approved_at timestamptz,
  primary key (rule_id, version),
  check ((approved_by is null) = (approved_at is null)));

create table migration.key_map (
  id bigint generated always as identity primary key,
  run_id uuid not null references migration.run, entity text not null,
  source_system text not null, source_table text not null, source_key text not null, source_row_hash text not null,
  disposition text not null check (disposition in ('IMPORTED', 'MERGED', 'SPLIT', 'EXCLUDED', 'REJECTED')),  -- ARCHIVED: DD-8
  rule_id text not null, rule_version int not null, target_table text, target_id text, survivor_target_id text,
  reason text, approved_by text, approved_at timestamptz,
  foreign key (rule_id, rule_version) references migration.rule);
-- one disposition per key and entity; only SPLIT may have more than one row (a mixed SPLIT key fails K2;
-- the stage that first produces a real SPLIT adds an exclusion constraint)
create unique index key_map_one_row on migration.key_map (run_id, entity, source_system, source_table, source_key)
  where disposition <> 'SPLIT';

create table migration.exception (
  id bigint generated always as identity primary key, run_id uuid not null references migration.run,
  entity text not null, source_system text not null, source_table text not null, source_key text not null,
  rule_id text not null, field text not null, value_fingerprint text, message text not null);

create table migration.reconciliation (
  id bigint generated always as identity primary key, run_id uuid not null references migration.run,
  "check" text not null check ("check" ~ '^K([1-9]|1[01])$'), scope jsonb not null default '{}',
  expected bigint, actual bigint, passed boolean, detail jsonb not null default '{}');
```

*   **`source_system`** is `fixture` in P8 (later `gems_mysql`, `xls`). **`target_table`** is schema-qualified (`app.person`). **`target_id`** is text (a uuid or a centre id).
*   **`key_map.approved_by` / `approved_at`** stay null in Stage 2, reserved for per-record approvals (D-MIG-4 merge maps); `gems_etl` cannot write them.
*   **`source_row_hash`:** lowercase hex sha256 of the raw row's [canonical form](#canonical-form).
*   **How each disposition fills the key map:**

    | Disposition | `target_table` | `target_id` | `survivor_target_id` | `reason` | Exception rows |
    |---|---|---|---|---|---|
    | IMPORTED (new row) | the table | the new id | null | null | 0 |
    | IMPORTED (existing row) | the table | the existing id | null | `existing` | 0 |
    | MERGED | the table | null | `id(<survivor name>)`, see below | `merged into <survivor source key>` | 0 |
    | SPLIT | the table | each target's id (one row per target) | null | null | 0 |
    | EXCLUDED | null | null | null | the mapping rule's reason | 0 |
    | REJECTED | null | null | null | the errors as `field: message`, joined with `; ` | one per error |

    The runner sets `survivor_target_id` to the id of the survivor key's own target, without following further merges. A survivor that is itself MERGED has no `target_id`, so K4 fails on any chain.

### Mapping Rules (DD-2)

A mapping rule is one TypeScript module per **source table** in `etl/rules/`, registered as one `migration.rule` row. It may produce more than one entity: the admission rule produces person and admission.

```ts
type Disposition = "IMPORTED" | "MERGED" | "SPLIT" | "EXCLUDED" | "REJECTED";        // no ARCHIVED (DD-8)
type RawRow = Record<string, string | null> & { source_key: string };
type Target = { table: string; id: string; row: Record<string, unknown> };
type RuleError = { field: string; message: string; value: string | null };          // field = raw column name
type Result =
  | { disposition: "IMPORTED"; target: Target }                                       // a new row
  | { disposition: "IMPORTED"; existing: { table: string; id: string } }              // matched an existing row
  | { disposition: "MERGED"; survivorKey: string; table: string }
  | { disposition: "SPLIT"; targets: Target[] }
  | { disposition: "EXCLUDED"; reason: string }
  | { disposition: "REJECTED"; errors: RuleError[] };
type Ctx = {
  result(entity: string, sourceKey: string): Result | undefined;   // results of entities processed before this
                                                                    // rule (centre, then admission, then registration)
  sourceRows(table: string): RawRow[];                               // raw rows of tables loaded in this run (parent lookups)
  centres: { id: number; code: string }[];                          // app.centre, read by the runner
  identity: Map<string, StoredIdentity | RuleError[]>;              // step 3, by admission source key
  matchKey: Map<string, string | null>;                             // step 3, valid identities only
  id(name: string): string;                                         // uuidv5, see Deterministic ids
  asOf: string;
};
type Rule = {
  id: string; version: number; description: string; owner: string;
  sourceTable: string; entities: string[];
  dispositions: Record<string, Disposition[]>;                      // allowed per entity
  parent?: Record<string, (row: RawRow, ctx: Ctx) => { entity: string; sourceKey: string } | null>; // used by map() and K6
  splitCardinality?: Record<string, number>;                        // for K5, per entity
  map(rows: RawRow[], ctx: Ctx): Map<string, Record<string, Result>>; // source key → entity → result
};
```

*   **Row order:** rows reach `map` ordered by `source_key collate "C"`. Applied to rows, "earlier" and "later" always mean this order.
*   **Strictness:** `validateResults(rule, rows, results)` in `etl/checks.ts`, a pure function, returns the violations: a result for an undeclared entity, a disposition outside the entity's `dispositions`, or a missing result for a row. Any violation is *fatal*: the run takes the failure path of [Writing Targets](#writing-targets-dd-3) before anything is written, and the artifact lists the violations under `errors`. ARCHIVED is excluded by the type and by the `key_map` check constraint, so a rule that returns it anyway fails the write transaction.
*   **One parent resolver.** `map()` finds a row's parent only through the rule's own `parent` function, so K6 checks the same link the rule used.
*   **No I/O in mapping rules.** Everything a rule reads is in `ctx`, so rules are unit-tested with plain objects and `app.person_match_key` is never reimplemented.
*   **One validation path.** Mapping rules validate with the person core's functions in `src/server/people.ts`: `academicYearOk()` (already exported) and `identityField()`, `isoDate()` and the message constant `ACADEMIC_YEAR_RULE` (`"YYYY-YY, consecutive years"`, which `people.ts` then uses in its own two places), all exported by this design without behaviour change. Step 3 calls `identityField()` once per identity field, so **every** failing field yields its own error; the rules likewise run every check of a row and collect every failure. A thrown `PersonError` with message `"<field>: <check>"` becomes a `RuleError` whose `field` is the raw column of that identity field and whose `message` is `<check>`:

    | Identity field / input | Raw column | Mapping |
    |---|---|---|
    | `givenName` | `first_name` | as is (`identityField()` trims) |
    | `familyName` | `last_name` | empty → null |
    | `dateOfBirth` | `dob` | empty → null; must be `YYYY-MM-DD`, a real date, and before today in Asia/Kolkata (a limit, see Risks) |
    | `mobile` | `mobile` | empty → null; `identityField()` normalises `+91`, `0`, spaces, `-` |
    | `gender`, `email` | — | null (not in the source) |
    | `academicYear` | `academic_year` | `academicYearOk()`; message `ACADEMIC_YEAR_RULE` |
    | `admittedOn` | `admitted_on` | `isoDate()` (`YYYY-MM-DD` or `not a date`); not after `asOf` |
    | `joinDate` | `join_date` | `isoDate()` (`YYYY-MM-DD` or `not a date`) |
    | `courseCode` | `course_code` | trimmed, non-empty (as `admit()` requires; no length limit) |
    | `registerNo` | `register_no` | trimmed, `^\d+$` (else `digits only`) |
    | `admissionNo` | `admission_no` | trimmed, non-empty (else `required`) |

*   **Registration, versions and approval (DD-10).** `etl/run.ts` holds a fixed registry `RULES = [{ rule: centre, file: "etl/rules/centre.ts" }, …]`. In preflight the runner computes `code_hash = codeHash(file)` (`etl/canonical.ts`): lowercase hex sha256 over that file plus the fixed list `src/server/people.ts`, `etl/ids.ts` (the code a rule reaches), sorted by path, each as `"<path>\n"` followed by its bytes, where paths are repo-relative with `/` separators and files are read relative to the repository root (`process.cwd()`). It inserts each rule's row if `(id, version)` is new; if the row exists with a different `code_hash`, the run is refused in every mode, because changed logic needs a new version (the rule's declarations are in its file, so they are covered). The approver approves as the schema owner, with the hash computed from the commit they reviewed, and records the statement and its row count (which must be 1) in the evidence log:

    ```sql
    update migration.rule set approved_by = '<name>', approved_at = now()
    where rule_id = '<id>' and version = <v> and code_hash = '<hash of the reviewed commit>';
    ```

    `gems_etl` cannot run it (column grants). Tests run it through `asAdmin()` (`tests/fixtures.ts`), which is the schema owner because `ADMIN_DATABASE_URL` equals `MIGRATE_URL` in Docker and CI.
*   **Dry and cutover mode.** A dry run runs every mapping rule and lists the unapproved ones in its artifact. A cutover run is refused in preflight unless every rule it would run is approved (`approved_at` not null) (G5). Since `gems_etl` cannot change a rule row and a changed hash refuses the run, an approved row always matches the reviewed code. Since C-03.1 requires an approver for each exclusion, the cutover approval check therefore also covers every rule that can return EXCLUDED.

### Deterministic Ids and Order (G3)

*   **Ids:** `uuidv5(name, namespace = ETL_NAMESPACE)` (RFC 9562 §5.5, SHA-1 via `node:crypto`), with `ETL_NAMESPACE = 4f6d0b2e-9c1a-5e7b-8d3f-2a6c4e8b1d90` (a constant in `etl/ids.ts`, never changed), name = UTF-8 of `${source_system}/${source_table}/${encodeURIComponent(source_key)}/${target_table}`, with `/${n}` appended for the n-th target of a SPLIT (n from 1). Examples: `fixture/legacy_admission/1042/app.person`, `fixture/legacy_course_row/77/app.registration`.
*   **A merged group's person** has the survivor row's id.
*   **`created_at`** of migrated rows comes from legacy dates: a person's from its survivor admission's `admitted_on`, an admission's from its `admitted_on`, a registration's from its `join_date`, each as `(d::timestamp at time zone 'Asia/Kolkata')`.
*   **Registration `centre_id`** is its admission's centre (required by the composite foreign key); `end_date` is null; `status` comes from the status map.

### Canonical Form

Used for `source_row_hash`, `input_hash` and the run digest.

*   **A row** is JSON with keys sorted by Unicode code point (an explicit comparator, not `Array.prototype.sort`'s UTF-16 order), no whitespace, `null` for null. Every value is read from the database as text (`jsonb_each_text(to_jsonb(row))` in a session with `timezone = 'UTC'`), so dates are `YYYY-MM-DD`, timestamps are `YYYY-MM-DDTHH:MI:SS+00:00`, and numbers are decimal strings; no driver-side date parsing is involved.
*   **Every ordering** in this section, in the CSV and in `input_hash` uses `collate "C"`.
*   **`input_hash`:** sha256 over the three raw tables in the order `legacy_centre`, `legacy_admission`, `legacy_course_row`, each as `"<table>\n"` followed by its rows ordered by `source_key`, one canonical row per line.
*   **Run digest:** sha256 over these sections in order, each `"<name>\n"` then one canonical row per line, output lowercase hex:
    1.  `key_map`: every column except `id` and `run_id`, ordered by (entity, source_table, source_key, target_table, target_id);
    2.  `exception`: every column except `id`, `run_id` and `value_fingerprint`, ordered by (entity, source_table, source_key, field);
    3.  `app.person`, `app.admission`, `app.registration`: every column, ordered by `id` (`created_at` and `match_key` included).
*   **Where digests compare:** fingerprints are left out, so the digest does not depend on `ETL_SALT`. It still depends on the database's character classification, which `app.person_match_key` uses for Indic letters; `migration.run.lc_ctype` records it, and K9 compares only runs with the same value.

### Exceptions Without PII

*   **`value_fingerprint`** = first 16 lowercase hex characters of HMAC-SHA256 with key = UTF-8 of `ETL_SALT` and message = UTF-8 of the raw value; null when the raw value is null. `ETL_SALT` is an environment secret, set per migration environment and never stored or committed.
*   Fingerprints are deterministic within an environment, so the same bad value has the same fingerprint in every rehearsal, and operators can follow it across the fix-and-rerun loop. Anyone holding `ETL_SALT` can check whether a suspected value produced a fingerprint. Without `ETL_SALT`, an attacker cannot recompute fingerprints, even for low-entropy values such as 10-digit mobile numbers.

### Numbers (G7; NP-8, DD-6, DD-9)

*   Migrated admissions and registrations keep their legacy Admission No and Register No (DD-3).
*   **Preflight** refuses the run if a `REGISTER` counter or an `ADMISSION` counter for any seed year already exists.
*   **Parsing (DD-9, assumed until Stage 0 shows the real data):** a Register No is `^\d+$`; an Admission No belongs to year *y* when it is `PERSON_POLICY.admissionPrefix(y)` followed by digits, which are its sequence (the R-029 format the app issues, defined once in `people.ts`). Years are tried from the raw row's own `academic_year` when it passes `academicYearOk()`, otherwise from the two-digit pairs after `GTEC`. Every raw row counts, whatever its disposition, because legacy forms and certificates already carry the numbers of excluded and rejected rows. A value that does not parse is not counted and is listed in the artifact under `unparsedNumbers`.
*   **Counters** (in the step 5 transaction): `('REGISTER', 'ALL', max)` and one `('ADMISSION', <year>, max)` per seed year, where `max` is the larger of the parsed maximum and `legacyCurrent`, and 0 when neither has a value. Past years are not seeded (person-core DD-7).
*   **Years after the newest seed year** (DD-6): parsed Admission Nos of such a year are listed under `laterYearNumbers`. After go-live the app would open that year at 1 and collide with them, so a cutover run is FAILED while the list is non-empty; the decision owner then adds the year to `seedYears`. A cutover run is likewise FAILED while `unparsedNumbers` is non-empty (DD-9).

### Writing Targets (DD-3)

*   **One transaction.** Step 5 writes everything in one transaction, as `gems_etl`: target rows in the order person, admission, registration, by `insert … select … from json_to_recordset($1)` in batches of 1,000; then the key-map and exception rows of all four entities; then the counters. A run therefore leaves either all of its target rows or none.
*   **Failure.** The database refuses rows through the person core's constraints: `given_name` not null, the `Gender` and `RegistrationStatus` enum casts, the academic-year check, the centre and composite foreign keys, and the unique Admission and Register Nos. Mapping rules return REJECTED for every row these would refuse, so a constraint error means a mapping rule has a bug. On it, or on a fatal strictness violation, the transaction rolls back (or never starts), the runner sets the run FAILED with `finished_at` in a new transaction, writes the finish audit row and the artifact (with `errors`), and stops; no checks are written. A crash leaves the run RUNNING, and a RUNNING run is never PASSED; the next run is refused in preflight until the operator runs `scripts/etl/reset.sql` (raw and run rows remain until then).
*   **Exclusive and clean.** Preflight takes `pg_advisory_lock(hashtext('gems.etl.run'))` for the whole run (released at the end or when the connection drops) and refuses unless `migration.run`, the three `raw.legacy_*` tables, `app.person`, `app.admission` and `app.registration` are all empty.
*   **Audit:** the runner inserts two rows directly, so `app.audit()`'s session fields do not apply:

    | Column | `migration.run.start` | `migration.run.finish` |
    |---|---|---|
    | `action` | `migration.run.start` | `migration.run.finish` |
    | `outcome` | `OK` | `OK` if PASSED, `FAILED` otherwise |
    | `actor_kind` | `migration:<run_id>` | same |
    | `user_id`, `target_centre_id`, `session_hash`, `request_id`, `client_ip`, `reason`, `before`, `after` | null | null |
    | `at` | default (now) | default (now) |
    | `actor_roles`, `actor_scope` | `{}` | `{}` |
    | `target_type`, `target_id` | `migration.run`, the run id | same |
    | `detail` | `app.redact({ mode, source, as_of, input_hash })` | `app.redact({ status, digest, counts })` |

    The action names are passed as TypeScript `"…"` parameters, never written inside SQL text, so the T-AUD-009 scan finds them. Per-row provenance is the key map, which keeps millions of rows out of `audit_log`.

### Entities in P8

Reason strings are written in backticks.

**centre** (`raw.legacy_centre`; normalised code = `upper(trim(code))`):

| Outcome | Condition | Reason |
|---|---|---|
| IMPORTED (existing) | the normalised code equals an `app.centre.code`, and no earlier row has the same normalised code | — |
| EXCLUDED | the normalised code is in the test-centre list of X14 (`GDEMO`, `KL-01-TEST3`, `KL-01-TEST6`; approval pending, covered by the cutover approval of the centre rule) | `test centre` |
| REJECTED | an earlier row has the same normalised code | `code: duplicate centre code` |
| REJECTED | no `app.centre` has the normalised code | `code: no such centre` |

**person and admission** (`raw.legacy_admission`): see [one pass](#admission-and-person-one-pass) below. `parent` resolves an admission row to the **earliest** centre key whose normalised code equals the row's normalised `centre_code`.

**registration** (`raw.legacy_course_row`; `parent` = the admission whose source key is `admission_key`):

| Outcome | Condition | Reason |
|---|---|---|
| IMPORTED | linked to the admission target of `admission_key` | — |
| REJECTED | that admission is not IMPORTED (or does not exist) | `admission_key: admission not imported` |
| REJECTED | a field fails its check in the [mapping table](#mapping-rules-dd-2) | `<raw column>: <check>` |
| REJECTED | the status is not in the status map | `status: not in the status map` |
| REJECTED | an earlier usable course row has the same Register No | `register_no: duplicate` |

#### Admission and Person, One Pass

No person is written without an admission (G2):

1.  For each row, in order, run every check below and collect every failure:
    *   the identity from step 3 (errors as in the mapping table);
    *   the centre: the parent centre key must be IMPORTED; otherwise `centre_code: centre excluded` (EXCLUDED parent) or `centre_code: centre not imported` (any other case);
    *   the academic year (`academic_year: YYYY-YY, consecutive years`);
    *   `admitted_on` (`admitted_on: YYYY-MM-DD`, `admitted_on: not a date`, or `admitted_on: after the run date`);
    *   the Admission No is not used by an earlier usable row (`admission_no: duplicate`).
2.  Group usable rows by match key; a null key is its own group. The survivor is the earliest row of the group.
3.  **person:** the survivor IMPORTED; other usable rows of the group MERGED into it; rows that are not usable REJECTED with their errors.
4.  **admission:** usable rows IMPORTED with `person_id` = the survivor's person id and `centre_id` = the parent centre's id; rows that are not usable REJECTED with the same errors.

**Status map** (XL-5), trimmed and case-insensitive: `active` → ACTIVE, `drop` → DROP, `leave` → LEAVE, `transfer` → TRANSFER. Anything else is REJECTED. The map is part of the registration rule, so changing it changes the code hash.

**SPLIT** (K5) has no case in the Stage 2 target tables under the per-entity reading (DD-7); a unit test with a synthetic split rule covers it.

**Mapping rules in P8** (version 1 each): `centre` (rule owner Operations), `admission` (Admissions and PRO), `registration` (Certification).

### The Synthetic Fixture and Its Defects (G4)

`etl/fixture.ts` fills the raw tables from the seed `20261028` with a mulberry32 generator: about 2,000 admissions and 3,000 course rows over centres A, A2 and B. Source keys are zero-padded six-digit numbers (`000001`…), so `collate "C"` order is numeric order. Generated academic years are `2025-26` and `2026-27` (plus the single 2027-28 defect); `admitted_on` and `join_date` fall within the row's academic year (June to May) and before `asOf` = `2026-10-28`; dates of birth fall in 1990–2010. Raw centre rows: `' kl2-25 '` (spaces, lower case), `KL3-07`, `TN1-03`, `GDEMO`, `XX9-99`, and a second `KL3-07`. Generated Admission Nos follow `GTEC<yy><yy><seq>`; generated Register Nos continue from 2,000,001. Planted defects and the outcome P8 asserts:

| Defect | Outcome |
|---|---|
| Centre `' kl2-25 '` | centre IMPORTED (existing centre `KL2-25`) |
| Second `KL3-07` row | REJECTED, `code: duplicate centre code` |
| `GDEMO` with admissions and course rows | centre EXCLUDED; its admissions and persons REJECTED (`centre_code: centre excluded`); its course rows REJECTED (`admission_key: admission not imported`) |
| `XX9-99` with admissions and course rows | centre REJECTED; its admissions and persons REJECTED (`centre_code: centre not imported`); its course rows REJECTED |
| The same learner admitted twice (same dob and mobile; first and last names swapped on one row) | the later person MERGED into the earlier; both admissions IMPORTED to one person |
| Mobile `+91 98470 12345`, and the same learner elsewhere with `09847012345` | stored as `9847012345`; MERGED |
| Learner with no dob | person IMPORTED, never merged (null match key) |
| Learner whose only admission has `admitted_on` `'45231'` | admission and person REJECTED (`admitted_on: YYYY-MM-DD`); no person row |
| Academic year `2026-2027` | admission and person REJECTED (`academic_year: YYYY-YY, consecutive years`) |
| Two admissions with the same Admission No | the later REJECTED (`admission_no: duplicate`) |
| Course row whose `admission_key` does not exist | REJECTED (`admission_key: admission not imported`) |
| Two course rows with the same Register No | the later REJECTED (`register_no: duplicate`) |
| Course status `Completed` | REJECTED (`status: not in the status map`) |
| The highest Register No and 2026-27 Admission No on `GDEMO` rows | counters seeded above them (G7) |
| An Admission No `G-TEC/26/0042` | admission imported or rejected on its other fields; listed under `unparsedNumbers` |
| An Admission No of 2027-28 | listed under `laterYearNumbers` |

### Checks and Outputs

| Check | Scope keys | `expected` | `actual` | `passed` |
|---|---|---|---|---|
| K1 coverage | entity | raw keys of the entity's source table | distinct source keys in `key_map` for the entity | equal |
| K2 balance | entity, centre, academic_year | raw keys in scope | key-map rows in scope, counting each SPLIT key once and every other row as one; `detail` holds the count per disposition | equal (a duplicate row makes `actual` larger) |
| K3 provenance | target table (`app.person`, `app.admission`, `app.registration`) | rows in the table | rows whose id is a `target_id` of the run | equal, and every IMPORTED or SPLIT `target_id` with that `target_table` exists in the table |
| K4 merge integrity | entity | MERGED keys | MERGED keys whose `survivor_target_id` is the `target_id` of an IMPORTED key of the same entity and run and exists in the target table | equal, and every person has at least one admission |
| K5 split integrity | rule, entity (one row per entity with a declared `splitCardinality`; none in P8) | SPLIT keys | SPLIT keys with `splitCardinality` targets | equal |
| K6 referential | entity | keys whose `parent` resolves to a key that is not IMPORTED, or to none | those keys REJECTED with a reason | equal, and `pg_constraint.convalidated` is true for every foreign key of the target tables |
| K9 determinism | run | — | — | null; `detail.digest` (the test compares the runs) |
| K7, K8, K10, K11 | — | — | — | null; `detail.reason` = `not applicable in Stage 2` |

*   **Scope values:** `centre` is the normalised raw centre code (a registration inherits its admission row's); `academic_year` is the raw value. Centre rows have no year.
*   **Run status** is `runStatus({ mode, fatal, checks, rejected, unparsedNumbers, laterYearNumbers })` in `etl/checks.ts`, a pure function unit-tested per gate (including a cutover case where only K7, K8, K10 and K11 are null and every other input passes). A dry run's status is PASSED when every check with non-null `passed` is true. A cutover run's status is PASSED only when K1–K11 are all true (none null), REJECTED = 0, and `unparsedNumbers` and `laterYearNumbers` are empty. In Stage 2 a cutover run therefore cannot pass, which is intended: K7, K8, K10 and K11 do not exist yet.
*   **Artifacts** in `artifactDir` (P8 passes a temporary directory; the evidence run writes to `evidence/`, which is committed). They are the P8 evidence that v1 audit §A.8 names `poc/evidence/P8-<date>.json`; Stage 2 evidence lives in `evidence/`:
    *   `etl-<run_id>.json`: `{ run: { runId, mode, source, asOf, inputHash, lcCtype, startedAt, finishedAt, status, digest }, rules: [{ id, version, codeHash, approved }], dispositions: { <entity>: { <disposition>: n } }, checks: [{ check, scope, expected, actual, passed, detail }], seeds: [{ series, period, value }], unparsedNumbers: [{ table, sourceKey, column }], laterYearNumbers: [{ sourceKey, year }] }`;
    *   `etl-<run_id>-exceptions.csv`: header `entity,source_table,source_key,rule_id,field,value_fingerprint,message`, rows ordered as in the digest, RFC 4180 quoting; no raw values.

## Decisions

The design owner accepted these on 2026-10-28; each stays PRO until the design is approved. DD-6 and DD-9 stay PMC under NP-8.

1.  **DD-1: Same database, own schemas.** `migration` and `raw` live in the GEMS database, created by the schema owner through a migration-environment setup script; `gems_etl` exists only there.
2.  **DD-2: Mapping rules in TypeScript, one module per source table** (it may produce several entities), registered in `migration.rule` with a version and an approval.
3.  **DD-3: Direct bulk insert as `gems_etl`**, keeping legacy numbers; the database's own constraints still apply.
4.  **DD-4: K7 and K8 wait for Stage 4**, when the fee and ledger tables exist.
5.  **DD-5: No `stage` schema.** Typing and cleaning happen inside each mapping rule. An entity that grows too slow for in-memory rules can be reimplemented as set-based SQL that writes the same key-map rows.
6.  **DD-6: Counter seeds.** `REGISTER` and only the NP-8 years (default `2026-27`), from the highest number on any raw row or the legacy counter if larger; an existing counter refuses the run; numbers of later years block a cutover until their year is seeded.
7.  **DD-7: One disposition per source key and entity.** A legacy row that becomes a person and an admission has two entries, one per entity. This is a deliberate reading of C-03.1, whose example ("an XLS enrolment row → person + course registration + fee plan") it records per entity instead of as one SPLIT; SPLIT stays for one entity producing several rows of the same kind.
8.  **DD-8: No ARCHIVED until D-MIG-1.** The runner refuses it and no `archive` schema exists.
9.  **DD-9: Legacy Admission Nos are assumed to be `GTEC<yy><yy><seq>`** (the R-029 format) until Stage 0 shows the real data; unparsable values are listed and block a cutover.
10. **DD-10: Mapping rules carry a code hash** over the rule and the code it reaches (`people.ts`, `ids.ts`). An approval binds the hash of the reviewed commit; the same version with different code is refused in every mode, so an approved rule always runs the reviewed code.
11. **DD-11: No command-line launcher in Stage 2.** `run()` is called from the tests; the first rehearsal adds a `tsx` launcher.

## Open Questions

| ID | Decision owner | What it affects here | Default used now |
|---|---|---|---|
| D-MIG-4 | Owners of each master list (Admissions, Academics, HR) | Real merge maps (masters; persons with D-STU-5) | Synthetic match-key rule in P8 only |
| D-STU-5 | Admissions, PRO | Person merge in real data | Not run on real data |
| D-MIG-7, D-MIG-8 | IT, Accounts, MIS | Which source; XLS import mode | No real source |
| D-MIG-1 | IT, Accounts | History depth; what is ARCHIVED | ARCHIVED refused (DD-8) |
| D-SEC-4, D-SEC-5 | IT, Legal | PII in `raw` and artifacts; whether `raw` is kept after go-live | Synthetic data only; fingerprints in exceptions |
| NP-8 | Accounts, Certification | Which years are seeded; seed values | DD-6 |
| NP-8 with Stage 0 | Accounts, Certification, IT | The real legacy Admission No format | DD-9 |
| D-TZ-1 | IT | Legacy dates and times | Dates only; `created_at` at Asia/Kolkata midnight |

## Alternatives Considered

### Alternative A: A Separate ETL Database

*   **Pros:** Stronger isolation; the target database never sees raw or migration schemas.
*   **Cons:** Two databases to provision and reconcile; target ids and constraints are checked across a connection; the key map lives away from the rows it describes.
*   **Reason for Rejection:** The extra isolation costs a second database to run and reconcile, while schemas owned by the schema owner plus a role that exists only in migration environments give sufficient separation in one database (DD-1).

### Alternative B: Mapping Rules as SQL (`insert … select` From Intermediate Tables)

*   **Pros:** Set-based and fast for millions of rows.
*   **Cons:** Per-row dispositions and exceptions become `case` expressions across many statements; unit testing needs a database; the person core's TypeScript validation would be duplicated in SQL.
*   **Reason for Rejection:** It duplicates the app's validation and makes rules hard to test, while P8 and the first roadmap stages are small enough for in-memory rules (DD-2). A slow entity can be reimplemented in SQL later (DD-5).

### Alternative C: Load Through `admit()`

*   **Pros:** Reuses the app's validation and audit.
*   **Cons:** Allocates new numbers, losing legacy Admission and Register Nos; one transaction and audit row per record; needs a session and permissions for every centre.
*   **Reason for Rejection:** Legacy numbers are printed on forms and certificates and must survive (DD-3). The mapping rules reuse `admit()`'s validation instead.

### Alternative D: Random Ids Plus a Lookup Table

*   **Pros:** No id scheme to define.
*   **Cons:** Every rerun gives different ids, so rehearsals do not predict the final run.
*   **Reason for Rejection:** Different ids on every run make two rehearsals incomparable (G3).

### Alternative E: An Audit Row per Migrated Record

*   **Pros:** The audit log alone tells where each row came from.
*   **Cons:** Millions of audit rows that duplicate the key map, in an append-only table that cannot be pruned.
*   **Reason for Rejection:** The key map is the per-record provenance; the audit log records the run.

### Alternative F: A Synthetic Voucher Table Now for K7/K8

*   **Pros:** Proves audit 08's "never auto-balance" rule (D-MIG-3) in Stage 2.
*   **Cons:** A throwaway target that the Stage 4 ledger replaces; the check would be rewritten anyway.
*   **Reason for Rejection:** The check would be built twice, once on a table that Stage 4 discards (DD-4).

### Alternative G: One Disposition per Source Key, With SPLIT for Multi-Entity Rows

*   **Pros:** Follows C-03.1's example literally.
*   **Cons:** A legacy admission row is then SPLIT into person and admission, but its person part may be a merge, which a single disposition cannot express without a second, per-target outcome.
*   **Reason for Rejection:** A single disposition cannot say that a row's person was merged while its admission was imported; per-entity dispositions record each outcome directly (DD-7).

### Alternative H: Seed Every Legacy Year From the Highest Migrated Number

*   **Pros:** Every year's counter exists after migration.
*   **Cons:** Reopens past years for new admissions (against person-core DD-7), and can reissue numbers printed on excluded or rejected rows.
*   **Reason for Rejection:** It reopens past years and can reissue printed numbers (DD-6).

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| `gems_etl` left in production | A role that bypasses RLS on live data | Created only by `scripts/etl/setup.sql`; owns nothing, so the go-live checklist can drop it; the T-RLS-015 query lists BYPASSRLS roles afterwards | P8, G6 cases |
| `gems_etl` approves its own rules | Unapproved logic in a cutover | Column grants: no insert or update of `approved_*` on `migration.rule` or `migration.key_map` | P8, G6 cases |
| The synthetic schema differs from the real legacy one | Mapping rules rewritten at Stage 0 | **Accepted:** the framework does not depend on the source shape; only `etl/rules/` and the raw loader (`etl/fixture.ts` in P8) do | n/a |
| The real Admission No format differs from DD-9 | Counters seeded too low; printed numbers reissued | `unparsedNumbers` listed in every artifact; a cutover run is FAILED while it is non-empty | P8 (unparsable-number defect); run-status unit test |
| A constraint error during the write | Run FAILED | Mapping rules return REJECTED for every row the constraints would refuse; the single write transaction rolls back; the operator resets | P8 |
| A crash mid-run | Database left with raw and run rows | Preflight refuses a non-empty database; the operator runs `scripts/etl/reset.sql`, which keeps the mapping rules and their approvals | P8, refusal cases |
| Raw tables hold PII in rehearsals | Exposure beyond the app's controls | Synthetic data only in Stage 2; `raw` revoked from `public`; retention and access are D-SEC-4/5 before any real run | n/a |
| `ETL_SALT` leaks | Fingerprints of low-entropy values (mobiles, dates of birth) can be reversed | A different secret per migration environment, never stored or committed | n/a |
| `ETL_DB_PASSWORD` in database logs | The role password visible to log readers | **Accepted:** setup sends one `alter role … password` statement, in a migration environment, and the role is dropped at go-live | n/a |
| `setup.mjs` on Supabase's non-superuser `postgres` | Setup fails on the production database before go-live | Role created with defaults and checked rather than altered; the first rehearsal runs setup on Supabase and records it | first rehearsal |
| In-memory rules on 1.2M rows | Slow or out of memory: `map()` holds a whole table, and the write transaction holds every row | Timed at the first rehearsal; the DD-5 set-based fallback for a slow entity (batching only caps statement size) | timed at the first rehearsal |
| Merge by match key on real data | Different people with equal name, dob and mobile merged | **Accepted for P8 only:** real merges need D-MIG-4/D-STU-5 maps | n/a (accepted) |
| A legacy number issued after extraction | Reissued by the app | Freeze before the final run (audit 08 §7); the `legacyCurrent` option set from the frozen counter; NP-8 sign-off | P8, continuity case |
| Date of birth checked against today (Asia/Kolkata) | A row whose date of birth is the run day is REJECTED on that day and accepted on later days, so its digest differs | **Accepted:** `identityField()` keeps the app's behaviour; the artifact records `asOf`, and such a date of birth is implausible for an admission | n/a |
| The validation in `people.ts` changes | Migrated and app data validated differently, or an approved rule silently changes | One shared function; `people.ts` is in every rule's code hash, so a change needs a new approval | `tests/people.test.ts`, P8 |

## Detailed Implementation Plan

### Build phases

`bash scripts/ci.sh` must be green at the end of each phase.

| Phase | Items | Why they go together |
|---|---|---|
| M1 Documents | 1 | T-MIG tests and matrix links stay consistent (T-DOC-001) |
| M2 Setup | 2, 3 | The schemas and role must exist before the runner can be tested; CI needs the new connection variable |
| M3 Runner and rules | 4, 5, 6, 7, 8 | Rules, ids and checks are tested together through P8; the audit actions are catalogued in the same change |
| M4 Evidence | 9 | After CI is green |

### Target Files to Create/Modify

#### 1. `docs/audit/09-test-strategy-and-acceptance-criteria.md` (Modify)

*   The T-MIG table gains a third column `Stage 2`: `P8 on synthetic data` for T-MIG-001…006 and 009; `Stage 4 (DD-4)` for 007 and 008; `needs legacy data` for 010 and 011.
*   Under the T-RLS heading, a note: "T-RLS-015 (defined in v1.1 C-04): `gems_etl` is created only by `scripts/etl/setup.mjs` in a migration environment and dropped at go-live, followed by the query in `docs/designs/migration-framework/migration-framework.md`. Schemas `raw` and `migration` have no RLS: no `centre_id`, revoked from every role except the schema owner and `gems_etl`."
*   No matrix TSV changes, so the CSV and FRD stay as they are.

#### 2. `scripts/etl/setup.sql`, `setup.mjs`, `reset.sql` (Create)

*   `setup.sql`: the DDL of [Data Model](#data-model-scriptsetlsetupsql-ddl-in-substance), the revokes and the grants of [Where It Runs](#where-it-runs-dd-1).
*   `setup.mjs`: the four steps of [Where It Runs](#where-it-runs-dd-1).
*   `reset.sql`: the reset of [Components](#components).

#### 3. `scripts/ci.sh`, `.github/workflows/ci.yml`, `scripts/scan-client-bundle.mjs`, `.env.local` (Modify)

*   `ci.sh`: `node scripts/etl/setup.mjs` after **both** `npx prisma migrate deploy` calls (lines 34 and 62), so the database CI leaves behind is set up; `ETL_DATABASE_URL`, `ETL_DB_PASSWORD` and `ETL_SALT` join the required-variable loop (line 10) and the header comment (line 5) that lists the variables.
*   `ci.yml` env: `ETL_DATABASE_URL: postgresql://gems_etl:dev_etl_pw@127.0.0.1:54320/gems` (the database directly, not PgBouncer), `ETL_DB_PASSWORD: dev_etl_pw`, `ETL_SALT: dev_etl_salt` (throwaway values).
*   `scan-client-bundle.mjs`: the three names join `SECRET_ENV` (T-SEC-017).
*   `.env.local`: the same three local values. This file is git-ignored, so the change is local; other developers add the variables from the `ci.sh` header.

#### 4. `src/server/people.ts` (Modify)

*   Export `identityField()`, `isoDate()`, the `StoredIdentity` type and `ACADEMIC_YEAR_RULE`, and use the constant in the two existing messages; no behaviour change (`tests/people.test.ts` unchanged and green).

#### 5. `etl/ids.ts`, `etl/types.ts`, `etl/canonical.ts` (Create)

*   `uuidv5(name, namespace = ETL_NAMESPACE)`; the types of [Mapping Rules](#mapping-rules-dd-2); canonical JSON with the code-point comparator, `inputHash()`, `digest()`, `fingerprint()` and `codeHash(file)`.

#### 6. `etl/rules/centre.ts`, `admission.ts`, `registration.ts` (Create)

*   The three mapping rules of [Entities in P8](#entities-in-p8), each version 1 with its rule owner and `parent` resolvers.

#### 7. `etl/run.ts`, `etl/checks.ts`, `etl/fixture.ts` (Create)

*   `run.ts`: `run()` steps 0–7, connecting with `ETL_DATABASE_URL`; `RunRefused`; the `RULES` registry; the advisory lock and empty-database check. When the environment variable `ETL_EVIDENCE=1` is set, `artifactDir` defaults to `evidence/`.
*   `checks.ts`: K1–K6 queries, the not-applicable rows, `validateResults()`, `k5(keyMapRows, rules)` and `runStatus()`.
*   `fixture.ts`: the generator, the centre rows and the defects table.

#### 8. Tests (Create/Modify)

*   `tests/etl.test.ts`. Its helper `resetEtl()` calls `reset()`, then through `asAdmin()` runs `scripts/etl/reset.sql` and, **for tests only**, `truncate migration.rule cascade`. Test titles start with their ids, as in the other suites.
    *   **Unit:** `uuidv5("www.example.com", DNS namespace 6ba7b810-9dad-11d1-80b4-00c04fd430c8)` = `2ed6657d-e927-568b-95e1-2665a8aea6a2`; canonical JSON (key order, nulls, code-point sort); each rule on hand-written rows; `validateResults()` with an undeclared entity, an undeclared disposition and a missing result; `k5()` on synthetic SPLIT key-map rows (one with the declared count, one without); `runStatus()` per gate.
    *   **P8**, in this order:
        1.  `resetEtl()`; dry run 1 with `asOf` `2026-10-28`; status PASSED; it registers the three rules.
        2.  Approve each rule through `asAdmin()` with `codeHash()` of its file; each update reports 1 row.
        3.  Assert every row of the defects table, G1–G4 and the `unparsedNumbers` and `laterYearNumbers` lists on run 1.
        4.  `reset.sql` only (rules and approvals kept); dry run 2; digests of run 1 and 2 equal (T-MIG-009).
        5.  `admit()` issues Register No max + 1 and the next 2026-27 Admission No (G7).
    *   **Key map:** a direct second insert for an existing key and entity fails with 23505 (T-MIG-002).
    *   **Refusals:** each starts from `resetEtl()`.
        *   Cutover with no approved rule: `RunRefused`; `count(*)` of `migration.rule` and `migration.run` is 0 afterwards.
        *   Changed code: dry run 1, then through `asAdmin()` `update migration.rule set code_hash = 'x' where rule_id = 'centre'`; the next dry run (after `reset.sql`) is refused in dry mode.
        *   Existing counter: insert a `REGISTER` counter; refused.
        *   Non-empty database: insert one raw row; refused.
    *   **G6:** no file under `prisma/migrations` mentions `gems_etl`; it owns no objects; connected as `gems_etl`, inserting a `migration.rule` row or a `migration.key_map` row with `approved_by`, and `update migration.rule`, fail with 42501.
    *   **Audit:** the two rows with the column values of [Writing Targets](#writing-targets-dd-3).
*   `tests/audit-catalogue.ts` gains `migration.run.start` and `migration.run.finish`; `tests/audit.test.ts` T-AUD-009 scans the whole of `etl/run.ts` with `/"(migration\.run\.[a-z]+)"/g`, as it scans `auth/index.ts`.

#### 9. `docs/STATUS.md`, `docs/audit/12-evidence-and-verification-log.md` (Modify)

*   Evidence run: `ETL_EVIDENCE=1 npx vitest run tests/etl.test.ts`, which writes `evidence/etl-<run_id>.json` and `evidence/etl-<run_id>-exceptions.csv` for P8 run 2 (committed).
*   The evidence-log entry: CI counts, both artifact hashes, the approval statements and their row counts, and the mutation checks.
*   STATUS: the Stage 2 line, the test count and the completed-items table.

### Verification Plan

*   **CI:** `bash scripts/ci.sh` (adds the ETL setup), `npx vitest run` including `tests/etl.test.ts`.
*   **Mutation checks**, recorded in the evidence log:

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | Determinism | Use `randomUUID()` in `etl/ids.ts` | T-MIG-009 |
    | No silent drop | Skip writing the key map for REJECTED keys | T-MIG-001 |
    | Provenance | Insert one unmapped person before the checks | T-MIG-003 |
    | No lost target | Skip one registration batch after its key-map rows are written (nothing references registration, so the write commits) | T-MIG-003 |
    | Duplicate disposition | Drop the unique index, then write a second row for one key | T-MIG-002 |
    | Merge integrity | Point a MERGED key at a MERGED survivor | T-MIG-004 |
    | No unreachable person | Import the person of an unusable row | T-MIG-004 |
    | Cutover approval | Skip the approval check | G5 test |

*Drafted with EGM*
