# EGM Stage 8: Intermediate zoom-out report (migration framework)

- **Target:** `docs/designs/migration-framework/migration-framework.md`, full file (595 lines, commit `aee30ba`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Also read the three earlier reports, v1.1 C-03, audit 08 §4–8, v1 audit §A.8, migrations 0002/0008/0011, `people.ts`, `numbering.ts`, `tests/fixtures.ts`, `scripts/ci.sh`, `poc/test/rls.test.js`, `vitest.config.ts`, `tests/foundation.test.ts`.
- **Date:** 2026-10-28
- **Result:** **0 Blocker, 3 Major, 12 Nit** (Z18–Z32); 1 OWNER (Z18).

The reviewer found the design still proportionate (the growth is the precision Stage 6 asked for), with no decision DD-1…DD-11 challenged. What had grown were places where two fixes guard the same invariant, plus one operational contradiction.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z18 | Major, OWNER | On the production database rules could not be approved and then run: a refused run rolls back registration, a dry run leaves the database non-empty, and re-provisioning deletes the approvals | **Option (a), which reverses no decision:** `scripts/etl/reset.sql` (raw, run tables, app targets, counters; keeps `migration.rule`), used by operators and P8; sequence dry run → approve → reset → cutover |
| Z19 | Major | `btree_gist` and the exclusion constraint guarded SPLIT mixing, which has no Stage 2 case and K2 already reports | Removed; partial unique index kept; added back with the first real SPLIT |
| Z20 | Major | The "extended reach check" pointed at the POC test file, whose database has no `raw`/`migration` | Reach query for `raw`/`migration` added to the go-live check |
| Z21 | Nit | `approved_hash` always equals `code_hash` | Removed; cutover requires `approved_at` not null |
| Z22 | Nit | Comparing `source_table`/`entity_list`/`dispositions` duplicated the hash check | Hash only |
| Z23 | Nit | `hashFiles` per rule, with wrong entries | Removed; rule file plus `people.ts`, `ids.ts` |
| Z24 | Nit | `input_hash` in the fingerprint key broke matching across rehearsals | Key = `ETL_SALT` |
| Z25 | Nit | Runner chain check duplicated K4 | K4 owns it |
| Z26 | Nit | ARCHIVED guarded three times, but the database allowed it | Removed from the `key_map` check; runtime guards dropped |
| Z27 | Nit | Admission No format defined twice | Parsing uses `PERSON_POLICY.admissionPrefix` |
| Z28 | Nit | No test reached `unparsedNumbers`/`laterYearNumbers` | Two defects added; run status a pure function, unit-tested per gate |
| Z29 | Nit | `source` and `fixtureSeed` options never vary | Constants in Stage 2 |
| Z30 | Nit | Batching claimed as a memory mitigation | Reworded |
| Z31 | Nit | Parent resolved twice | `map()` uses the rule's `parent` function |
| Z32 | Nit | Artifact path differs from A.8 | Mapping stated |

## Resolution

**Status: resolved (2026-10-28).** All 15 applied under the owner's standing instruction "apply all fixes when the reviews are done"; Z18 took the reviewer's recommended option (a), which adds a reset script and reverses no decision.
