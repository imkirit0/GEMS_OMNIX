# Migration framework: ETL foundation and P8 (Stage 2)

*   **Author:** gtm
*   **Status:** Draft, for the owner's section-by-section review. Owner decisions taken before drafting (2026-10-28): DD-1 location, DD-2 rules in TypeScript, DD-3 direct bulk insert, DD-4 K7/K8 deferred to Stage 4.
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
| Disposition | The recorded outcome of one source key: IMPORTED, MERGED, SPLIT, ARCHIVED, EXCLUDED or REJECTED | C-03.1, audit 08 §4 |
| Key map | `migration.key_map`: one row per (source key, target row) pair of a run | C-03.2 |
| Rule | A versioned mapping for one entity, with an owner and an approval | C-03.2 |
| Exception | A rejected or flagged value, stored as a fingerprint, not the raw value | C-03.2 |
| K1…K11 | The reconciliation checks; T-MIG-001…011 test them | C-03.3, audit 09 §T-MIG |
| Run | One execution of the ETL, identified by a run id; *dry* (any rules) or *cutover* (approved rules only) | this design |
| Migration environment | A database where migration runs: local Docker, CI, a rehearsal copy, and the new production database before go-live | audit 08 §6 |
| `gems_etl` | The database role the ETL runs as; it bypasses RLS and exists only in a migration environment | T-RLS-015 |
| RLS | Postgres row-level security | migration 0002 |
| P8 | Proof of concept: repeatable dry run with reconciliation output | `docs/audit/11-proof-of-concept-specification.md`; v1 audit §A.8 |
| Person core | `person`, `admission`, `registration` (migration 0011) | `docs/designs/person-core/person-core.md` |
| `app.person_match_key` | The database function that derives the duplicate-check key from name, date of birth and mobile | migration 0011 |
| R-xxx, D-xxx, NP-n | Requirements and open business decisions | `docs/audit/02-…csv`, `docs/audit/04-manager-decision-register.md` |
| DD-n | Design decisions of this document | [Decisions](#decisions) |

## The Problem

1.  **Counting is not reconciling.** The original plan checked "record counts per entity" (v0 §7.4). Counts balance even when one record is lost and another duplicated (v1.1 L-23). The audit replaced counts with per-key dispositions and eleven checks.
2.  **The legacy data is known to be dirty** (audit 08 §2, DQR): whitespace and malformed centre codes, test centres, duplicate persons with no shared identifier (XL-1), dates in text columns (XL-4), enum drift per year (XL-5). Each defect needs a recorded outcome, not a silent fix.
3.  **Reruns must be identical.** Migration is rehearsed at least twice before cutover (audit 08 §7). If ids or outcomes change between runs, a rehearsal proves nothing about the final run (K9).
4.  **The ETL needs powers the app must never have.** Loading every centre's rows needs to bypass RLS. That role must not exist in production (T-RLS-015).
5.  **No source access yet.** The framework must be built and proven before the legacy schema is known, so it cannot hard-code that schema.

## Goals

Each goal is met when its tests pass in `bash scripts/ci.sh`.

*   **G1: Every source key has exactly one disposition.** The key map is complete and the database refuses a second disposition for the same key and entity in a run (T-MIG-001 K1, T-MIG-002 K2).
*   **G2: Nothing reaches a target without provenance.** Every row the ETL writes has a key-map row; merges have one existing survivor and no chains; target foreign keys hold (T-MIG-003 K3, T-MIG-004 K4, T-MIG-006 K6).
*   **G3: Reruns are identical.** Two runs from scratch on the same input give the same key map (ignoring the run id) and the same target rows (T-MIG-009 K9).
*   **G4: Planted defects surface.** Each defect in the synthetic fixture ends as the disposition its rule names (EXCLUDED, MERGED, REJECTED), with an exception for each REJECTED key (P8).
*   **G5: Cutover mode refuses unapproved rules** (P8, a cutover-mode run with one unapproved rule fails before writing).
*   **G6: The ETL role is confined.** `gems_etl` is created only by the migration-environment setup script, never by a Prisma migration (T-RLS-015, checked as far as Stage 2 can).

## Non-Goals

*   **Real legacy data.** No MySQL access (Stage 0); the XLS needs separate approval (v1 audit §A.8) and its import mode is D-MIG-8.
*   **K7 and K8** (money control totals, ledger). There are no fee or ledger tables until Stage 4 (G-FIN); both checks are built then (DD-4). P8 records them as not applicable.
*   **K10 and K11** (report parity, sampled field fidelity). They need legacy reports and real rows.
*   **Mappings for later stages:** centres beyond matching codes, catalogue, fees, exams, certificates, tickets. Each module stage adds its own.
*   **A person-merge tool** (D-STU-5). P8 merges duplicates only by a synthetic rule on the match key; real merge maps are D-MIG-4.
*   **Files** (`/uploads/`). Moved with their references in a later stage.
*   **Cutover runbook, freeze and rollback** (audit 08 §7). Written before the first rehearsal.

## Technical Plan (Architecture)

### Components

```text
 node etl/run.ts --source fixture|<later> --mode dry|cutover
   │  1. start run         migration.run row; audit migration.run.start
   │  2. load raw          source → raw.* (verbatim, typed as text)
   │  3. apply rules       per entity, in dependency order: centre → person → admission → registration
   │                       each rule: (raw row) → disposition + target rows, deterministic ids
   │  4. write             target rows (app.*) and key_map / exception rows, one transaction per entity
   │  5. check             K1–K6, K9 → migration.reconciliation
   │  6. finish run        status, artifacts (JSON + exceptions CSV); audit migration.run.finish
   ▼
 Postgres, same database (DD-1)
   raw.*         verbatim source rows            migration.*   run, rule, key_map, exception, reconciliation
   archive.*     ARCHIVED payloads (later)       app.*         target tables (person core today)
```

### Where it runs (DD-1)

*   **Schemas** `migration`, `raw` and `archive` in the GEMS database. There is no separate `stage` schema: typing and cleaning happen inside each TypeScript rule, which keeps one place per entity (DD-5).
*   **Created by a setup script, not a Prisma migration.** `scripts/etl/setup.sql` creates the schemas, tables and the `gems_etl` role. It runs only in a migration environment. Production never runs it, and the go-live checklist drops `gems_etl` after the final run (G6). The Prisma datasource lists only `app`, so the drift gate is unaffected.
*   **`gems_etl`:** `login bypassrls nosuperuser nocreatedb nocreaterole noinherit`; owns `raw`, `migration`, `archive`; `insert, select` on the target tables of mapped entities; `insert` on `app.audit_log`; `select, insert, update` on `app.global_number_series` (the counter seed); `usage` on schema `app`. No other update and no delete on `app.*`: a run starts from a fresh database (audit 08 §6), so it never needs to change an existing target row.

### Data model (`scripts/etl/setup.sql`)

| Table | Columns | Notes |
|---|---|---|
| `migration.run` | run_id (uuid), mode (`dry`/`cutover`), source, started_at, finished_at, status (`RUNNING`/`PASSED`/`FAILED`), input_hash | One row per run |
| `migration.rule` | rule_id (text), version (int), entity, description, dispositions (text[]), owner, approved_by, approved_at; primary key (rule_id, version) | Registered from code at run start; approval is set by the owner, never by code |
| `migration.key_map` | run_id, entity, source_system, source_table, source_key, source_row_hash, disposition, rule_id, rule_version, target_table, target_id, survivor_target_id, reason, approved_by, approved_at | One row per (source key, target) pair |
| `migration.exception` | run_id, entity, source_system, source_table, source_key, rule_id, field, value_fingerprint, message | No raw values |
| `migration.reconciliation` | run_id, check (`K1`…`K11`), scope (jsonb), expected, actual, passed, detail (jsonb) | One row per check and scope |

*   **One disposition per key and entity.** A partial unique index on `key_map (run_id, entity, source_system, source_table, source_key)` covers every disposition except SPLIT, which writes one row per target; for SPLIT a check that all rows of a key share the disposition (K2) completes it. "Entity" is part of the key because one legacy row can feed two entities (a legacy admission row is both a person and an admission).
*   **Fingerprint:** `hmac-sha256(run salt, value)`, first 16 hex characters. The salt is in `migration.run`, so an operator with database access can test a suspected value, while the exception table on its own holds no PII.

### Rules (DD-2)

*   A rule is a TypeScript module in `etl/rules/`, exporting `{ id, version, entity, dispositions, map(row, ctx) }`. `map` returns one of:
    *   `{ disposition: "IMPORTED", target: { table, row } }`;
    *   `{ disposition: "MERGED", survivorKey }`;
    *   `{ disposition: "SPLIT", targets: [...] }`;
    *   `{ disposition: "EXCLUDED" | "ARCHIVED", reason }`;
    *   `{ disposition: "REJECTED", errors: [{ field, value, message }] }`.
*   `ctx` gives read access to earlier entities' key maps (to resolve a centre code or a survivor) and the id function. Rules do no I/O of their own, so they can be unit-tested with plain objects.
*   **Registration and approval:** at run start the runner upserts each rule's (id, version, entity, description, dispositions). Approval columns are written only by `scripts/etl/approve-rule.mjs`, run by a person, which records who and when. A changed rule must get a new version, so an approval never carries over to new logic.
*   **Cutover mode** refuses to start if any rule it would run lacks an approval for its current version (G5). EXCLUDED and ARCHIVED rules need approval in every mode, as C-03.1 requires an approver for each.

### Deterministic ids and order (G3)

*   **Ids:** UUIDv5 under a fixed namespace (a constant in `etl/ids.ts`), name `${source_system}/${source_table}/${source_key}/${target_table}[/${n}]`. Implemented with `node:crypto` SHA-1 (RFC 9562 §5.5); no dependency.
*   **Order:** each entity reads raw rows ordered by source key, so survivors (the lowest key of a duplicate group) and exception order are stable.
*   **Numbers:** migrated admissions and registrations keep their legacy Admission No and Register No (DD-3). After the load, the runner sets `global_number_series` for `REGISTER` and each `ADMISSION` year to the highest migrated value, the NP-8 cutover seed, unless the series already exists; P8 asserts the new app continues from there.
*   **K9** compares two runs' key maps on everything except run id and timestamps, and the target rows by id.

### Writing targets (DD-3)

*   Bulk `insert … select from json_to_recordset($1)` per entity in batches of 1,000, inside one transaction per entity, as `gems_etl`.
*   The database still applies the person core's rules: the `match_key` trigger, the academic-year check, the composite foreign key, unique Admission and Register Nos. A violation fails the entity's transaction, and the run is FAILED: rules must turn bad data into REJECTED first, so a constraint error is a rule bug.
*   **Audit:** two rows per run, `migration.run.start` and `migration.run.finish`, inserted directly with `actor_kind = 'migration:<run_id>'` and the run summary as detail. Per-row provenance is the key map, not the audit log, which keeps 1.2M rows out of `audit_log`.

### Entities in P8

The synthetic source imitates two legacy MySQL tables (INF: the real schema is unknown until Stage 0). Each row is typed as text in `raw`.

| Entity | Source | Rule outcomes |
|---|---|---|
| centre | `raw.legacy_centre` (code, name, status) | IMPORTED: trimmed, upper-cased code matches an existing `app.centre.code` (no row is written; the key map points at the existing id). EXCLUDED: the approved test-centre list (GDEMO, KL-01-TEST3, KL-01-TEST6). REJECTED: no matching centre |
| person | `raw.legacy_admission` (one row per legacy admission: id, centre code, admission no, academic year, admitted on, first name, last name, dob, mobile) | IMPORTED: the first row of a match-key group. MERGED: later rows with the same `app.person_match_key`, survivor = first row (synthetic rule standing in for D-MIG-4 maps). REJECTED: no usable given name, or a malformed date |
| admission | `raw.legacy_admission` | IMPORTED, linked to the person target (or its survivor) and the centre target. REJECTED: centre REJECTED or EXCLUDED, bad academic year, or person REJECTED |
| registration | `raw.legacy_course_row` (admission id, course code, register no, join date, status) | IMPORTED, linked to its admission. REJECTED: orphan (admission not IMPORTED), duplicate Register No, malformed date |

SPLIT (K5) has no case in today's targets; the framework supports it, and a unit test of the runner with a synthetic split rule covers K5.

### The synthetic fixture and its defects (G4)

`etl/fixture.ts` generates the raw rows from a fixed seed (no randomness at run time), about 2,000 admissions and 3,000 course rows over the three fixture centres, plus these planted defects, each with the outcome P8 asserts:

| Defect | Outcome |
|---|---|
| Centre code with surrounding spaces and lower case (`' kl2-25 '`) | IMPORTED to centre A |
| Test centre `GDEMO` with admissions | centre EXCLUDED; its admissions and course rows REJECTED with reason "centre excluded" |
| Unknown centre code | centre REJECTED; its admissions REJECTED |
| The same learner admitted twice (same name, dob, mobile; names swapped once) | second person MERGED into the first; both admissions IMPORTED to the one person |
| Learner with no dob | person IMPORTED, never merged (null match key) |
| Date in a text column (`'45231'`) | REJECTED, exception on `admitted_on` |
| Course row whose admission does not exist | REJECTED (orphan), K6 |
| Two course rows with the same Register No | the second REJECTED |
| Academic year `2026-2027` | REJECTED, exception on `academic_year` |

### Checks and outputs

*   **K1** every raw key of every entity appears in `key_map`. **K2** per entity and centre: source count = sum of dispositions (counting a SPLIT key once). **K3** every row in each target table the run wrote has a key-map row. **K4** each MERGED key's survivor is an IMPORTED key of the same entity in the same run (so no chains). **K5** each SPLIT key has the target count its rule declares. **K6** no target row references a missing row (checked with anti-joins on each foreign key of the mapped tables). **K9** run by `etl/compare.ts` over two run ids.
*   K7, K8, K10, K11 are written as `passed = null`, `detail.reason = "not applicable in Stage 2"`.
*   **Artifacts:** `evidence/etl-<run_id>.json` (run, rules, disposition counts per entity and centre, check results) and `evidence/etl-<run_id>-exceptions.csv` (keys, fields, fingerprints, messages; no raw values).
*   **A run PASSES** when every applicable check passes and, in cutover mode, REJECTED = 0.

## Decisions

Taken by the owner on 2026-10-28, before drafting; each stays PRO until the design is approved.

1.  **DD-1: Same database, own schemas.** `migration`, `raw`, `archive` live in the GEMS database, created by a migration-environment setup script; `gems_etl` exists only there.
2.  **DD-2: Rules in TypeScript, one module per entity**, registered in `migration.rule` with a version and an approval.
3.  **DD-3: Direct bulk insert as `gems_etl`**, keeping legacy numbers; the database's own constraints still apply; counters are seeded from the migrated maximum.
4.  **DD-4: K7 and K8 wait for Stage 4**, when the fee and ledger tables exist.
5.  **DD-5: No `stage` schema** (proposed while drafting): typing and cleaning happen inside each rule. A `stage` table can be added for an entity whose rule becomes too slow in memory.

## Open questions

| ID | Owner | What it affects here | Default used now |
|---|---|---|---|
| D-MIG-4 | Owners | Real merge maps (masters, persons with D-STU-5) | Synthetic match-key rule in P8 only |
| D-STU-5 | Admissions/PRO | Person merge in real data | Not run on real data |
| D-MIG-7, D-MIG-8 | IT, Accounts, MIS | Which source, XLS mode | No real source |
| D-MIG-1 | IT/Accounts | History depth, what is ARCHIVED | ARCHIVED supported, unused in P8 |
| D-SEC-4/5 | IT + Legal | PII in raw tables and artifacts; retention of `raw` after cutover | Synthetic data only; fingerprints in exceptions |
| NP-8 | Accounts + Certification | Counter seeds after migration | Highest migrated value |
| D-TZ-1 | IT | Legacy dates and times | Dates only in P8 |

## Alternatives Considered

### Alternative A: A separate ETL database

*   **Pros**: Stronger isolation; the target database never sees raw or migration schemas.
*   **Cons**: Two databases to provision and reconcile; target ids and constraints are checked across a connection; the key map lives away from the rows it describes.
*   **Reason for Rejection**: The same separation comes from schemas plus a role that exists only in migration environments (DD-1).

### Alternative B: Rules as SQL (`insert … select` from stage tables)

*   **Pros**: Set-based and fast for millions of rows.
*   **Cons**: Per-row dispositions and exceptions become `case` expressions across many statements; unit testing needs a database; versioning a rule means versioning SQL text.
*   **Reason for Rejection**: P8 and the first module stages are small; correctness and testability come first. A slow entity can move to SQL behind the same rule interface later (DD-2).

### Alternative C: Load through `admit()`

*   **Pros**: Reuses the app's validation and audit.
*   **Cons**: Allocates new numbers, losing legacy Admission and Register Nos; one transaction and audit row per record; needs a session and permissions for every centre.
*   **Reason for Rejection**: Legacy numbers are printed on forms and certificates and must survive (DD-3).

### Alternative D: Random ids plus a lookup table

*   **Pros**: No id scheme to define.
*   **Cons**: Every rerun gives different ids, so K9 cannot hold and rehearsals do not predict the final run.
*   **Reason for Rejection**: Determinism is a goal (G3).

### Alternative E: An audit row per migrated record

*   **Pros**: The audit log alone tells where each row came from.
*   **Cons**: 1.2M+ audit rows that duplicate the key map, in an append-only table that cannot be pruned.
*   **Reason for Rejection**: The key map is the per-record provenance; the audit log records the run.

### Alternative F: A synthetic voucher table now for K7/K8

*   **Pros**: Proves "never auto-balance" in Stage 2.
*   **Cons**: A throwaway target that the Stage 4 ledger replaces; the check would be rewritten anyway.
*   **Reason for Rejection**: The owner deferred K7/K8 to Stage 4 (DD-4).

## Risks and limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| `gems_etl` left in production | A role that bypasses RLS on live data | Created only by `scripts/etl/setup.sql`; go-live checklist drops it; a check script lists BYPASSRLS roles (T-RLS-015) | `tests/etl.test.ts` asserts no Prisma migration creates it |
| The synthetic schema differs from the real legacy one | Rules rewritten at Stage 0 | **Accepted:** the framework does not depend on the source shape; only `etl/rules/` and the loader do | n/a |
| A constraint error mid-entity | Run FAILED | Rules must REJECT bad data first; the failed entity's transaction rolls back, and the run is rerun from a fresh database | P8 |
| Raw tables hold PII in rehearsals | Exposure beyond the app's controls | Synthetic data only in Stage 2; retention and access of `raw` are D-SEC-4/5 before any real run | n/a |
| In-memory rules on 1.2M rows | Slow or out of memory | Batches of 1,000 rows per read and write; an entity can move to SQL (Alternative B) | timed at the first rehearsal |
| Merge by match key on real data | Wrong merges of different people with equal name, dob and mobile | **Accepted for P8 only:** real merges need D-MIG-4/D-STU-5 maps | T-MIG-004 |
| Counter seed from migrated maximum | A legacy number issued after extraction is reused | Freeze before the final run (audit 08 §7); NP-8 sign-off | P8 continuity assertion |

## Detailed Implementation Plan

### Build phases

`bash scripts/ci.sh` must be green at the end of each phase.

| Phase | Items | Why they go together |
|---|---|---|
| M1 Documents | 1 | T-MIG tests and matrix links stay consistent (T-DOC-001) |
| M2 Setup | 2, 3 | The schema and role must exist before the runner can be tested |
| M3 Runner and rules | 4, 5, 6, 7 | Rules, ids and checks are tested together through P8 |
| M4 Evidence | 8 | After CI is green |

### Target Files to Create/Modify

#### 1. `docs/audit/09-…md`, matrix (Modify)

*   T-MIG-001…006 and 009 gain "Stage 2: P8 on synthetic data"; T-MIG-007/008 "Stage 4 (DD-4)"; T-MIG-010/011 "needs legacy data".
*   T-RLS-015 notes the setup-script confinement.

#### 2. `scripts/etl/setup.sql` (Create)

*   Idempotent: `create schema if not exists raw, migration, archive`; the five tables above with keys and the partial unique index; `gems_etl` with the grants above (created only if missing; password from the environment, never in the file).
*   `docker/initdb` is unchanged; `scripts/ci.sh` runs `setup.sql` after `prisma migrate deploy`, as the CI database is a migration environment.

#### 3. `scripts/etl/approve-rule.mjs` (Create)

*   `node scripts/etl/approve-rule.mjs <rule_id> <version> <approver>`: sets `approved_by`, `approved_at` on that version only.

#### 4. `etl/ids.ts`, `etl/types.ts` (Create)

*   `uuidv5(name)` under the fixed namespace; the rule and result types above.

#### 5. `etl/rules/centre.ts`, `person.ts`, `admission.ts`, `registration.ts` (Create)

*   The four rules of the entity table, each with `id`, `version: 1`, `entity`, `dispositions`, `map`.

#### 6. `etl/run.ts`, `etl/checks.ts`, `etl/compare.ts`, `etl/fixture.ts` (Create)

*   The runner steps 1–6; checks K1–K6 and the not-applicable rows; K9 comparison; the seeded fixture with the defects table.

#### 7. `tests/etl.test.ts` (Create)

*   Unit: `uuidv5` against RFC 9562 test vectors; each rule on hand-written rows; a synthetic SPLIT rule through the runner (K5).
*   P8: reset the database, run twice from scratch, assert G1–G5 and each defect's outcome, K9 equal, counters continue from the migrated maximum (`admit()` issues the next numbers), cutover mode refuses an unapproved rule, no balancing or extra rows.
*   G6: no file under `prisma/migrations` mentions `gems_etl`.
*   Audit: `migration.run.start`/`finish` rows with `actor_kind` `migration:<run_id>`; both catalogued (T-AUD-009 scans `etl/run.ts`).

#### 8. `docs/STATUS.md`, evidence log (Modify)

*   Evidence entry with the two run artifacts, CI counts and mutation checks.

### Verification Plan

*   **CI:** `bash scripts/ci.sh` (adds `setup.sql`), `npx vitest run` including `tests/etl.test.ts`.
*   **Mutation checks**, recorded in the evidence log:

    | Guarantee | Mutation | Test that must fail |
    |---|---|---|
    | One disposition per key | Drop the partial unique index | T-MIG-002 |
    | Determinism | Use `randomUUID()` in `etl/ids.ts` | T-MIG-009 |
    | No silent drop | Skip writing the key map for REJECTED keys | T-MIG-001 |
    | Merge integrity | Point a MERGED key at a MERGED survivor | T-MIG-004 |
    | Cutover approval | Skip the approval check | G5 test |

*Drafted with EGM*
