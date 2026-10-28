# Migration framework: ETL foundation and P8 (Stage 2)

*   **Author:** gtm
*   **Status:** Proposed. The owner accepted every section on 2026-10-28; build approval follows EGM review Stages 5–9. Reviews so far: [`zoom_out_report.md`](zoom_out_report.md) (Stage 5).
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
| Rule | A versioned mapping for one entity, with an owner and an approval | C-03.2 |
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
 node etl/run.ts --source fixture --mode dry|cutover --seed-years 2026-27
   │  1. start run         migration.run row; audit migration.run.start
   │  2. load raw          source → raw.* (verbatim, every column text)
   │  3. prepare           match keys for every raw admission row, in one query (app.person_match_key)
   │  4. apply rules       centre → admission/person (one pass) → registration
   │                       each rule: (raw row, ctx) → disposition + target rows; deterministic ids
   │  5. write             person → admission → registration, plus key_map / exception rows,
   │                       one transaction per entity
   │  6. seed counters     REGISTER and the --seed-years from the highest number on any raw row
   │  7. check             K1–K6 → migration.reconciliation; run digest (K9)
   │  8. finish run        status, artifacts (JSON + exceptions CSV); audit migration.run.finish
   ▼
 Postgres, same database (DD-1)
   raw.*         verbatim source rows          migration.*   run, rule, key_map, exception, reconciliation
   app.*         target tables (person core today)
```

### Where it runs (DD-1)

*   **Schemas** `migration` and `raw` in the GEMS database. There is no `stage` schema: typing and cleaning happen inside each rule (DD-5), and no `archive` schema until ARCHIVED is decided (DD-8).
*   **Created by a setup script, not a Prisma migration.** `scripts/etl/setup.sql` runs as the **migration owner**, once, on a fresh database, in a migration environment. It creates both schemas and their tables (owned by the migration owner, as 0002 requires: runtime roles never own objects), and the `gems_etl` role. The new production database runs it **before** go-live only; the go-live checklist then revokes `gems_etl`'s privileges and drops the role. The schemas and the key map stay as cutover evidence; whether `raw` is kept is D-SEC-5. The Prisma datasource lists only `app`, so the drift gate is unaffected.
*   **`gems_etl`:** `login bypassrls nosuperuser nocreatedb nocreaterole noinherit`, owning nothing.
    *   `usage` on `raw`, `migration` and `app`;
    *   `select, insert` on every `raw` and `migration` table, `update` on `migration.run` and `migration.rule` (status and registration);
    *   `select` on `app.centre`; `select, insert` on `app.person`, `app.admission`, `app.registration`;
    *   `select, insert, update` on `app.global_number_series` (the counter seed);
    *   `insert` on `app.audit_log` and `usage` on `app.audit_log_id_seq`.

    No other update and no delete on `app.*`: a run starts from a fresh database, so it never changes an existing target row.
*   **T-RLS-015 check:** the query already in `poc/test/rls.test.js` (roles with `rolbypassrls or rolsuper`, except the platform's) is reused as the go-live check, run after `gems_etl` is dropped.

### Data model (`scripts/etl/setup.sql`)

| Table | Columns | Notes |
|---|---|---|
| `migration.run` | run_id (uuid), mode (`dry`/`cutover`), source, input_hash, salt, started_at, finished_at, status (`RUNNING`/`PASSED`/`FAILED`), digest | One row per run |
| `migration.rule` | rule_id (text), version (int), entity, description, dispositions (text[]), owner, approved_by, approved_at; primary key (rule_id, version) | Registered from code at run start; approval is set by a person, never by code |
| `migration.key_map` | run_id, entity, source_system, source_table, source_key, source_row_hash, disposition, rule_id, rule_version, target_table, target_id, survivor_target_id, reason, approved_by, approved_at | One row per (source key, entity, target) |
| `migration.exception` | run_id, entity, source_system, source_table, source_key, rule_id, field, value_fingerprint, message | No raw values |
| `migration.reconciliation` | run_id, check (`K1`…`K11`), scope (jsonb), expected, actual, passed (nullable), detail (jsonb) | One row per check and scope |

*   **One disposition per key and entity** (DD-7). A unique index on `key_map (run_id, entity, source_system, source_table, source_key)` where `disposition <> 'SPLIT'`; for SPLIT, K2 checks that all rows of a key share the disposition.
*   **`approved_by` / `approved_at` on `key_map`** stay null in Stage 2. They are reserved for per-record approvals (D-MIG-4 merge maps); a rule's approval is read through `rule_id` and `rule_version`.
*   **Fingerprint:** `hmac-sha256(salt, value)`, first 16 hex characters, where `salt = sha256(input_hash ‖ environment secret ETL_SALT)`. The same input in the same environment gives the same fingerprints, so the exception CSV is part of the run digest; an operator with the secret can test a suspected value, while the table on its own holds no PII.

### Rules (DD-2)

*   A rule is a TypeScript module in `etl/rules/`, exporting `{ id, version, entity, dispositions, map(rows, ctx) }`. `map` takes the entity's raw rows (ordered by source key) and returns, for each row, one result:
    *   `{ disposition: "IMPORTED", target: { table, row } }`;
    *   `{ disposition: "MERGED", survivorKey }`;
    *   `{ disposition: "SPLIT", targets: [...] }`;
    *   `{ disposition: "EXCLUDED", reason }`;
    *   `{ disposition: "REJECTED", errors: [{ field, value, message }] }`.
*   **No I/O in rules.** `ctx` holds everything a rule reads: earlier entities' results (to resolve a centre or a survivor), the match keys the runner computed in step 3, and the id function. So `app.person_match_key` is never reimplemented in TypeScript, and rules are unit-tested with plain objects.
*   **One validation path.** The person and admission rules validate with the person core's own functions, `identity()` (exported from `src/server/people.ts` for this) and `academicYearOk()`. A `PersonError` becomes a REJECTED error naming the field. The ETL therefore normalises mobiles (`+91 98…` → 10 digits) exactly as `admit()` does, so migrated learners match later admissions.
*   **Registration and approval:** at run start the runner upserts each rule's (id, version, entity, description, dispositions). Approval is one statement run by the approver, recorded in the evidence log:

    ```sql
    update migration.rule set approved_by = '<name>', approved_at = now() where rule_id = '<id>' and version = <v>;
    ```

    A changed rule must get a new version, so an approval never carries over to new logic. Tests set approvals directly.
*   **Dry and cutover mode.** A dry run runs every rule and lists the unapproved ones in its artifact. A cutover run refuses to start if any rule it would run lacks an approval for its current version (G5); this includes every rule that can return EXCLUDED, since C-03.1 requires an approver for each exclusion.
*   **ARCHIVED** returned by any rule fails the run until DD-8 is revisited.

### Deterministic ids and order (G3)

*   **Ids:** UUIDv5 under a fixed namespace (a constant in `etl/ids.ts`), name `${source_system}/${source_table}/${source_key}/${target_table}[/${n}]`, implemented with `node:crypto` SHA-1 (RFC 9562 §5.5); no dependency.
*   **Order:** every rule reads its rows ordered by source key, so survivors (the lowest key of a duplicate group) and exception order are stable.
*   **`created_at`** of migrated rows is set from `admitted_on` / `join_date` (midnight Asia/Kolkata), not the load time, so the person core's ordering by `created_at` follows legacy order and the target rows are part of the digest.
*   **Run digest (K9):** at finish, sha256 over the sorted key map, exceptions and target rows of the mapped tables, each without run id and load timestamps. It is stored in `migration.run` and the JSON artifact. K9 compares two artifacts' digests, so it works across separate databases.

### Numbers (G7; NP-8, DD-6)

*   Migrated admissions and registrations keep their legacy Admission No and Register No (DD-3).
*   After the load the runner creates the counters: `REGISTER` (period `ALL`) and one `ADMISSION` row per year in `--seed-years` (NP-8; default: the year in progress, `2026-27`). Past years are **not** seeded, so person-core DD-7 holds: a year before the earliest seeded one can never open by itself.
*   **Seed value:** the highest number on **any** raw row of that series, whatever its disposition, because excluded and rejected rows' numbers are printed but not migrated. An optional `--legacy-current REGISTER=…,ADMISSION:2026-27=…` input wins when larger (the legacy counter read at freeze).
*   **A series that already exists fails the run**: a counter is never silently kept or overwritten. P8 removes the fixture seeds of `tests/fixtures.ts` before running.

### Writing targets (DD-3)

*   Bulk `insert … select from json_to_recordset($1)` per entity in batches of 1,000, one transaction per entity, as `gems_etl`.
*   The database still applies the person core's rules: the `match_key` trigger, the academic-year check, the composite foreign key, unique Admission and Register Nos. Rules REJECT every case those constraints would refuse, so a constraint error during a write is a rule bug: the entity's transaction rolls back and the run is FAILED.
*   **Audit:** two rows per run, `migration.run.start` and `migration.run.finish`, inserted directly into `app.audit_log` with `actor_kind = 'migration:<run_id>'` and the run summary as detail. Per-row provenance is the key map, which keeps millions of rows out of `audit_log`.

### Entities in P8

The synthetic source imitates two legacy MySQL tables (INF: the real schema is unknown until Stage 0). `etl/fixture.ts` creates and fills `raw.legacy_centre`, `raw.legacy_admission` and `raw.legacy_course_row`, every column text.

| Entity | Source | Rule outcomes |
|---|---|---|
| centre | `raw.legacy_centre` (code, name, status) | IMPORTED: the trimmed, upper-cased code matches an existing `app.centre.code` (no row is written; the key map points at the existing id). EXCLUDED: the approved test-centre list (GDEMO, KL-01-TEST3, KL-01-TEST6). REJECTED: no matching centre |
| admission and person | `raw.legacy_admission` (id, centre code, admission no, academic year, admitted on, first name, last name, dob, mobile), decided **together** in one pass | see below |
| registration | `raw.legacy_course_row` (id, admission id, course code, register no, join date, status) | IMPORTED, linked to its admission. REJECTED: orphan (admission not IMPORTED), duplicate Register No (the later key), malformed date, or a status outside the approved map |

**Admission and person, one pass** (no person without an admission, G2):

1.  Per row: validate the identity (`identity()`), the centre (must be IMPORTED), the academic year (`academicYearOk`), `admitted_on`, and that the Admission No is not taken by an earlier row. A row is *usable* when all hold.
2.  Group usable rows by match key (a null key is its own group). The survivor is the lowest source key in the group.
3.  **person:** the survivor IMPORTED; other usable rows MERGED into it; unusable rows REJECTED with the failing field.
4.  **admission:** usable rows IMPORTED, with `person_id` = the survivor's person id; unusable rows REJECTED with the same reason.

A person is therefore written only when at least one of its admissions is.

**Status map** (XL-5): legacy course status values map to `ACTIVE`, `DROP`, `LEAVE`, `TRANSFER` through a table in the registration rule; an unmapped value is REJECTED. The map is part of the rule, so a change needs a new rule version and approval.

**SPLIT** (K5) has no case in today's targets under the per-entity reading (DD-7). The runner supports it, and a unit test with a synthetic split rule covers K5.

### The synthetic fixture and its defects (G4)

`etl/fixture.ts` generates the raw rows from a fixed seed: about 2,000 admissions and 3,000 course rows over the three fixture centres, plus these planted defects, each with the outcome P8 asserts:

| Defect | Outcome |
|---|---|
| Centre code with spaces and lower case (`' kl2-25 '`) | centre IMPORTED to centre A |
| Test centre `GDEMO` with admissions | centre EXCLUDED; its admissions, persons and course rows REJECTED ("centre excluded") |
| Unknown centre code | centre REJECTED; its admissions and persons REJECTED |
| The same learner admitted twice (same name, dob, mobile; names swapped once) | second person MERGED into the first; both admissions IMPORTED to the one person |
| Mobile written `+91 98470 12345` | stored as `9847012345`; merges with the same learner written `09847012345` |
| Learner with no dob | person IMPORTED, never merged (null match key) |
| Learner whose only admission has a date in a text column (`'45231'`) | admission and person REJECTED, exception on `admitted_on`; no person row |
| Academic year `2026-2027` | admission and person REJECTED, exception on `academic_year` |
| Two admissions with the same Admission No | the later one REJECTED |
| Course row whose admission does not exist | REJECTED (orphan) |
| Two course rows with the same Register No | the later one REJECTED |
| Course status `Completed` (not in the map) | REJECTED, exception on `status` |
| Highest Register No and 2026-27 Admission No on a GDEMO row | counters seeded above them (G7) |

### Checks and outputs

Scopes follow C-03.3: per entity, centre and academic year where the source row has them.

*   **K1** every raw key of every entity appears in `key_map`.
*   **K2** per scope: source count = sum of dispositions (a SPLIT key counted once), and all rows of a SPLIT key share it.
*   **K3** every row in `app.person`, `app.admission` and `app.registration` has a key-map row (the database was fresh, so any other row is unexplained).
*   **K4** each MERGED key's survivor is an IMPORTED key of the same entity in the same run (no chains); every migrated person has at least one migrated admission.
*   **K5** each SPLIT key has the target count its rule declares.
*   **K6** every source orphan (a key whose parent is not IMPORTED) is REJECTED with a reason, and every foreign key on the mapped tables is validated (`pg_constraint.convalidated`). The database itself refuses target orphans.
*   **K9** the run digest; equal across the two P8 runs.
*   K7, K8, K10, K11 are written with `passed = null`, `detail.reason = "not applicable in Stage 2"`.
*   **Artifacts:** `evidence/etl-<run_id>.json` (run, rules and their approval state, disposition counts per scope, check results, digest) and `evidence/etl-<run_id>-exceptions.csv` (keys, fields, fingerprints, messages; no raw values).
*   **A run PASSES** when every applicable check passes and, in cutover mode, REJECTED = 0.

## Decisions

Taken by the owner on 2026-10-28; each stays PRO until the design is approved. DD-6 stays PMC under NP-8.

1.  **DD-1: Same database, own schemas.** `migration` and `raw` live in the GEMS database, created by the migration owner through a migration-environment setup script; `gems_etl` exists only there.
2.  **DD-2: Rules in TypeScript, one module per entity**, registered in `migration.rule` with a version and an approval.
3.  **DD-3: Direct bulk insert as `gems_etl`**, keeping legacy numbers; the database's own constraints still apply.
4.  **DD-4: K7 and K8 wait for Stage 4**, when the fee and ledger tables exist.
5.  **DD-5: No `stage` schema.** Typing and cleaning happen inside each rule. An entity that grows too slow for in-memory rules can be reimplemented as set-based SQL that writes the same key-map rows.
6.  **DD-6: Counter seeds.** `REGISTER` and only the NP-8 years (default the year in progress), from the highest number on any raw row or the legacy counter if larger; an existing series fails the run.
7.  **DD-7: One disposition per source key and entity.** A legacy row that becomes a person and an admission has two IMPORTED (or MERGED) entries, one per entity. This is a deliberate reading of C-03.1, whose example ("an XLS enrolment row → person + course registration + fee plan") it records per entity instead of as one SPLIT; SPLIT stays for one entity producing several rows of the same kind.
8.  **DD-8: No ARCHIVED until D-MIG-1.** The runner refuses it and no `archive` schema exists.

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
*   T-RLS-015 notes the setup-script confinement and the go-live drop.

#### 2. `scripts/etl/setup.sql` and `scripts/etl/setup.mjs` (Create)

*   `setup.sql`: plain `create schema raw`, `create schema migration`, the five tables and the unique index; `gems_etl` created if missing, with the grants above. It runs once on a fresh database.
*   `setup.mjs`: runs `setup.sql` with `pg` as the migration owner (`MIGRATE_URL`), as `scripts/bootstrap-admin.mjs` does; sets the role password from `ETL_DB_PASSWORD` with `format('%L')`, never from the file.

#### 3. `scripts/ci.sh`, `.env.local` (Modify)

*   `ci.sh`: after `npx prisma migrate deploy`, `node scripts/etl/setup.mjs` (the CI database is a migration environment); `ETL_DATABASE_URL`, `ETL_DB_PASSWORD`, `ETL_SALT` join the required-variable loop.
*   `.env.local`: local values for the three variables.

#### 4. `src/server/people.ts` (Modify)

*   Export `identity()` and the `StoredIdentity` type; no behaviour change.

#### 5. `etl/ids.ts`, `etl/types.ts` (Create)

*   `uuidv5(name)` under the fixed namespace; the rule, result and context types.

#### 6. `etl/rules/centre.ts`, `admission.ts` (person and admission), `registration.ts` (Create)

*   The rules of the entity table, each with `id`, `version: 1`, `entity`, `dispositions`, `map`.

#### 7. `etl/run.ts`, `etl/checks.ts`, `etl/fixture.ts` (Create)

*   The runner steps 1–8 (connects with `ETL_DATABASE_URL`); checks K1–K6, the digest and the not-applicable rows; the seeded fixture, which creates and fills the `raw.legacy_*` tables.

#### 8. Tests (Create/Modify)

*   `tests/etl.test.ts`:
    *   unit: `uuidv5` against the RFC 9562 test vector; each rule on hand-written rows; a synthetic SPLIT rule through the runner (K5); an ARCHIVED result fails the run;
    *   P8: reset, delete the fixture counter seeds, run twice from scratch (resetting in between), assert G1–G5 and G7 and each defect's outcome; equal digests; `admit()` after the run issues the next numbers; a cutover-mode run with one unapproved rule fails before writing; an unapproved rule is listed in a dry run's artifact;
    *   G6: no file under `prisma/migrations` mentions `gems_etl`, and it owns no objects;
    *   audit: `migration.run.start` and `migration.run.finish` rows with `actor_kind` `migration:<run_id>`.
*   `tests/audit-catalogue.ts` gains both actions; `tests/audit.test.ts` T-AUD-009 scans `etl/run.ts` with `/"(migration\.[a-z0-9_.]+)"/`.

#### 9. `docs/STATUS.md`, evidence log (Modify)

*   Evidence entry with the two run artifacts, CI counts and the mutation checks.

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
