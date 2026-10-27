# 01 Executive architecture review (v1.1)

Date: 2026-10-26. Status: **audit baseline for review. No application exists. No application tests have been run.**

The detailed corrections C-01…C-12 that this file summarises are in `revisions/v1.1-corrections.md`. Sections cited as "01 §C-xx" refer to that file.

## 1. Repository state (inspected)
- **`D:\GEMS OMNIX`**: the two source PDFs (unchanged), plus this new `docs/audit/` folder. There is no code, no package configuration, no database configuration and no tests.
- **Git:** none. `git status` returns "not a repository". Initialising one is proposed but not done.
- **Read-only external evidence:** the legacy XLS workbook, the API data-quality report, the API technical response and the GEMS API request (paths in 12).
- **Legacy MySQL:** no access.

## 2. What GEMS is (SRC)
- **System:** a vendor school ERP (CareerBook, by d'Katia) adapted for a franchise network of about 325 centres. It consists of the CodeIgniter monolith plus HRMS, CRM, Accounts and Purchase apps.
- **Size:** about 230 pages, 43 roles and 854 permission rows.
- **Core spine:** centre → course → student → course registration → fees → exams → certificates, plus supply chains (vouchers, licences, SAP, materials) and royalty.
- **Integration:** a read-only Centres API feeds a management dashboard.

## 3. Target architecture (PRO; user-chosen stack retained)
- **Stack:**
  - Next.js App Router + TypeScript as one app, with server actions for the UI and `/api/v1` route handlers for integrations and mobile;
  - Prisma + PostgreSQL (Neon) on Vercel;
  - zod validation;
  - shared DataTable and filter cascade;
  - private Blob storage;
  - Vercel Cron.
- **Auth:** one implementation, chosen by ADR-001 through a POC bake-off (06 §2). Requirements: argon2id, TOTP for head office, revocable DB sessions, step-up.
- **Authorization:** one server-side `authorize()` gate plus PostgreSQL RLS. Both must allow a request. Scope is DB-derived and transaction-local (06).
- **Domain spine:** person → admission → course registration (identity is decided by D-STU-4), an AY-keyed fee structure, and a double-entry ledger (07).
- **Shared engines:**
  - ticket/approval engine (core in Stage 2);
  - numbering (policy separate from mechanism);
  - append-only audit;
  - import framework;
  - notification adapters.

## 4. Evidence change from the earlier plan
| Change | Why |
|---|---|
| The legacy Centres API is added as a requirement (R-200…205) | Cutover would otherwise break the management dashboard |
| Migration has two sources (MySQL + XLS) and entity-aware reconciliation | The vendor says GEMS data starts in 2026; the XLS covers 2009–2026 |
| Numbering policy is unapproved; the mechanism supports both gapless and unique-only | Source conflict X1; no approval exists |
| Auth library: decided by tests, not by assertion | DR-14 |
| Ticket core moves earlier (Stage 2) | Dependency order |
| Performance thresholds are proposals until approved | No approved NFRs exist |

## 5. Top risks
| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | Report and KPI definitions disagree (X3, X11, D-ADM-2/4); management numbers change at cutover | Critical | Golden datasets; parity checks K10; signed definitions | MIS |
| 2 | History split across GEMS and XLS, with no shared keys | Critical | D-MIG-7/8; reporting-only import by default | IT + Accounts |
| 3 | Financial policies unapproved (cash/accrual, GST rounding, refunds, royalty formula) | Critical | G-FIN gate; production flags unset until signed | Accounts |
| 4 | Scope leak through pooling or owner-rights views | Critical | T-RLS-001…018 through real PgBouncer and the Neon pooler | IT |
| 5 | Centre-side behaviour never observed (receipt screen, exam registration, orders) | High | Read-only centre walkthrough in Stage 0 | Operations |
| 6 | Legacy secrets exposed (API key in guides; gateway credentials) | High | Rotate at cutover (D-SEC-6) | IT |
| 7 | Personal-data obligations (Aadhaar, caste; about 1.2M XLS rows on a laptop drive) | High | D-SEC-4/5 with Legal | IT + Legal |
| 8 | Scope size (290 requirement rows; 18 + 26 processes) | High | Staged delivery; removals only with usage evidence | Sponsor |

## 6. Coverage summary (from the T-DOC-001 run, see 12)

**Totals:**
- 290 requirement rows.
- Every row has a target module or a proposed-removal rationale.
- 265 rows link to ≥ 1 test ID.
- 12 cannot yet: their pages were never observed (03 §C).
- 13 are group headers or proposed removals.
- **Requirements verified (VER): 0. Implemented (IMP): 0.**

**Evidence mix:**

| Class | Rows |
|---|---|
| SRC | 233 |
| REC | 50 |
| Mixed | 7 |

## 7. Decisions that block implementation
- **Stage 1:** ADR-001 approval and architecture sign-off.
- **Stage 2:** NP-1…8, D-STU-4, D-MIG-1…3, D-MIG-7/8, D-TZ-1.
- **Stage 3:** D-ADM-1…4, D-ORG-1…6, D-CAT-1…3, D-SEC-1/4, PR usage results.
- **G-FIN:** every finance item in 07.
- **Full register:** 04.
