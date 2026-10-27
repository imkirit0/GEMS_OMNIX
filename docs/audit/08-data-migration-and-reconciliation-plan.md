# 08 Data migration and reconciliation plan (v1.1)

Status: **discovery not started on the legacy database (no access).** The XLS workbook was profiled read-only. No data has been copied or migrated.

## 1. Sources
| Source | Access today | Content | Use |
|---|---|---|---|
| GEMS MySQL (`gsch_*`) + HRMS, CRM, Accounts, Purchase DBs | **None.** Request read-only replica/dump from vendor (d'Katia) | System of record | Primary migration source |
| `D:\Legacy_Data\GEMS LEGACY DATA (2009-2026 March).xlsx` | Read-only, profiled 2026-10-26 | Enrolment-level history, 2009–2026 | Candidate history source (D-MIG-7, D-MIG-8) |
| Legacy Centres API | Via dashboard team | Counts and rosters | Cross-check only (control totals) |
| `/uploads/` files (QR codes, certificates, photos, documents, CSV templates) | None | Files referenced by DB rows | Migrated with references |

## 2. XLS profile (evidence; no row values copied)

**Shape:**
- 18 sheets, `2009`…`2026`.
- The same 20 columns on every sheet: CenterID, LocationName, Name, address, TotalFee, FirstInsallment, NoofInstallments, InstallmentAmount, Duration, JoinDate, Completed, ParentName, Sex, FeeCompleted, CourseCode, CourseName, SchemeName, District, State, Country.
- ≈1,218,203 rows in total. Per-sheet counts are in `baseline/v1-audit.md` §A.7.1.

**Findings:**

| # | Finding | Consequence |
|---|---|---|
| XL-1 | No student ID, admission number, register number, DOB, phone or email | No deterministic person matching |
| XL-2 | No receipts or ledger, only the fee plan plus a FeeCompleted flag | Not a financial migration source |
| XL-3 | The 2026 sheet runs to 2026-06-29 | Overlap with GEMS (X15) |
| XL-4 | Type corruption: dates appear in numeric/text columns | Affected rows are REJECTED |
| XL-5 | Enum drift per year | Value maps need approval per year |
| XL-6 | Code/name count mismatches | Catalogue mapping needs approval |
| XL-7 | CenterID formats unknown | Centre mapping to GEMS codes is needed |
| XL-8 | PII for about 1.2M rows on a local drive | Handling and retention decision needed (D-SEC-4/5) |

## 3. Discovery (Stage 0 deliverables)
1. Schema export: tables, columns, types, PK/FK, indexes, engine and charset.
2. Row counts and date ranges per table, broken down by centre and AY for core tables.
3. Usage queries for every PR-xx: count, last used, and centres using it.
4. Control-total queries that replicate the legacy reports:
   - the 16 admission reports;
   - fee collection per centre/FY;
   - trial balance per FY;
   - outstanding dues;
   - ticket counts by status.
5. Data-quality profile:
   - duplicates and orphans;
   - invalid dates and encoding issues;
   - known issues from DQR/REQ (6 malformed centre codes, test centres, whitespace course codes, 196 multi-name codes, `/` and `&` in codes, empty codes);
   - plaintext secrets;
   - the password hash scheme.
6. File inventory: every DB column holding a path, with existence checks on disk.
7. Map every legacy table to its requirement row (02 `migration` column). Tables with no mapping are marked "unsupported → ARCHIVED or EXCLUDED, reason required".

## 4. Dispositions and traceability (from 01 §C-03; authoritative)
- **One disposition per source key:**

  | Disposition | Mapping | Requirement |
  |---|---|---|
  | IMPORTED | 1→1 | — |
  | MERGED | n→1, with a survivor | — |
  | SPLIT | 1→n | — |
  | ARCHIVED | read-only archive schema | — |
  | EXCLUDED | — | Approved reason + approver |
  | REJECTED | — | Must reach 0 at cutover |

- **Tables:**
  - `migration.key_map`: run, system, table, key, row hash, disposition, rule, target, survivor, reason, approver.
  - `migration.rule`: versioned; owner approval needed for cutover mode.
  - `migration.exception`: fingerprints, no raw PII.
  - `migration.reconciliation`.
- **Never silently drop a record.**

## 5. Reconciliation checks (T-MIG-001…011 = K1…K11)
| Check | What it verifies |
|---|---|
| K1 | Coverage |
| K2 | Disposition balance per entity/centre/year |
| K3 | Target provenance |
| K4 | Merge integrity |
| K5 | Split integrity |
| K6 | Referential integrity |
| K7 | Amount control totals: excluded/archived amounts reported separately with reasons |
| K8 | Ledger per FY: legacy imbalances reported, never auto-balanced |
| K9 | Determinism across two runs |
| K10 | Report parity with legacy |
| K11 | Stratified field sample |

## 6. ETL design (PRO)
- **Stages:**
  - `raw`: verbatim copy (pgloader or CSV).
  - `stage`: typed and cleaned.
  - `public`: target.
- **Keys:** deterministic target IDs, e.g. UUIDv5 of (system, table, key), so reruns produce identical results.
- **Runs:** re-runnable from scratch on a fresh Neon branch, as `gems_etl`. That role holds BYPASSRLS **only in the migration environment** (T-RLS-015).
- **Audit:** actor `migration:<run>`.
- **Incremental slices:** each module stage (3–7) delivers its entity mappings plus a dry run, so problems surface early.

## 7. Rehearsal, cutover, rollback
1. **Rehearsals.** At least 2 full rehearsals on production-sized copies, timed. K1–K11 must be green, REJECTED = 0, and all EXCLUDED/ARCHIVED rules approved.
2. **Freeze.** Legacy goes read-only, or the delta is captured if `updated_at` exists (unknown).
3. **Final run.** Final run, then the checks, then sign-off by Accounts and Operations.
4. **Switch-over.** Switch login/DNS, and rotate all secrets (D-SEC-6).
5. **Rollback.** Legacy stays intact and read-only for the D-MIG-5 window. The trigger is a failed go/no-go or a severity-1 issue. Transactions entered in the new system are exported for re-entry (procedure written before cutover).
6. **Post-cutover.**
   - Day-1 reconciliation (07 §5).
   - Report parity spot checks.
   - Access review (D-SEC-1).
   - Hypercare.

## 8. Blockers
| Blocker | Blocks |
|---|---|
| Legacy DB access | Stage 0 exit |
| D-MIG-7/8 (history source, XLS mode) | Stage 2 |
| D-TZ-1 | Stage 2 |
| D-MIG-4 merge maps | Each module stage |
| D-MIG-2/3 | Stage 4 |
| Password hash scheme | Stage 8 |
