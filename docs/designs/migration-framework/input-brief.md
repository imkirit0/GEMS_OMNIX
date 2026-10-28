# Migration framework (ETL foundation and P8): input brief for `egm-draft`

Prepared 2026-10-28 from the audit pack, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, PRO)
- **Stage 2 deliverable** (audit 10, row 2; v1 audit §A.8): an "ETL framework" with a "disposition ledger" and **P8**, a repeatable migration dry run with reconciliation output, on **synthetic data only**. Real legacy data waits for Stage 0 access and separate approval.
- **The rule that drives everything** (audit 08 §4, v1.1 C-03, SRC of the audit): every source key gets **exactly one disposition**, and **no record is ever silently dropped**.

  | Disposition | Meaning | Requires |
  |---|---|---|
  | IMPORTED | 1 source → 1 target | rule id |
  | MERGED | n sources → 1 survivor (duplicate persons, duplicate masters) | approved merge rule + survivor |
  | SPLIT | 1 source → n targets (an XLS enrolment row → person + admission + registration) | split rule |
  | ARCHIVED | kept read-only in an `archive` schema with the source payload | approved archive rule |
  | EXCLUDED | intentionally not migrated (test centres GDEMO, KL-01-TEST3, KL-01-TEST6) | approved reason + approver |
  | REJECTED | failed validation (corrupted cells, orphan FK) | exception; **0 at cutover** |

- **Traceability tables** (C-03.2, PRO): `migration.key_map` (run, source system/table/key, row hash, disposition, rule, target table/id, survivor, reason, approver), `migration.rule` (versioned; an unapproved rule cannot run in cutover mode), `migration.exception` (fingerprints, **no raw PII**), `migration.reconciliation` (stored check results).
- **ETL shape** (audit 08 §6, PRO): `raw` (verbatim) → `stage` (typed, cleaned) → target; **deterministic target ids** (e.g. UUIDv5 of system, table, key) so reruns are identical; re-runnable from scratch; runs as `gems_etl`, which holds BYPASSRLS **only in the migration environment** (T-RLS-015); audit actor `migration:<run>` (the `actor_kind` column exists since 0008).

## 2. P8 as specified (v1 audit §A.8, amended by C-03 to assert K1–K9)
- **Fixture:** a synthetic dataset shaped like the XLS/legacy tables, no real PII, with seeded defects: whitespace codes, duplicate persons, a test centre, corrupted cells, an unbalanced voucher.
- **Test:** run the ETL twice from scratch.
- **Expected:** identical target state and key_map both times; dispositions cover 100% of source keys; counts per entity/centre balance; control totals per centre/FY match; seeded defects appear as exceptions; **no balancing entry is created**.
- **Failure conditions:** a source key without a disposition; non-deterministic ids; a silent drop; an auto-generated balancing entry.
- **Evidence:** a JSON result plus the exception CSV, recorded in the evidence log.

## 3. Reconciliation checks (T-MIG-001…011 = K1…K11, audit 09; C-03.3)
| Check | Formula (summary) | P8 on synthetic data? |
|---|---|---|
| K1 coverage | every source key appears in key_map | yes |
| K2 disposition balance | source = IMPORTED + MERGED + SPLIT + ARCHIVED + EXCLUDED + REJECTED, per entity/centre/year | yes |
| K3 target provenance | every target row has a key_map row (or is a documented seed) | yes |
| K4 merge integrity | one survivor per group, survivor exists, no chains | yes |
| K5 split integrity | each split yields its rule's target set | yes |
| K6 referential integrity | 0 orphan FKs in target; source orphans REJECTED/EXCLUDED with reason | yes |
| K7 amount control totals | Σ source = Σ target + Σ excluded/archived, per centre/FY/fee head | yes, if a money entity is in the fixture |
| K8 ledger | per FY trial balance nets to 0; legacy imbalance reported, **never auto-balanced** | yes, with a synthetic voucher table (no ledger exists yet) |
| K9 determinism | two runs give identical key_map and totals | yes |
| K10 report parity | legacy reports equal | no: needs legacy reports |
| K11 field fidelity sample | stratified field-by-field sample | partially (synthetic) |

## 4. Targets that exist today (built; E-014…E-032)
- **Person core** (migration 0011): `person` (network-wide, `match_key` set by trigger so bulk loads get it), `admission` (centre, academic year, Admission No), `registration` (centre, course code text, Register No, status). Numbers come from `global_number_series`; the cutover script seeds REGISTER and the 2026-27 ADMISSION year from legacy values (NP-8). T-MIG-004 is cited by D-STU-4 and the person-core design as the migration check.
- **Organisation:** `region`, `area`, `centre` (codes like `KL2-25`). There is no course catalogue table yet (`course_code` is text), no fee or ledger tables (Stage 4, behind G-FIN).
- **Roles:** `gems_owner` (migrations), `gems_app`, `gems_job`, `gems_auth`, `gems_report_ro` (0002, 0003, `docker/initdb`). **No `gems_etl` yet.**
- **Audit:** `app.audit()`, append-only `audit_log` with `actor_kind`.
- **CI:** `bash scripts/ci.sh` recreates the Docker database; drift gate; vitest suites; the POC suite in `poc/` is not run by CI.

## 5. Sources (audit 08 §1–2; nothing copied)
- **GEMS MySQL** (`gsch_*` and related DBs): no access (Stage 0 blocker).
- **XLS** `GEMS LEGACY DATA (2009-2026 March).xlsx`: profiled read-only; 18 sheets × the same 20 columns (CenterID, LocationName, Name, address, TotalFee, FirstInsallment, NoofInstallments, InstallmentAmount, Duration, JoinDate, Completed, ParentName, Sex, FeeCompleted, CourseCode, CourseName, SchemeName, District, State, Country); ≈1.2M rows. Findings XL-1…XL-8: no student id, DOB, phone or email (no deterministic person match); no receipts/ledger; dates in numeric/text columns; enum drift per year; CenterID formats unknown; PII on a local drive (D-SEC-4/5).

## 6. Open decisions (audit 04; all PMC, none approved)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-MIG-1 | History depth; log archive | All core records; old logs archived | IT/Accounts |
| D-MIG-2 | Historic journals: full vs opening balances | Full for open FYs, opening for closed | Accounts |
| D-MIG-3 | Unbalanced vouchers | Report + approved treatment; never auto-balance | Accounts |
| D-MIG-4 | Master dedupe maps | Approved merge maps | Owners |
| D-MIG-7 | Authoritative pre-2026 history source | Both profiled; XLS only for history absent from MySQL | IT + Accounts |
| D-MIG-8 | XLS import mode; Jan–Jun 2026 overlap | Reporting-only history table; overlap excluded | IT + MIS |
| D-STU-5 | Merging duplicate person records | Merged later by a reviewed process | Admissions/PRO |
| D-TZ-1 | Legacy time zone | UTC storage; legacy zone TBD | IT |
| D-SEC-4/5 | PII handling, retention | — | IT + Legal |

## 7. Questions the design should answer explicitly
1. **Where it runs:** a schema `migration` (and `raw`, `stage`, `archive`) in the same database, or a separate database; how `gems_etl` and BYPASSRLS are confined to the migration environment and proven absent elsewhere (T-RLS-015).
2. **Rules:** how a mapping rule is expressed (SQL, TypeScript, or declarative), versioned and approved; how cutover mode refuses unapproved rules.
3. **Determinism:** the id scheme (UUIDv5 namespace), ordering, and how a rerun proves identical output (K9), including numbers allocated from `global_number_series`.
4. **Writing to targets:** direct inserts as `gems_etl` vs going through `admit()`; how triggers (`match_key`), check constraints and composite FKs apply; how person duplicates in the source become MERGED without D-STU-5 tooling.
5. **The synthetic fixture:** its shape (XLS-like rows, a small legacy-table subset), which seeded defect proves which check, and whether a synthetic voucher table is in scope for K7/K8 before the ledger exists.
6. **Exceptions without PII:** what a fingerprint is (hash with a run salt?) and how an operator still finds the bad row.
7. **Reconciliation storage and output:** the JSON and CSV artifacts, and how T-MIG-001…009 run in `scripts/ci.sh`.
8. **What Stage 2 delivers** (framework, ledger tables, P8 on synthetic data) versus what each module stage (3–7) adds (its entity mappings and dry runs) and what waits for Stage 0 access.
