# EGM Stage 6: Comprehension Test report (migration framework)

- **Target:** `docs/designs/migration-framework/migration-framework.md` (389 lines, commit `0bbcff3`).
- **Reviewer:** `egm-comprehension` (fresh context), standard `re-implementation-standard.md`. Also read migrations 0001/0002/0008/0011, `people.ts`, `numbering.ts`, `tests/fixtures.ts`, `ci.sh`, `bootstrap-admin.mjs`, `poc/test/rls.test.js`, v1.1 C-03, `tests/audit.test.ts`, `package.json`, `db.ts`, `.github/workflows/ci.yml`.
- **Date:** 2026-10-28
- **Result:** **2 Blocker, 16 Major, 7 Nit** (C1–C25); 2 OWNER (C10, C14).

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | **Blocker** | Raw tables: nobody could create them, shape undefined, P8 reset undefined | Raw DDL with exact columns in `setup.sql` (owned by the migration owner, granted to `gems_etl`); the fixture fills them; the test helper truncates raw and run tables between runs |
| C2 | **Blocker** | Match keys computed from raw, unnormalised values, so the `+91` merge defect could not pass | Step 3 runs `identity()` first and computes keys only from the stored forms of valid identities |
| C3 | Major | Rule interface could not express two entities per row, existing-row matches, centres, parents or split cardinality | Full `Rule`/`Result`/`Ctx` types; one rule per source table producing several entities; `existing` IMPORTED shape; `ctx.centres`; `parent`, `splitCardinality` |
| C4 | Major | Key-map columns per disposition, `source_row_hash`, exception `field` undefined | Per-disposition table; schema-qualified `target_table`, text `target_id`; hash of canonical JSON; identity-key → raw-column map |
| C5 | Major | No types, keys, FKs or checks | DDL given in substance |
| C6 | Major | "Ordered by source key" ambiguous; do rejected rows reserve numbers | `collate "C"` everywhere; only usable rows claim Admission/Register Nos |
| C7 | Major | Id scheme incomplete | Namespace literal, name grammar with `encodeURIComponent`, SPLIT suffix from 1, UTF-8, examples |
| C8 | Major | Digest serialisation undefined | Canonical form section (rows, order, sections, hex) |
| C9 | Major | Fingerprint inputs undefined; stored salt allowed brute force | Exact HMAC key and message; the salt is never stored |
| C10 | Major | Counter-seed parsing and CLI grammar undefined | **OWNER: DD-9**, assume `GTEC<yy><yy><seq>` until Stage 0; unparsable values listed; existence check moved to preflight; options typed |
| C11 | Major | `node etl/run.ts` cannot load `people.ts` (parameter properties, extension-less imports); no `tsx` | **DD-11:** `run()` exported and called from tests; launcher with the first rehearsal; result and `RunRefused` defined |
| C12 | Major | Reconciliation row contents undefined | Per-check table (scope, expected, actual, passed); K9 `passed = null` with the digest |
| C13 | Major | Refused-run order unclear; upsert conflicts | Preflight before any write; refused = no run row, no audit; same version with other metadata refused |
| C14 | Major | Changed code under the same version keeps its approval | **OWNER: DD-10**, `code_hash` with `approved_hash`; refused in every mode on mismatch |
| C15 | Major | Table-level update would let the ETL approve its own rules | Column grants; approval only as the migration owner |
| C16 | Major | Artifact formats undefined | JSON shape and CSV header given; `evidence/` committed for the evidence run, temp dir in P8 |
| C17 | Major | `isoDate` private; raw-to-Identity mapping missing | `isoDate` exported; mapping table incl. course and register fields |
| C18 | Nit | CI wiring | `ci.yml` added; setup after line 34; `MIGRATE_URL`; client-side `format()` |
| C19 | Nit | Go-live T-RLS-015 run | Query and expected list in the design |
| C20 | Nit | Audit row incomplete | Column table (`FAILED` exists since 0009); `app.redact`; whole-file scan |
| C21 | Nit | `created_at`, registration centre, end date | Specified |
| C22 | Major | Admission → centre lookup ambiguous | Normalise both sides; IMPORTED centre key required; raw centre rows listed (incl. a duplicate code) |
| C23 | Nit | Fixture and rule constants | mulberry32 seed, status map, rule ids and owners, reason strings |
| C24 | Nit | Transaction and failure boundaries | Per entity; FAILED in a new transaction; RUNNING after a crash never PASSES |
| C25 | Nit | Role of `dispositions` | Undeclared dispositions fail the run; declaring ARCHIVED fails registration |

## Resolution

**Status: resolved (2026-10-28).** Owner decisions: C10 → DD-9 (assume the R-029 `GTEC<yy><yy><seq>` format until Stage 0), C14 → DD-10 (code hash on rules). All 25 applied; the Technical Plan and the implementation plan were rewritten (DD-9…DD-11 added).
