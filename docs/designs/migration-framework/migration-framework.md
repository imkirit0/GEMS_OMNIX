# Migration framework: ETL foundation and P8 (Stage 2)

*   **Author:** gtm
*   **Status:** Proposed. The owner accepted every section on 2026-10-28; build approval follows EGM review Stages 5–9. Reviews so far: [`zoom_out_report.md`](zoom_out_report.md) (Stage 5), [`comprehension_report.md`](comprehension_report.md) (Stage 6).
*   **Date:** 2026-10-28

Evidence classes follow `docs/audit/00-README.md`: SRC (stated in a source), INF (inferred), PRO (proposed here), PMC (proposed default, waiting for its business owner to sign). Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

GEMS OMNIX replaces a legacy system that holds 17 years of learners, admissions, fees and certificates. Moving that data is the riskiest single step of the rebuild: a record that silently disappears, or two legacy rows that silently become one, cannot be noticed later. The audit pack therefore fixed one rule before any code (audit 08 §4, v1.1 C-03): **every legacy record gets exactly one recorded outcome, and nothing is ever dropped without a reason.**

This design covers the **migration foundation** that Stage 2 of the roadmap asks for (`docs/audit/10-implementation-roadmap.md`, row 2: "ETL framework", "key map, rules, exceptions live", P8):

*   the bookkeeping: where each legacy key went, under which rule, and why (the *key map*);
*   how mapping rules are written, versioned and approved;
*   a runner that loads a source, applies the rules, and writes target rows with ids that come out the same on every run;
*   the reconciliation checks K1–K6 and K9, stored per run;
*   **P8**: a dry run on a synthetic, legacy-shaped dataset with planted defects, run twice from scratch in CI.

The real sources stay out of scope: there is no access to the legacy MySQL database yet (a Stage 0 blocker), and the 1.2M-row XLS needs separate approval (v1 audit §A.8). Each later module stage (3–7) adds its own entity mappings on this foundation.

### Terms and references

| Term | Meaning | Where |
|---|---|---|
| Source key | The identity of one legacy record: source system, table and key | C-03.2 |
| Entity | The kind of target a rule produces (centre, person, admission, registration). One source row can feed several entities | DD-7 |
| Disposition | The recorded outcome of one source key for one entity: IMPORTED, MERGED, SPLIT, ARCHIVED, EXCLUDED or REJECTED | C-03.1, audit 08 §4 |
| Key map | `migration.key_map`: one row per (source key, entity, target row) of a run | C-03.2 |
| Rule | A versioned mapping for one source table, producing one or more entities, with an owner, a code hash and an approval | C-03.2 |
| Exception | A rejected value, stored as a fingerprint, not the raw value | C-03.2 |
| K1…K11 | The reconciliation checks; T-MIG-001…011 test them | C-03.3, audit 09 §T-MIG |
| Run | One execution of the ETL, identified by a run id; *dry* or *cutover* | this design |
| Run digest | A hash of a run's key map and target rows without run ids and timestamps; equal digests mean identical runs (K9) | this design |
| Migration environment | A database where migration runs: local Docker, CI, a rehearsal copy, and the new production database **before** go-live | audit 08 §6 |
| Migration owner | The role that runs Prisma migrations and owns every schema object (`MIGRATE_URL`; superuser locally, `postgres` on Supabase) | migration 0002 |
| `gems_etl` | The database role the ETL runs as; it bypasses RLS, owns nothing, and exists only in a migration environment | T-RLS-015 |
| RLS | Postgres row-level security | migration 0002 |
| P8 | Proof of concept: repeatable dry run with reconciliation output | `docs/audit/11-proof-of-concept-specification.md`; v1 audit §A.8 |
| Person core | `person`, `admission`, `registration` (migration 0011) and `src/server/people.ts` | `docs/designs/person-core/person-core.md` |
| `app.person_match_key` | The database function that derives the duplicate-check key from name, date of birth and mobile | migration 0011 |
| R-xxx, D-xxx, NP-n | Requirements and open business decisions | `docs/audit/02-…csv`, `docs/audit/04-manager-decision-register.md` |
| DD-n | Design decisions of this document | [Decisions](#decisions) |

## The Problem

1.  **Counting is not reconciling.** The original plan checked "record counts per entity" (v0 §7.4). Counts balance even when one record is lost and another duplicated (v1.1 L-23). The audit replaced counts with per-key dispositions and eleven checks.
2.  **The legacy data is known to be dirty** (audit 08 §2, DQR): whitespace and malformed centre codes, test centres, duplicate persons with no shared identifier (XL-1), dates in text columns (XL-4), enum drift per year (XL-5). Each defect needs a recorded outcome, not a silent fix.
3.  **Reruns must be identical.** Migration is rehearsed at least twice before cutover, each time on a fresh copy (audit 08 §6–7). If ids or outcomes change between runs, a rehearsal proves nothing about the final run (K9).
4.  **The ETL needs powers the app must never have.** Loading every centre's rows needs to bypass RLS. That role must not exist in production after go-live (T-RLS-015).
5.  **No source access yet.** The framework must be built and proven before the legacy schema is known, so it cannot hard-code that schema.

## Goals

Each goal is met when its tests pass in `bash scripts/ci.sh`.

*   **G1: Every source key has exactly one disposition per entity.** The key map is complete and the database refuses a second disposition for the same key and entity in a run (T-MIG-001 K1, T-MIG-002 K2).
*   **G2: Nothing reaches a target without provenance, and nothing unreachable is written.** Every row in the mapped target tables has a key-map row; merges have one imported survivor and no chains; every migrated person has at least one migrated admission; source orphans end REJECTED (T-MIG-003 K3, T-MIG-004 K4, T-MIG-006 K6).
*   **G3: Reruns are identical.** Two runs from scratch on the same input give the same run digest (T-MIG-009 K9).
*   **G4: Planted defects surface.** Each defect in the synthetic fixture ends as the disposition the defect table names, with an exception for each REJECTED key (P8).
*   **G5: Cutover mode refuses unapproved rules** (P8: a cutover-mode run with one unapproved rule fails before writing).
*   **G6: The ETL role is confined.** `gems_etl` is created only by the migration-environment setup script, owns nothing, and can be dropped at go-live without losing the key map (T-RLS-015, as far as Stage 2 can check it).
*   **G7: The app continues the legacy numbers.** After a run, `admit()` issues the Register No and Admission No after the highest number on any legacy row (P8).

## Non-Goals

*   **Real legacy data.** No MySQL access (Stage 0); the XLS needs separate approval (v1 audit §A.8) and its import mode is D-MIG-8.
*   **K7 and K8** (money control totals, ledger). There are no fee or ledger tables until Stage 4 (G-FIN); both checks are built then (DD-4). P8 records them as not applicable.
*   **K10 and K11** (report parity, sampled field fidelity). They need legacy reports and real rows.
*   **ARCHIVED.** What is archived is D-MIG-1. Until then the runner refuses an ARCHIVED result and no `archive` schema exists (DD-8).
*   **Mappings for later stages:** catalogue, fees, exams, certificates, tickets, and centres beyond matching existing codes. Each module stage adds its own.
*   **A person-merge tool** (D-STU-5). P8 merges duplicates only by a synthetic rule on the match key; real merge maps are D-MIG-4.
*   **Files** (`/uploads/`). Moved with their references in a later stage.
*   **Cutover runbook, freeze and rollback** (audit 08 §7). Written before the first rehearsal.

## Technical Plan (Architecture)

### Components

```text
 run({ source: "fixture", mode: "dry" | "cutover", seedYears, legacyCurrent })      etl/run.ts
   │  0. preflight         options valid; counters absent; rules registered (hash checked); cutover: approvals
   │                       → refused: RunRefused thrown, nothing written
   │  1. start run         migration.run row (RUNNING); audit migration.run.start
   │  2. load raw          source "fixture": etl/fixture.ts fills raw.legacy_* (empty before)
   │  3. prepare           identity() on every admission row; match keys of the valid ones in one query
   │  4. apply rules       centre → admission (person + admission) → registration
   │  5. write             per entity in order centre, person, admission, registration: target rows,
   │                       key_map and exception rows, one transaction per entity
   │  6. seed counters     REGISTER and the seed years (DD-6, DD-9)
   │  7. check             K1–K6 → migration.reconciliation; run digest
   │  8. finish run        status PASSED/FAILED, digest; artifacts; audit migration.run.finish
   ▼
 Postgres, same database (DD-1)
   raw.legacy_*  verbatim source rows (text)     migration.*   run, rule, key_map, exception, reconciliation
   app.*         target tables (person core today)
```

*   **Entry point (DD-11):** `etl/run.ts` exports `run(opts): Promise<RunResult>`; Stage 2 calls it only from `tests/etl.test.ts`. There is no command-line launcher yet: Node's type stripping cannot load `src/server/people.ts` (constructor parameter properties, extension-less imports), and no `tsx` is installed. A launcher (`tsx`) is added with the first rehearsal.
*   **Options:** `source: "fixture"` (the only value in Stage 2); `mode` (required); `seedYears: string[]` (default `["2026-27"]`, PMC under NP-8, a literal, not the clock); `legacyCurrent?: { REGISTER?: bigint; ADMISSION?: Record<string, bigint> }`; `artifactDir` (default `evidence/`); `fixtureSeed` (default `20261028`).
*   **Result:** `{ runId, status: "PASSED" | "FAILED", digest, checks, artifactPaths }`. A refused run throws `RunRefused(reasons: string[])` and writes nothing: no run row, no audit, no artifact.

### Where it runs (DD-1)

*   **Schemas** `raw` and `migration` in the GEMS database. No `stage` schema (DD-5); no `archive` schema (DD-8).
*   **Created by a setup script, not a Prisma migration.** `scripts/etl/setup.mjs` runs `scripts/etl/setup.sql` as the **migration owner** (`MIGRATE_URL`), once, on a fresh database, in a migration environment. Every table is owned by the migration owner (0002: runtime roles never own objects). The new production database runs it **before** go-live only; the go-live checklist then revokes `gems_etl`'s privileges, drops the role, and runs the T-RLS-015 query below. The schemas and the key map stay as cutover evidence; whether `raw` is kept is D-SEC-5. The Prisma datasource lists only `app`, so the drift gate is unaffected.
*   **`gems_etl`** (created if missing; password set by the client as `select format('alter role gems_etl login password %L', $1)` with `ETL_DB_PASSWORD`, then executing the result): `login bypassrls nosuperuser nocreatedb nocreaterole noinherit`, owning nothing.
    *   `usage` on `raw`, `migration`, `app`;
    *   `select, insert` on the three `raw.legacy_*` tables and on `migration.key_map`, `migration.exception`, `migration.reconciliation`;
    *   `select, insert` on `migration.run` and `update (finished_at, status, digest)` on it;
    *   `select, insert` on `migration.rule` and `update (entity_list, description, owner, dispositions)` on it, so the ETL can register a rule but never approve one;
    *   `select` on `app.centre`; `select, insert` on `app.person`, `app.admission`, `app.registration`;
    *   `select, insert, update` on `app.global_number_series`;
    *   `insert` on `app.audit_log`, `usage` on `app.audit_log_id_seq`.

    No other update and no delete on `app.*`.
*   **Go-live check (T-RLS-015)**, run as the migration owner after the drop and recorded in the evidence log:

    ```sql
    select rolname from pg_roles where (rolbypassrls or rolsuper) and rolname <> 'postgres' order by 1;
    ```

    The result must equal the platform's pinned list (`poc/test/rls.test.js`: on Supabase `service_role`, `supabase_admin`, `supabase_etl_admin`, `supabase_read_only_user`).

### Data model (`scripts/etl/setup.sql`, verbatim in substance)

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
  input_hash text not null, started_at timestamptz not null default now(), finished_at timestamptz,
  status text not null default 'RUNNING' check (status in ('RUNNING', 'PASSED', 'FAILED')), digest text);

create table migration.rule (
  rule_id text not null, version int not null, source_table text not null, entity_list text[] not null,
  description text not null, owner text not null, dispositions text[] not null, code_hash text not null,
  approved_by text, approved_at timestamptz, approved_hash text,
  primary key (rule_id, version),
  check ((approved_by is null) = (approved_at is null) and (approved_by is null) = (approved_hash is null)));

create table migration.key_map (
  id bigint generated always as identity primary key,
  run_id uuid not null references migration.run, entity text not null,
  source_system text not null, source_table text not null, source_key text not null, source_row_hash text not null,
  disposition text not null check (disposition in ('IMPORTED', 'MERGED', 'SPLIT', 'ARCHIVED', 'EXCLUDED', 'REJECTED')),
  rule_id text not null, rule_version int not null, target_table text, target_id text, survivor_target_id text,
  reason text, approved_by text, approved_at timestamptz,
  foreign key (rule_id, rule_version) references migration.rule);
create unique index key_map_one_disposition on migration.key_map (run_id, entity, source_system, source_table, source_key)
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

*   **`source_system`** is `fixture` in P8 (later `gems_mysql`, `xls`). **`target_table`** is schema-qualified (`app.person`). **`target_id`** is text (uuid or centre id).
*   **`key_map.approved_by` / `approved_at`** stay null in Stage 2, reserved for per-record approvals (D-MIG-4 merge maps).
*   **`source_row_hash`:** lowercase hex sha256 of the raw row as canonical JSON (see [Canonical form](#canonical-form)).
*   **How each disposition fills the key map:**

    | Disposition | `target_table` | `target_id` | `survivor_target_id` | `reason` | Exception rows |
    |---|---|---|---|---|---|
    | IMPORTED (new row) | the table | the new id | null | null | 0 |
    | IMPORTED (existing row) | the table | the existing id | null | `existing` | 0 |
    | MERGED | the table | null | the survivor's target id | `merged into <survivor source key>` | 0 |
    | SPLIT | the table | each target's id (one row per target) | null | null | 0 |
    | EXCLUDED | null | null | null | the rule's reason | 0 |
    | REJECTED | null | null | null | the errors as `field: message`, joined with `; ` | one per error |

### Rules (DD-2)

A rule is one TypeScript module per **source table** in `etl/rules/`, registered as one `migration.rule` row. It may produce more than one entity (the admission rule produces person and admission).

```ts
type Disposition = "IMPORTED" | "MERGED" | "SPLIT" | "EXCLUDED" | "REJECTED";        // ARCHIVED: DD-8
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
  result(entity: string, sourceKey: string): Result | undefined;   // earlier entities' results
  centres: { id: number; code: string }[];                          // app.centre, read by the runner
  identity: Map<string, StoredIdentity | RuleError[]>;              // step 3, by admission source key
  matchKey: Map<string, string | null>;                             // step 3, valid identities only
  id(name: string): string;                                         // uuidv5 (Deterministic ids)
};
type Rule = {
  id: string; version: number; description: string; owner: string;
  sourceTable: string; entities: string[];
  dispositions: Record<string, Disposition[]>;                      // allowed per entity
  parent?: Record<string, { entity: string; field: string }>;      // for K6, per entity
  splitCardinality?: Record<string, number>;                        // for K5, per entity
  map(rows: RawRow[], ctx: Ctx): Map<string, Record<string, Result>>; // source key → entity → result
};
```

*   **Rows** reach `map` ordered by `source_key collate "C"`; "earlier" and "later" always mean this order.
*   **Strictness:** a result for an undeclared entity, a disposition outside the entity's `dispositions`, a missing result for a row, or an ARCHIVED result fails the run (FAILED). Declaring ARCHIVED fails registration.
*   **No I/O in rules.** Everything a rule reads is in `ctx`, so rules are unit-tested with plain objects and `app.person_match_key` is never reimplemented.
*   **One validation path.** Rules validate with the person core's functions, exported from `src/server/people.ts` without behaviour change: `identity()`, `isoDate()`, `academicYearOk()`. A thrown `PersonError` with message `"<key>: <rule>"` becomes a `RuleError` with `field` = the raw column of that key and `message` = `<rule>`:

    | Identity key / input | Raw column | Mapping |
    |---|---|---|
    | `givenName` | `first_name` | as is (`identity()` trims) |
    | `familyName` | `last_name` | empty → null |
    | `dateOfBirth` | `dob` | empty → null; must be `YYYY-MM-DD` |
    | `mobile` | `mobile` | empty → null; `identity()` normalises `+91`, `0`, spaces, `-` |
    | `gender`, `email` | — | null (not in the source) |
    | `academicYear` | `academic_year` | `academicYearOk()` |
    | `admittedOn` | `admitted_on` | `isoDate()`; not in the future |
    | `joinDate` | `join_date` | `isoDate()` |
    | `courseCode` | `course_code` | trimmed, non-empty, at most 50 characters |
    | `registerNo` | `register_no` | trimmed, `^\d+$` |
    | `admissionNo` | `admission_no` | trimmed, non-empty |

*   **Registration, versions and approval (DD-10).** In preflight the runner computes `code_hash` = lowercase hex sha256 of the rule module's file bytes, and inserts each rule's row if `(id, version)` is new. If the row exists with a different `code_hash`, `source_table`, `entity_list` or `dispositions`, the run is refused in **every** mode: changed logic needs a new version. Approval is one statement, run by the approver as the migration owner and recorded in the evidence log:

    ```sql
    update migration.rule set approved_by = '<name>', approved_at = now(), approved_hash = code_hash
    where rule_id = '<id>' and version = <v>;
    ```

    `gems_etl` cannot run it (column grants). Tests run it as the admin.
*   **Dry and cutover mode.** A dry run runs every rule and lists the unapproved ones in its artifact. A cutover run is refused in preflight unless every rule it would run has `approved_hash = code_hash` (G5). This covers each rule that can return EXCLUDED, since C-03.1 requires an approver for each exclusion.

### Deterministic ids and order (G3)

*   **Ids:** UUIDv5 (RFC 9562 §5.5, SHA-1 via `node:crypto`), namespace `4f6d0b2e-9c1a-5e7b-8d3f-2a6c4e8b1d90` (a constant in `etl/ids.ts`, never changed), name = UTF-8 of `${source_system}/${source_table}/${encodeURIComponent(source_key)}/${target_table}`, with `/${n}` appended for the n-th target of a SPLIT (n from 1). Examples: `fixture/legacy_admission/1042/app.person`, `fixture/legacy_course_row/77/app.registration`.
*   **A merged group's person** has the survivor row's id.
*   **`created_at`** of migrated rows comes from legacy dates: a person's from its survivor admission's `admitted_on`, an admission's from its `admitted_on`, a registration's from its `join_date`, each as `(d::timestamp at time zone 'Asia/Kolkata')`.
*   **Registration `centre_id`** is its admission's centre (required by the composite foreign key); `end_date` is null; `status` comes from the status map.

### Canonical form

Used for `source_row_hash`, `input_hash` and the run digest, so they are identical on any machine.

*   **A row** is JSON with keys sorted by code point, no whitespace, `null` for null, dates as `YYYY-MM-DD`, timestamps as ISO 8601 UTC, bigints as decimal strings.
*   **`input_hash`:** sha256 over the three raw tables in the order `legacy_centre`, `legacy_admission`, `legacy_course_row`, each as `"<table>\n"` followed by its rows (ordered by `source_key collate "C"`), one canonical row per line.
*   **Run digest:** sha256 over these sections in order, each `"<name>\n"` then one canonical row per line:
    1.  `key_map`: every column except `id` and `run_id`, ordered by (entity, source_table, source_key, target_table, target_id);
    2.  `exception`: every column except `id` and `run_id`, ordered by (entity, source_table, source_key, field);
    3.  `app.person`, `app.admission`, `app.registration`: every column, ordered by `id` (`created_at` is derived from legacy dates, so it is included; `match_key` is included).

    Output: lowercase hex.

### Exceptions without PII

*   **`value_fingerprint`** = first 16 lowercase hex characters of HMAC-SHA256 with key = UTF-8 of `${input_hash}:${ETL_SALT}` and message = UTF-8 of the raw value; null when the raw value is null. `ETL_SALT` is an environment secret, never stored. The same input in the same environment gives the same fingerprints, so the exceptions are part of the digest; with the secret an operator can test a suspected value; without it a 16-hex fingerprint of a mobile number cannot be brute-forced.

### Numbers (G7; NP-8, DD-6, DD-9)

*   Migrated admissions and registrations keep their legacy Admission No and Register No (DD-3).
*   **Preflight** refuses the run if a `REGISTER` row or an `ADMISSION` row for any seed year already exists in `app.global_number_series`.
*   **Parsing (DD-9, assumed until Stage 0 shows the real data):** a Register No is `^\d+$`; an Admission No is `^GTEC(\d{2})(\d{2})(\d+)$`, giving the year `20<a>-<b>` from the prefix and the sequence from the trailing digits (the R-029 format the app issues). Every raw row counts, whatever its disposition, because excluded and rejected rows' numbers are printed. A value that does not parse is not counted and is listed in the artifact under `unparsedNumbers`.
*   **Step 6** inserts `('REGISTER', 'ALL', max)` and one `('ADMISSION', <year>, max)` per seed year, where `max` is the larger of the parsed maximum and `legacyCurrent`, and 0 when neither has a value. Past years are not seeded (person-core DD-7).

### Writing targets (DD-3)

*   **Order and transactions.** Entities are written in the order centre (key map only), person, admission, registration. Each entity is one transaction: its target rows by `insert … select … from json_to_recordset($1)` in batches of 1,000, then its key-map and exception rows the same way.
*   **Failure.** The database applies the person core's rules (the `match_key` trigger, the academic-year check, the composite foreign key, unique numbers). Rules REJECT every case those would refuse, so a constraint error is a rule bug: the entity's transaction rolls back, the runner sets the run FAILED with `finished_at` in a new transaction, writes the finish audit row, and stops. A crash leaves the run RUNNING; the next run starts from a fresh database, and a RUNNING run is never PASSED.
*   **Audit:** two rows, inserted directly by the runner, so `app.audit()`'s session fields do not apply:

    | Column | `migration.run.start` | `migration.run.finish` |
    |---|---|---|
    | `action` | `migration.run.start` | `migration.run.finish` |
    | `outcome` | `OK` | `OK` if PASSED, `FAILED` otherwise |
    | `actor_kind` | `migration:<run_id>` | same |
    | `user_id`, `target_centre_id`, `session_hash`, `request_id`, `client_ip` | null | null |
    | `actor_roles`, `actor_scope` | `{}` | `{}` |
    | `target_type`, `target_id` | `migration.run`, the run id | same |
    | `detail` | `app.redact({ mode, source, input_hash })` | `app.redact({ status, digest, counts })` |

    Per-row provenance is the key map, which keeps millions of rows out of `audit_log`.

### Entities in P8

| Entity | Source | Rule outcomes (reason strings in quotes) |
|---|---|---|
| centre | `raw.legacy_centre` | normalised code = `upper(trim(code))`. IMPORTED (existing): matches an `app.centre.code`. EXCLUDED: in the approved test list `GDEMO`, `KL-01-TEST3`, `KL-01-TEST6` ("test centre"). REJECTED: no match (`code: no such centre`), or the same normalised code as an earlier row (`code: duplicate centre code`) |
| person, admission | `raw.legacy_admission`, one pass (below) | |
| registration | `raw.legacy_course_row` | IMPORTED, linked to the admission target of `admission_key`. REJECTED: that admission not IMPORTED (`admission_key: admission not imported`), duplicate Register No of an earlier usable row (`register_no: duplicate`), a bad field (table above), or an unmapped status (`status: not in the status map`) |

**Admission and person, one pass** (no person without an admission, G2):

1.  Per row: the identity from step 3; the centre: the raw `centre_code`, normalised, must equal the normalised code of an IMPORTED centre key (else `centre_code: centre not imported`, or `centre_code: centre excluded` when that key is EXCLUDED); the academic year; `admitted_on`; the Admission No not used by an earlier usable row (`admission_no: duplicate`). A row is *usable* when all hold.
2.  Group usable rows by match key; a null key is its own group. The survivor is the earliest row of the group.
3.  **person:** the survivor IMPORTED; other usable rows of the group MERGED into it; unusable rows REJECTED with the failing fields.
4.  **admission:** usable rows IMPORTED with `person_id` = the survivor's person id and `centre_id` = the matched centre; unusable rows REJECTED with the same errors.

**Status map** (XL-5), trimmed and case-insensitive: `active` → ACTIVE, `drop` → DROP, `leave` → LEAVE, `transfer` → TRANSFER. Anything else is REJECTED. The map is part of the rule, so changing it changes the code hash.

**SPLIT** (K5) has no case in today's targets under the per-entity reading (DD-7); a unit test with a synthetic split rule covers it.

**Rules in P8** (version 1 each): `centre` (owner `Operations`), `admission` (owner `Admissions/PRO`), `registration` (owner `Certification`).

### The synthetic fixture and its defects (G4)

`etl/fixture.ts` fills the raw tables from `fixtureSeed` with a mulberry32 generator: about 2,000 admissions and 3,000 course rows over the three fixture centres. Raw centre rows: `' kl2-25 '` (spaces, lower case), `KL3-07`, `TN1-03`, `GDEMO`, `XX9-99`, and a second `KL3-07`. Generated admission numbers follow `GTEC<yy><yy><seq>` and register numbers continue from 2,000,001. Planted defects and the outcome P8 asserts:

| Defect | Outcome |
|---|---|
| Centre `' kl2-25 '` | centre IMPORTED (existing centre A) |
| Second `KL3-07` row | REJECTED, `code: duplicate centre code` |
| `GDEMO` with admissions and course rows | centre EXCLUDED; its admissions and persons REJECTED (`centre_code: centre excluded`); its course rows REJECTED (`admission_key: admission not imported`) |
| `XX9-99` with admissions | centre REJECTED; its admissions, persons and course rows REJECTED |
| The same learner admitted twice (same dob and mobile, names swapped once) | second person MERGED into the first; both admissions IMPORTED to one person |
| Mobile `+91 98470 12345` and the same learner with `09847012345` | stored as `9847012345`; MERGED |
| Learner with no dob | person IMPORTED, never merged (null match key) |
| Learner whose only admission has `admitted_on` `'45231'` | admission and person REJECTED (`admitted_on: YYYY-MM-DD`); no person row |
| Academic year `2026-2027` | admission and person REJECTED (`academic_year: YYYY-YY, consecutive years`) |
| Two admissions with the same Admission No | the later REJECTED (`admission_no: duplicate`) |
| Course row whose `admission_key` does not exist | REJECTED (`admission_key: admission not imported`) |
| Two course rows with the same Register No | the later REJECTED (`register_no: duplicate`) |
| Course status `Completed` | REJECTED (`status: not in the status map`) |
| The highest Register No and 2026-27 Admission No on `GDEMO` rows | counters seeded above them (G7) |

### Checks and outputs

| Check | Scope keys | `expected` | `actual` | `passed` |
|---|---|---|---|---|
| K1 coverage | entity | raw keys of the entity's source table | distinct source keys in `key_map` for the entity | equal |
| K2 balance | entity, centre, academic_year | raw keys in scope | key-map keys in scope (SPLIT once); `detail` holds the count per disposition | equal, and every SPLIT key's rows share the disposition |
| K3 provenance | target table | rows in the table | rows whose id is a `target_id` of the run | equal |
| K4 merge integrity | entity | MERGED keys | MERGED keys whose survivor is an IMPORTED key of the same entity and run | equal, and every person has ≥ 1 admission |
| K5 split integrity | rule, entity | SPLIT keys | SPLIT keys with `splitCardinality` targets | equal |
| K6 referential | entity | keys whose parent (`parent`) is not IMPORTED | those keys REJECTED with a reason | equal, and every foreign key of the mapped tables has `convalidated` |
| K9 determinism | run | — | — | null; `detail.digest` (the test compares runs) |
| K7, K8, K10, K11 | — | — | — | null; `detail.reason` = `not applicable in Stage 2` |

*   **Scope values:** `centre` is the normalised raw centre code (a registration inherits its admission row's); `academic_year` is the raw value. Centre rows have no year.
*   **A run PASSES** when every check with non-null `passed` is true and, in cutover mode, REJECTED = 0.
*   **Artifacts** in `artifactDir` (P8 passes a temporary directory; the evidence run writes to `evidence/`, which is committed):
    *   `etl-<run_id>.json`: `{ run: { runId, mode, source, inputHash, startedAt, finishedAt, status, digest }, rules: [{ id, version, codeHash, approved }], dispositions: { <entity>: { <disposition>: n } }, checks: [{ check, scope, expected, actual, passed, detail }], seeds: [{ series, period, value }], unparsedNumbers: [{ table, sourceKey, column }] }`;
    *   `etl-<run_id>-exceptions.csv`: header `entity,source_table,source_key,rule_id,field,value_fingerprint,message`, rows ordered as in the digest, RFC 4180 quoting; no raw values.

## Decisions

Taken by the owner on 2026-10-28; each stays PRO until the design is approved. DD-6 and DD-9 stay PMC under NP-8.

1.  **DD-1: Same database, own schemas.** `migration` and `raw` live in the GEMS database, created by the migration owner through a migration-environment setup script; `gems_etl` exists only there.
2.  **DD-2: Rules in TypeScript, one module per source table** (it may produce several entities), registered in `migration.rule` with a version and an approval.
3.  **DD-3: Direct bulk insert as `gems_etl`**, keeping legacy numbers; the database's own constraints still apply.
4.  **DD-4: K7 and K8 wait for Stage 4**, when the fee and ledger tables exist.
5.  **DD-5: No `stage` schema.** Typing and cleaning happen inside each rule. An entity that grows too slow for in-memory rules can be reimplemented as set-based SQL that writes the same key-map rows.
6.  **DD-6: Counter seeds.** `REGISTER` and only the NP-8 years (default the year in progress), from the highest number on any raw row or the legacy counter if larger; an existing series fails the run.
7.  **DD-7: One disposition per source key and entity.** A legacy row that becomes a person and an admission has two IMPORTED (or MERGED) entries, one per entity. This is a deliberate reading of C-03.1, whose example ("an XLS enrolment row → person + course registration + fee plan") it records per entity instead of as one SPLIT; SPLIT stays for one entity producing several rows of the same kind.
8.  **DD-8: No ARCHIVED until D-MIG-1.** The runner refuses it and no `archive` schema exists.
9.  **DD-9: Legacy Admission Nos are assumed to be `GTEC<yy><yy><seq>`** (the R-029 format) until Stage 0 shows the real data; unparsable values are listed, not counted.
10. **DD-10: Rules carry a code hash.** An approval records the hash; a cutover run needs the current hash to equal the approved one, and the same version with different code is refused in every mode.
11. **DD-11: No command-line launcher in Stage 2.** `run()` is called from the tests; a `tsx` launcher comes with the first rehearsal (proposed while resolving Stage 6).

## Open questions

| ID | Owner | What it affects here | Default used now |
|---|---|---|---|
| D-MIG-4 | Owners | Real merge maps (masters, persons with D-STU-5) | Synthetic match-key rule in P8 only |
| D-STU-5 | Admissions/PRO | Person merge in real data | Not run on real data |
| D-MIG-7, D-MIG-8 | IT, Accounts, MIS | Which source, XLS mode | No real source |
| D-MIG-1 | IT/Accounts | History depth, what is ARCHIVED | ARCHIVED refused (DD-8) |
| D-SEC-4/5 | IT + Legal | PII in `raw` and artifacts; whether `raw` is kept after go-live | Synthetic data only; fingerprints in exceptions |
| NP-8 | Accounts + Certification | Which years are seeded, and the seed values | DD-6 |
| D-TZ-1 | IT | Legacy dates and times | Dates only in P8 |

## Alternatives Considered

### Alternative A: A separate ETL database

*   **Pros**: Stronger isolation; the target database never sees raw or migration schemas.
*   **Cons**: Two databases to provision and reconcile; target ids and constraints are checked across a connection; the key map lives away from the rows it describes.
*   **Reason for Rejection**: Schemas owned by the migration owner, plus a role that exists only in migration environments, give the same separation with one database (DD-1).

### Alternative B: Rules as SQL (`insert … select` from stage tables)

*   **Pros**: Set-based and fast for millions of rows.
*   **Cons**: Per-row dispositions and exceptions become `case` expressions across many statements; unit testing needs a database; the person core's TypeScript validation would be duplicated in SQL.
*   **Reason for Rejection**: P8 and the first module stages are small; correctness and one validation path come first (DD-2). A slow entity can be reimplemented in SQL later (DD-5).

### Alternative C: Load through `admit()`

*   **Pros**: Reuses the app's validation and audit.
*   **Cons**: Allocates new numbers, losing legacy Admission and Register Nos; one transaction and audit row per record; needs a session and permissions for every centre.
*   **Reason for Rejection**: Legacy numbers are printed on forms and certificates and must survive (DD-3). The rules reuse `admit()`'s validation instead.

### Alternative D: Random ids plus a lookup table

*   **Pros**: No id scheme to define.
*   **Cons**: Every rerun gives different ids, so rehearsals do not predict the final run.
*   **Reason for Rejection**: Determinism is a goal (G3).

### Alternative E: An audit row per migrated record

*   **Pros**: The audit log alone tells where each row came from.
*   **Cons**: Millions of audit rows that duplicate the key map, in an append-only table that cannot be pruned.
*   **Reason for Rejection**: The key map is the per-record provenance; the audit log records the run.

### Alternative F: A synthetic voucher table now for K7/K8

*   **Pros**: Proves "never auto-balance" in Stage 2.
*   **Cons**: A throwaway target that the Stage 4 ledger replaces; the check would be rewritten anyway.
*   **Reason for Rejection**: The owner deferred K7/K8 to Stage 4 (DD-4).

### Alternative G: One disposition per source key, with SPLIT for multi-entity rows

*   **Pros**: Follows C-03.1's example literally.
*   **Cons**: A legacy admission row is then SPLIT into person and admission, but its person part may be a merge, which a single disposition cannot express without a second, per-target outcome.
*   **Reason for Rejection**: Per-entity dispositions record each outcome directly (DD-7).

### Alternative H: Seed every legacy year from the highest migrated number

*   **Pros**: Every year's counter exists after migration.
*   **Cons**: Reopens past years for new admissions (against person-core DD-7), and can reissue numbers printed on excluded or rejected rows.
*   **Reason for Rejection**: DD-6.

## Risks and limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| `gems_etl` left in production | A role that bypasses RLS on live data | Created only by `scripts/etl/setup.sql`; owns nothing, so the go-live checklist can drop it; the T-RLS-015 query lists BYPASSRLS roles afterwards | `tests/etl.test.ts`: no Prisma migration mentions it; it owns no objects |
| The synthetic schema differs from the real legacy one | Rules rewritten at Stage 0 | **Accepted:** the framework does not depend on the source shape; only `etl/rules/` and the loader do | n/a |
| A constraint error mid-entity | Run FAILED | Rules REJECT every case the constraints refuse; the failed entity's transaction rolls back; rerun from a fresh database | P8 |
| Raw tables hold PII in rehearsals | Exposure beyond the app's controls | Synthetic data only in Stage 2; retention and access of `raw` are D-SEC-4/5 before any real run | n/a |
| In-memory rules on 1.2M rows | Slow or out of memory | Batches of 1,000 rows per write; an entity can move to SQL (DD-5) | timed at the first rehearsal |
| Merge by match key on real data | Different people with equal name, dob and mobile merged | **Accepted for P8 only:** real merges need D-MIG-4/D-STU-5 maps | T-MIG-004 |
| A legacy number issued after extraction | Reissued by the app | Freeze before the final run (audit 08 §7); `--legacy-current` from the frozen counter; NP-8 sign-off | G7 |
| The validation in `people.ts` changes | Migrated and app data validated differently | One shared function; a change shows in both suites | `tests/people.test.ts`, `tests/etl.test.ts` |

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

#### 1. `docs/audit/09-…md`, matrix (Modify)

*   T-MIG-001…006 and 009 gain "Stage 2: P8 on synthetic data"; T-MIG-007/008 "Stage 4 (DD-4)"; T-MIG-010/011 "needs legacy data".
*   T-RLS-015 notes the setup-script confinement, the go-live drop and the check query.

#### 2. `scripts/etl/setup.sql` and `scripts/etl/setup.mjs` (Create)

*   `setup.sql`: the DDL of [Data model](#data-model-scriptsetlsetupsql-verbatim-in-substance) and the grants of [Where it runs](#where-it-runs-dd-1); `gems_etl` created only if missing.
*   `setup.mjs`: connects with `pg` to `MIGRATE_URL`, runs `setup.sql`, then sets the password from `ETL_DB_PASSWORD` (`select format(…, $1)`, executed by the client).

#### 3. `scripts/ci.sh`, `.github/workflows/ci.yml`, `.env.local` (Modify)

*   `ci.sh`: `node scripts/etl/setup.mjs` right after the first `npx prisma migrate deploy` (line 34; the "Fresh database" step), since the CI database is a migration environment; `ETL_DATABASE_URL`, `ETL_DB_PASSWORD` and `ETL_SALT` join the required-variable loop.
*   `ci.yml`: the three variables with throwaway values (`ETL_DATABASE_URL` points at the Docker database directly, not PgBouncer, port 54320).
*   `.env.local`: the same local values.

#### 4. `src/server/people.ts` (Modify)

*   Export `identity()`, `isoDate()` and the `StoredIdentity` type; no behaviour change.

#### 5. `etl/ids.ts`, `etl/types.ts`, `etl/canonical.ts` (Create)

*   `uuidv5(name)` under the fixed namespace; the types of [Rules](#rules-dd-2); canonical JSON, `input_hash`, the digest and the fingerprint.

#### 6. `etl/rules/centre.ts`, `admission.ts`, `registration.ts` (Create)

*   The three rules of [Entities in P8](#entities-in-p8), each version 1 with its owner.

#### 7. `etl/run.ts`, `etl/checks.ts`, `etl/fixture.ts` (Create)

*   `run()` steps 0–8, connecting with `ETL_DATABASE_URL`; `RunRefused`; the checks table; the fixture (mulberry32, the centre rows and the defects table).

#### 8. Tests (Create/Modify)

*   `tests/etl.test.ts`, with a helper that truncates `raw.legacy_*`, `migration.key_map`, `migration.exception`, `migration.reconciliation` and `migration.run` as the admin, then calls `reset()` and deletes the fixture counter seeds (`migration.rule` rows and approvals are kept between runs):
    *   unit: `uuidv5` against the RFC 9562 example; canonical JSON; each rule on hand-written rows; a synthetic SPLIT rule through the runner (K5); an undeclared disposition and an ARCHIVED result fail the run; declaring ARCHIVED fails registration;
    *   P8: approve the three rules, run twice (resetting in between), assert G1–G5 and G7 and every row of the defects table; equal digests; after the run `admit()` issues the next Register No and 2026-27 Admission No;
    *   refusals: cutover with one unapproved rule throws `RunRefused` and writes no run row; the same version with a changed code hash is refused in dry mode; an existing counter is refused;
    *   G6: no file under `prisma/migrations` mentions `gems_etl`; it owns no objects; it cannot update `migration.rule.approved_by`;
    *   audit: the two rows with the column values above.
*   `tests/audit-catalogue.ts` gains `migration.run.start` and `migration.run.finish`; `tests/audit.test.ts` T-AUD-009 scans the whole of `etl/run.ts` with `/"(migration\.run\.[a-z]+)"/g`, as it scans `auth/index.ts`.

#### 9. `docs/STATUS.md`, evidence log (Modify)

*   One evidence run into `evidence/` (committed), CI counts and the mutation checks.

### Verification Plan

*   **CI:** `bash scripts/ci.sh` (adds the ETL setup), `npx vitest run` including `tests/etl.test.ts`.
*   **Mutation checks**, recorded in the evidence log:

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | One disposition per key | Drop the unique index | T-MIG-002 |
    | Determinism | Use `randomUUID()` in `etl/ids.ts` | T-MIG-009 |
    | No silent drop | Skip writing the key map for REJECTED keys | T-MIG-001 |
    | Provenance | Insert one unmapped person before the checks | T-MIG-003 |
    | Merge integrity | Point a MERGED key at a MERGED survivor | T-MIG-004 |
    | No unreachable person | Import the person of an unusable row | T-MIG-004 |
    | Cutover approval | Skip the approval check | G5 test |

*Drafted with EGM*
