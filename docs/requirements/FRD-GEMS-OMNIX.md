---
title: "GEMS OMNIX: Functional Requirements Document (FRD)"
subtitle: "Draft v0.1 for review, not approved"
date: "2026-10-27"
---

# GEMS OMNIX: Functional Requirements Document (FRD)

## 1. Document control

| Item | Value |
|---|---|
| Document | FRD, GEMS OMNIX (replacement of the G-TEC GEMS ERP) |
| Version | **0.1 DRAFT for review**. Not approved; nothing in it is signed |
| Date | 2026-10-27 |
| Companion | `BRD-GEMS-OMNIX.md` (business requirements) |
| Generated from | `docs/audit/data/matrix-*.tsv` (290 rows), 05, 07 and v1.1 C-06, via `docs/requirements/tools/build_frd.py`. Sections 1–4 are hand-written (`src/frd-front.md`) |
| Edit policy | Do **not** edit the generated file. Change the matrix TSV or the front matter, then re-run the generator. This keeps the FRD and the traceability matrix identical |
| Verification state | 0 application tests run. 0 requirements VER, 0 IMP. POC mechanism tests only (P2/P3, E-008 and E-010) |

**Sources**
- **SPEC:** GEMS ERP Rebuild Specification, 57 pp.
- **WF:** GEMS Workflows for Manager Review.
- **REQ / APIR / DQR:** documents on the legacy Centres API.
- **XLS:** legacy enrolment workbook.

Hashes are recorded in `docs/audit/12-evidence-and-verification-log.md`. The *GEMS 2.0 Refs* proposal (2025) is **reference only** and is not a source of any requirement here (v1.5 §G).

## 2. Purpose and how to read this document

**Purpose.** This FRD states **what the system must do**, one requirement per legacy page or capability, with its owner, open decisions and acceptance tests. It describes the legacy behaviour to be rebuilt. Where the target design differs, the difference is stated as a **proposed** (PRO) design or a **pending** (PMC) decision, never as an approved rule.

**Requirement IDs.**
- `FR-x` corresponds 1:1 to matrix row `R-x`.
- Child rows (e.g. FR-044.08) refine a group row (FR-044).

**Evidence classes**

| Class | Meaning |
|---|---|
| SRC | Observed in a source document, with a page |
| REC | Reconstructed from a page that crashed, was blank or hidden, or was never inspected (needs verification before build) |
| INF | Inferred |
| PRO | Proposed design |
| PMC | Pending manager confirmation |
| VER | Verified by an executed test (**0 today**) |
| IMP | Implemented, unverified (**0 today**) |

**Each entry contains:**
- legacy behaviour;
- source page;
- evidence;
- actors;
- dependencies;
- owner;
- open decisions (see the BRD §9 and audit 04);
- acceptance tests (catalogue in audit 09);
- workflows (audit 05);
- migration treatment (audit 08);
- delivery stage (audit 10).

**Rule for open decisions.** Where a decision is open, the requirement is built to support every option, or it waits for the decision. Production configuration for finance, access and retention decisions (marked ⛔ in audit 04) stays unset until the owner signs.

## 3. Actors and access model

| Actor | Description | Scope |
|---|---|---|
| Head-office (HO) user | Staff in HO roles: Super Admin, PRO, ASO, RSO, Certification, Accounts, MIS, Tech Support, Stores, HR, etc. (43 legacy roles; mapping open, D-SEC-1) | ALL, REGION or AREA, by assignment |
| Centre user | Centre admin, cashier and staff of one franchise centre | CENTRE |
| Faculty | Trainer at a centre; own batches (D-ACA-2) | CENTRE, own batches |
| System job | Scheduled job running as a named principal with declared scope | Declared centre list |
| External API client | Management dashboard consuming the Centres API (FR-200…205) | API key/bearer; read-only |
| Payment gateway | Sends signed callbacks and settlement files | Verified callbacks only |
| Student / parent | **No portal or app in scope** (D-PORTAL-1 default: API-first, no portal; PMC) | — |

**Access rules** (PRO, from audit 06; tests T-AUTH-*, T-SEC-*, T-RLS-*):

1. **Permission keys.**
   - Permissions take the form `domain.resource.action` and are granted per role.
   - Users receive scoped role assignments.
   - **Deny by default.**
2. **Two independent gates.** Every request must pass both:
   - server-side `authorize()`;
   - PostgreSQL row-level security (RLS).

   Scope is derived from the database at the start of each transaction.
3. **Head-office sign-in.** HO users with wider-than-centre scope, or with finance/RBAC permissions, must sign in with TOTP.
4. **Step-up re-authentication.** Sensitive actions require it. They include fee cancellation, amount change, transfer, RBAC changes and gateway secrets.
5. **No impersonation.** HO users act within their own scope and every action is audited. This replaces legacy impersonation and the hard-coded approvals password (PR-01, PMC).
6. **Sessions.**
   - Sessions are opaque, stored as hashes, and revocable.
   - Revocation happens on password, role or scope change, on deactivation, and on centre deactivation.
   - Timeouts follow D-SEC-3.
7. **Credentials.** No credential is ever e-mailed. Users receive a one-time reset or invite link instead (PR-12).

## 4. Cross-cutting functional rules

### 4.1 Scope and isolation
| Rule | Detail | Tests |
|---|---|---|
| Out-of-scope data | Never shown, counted, exported or modifiable. Out-of-scope record URLs return 404 (no existence oracle) | T-SEC-001…019 |
| Missing or invalid scope | Fails loudly (error), never as an empty page | T-RLS-006, 007 |
| Region/area scope | Follows centre moves on the next transaction | T-RLS-014 |
| Cross-centre references | Use composite keys, so a centre-A record cannot reference a centre-B record (v1.3 C-19) | T-RLS-008 |

### 4.2 Audit
Every create, update, delete, approval, export, login and denial writes an append-only audit row in the **same transaction** as the change. The row records actor, scope, action, target, before/after (with redaction) and reason (tests T-AUD-001…010). Audit rows cannot be edited or deleted by application roles.

### 4.3 Document numbering
- **Mechanism (PRO; POC-proven locally):**
  - one counter row per series and period;
  - allocation inside the business transaction;
  - a rollback releases the number;
  - a unique index on (series, period, number) is the final guard.
- **Policy** (series scope, reset period, gapless vs unique, cancelled numbers, format and length, prefix types, register-number scope, legacy counter continuation; NP-1…NP-8) is **unapproved**. Owners: Accounts + Certification.
- Tests: T-NUM-001…010, run in both gap modes.

### 4.4 Ticket and approval engine
One engine serves all request types: corrections, course/mode/scheme changes, fee cancellation, transfers, payment approvals and exam requests.
- **Configuration:** ticket types, levels, approvers and prefixes.
- **States:** raise → level approvals → final approval applies the domain change **exactly once**, in the same transaction.
- **Other actions:** reject (new linked ticket, D-TKT-2); forward.
- **Self-approval** is prohibited (D-TKT-4, ⛔).
- **SLA/reminders:** per D-TKT-3.
- Tests: T-TKT-001…018.

### 4.5 Shared list and filter behaviour
All list pages share:
- server-side paging, search and sort;
- page sizes 10/25/50/100;
- column chooser;
- export (FR-006);
- the Region → Area → Centre → AY → Category → Division → Course filter cascade (FR-007).

Lists and exports apply the same scope rules as single records.

### 4.6 Exports and imports
- **Exports:**
  - need an `*.export` permission; PII columns additionally need `pii.export`;
  - are streamed inside one transaction;
  - large exports run as asynchronous jobs to private storage, with a short-lived link that is re-authorised on download;
  - are audited with filters and row count;
  - are rate limited.

  Tests: T-SEC-006, T-RPT-010…013.
- **Imports:**
  - processed row by row under authorize + RLS, with caps;
  - idempotent by file hash;
  - per-row exceptions, plus a batch audit.

  Tests: T-IMP-001…004.

### 4.7 Notifications
SMS, e-mail, push and in-app messages go through provider adapters. Only providers confirmed under D-COMM-1 are built, with templates, consent and DLT registration. Tests: T-NTF-001…005.

### 4.8 Money, time and errors
- **Money:**
  - amounts are `numeric(14,2)`, with no floating point;
  - one currency per receipt or journal;
  - GST applies only to Indian centres (D-CUR-1).
- **Time:** stored in UTC, displayed in Asia/Kolkata; the legacy zone is open (D-TZ-1).
- **Errors:** users see a generic error with a request ID. No SQL or stack trace is ever shown (legacy leaks raw SQL, FR-005.01).

## 5. System-wide financial invariants

Quoted verbatim from `docs/audit/07-financial-invariants-and-transactions.md` §2. Approval state as recorded there; nothing here is approved by this FRD.

| ID | Invariant | Enforcement | Tests | Approval state |
|---|---|---|---|---|
| F1 | Every posted journal balances (Σ Dr = Σ Cr > 0) | Deferred constraint trigger at commit | T-FEE-001 | Technical: needs Accounts acknowledgement |
| F2 | Posted journals and receipts are immutable; corrections only by reversal | Triggers + revoked privileges | T-FEE-012, T-AUD-004 | Ack |
| F3 | Receipt total = Σ allocations (+ unapplied part) | Constraint trigger | T-FEE-001 | Ack |
| F4 | Allocation ≤ outstanding; outstanding = gross − concession + fine − Σ active allocations ≥ 0 | Row lock + check | T-FEE-010 | Ack |
| F5 | Overpayment → Excess Fee liability | Posting rule | T-FEE-006 | **UNAPPROVED** |
| F6 | Cancellation = status change + reversing journal + reversed allocations, in one transaction; links kept | Service + F2 | T-FEE-012, 013 | Ack (window/approver D-FIN-3 UNAPPROVED) |
| F7 | Receipt numbers unique within the approved scope; gapless only if NP-3 says so | `number_series` row lock + unique index | T-NUM-001…010 | **Policy UNAPPROVED (NP-1…8)** |
| F8 | GST split exact; residual per D-FIN-4; no GST for non-Indian centres | Posting function + check | T-FEE-003…005, 016 | **UNAPPROVED** (D-FIN-4, D-CUR-1) |
| F9 | One receipt per successful payment attempt | Unique `payment_attempt_id` | T-FEE-018, 019 | Ack |
| F10 | Success only after signature verification + server recheck + amount/order match; no backward transitions | State machine + unique event | T-FEE-020…022 | Ack |
| F11 | Idempotent collection | Unique `idempotency_key` | T-FEE-007, 008 | Ack |
| F12 | No posting into a Closed period; back-dated corrections post in the open period with a reference | Trigger | T-FEE-015 | **UNAPPROVED** (rule) |
| F13 | `numeric(14,2)`, one currency per receipt/journal, no floats | Types + lint | T-FEE-017 | Ack |
| F14 | Settlement totals tie; differences recorded, never absorbed | Constraint + report | T-FEE-023 | Ack |
| F15 | Receivable control = Σ outstanding dues | Nightly job | T-FEE-028 | Only if accrual (D-FIN-1 UNAPPROVED) |
| F16 | Unapplied cash tracked until applied or refunded | Liability account + check | T-FEE-024 | **UNAPPROVED** (D-FIN-9) |
| F17 | Fee balance per student = Σ dues − Σ concessions + Σ fines − Σ active allocations, recomputable from records | Reconciliation query | T-FEE-028 | Ack |
| F18 | Report totals come only from the documented rules (SPEC p45), one implementation shared by screen, export and API | Shared query module | T-RPT-001…009, T-API-003 | Rules SRC; D-ADM-2 UNAPPROVED |
| F19 | Failed transactions leave no partial business update (number, audit, stock, ticket) | Single transaction per command | T-TKT-007, T-NUM-002, T-AUD-002 | Ack |
| F20 | Royalty inputs frozen per period; recompute idempotent | Snapshot table | T-ROY-002, 003 | **Formula UNAPPROVED** (D-ROY-2) |
| F21 | Migration differences reported, investigated and signed off; never auto-balanced | K7, K8 checks | T-MIG-007, 008 | D-MIG-3 UNAPPROVED |

## 6. Non-functional requirements (all thresholds PROPOSED, decision D-OPS-1)

Quoted from `docs/audit/revisions/v1.1-corrections.md` C-06. RLS overhead is superseded by v1.3 C-20 (absolute per-statement threshold, to be measured in-region).

| ID | Scenario | Measure |
|---|---|---|
| PERF-01 | Steady load, 30 min, at modelled peak | p50/p95/p99 latency per endpoint class, error rate, DB CPU, connections |
| PERF-02 | Spike: month-end collection (5× fee collection rate for 10 min) | the same, plus numbering contention |
| PERF-03 | Soak, 2 h | memory growth, connection leaks |
| PERF-04 | Concurrent large export (100k rows) under PERF-01 load | function memory, duration, impact on others |
| PERF-05 | Single-centre hot spot: 20 parallel collections on one series | throughput, lock waits, no duplicates |
| PERF-06 | Report suite (16 admission reports, one AY, 3× data) | p95 per report |
| PERF-07 | RLS overhead (T-RLS-017) | delta |

| Metric | Proposed | Approved |
|---|---|---|
| List/search p95 (PERF-01) | ≤ 800 ms | — |
| Save p95 | ≤ 1,000 ms | — |
| Fee collection p95 | ≤ 1,500 ms | — |
| Report p95 (PERF-06) | ≤ 3 s | — |
| Error rate | < 0.1% | — |
| Export 100k rows | ≤ 120 s, memory ≤ 512 MB | — |
| DB connections at peak | ≤ 70% of plan limit | — |
| RLS overhead | ≤ 10% | — |

## 7. Traceability summary (computed from the matrix)

| Module | Requirements | Stages |
|---|---|---|
| Organisation and centres | 24 | S2, S3 |
| Platform core: search, navigation, roles, numbering, logs | 22 | S0, S1, S2, S3, S6 |
| Course catalogue | 11 | S3, S6 |
| Enquiries and CRM | 5 | S3, S7 |
| Student records and admission | 8 | S3, S7 |
| Academics: batches, attendance, syllabus, placement | 17 | S3, S6, S7 |
| Fees, schemes and concessions | 20 | S4, S6 |
| Payments and gateways | 3 | S4 |
| Accounting | 40 | S4, S6 |
| Royalty and clearance | 3 | S6 |
| Tickets and approvals | 13 | S2, S3, S5, S6 |
| Examinations | 12 | S6 |
| Certificates | 8 | S6 |
| Vouchers, licences, materials and SAP | 18 | S6 |
| Human resources (HRMS) | 11 | S7 |
| Reports and dashboards | 51 | S5, S6, S7 |
| Notifications and communications | 6 | S6, S7 |
| Integrations: legacy Centres API | 6 | S7 |
| Proposed out of scope (pending usage evidence and owner sign-off) | 12 | S0, S3 |
| **Total** | **290** | |

| Stage | Rows |
|---|---|
| 0 Discovery | 11 |
| 1 Security POC | 7 |
| 2 Data model, numbering, audit, ticket core | 14 |
| 3 Centre, catalogue, enquiry, admission | 56 |
| 4 Fees, receipts, payments, accounting | 61 |
| 5 Ticket workflows | 5 |
| 6 Exams, certificates, supply, royalty, year close | 56 |
| 7 HRMS, reports, integrations, hardening | 80 |

| Evidence | Rows |
|---|---|
| Mixed SRC/REC | 7 |
| REC | 50 |
| SRC | 233 |
| VER (verified by test) | 0 |
| IMP (implemented) | 0 |

## 8. Functional requirements by module

Each entry is one row of the traceability matrix. `FR-x` = matrix `R-x`. Acceptance status of every requirement: **not verified (0 application tests run)**.

### 8.1 Organisation and centres

- **Requirements:** 24
- **Owners:** Operations (21), Admissions (1), IT (1), Accounts (1)
- **Workflows (05):** WF-X13 User/role/permission administration; WF3 Centre onboarding
- **Open decisions (04):** D-CAT-1, D-COMM-1, D-CUR-1, D-GAP-2, D-MIG-4, D-MIG-7, D-ORG-1, D-ORG-2, D-ORG-3, D-ORG-4, D-ORG-5, D-ORG-6, D-PORTAL-1, D-SEC-2, D-SEC-4, D-YEAR-3, PR-01
- **Distinct acceptance tests (09):** 20

#### FR-020: GROUP: Masters dashboard (10 tiles, "Search features" box)

| Field | Value |
|---|---|
| Description (legacy behaviour) | 10 simple masters below |
| Source | SPEC p.9-11; legacy path `admin/master/master_dashboard` |
| Evidence class | SRC |
| Actors / permissions | master manage |
| Depends on | FR-008 |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | Masters migrated with dedupe map (D-MIG-4) |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-020.02: Student Category (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Form Centre Name, Student Type, Fee Amount; list Student Type Id, Student Type, Fee Amount, Action |
| Source | SPEC p.11; legacy path `student/studentType` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Admissions |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | migrate if used |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | usage unchecked |

#### FR-020.03: Religion (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Religion Name; list id, name, edit, delete; 51 rows with duplicates/misspellings |
| Source | SPEC p.11; legacy path `admin/master/Regl` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Operations |
| Open decisions | D-MIG-4 |
| Acceptance tests | T-MIG-004 |
| Workflows | - |
| Data migration | MERGED via approved map |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-020.04: Caste (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Religion (dropdown), Caste Name; list Caste id, Religion, Caste Name, edit, delete; 963 rows |
| Source | SPEC p.11; legacy path `admin/master/commun` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | FR-020.03 |
| Business owner | Operations |
| Open decisions | D-MIG-4, D-SEC-4 |
| Acceptance tests | T-MIG-004 |
| Workflows | - |
| Data migration | MERGED via approved map |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Retention/necessity of caste data PMC |

#### FR-020.05: Mother Tongue (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Mother Tongue Name; list Sl No, Mother Tongue, Action; 24 values incl. Not applicable, Others |
| Source | SPEC p.11; legacy path `student/MT_Master` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-020.06: Category (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre Name, Category (req); DataTable Category Id, Category, Action; values OBC, GENERAL, SC |
| Source | SPEC p.11; legacy path `category` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-020.08: Blood Group (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Institution Name, Blood Group; DataTable #, Id, Blood Group, Action; 8 rows |
| Source | SPEC p.11; legacy path `admin/Admin/bloodgroup_master` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-022: Centre Master / Centre List

| Field | Value |
|---|---|
| Description (legacy behaviour) | DataTable SiNo, Sch Code, Centre Name, Email, Account No., Class Type, Status (Active/Inactive), Action view/edit/delete, per-row password reset; top buttons Permission, Mobile Settings |
| Source | SPEC p.12; legacy path `admin/school/SchoolList` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-023 |
| Business owner | Operations |
| Open decisions | D-ORG-1, D-ORG-6 |
| Acceptance tests | T-SEC-001, T-AUTH-012, T-CO-001, T-CO-004 |
| Workflows | WF3 Centre onboarding |
| Data migration | centres IMPORTED; test centres EXCLUDED (X14) |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Delete action replaced by soft close (D-ORG-6) |

#### FR-022.01: Centre Master quick view (part of FR-022)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre General Setting card (see R-022) |
| Source | SPEC p.3,12; legacy path `admin/School/view/{id}` |
| Evidence class | SRC |
| Actors / permissions | HO / own centre |
| Depends on | FR-022 |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-001 |
| Workflows | WF3 Centre onboarding |
| Data migration | n/a |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-022.02: Centre view (part of FR-022)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Logo card + General Setting: Centre Name, Code, Email, Address, Phone, Account Number, Country, State, District, Region, Area, Centre Class, Centre Category, GST Enabled, Centre Visibility in Enquiry form, State/Interstate, GST No, Default Permission; buttons Courses List, Centre - Course List |
| Source | SPEC p.12; legacy path `admin/school/view/{id}` |
| Evidence class | SRC |
| Actors / permissions | HO / own centre |
| Depends on | FR-022 |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-001, T-CO-001 |
| Workflows | WF3 Centre onboarding |
| Data migration | n/a |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-023: Centre Creation

| Field | Value |
|---|---|
| Description (legacy behaviour) | Identity: Centre Name, Code, Email, Address, Phone (req), Affiliation No, Accreditation No, Website, logo. Classification: Board (STATE, CBSE, ICSE, IGCSE, VHSE, Calicut University), Centre Type (SCHOOL), Centre Category (School, College), Centre Class (req: METRO, A++, A+, A, B, C, GCE, GCAS, GENSMART, IT MAGIC, CALTEX, UAE, EGY, BAH, UK), Category level (req: Superadmin, Head office, Region office, Centre), parent Centre. Location cascade Country (255), State, District, Region, Area (req) with quick-add. Finance: Account Number, GST Enable (req), State/Interstate, GST No. Default Permission (Yes/No) |
| Source | SPEC p.12-13; legacy path `admin/school/index -> admin/school/create` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-033 |
| Business owner | Operations |
| Open decisions | D-ORG-1, D-ORG-2, D-ORG-5, D-ORG-6, D-CUR-1 |
| Acceptance tests | T-E2E-003, T-CO-001, T-CO-002, T-CO-003 |
| Workflows | WF3 Centre onboarding |
| Data migration | IMPORTED; codes normalised (6 malformed, DQR) |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-024: Centre Permission settings (~60 flags)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Company/Branch header (Company, Branch, names, address, phone, email, logo); Permission Allow/Deny flags (fee_assign, fee_payment, admission_settings, student_delete, fee_details, currency_type INR/USD, parent_fee_card_type, student_class_wise_mid, virtual_account_num_type, split_fee_payment, erp_workflow_hr/pr/vr, admission_month/year, mother_tongue, religion, school_board, profile_edit, course_document, quick_student_import, school_logo_enable, store_enable_disable, student_common_credentials, fee_category_fee_collection_fee_receipt, sectionwise_feeassign, fee_assign_with_invoice_entry, prev_due_validation); Fees Settings Admin Login flags; Fees Settings Parent Login flags; Notification flags; Timetable flags; Format; Email Setting |
| Source | SPEC p.13-14; legacy path `admin/school/settingsInstitution` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-213 |
| Business owner | Operations |
| Open decisions | D-ORG-4, D-CUR-1, D-PORTAL-1 |
| Acceptance tests | T-SEC-007 |
| Workflows | WF3 Centre onboarding |
| Data migration | only flags with non-default values (D-ORG-4) |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Unused flags proposed for removal after usage check |

#### FR-024.02: Format and Email Setting (part of FR-024)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Format: Certificate Type (TC), Certificate Format 1-4, Receipt Format (Gtec Format), Certificate. Email: Username, Password, Server, Port, From |
| Source | SPEC p.14; legacy path `admin/school/settingsInstitution` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-130 |
| Business owner | IT |
| Open decisions | D-COMM-1 |
| Acceptance tests | T-AUD-005 |
| Workflows | WF3 Centre onboarding |
| Data migration | SMTP secrets rotated |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-028: Academic Year / Admitted Year; Academic Year Master (sessions) (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Admitted Year: Institution Name, Admitted Year (2019-2023). Sessions: Academic Year, From Date, To Date, Sort Order; DataTable Academic Year Id, Sort Order, Session, Academic Year Status, Login Status, Active Academic Year, FromDate, ToDate, Seq.No, Action; active year also chosen in header modal |
| Source | SPEC p.11,14; legacy path `admin/admin/admittedyear_master; sessions` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | D-YEAR-3, D-MIG-7 |
| Acceptance tests | T-RPT-015, T-CAT-001, T-CAT-002, T-MS-001, T-MS-003 |
| Workflows | - |
| Data migration | IMPORTED; X9 history conflict |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-033: GROUP: Location and classification masters (second-level)

| Field | Value |
|---|---|
| Description (legacy behaviour) | - |
| Source | SPEC p.16; legacy path `quick-add pages` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Operations |
| Open decisions | D-ORG-5 |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED with normalisation |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.01: Country (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Country Code, Country Name; 255 rows |
| Source | SPEC p.16; legacy path `admin/master/Add_country` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.02: State (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Country, State Name; 73 rows |
| Source | SPEC p.16; legacy path `admin/master/Add_state` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-033.01 |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.03: District (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Country, State, District Name, Display Sort Order; 43 rows |
| Source | SPEC p.16; legacy path `admin/master/create` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-033.02 |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.04: Region (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region Name; 17 rows (X6: filters show 18) |
| Source | SPEC p.16; legacy path `admin/master/region` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Operations |
| Open decisions | D-ORG-5 |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | mapping approved (D-ORG-5) |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.05: Area (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Country, State, District, Region, Area Name; 48 rows |
| Source | SPEC p.16; legacy path `admin/master/area` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-033.04 |
| Business owner | Operations |
| Open decisions | D-ORG-5 |
| Acceptance tests | T-SEC-014 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.06: Centre Class (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Class; 15 rows (Centre Creation lists 15 values; filters say 16) |
| Source | SPEC p.16; legacy path `admin/school/institution_class` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Operations |
| Open decisions | D-CAT-1 |
| Acceptance tests | T-SEC-007, T-CAT-001, T-CAT-004, T-MS-001, T-MS-002, T-MS-003 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.11: Centre category quick-add (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Throws uncaught exception today |
| Source | SPEC p.16; legacy path `admin/school/class_category` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Operations |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | unknown |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Rebuild (PR-07) |

#### FR-034: QR Code Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | KPI Uploaded Centres, Pending Uploads; tabs All (327), Uploaded, Pending; DataTable #, Centre Code, Centre Name, QR Preview, Uploaded Date, Status; Download File; stores each centre's payment QR image |
| Source | SPEC p.6,36; legacy path `admin/Master/qr_code_master` |
| Evidence class | SRC |
| Actors / permissions | HO / centre |
| Depends on | FR-022 |
| Business owner | Operations |
| Open decisions | D-ORG-3 |
| Acceptance tests | T-SEC-007 |
| Workflows | WF3 Centre onboarding |
| Data migration | QR images migrated from /uploads/ |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-089: Centre List (institution_list) incl. Login impersonation and permission push (part of FR-022)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Country, State, District, Region, Area; DataTable Sl No, Name, Country, State, District, Region, Area, Centre Class, GST Enabled, GST No, GST Type, Login (impersonates via site/switchSchoolloginAdmin/{centreId}); Update Web Permissions / Update App Permissions push default role permissions to all centres |
| Source | SPEC p.5,35; legacy path `admin/admin/institution_list` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-022 |
| Business owner | Operations |
| Open decisions | PR-01, D-SEC-2 |
| Acceptance tests | T-SEC-013, T-AUTH-010 |
| Workflows | WF-X13 User/role/permission administration |
| Data migration | n/a |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Alias of R-022 (L-12); impersonation replaced (PR-01) |

### 8.2 Platform core: search, navigation, roles, numbering, logs

- **Requirements:** 22
- **Owners:** IT (14), Operations (3), Accounts (2), Admissions (1), Certification (1), Tech Support (1)
- **Workflows (05):** WF-X13 User/role/permission administration; WF-X14 Credential issuance / reset; WF1 Enquiry to admission; WF10 Voucher & licence; WF3 Centre onboarding; WF8 Exam lifecycle
- **Open decisions (04):** D-API-1, D-FEE-2, D-GAP-2, D-MIG-1, D-MIG-6, D-OPS-1, D-ORG-5, D-SEC-1, D-SEC-2, D-SEC-3, D-STU-4, D-YEAR-3, NP-1, NP-2, NP-3, NP-5, NP-6, NP-7, NP-8, PR-01, PR-12
- **Distinct acceptance tests (09):** 35

#### FR-000: GROUP: Platform shape (legacy)

| Field | Value |
|---|---|
| Description (legacy behaviour) | CodeIgniter monolith + 4 satellite apps (HRMS /hrms/, CRM /crm/, Purchase /pos_new/, Accounts /accounts/) sharing session; data-driven menus/roles/permissions; files under /uploads/ (QR codes, exam CSV templates, certificates) |
| Source | SPEC p.2; legacy path `-` |
| Evidence class | SRC |
| Actors / permissions | - |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-API-1 |
| Acceptance tests | T-DOC-001 |
| Workflows | - |
| Data migration | Files under /uploads/ must be inventoried and migrated with references (M0) |
| Delivery stage | 0 Discovery |

#### FR-001: Global search with scopes Course/Staff/Student/Reg No/Enq No

| Field | Value |
|---|---|
| Description (legacy behaviour) | Opens Search Student page; tabs Students List + Detailed View; columns Admission Number, Student Name, Programme, Father Name, Date Of Birth, Gender, Category, Mobile Number, Action |
| Source | SPEC p.2-3; legacy path `header search` |
| Evidence class | SRC |
| Actors / permissions | not documented (results presumably scoped by centre) |
| Depends on | FR-007, FR-150 |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-SEC-005, T-RPT-008, T-ADM-004 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-003: User menu: Change Password, Logout; last-login time; academic-year Session selector

| Field | Value |
|---|---|
| Description (legacy behaviour) | Session selector 2020-21..2025-2026; last-login shown in sidebar; Back button every page |
| Source | SPEC p.2-3; legacy path `admin/admin/changepass; site/logout` |
| Evidence class | SRC |
| Actors / permissions | all users |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-SEC-3, D-YEAR-3 |
| Acceptance tests | T-AUTH-001, T-AUTH-009 |
| Workflows | WF-X14 Credential issuance / reset |
| Data migration | Legacy password hashes (D-MIG-6) |
| Delivery stage | 1 Security POC |

#### FR-006: Shared DataTable list behaviour

| Field | Value |
|---|---|
| Description (legacy behaviour) | Search box, sorting, page size 10/25/50/100, "Records x to y of z", Copy/Excel/CSV/PDF/Print/Columns; row icons view/edit/delete (delete is GET + confirm); heavy lists rendered fully server-side (cause of crashes) |
| Source | SPEC p.10,18; legacy path `all list pages` |
| Evidence class | SRC |
| Actors / permissions | per page |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-OPS-1 |
| Acceptance tests | T-RPT-009, T-RPT-012, PERF-01 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 1 Security POC |
| Removal / scope note (UNAPPROVED) | GET-delete pattern replaced (security) |

#### FR-007: Filter cascade Region->Area->Centre and shared filters

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region 18, Area ~50, Centre 327, AY 2020-21..2025-2026, Course Category 12, Division 23, Course 1,350+, Section A, Certification 58, Exam 62, Fee Type 17, Scheme 242, dates; Select2 typeahead + multi-select |
| Source | SPEC p.2,18; legacy path `all` |
| Evidence class | SRC |
| Actors / permissions | scope-limited options |
| Depends on | FR-033 |
| Business owner | IT |
| Open decisions | D-ORG-5 |
| Acceptance tests | T-SEC-005 |
| Workflows | - |
| Data migration | X2,X5,X6 |
| Delivery stage | 1 Security POC |

#### FR-008: Masters quick-add + Refresh List

| Field | Value |
|---|---|
| Description (legacy behaviour) | Plus icon opens master page (religion, caste, AY, course category, division, certification, exam, enquiry path, enquiry type, qualification, transport mode); Refresh List reloads dropdown via JSON |
| Source | SPEC p.18; legacy path `forms` |
| Evidence class | SRC |
| Actors / permissions | master manage perm |
| Depends on | - |
| Business owner | IT |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-009: Role Permissions / Role List / Users / Permission Master / Menu Settings

| Field | Value |
|---|---|
| Description (legacy behaviour) | 43 roles (listed incl. test/unused), Role Type Normal User/Admin, Modules tree with Enable All, Disable All, Copy Permission, Update; Role List (Set Default, Edit, Cancel, View Permissions; Export Excel); Users filters Centre, User Type (Admin, Staff, Parent, Student), Role, Status; Create User (role, all-branch flag, department, employee type HOD/Dean/Principal, password); Disable/Enable; Purchase Permission; Add Department; Permission Master 854 rows / 151 modules (Id, Title, Module, Menu, Action); Menu records (Module, Navigation SideBar/TopBar/Report Menu/Menu dashboard, Parent, Title, URL, Description, Icon, Sort Order, Check Academic Year, permission title/key) |
| Source | SPEC p.2,6,36; legacy path `Permissions/rolepermissions; admin/admin/role_list; permissions/users; permissions/permissionMaster; permissions/menuSettings` |
| Evidence class | SRC |
| Actors / permissions | RBAC admin + step-up (PRO) |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-SEC-1 |
| Acceptance tests | T-SEC-007, T-AUTH-010, T-E2E-X13 |
| Workflows | WF-X13 User/role/permission administration |
| Data migration | roles/users mapped to new permission keys; legacy matrix exported (D-SEC-1) |
| Delivery stage | 1 Security POC |
| Removal / scope note (UNAPPROVED) | Test/unused roles EXCLUDED after review |

#### FR-010: HO impersonation of centre logins (part of FR-089)

| Field | Value |
|---|---|
| Description (legacy behaviour) | How HO performs centre-level actions today |
| Source | SPEC p.2,35; legacy path `site/switchSchoolloginAdmin/{centreId}` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-009 |
| Business owner | Operations |
| Open decisions | PR-01, D-SEC-2 |
| Acceptance tests | T-SEC-013 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 1 Security POC |
| Removal / scope note (UNAPPROVED) | Replaced by scoped access (PR-01, unapproved) |

#### FR-011: Scope & numbering

| Field | Value |
|---|---|
| Description (legacy behaviour) | Data belongs to Centre + Academic Year; numbers from prefix counters: admission GTEC2627+seq per year; register 2000001+ global; receipts {centreCode}/{TYPE}/{FY}/; tickets TK-26/{typecode}/{seq}; certificates G+6 digits |
| Source | SPEC p.18; legacy path `-` |
| Evidence class | SRC |
| Actors / permissions | - |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | NP-1, NP-2, NP-3, NP-5, NP-6, NP-7, NP-8 |
| Acceptance tests | T-NUM-001, T-NUM-002, T-NUM-003, T-NUM-004, T-NUM-005, T-NUM-006, T-NUM-007, T-NUM-008, T-NUM-009, T-NUM-010 |
| Workflows | WF1 Enquiry to admission |
| Data migration | Counters continue from legacy (NP-8) |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-012: GROUP: Log Report / Activity Log (15 reports; Centre, Date From/To, Search)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Replaced by one ActivityLog with filtered views |
| Source | SPEC p.6,19,36-37; legacy path `LogReport/dashboardLogReport` |
| Evidence class | SRC |
| Actors / permissions | audit read (scope) |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001, T-AUD-010 |
| Workflows | - |
| Data migration | legacy logs ARCHIVED (read-only) per D-MIG-1 |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-012.01: Login Activity Log (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Activity type General/Accounts; web logins (Sl.No, Time, User Type, User Name, Activity, Site Url, Ip Address, View); login hours (SL, Centre, Username, In-time, Out-time, Total Hours); mobile-app logins (SL, Centre, Class, Username, Brand Name, In-time) |
| Source | SPEC p.36-37; legacy path `log` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUTH-020 |
| Workflows | - |
| Data migration | ARCHIVED |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-012.02: User Login Log; Payment Login Log (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre and date range |
| Source | SPEC p.37; legacy path `LogReport/userLogList; LogReport/paymentLogList` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUTH-020 |
| Workflows | - |
| Data migration | ARCHIVED |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-012.03: User Status Log; Student Enquiry Enrollment Log (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Render blank today |
| Source | SPEC p.37; legacy path `LogReport/userStatusLogList; student/EnquiryEnrollLog` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | audit read |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-AUD-001 |
| Workflows | - |
| Data migration | ARCHIVED if data exists |
| Delivery stage | 2 Data model, numbering, audit, ticket core |
| Removal / scope note (UNAPPROVED) | Rebuild as audit views (PR-07) |

#### FR-012.04: Mark Entry Log; Student Observation Log; Student Remarks Log; Student Log (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Institution, dates, student (and subject) |
| Source | SPEC p.37; legacy path `LogReport/exam_mark_entryLogList; student_observationLogList; student_remarkLogList; studentLogList` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001 |
| Workflows | - |
| Data migration | ARCHIVED |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-013: Security observations (to redesign)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Client-side hard-coded approvals password; password prompts on fee cancel / amount change; HO impersonation of centre logins; raw SQL leaked into dashboard header |
| Source | SPEC p.19,28,44; legacy path `-` |
| Evidence class | SRC |
| Actors / permissions | - |
| Depends on | - |
| Business owner | IT |
| Open decisions | PR-01, D-FEE-2 |
| Acceptance tests | T-SEC-012, T-AUTH-015 |
| Workflows | - |
| Data migration | Rotate exposed secrets (D-SEC-6) |
| Delivery stage | 1 Security POC |
| Removal / scope note (UNAPPROVED) | Redesign, not copy |

#### FR-026: Accounts Prefix + New Prefix

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filter Prefix (format {centreCode}/{TYPE}/{financialYear}/; types ADMREC, CON, FEEREC, INV, JOU, REC, VOU); DataTable #, Prefix, Starting Number, Current Number, Type, Branch, Action; New: Company, Branch, Type (Receipt, Journal, Fee Invoice, Online Receipt, Paid Fee Import), Receipt/Voucher/Contra/Journal Type, Starting No., Prefix |
| Source | SPEC p.14; legacy path `admin/Admin/AccountsPrefix; admin/admin/add_prefix` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-011 |
| Business owner | Accounts |
| Open decisions | NP-1, NP-5, NP-6, NP-8 |
| Acceptance tests | T-NUM-006, T-NUM-009, T-NUM-010 |
| Workflows | WF3 Centre onboarding |
| Data migration | counters continued (NP-8) |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-029: G-TEC Admission No & Register No Prefix

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre Name, Class (Gtec Register No, GTEC - Admission), Prefix, Startno, Currentno; DataTable Sl No, Prefix, Class, Startno, Currentno, Action; register 2000001 (current 2064112); admission GTEC2627 (current 43887); "counters reset per academic year prefix" |
| Source | SPEC p.14-15; legacy path `admin/admin/Gcourse_prefix` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-011 |
| Business owner | Admissions |
| Open decisions | NP-2, NP-7, NP-8, D-STU-4 |
| Acceptance tests | T-NUM-007, T-NUM-010, T-PER-001, T-PER-002, T-PER-003, T-PER-004, T-PER-005 |
| Workflows | WF1 Enquiry to admission |
| Data migration | counters continued; X1 conflict |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-093: Role Permissions (General tile) (part of FR-009)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Same as R-009 |
| Source | SPEC p.6,36; legacy path `Permissions/rolepermissions` |
| Evidence class | SRC |
| Actors / permissions | RBAC admin |
| Depends on | FR-009 |
| Business owner | IT |
| Open decisions | D-SEC-1 |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | see R-009 |
| Delivery stage | 1 Security POC |
| Removal / scope note (UNAPPROVED) | Alias of R-009 (L-12) |

#### FR-119: Exam Result Log

| Field | Value |
|---|---|
| Description (legacy behaviour) | 1,941 entries; filters Centre, Exam, dates, keyword; columns #, Date & Time, Centre, Reg No/Student, Course/Exam, Action, Result, Score, Grade, Updated By |
| Source | SPEC p.7,42; legacy path `admin/admin/course_exam_log` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | FR-116 |
| Business owner | Certification |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001 |
| Workflows | WF8 Exam lifecycle |
| Data migration | ARCHIVED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.08: Voucher Log and Licence Log (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | User Name, Site Url, IP Address, Reference id, Function Name, Created Date, View Details |
| Source | SPEC p.17; legacy path `(voucher/licence module)` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | - |
| Business owner | Tech Support |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001 |
| Workflows | WF10 Voucher & licence |
| Data migration | ARCHIVED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-228: Login Details table + Resend Username and Password + credential modal (part of FR-023)

| Field | Value |
|---|---|
| Description (legacy behaviour) | DataTable Centre Name, Email, Phone, Account Number, Class Type, Code, Category, Centre, Gst Enable, Status toggle, Action view/edit; Resend credentials button |
| Source | SPEC p.13; legacy path `admin/school/create (below form)` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-023 |
| Business owner | IT |
| Open decisions | PR-12, D-MIG-6 |
| Acceptance tests | T-AUTH-008, T-AUTH-012 |
| Workflows | WF-X14 Credential issuance / reset; WF3 Centre onboarding |
| Data migration | credentials NOT migrated in plaintext |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Replace emailing of passwords with reset link (PR-12) |

#### FR-229: Search Student Detailed View tab (part of FR-001)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Tab "Detailed View" (content not described) |
| Source | SPEC p.2; legacy path `header search` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | not documented |
| Depends on | FR-001 |
| Business owner | Operations |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-SEC-005, T-ADM-004 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

### 8.3 Course catalogue

- **Requirements:** 11
- **Owners:** Academics (9), Certification (1), Tech Support (1)
- **Workflows (05):** WF10 Voucher & licence; WF15 Attendance, syllabus, placement; WF2 Catalogue & availability
- **Open decisions (04):** D-CAT-1, D-CAT-2, D-CAT-3
- **Distinct acceptance tests (09):** 19

#### FR-033.07: Course Category (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | 11 active (filters say 12) |
| Source | SPEC p.16; legacy path `admin/Master/sch_class_cat` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-SEC-007, T-CAT-001, T-CAT-004, T-MS-001, T-MS-003 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.08: Course Division (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | 22 rows (filters/admission say 23; X5) |
| Source | SPEC p.16; legacy path `admin/Master/sch_class_div` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-SEC-007, T-CAT-001, T-CAT-004, T-MS-001, T-MS-003 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-033.09: Curriculum (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Empty |
| Source | SPEC p.16; legacy path `Accreditation/curriculum_master` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | - |
| Workflows | - |
| Data migration | none |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Empty today; usage unchecked |

#### FR-090: G-TEC Courses (course master)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre Name, Course Name, Display Name, Exam Minimum Days, Course Code, Category (req; 12), Division (req; 23), Mandatory Certification (multi, 58), Optional Certification (multi), Duration Type (Month, Week, Day, Not Applicable) + months/weeks/days/hours and computed summary, Capacity, Duration, Fees split type, Promotion Sort Order, Department (req), Curriculum, Gtech Default Status, Mandatory Exam (req, multi; 59), Optional Exam, Centre Class (req, multi; 16), flags Course Visibility, IT MAGIC, KELTRON + Keltron Share, NO REG FEE, INTERNSHIP KELTRON, SELECTED COURSE, Materials Required, Marklist Required; fee rows per Fee Type (Course Fee, Voucher Rate, Academic Kit, Welcome Kit, Exam Fee, Exam Processing Fee); Course Duration Settings; quick-adds; DataTable S No., Course Id, Name, Display Name, Code, Section, Duration, Division, Category, Certifications, Optional Certifications, Exam Minimum Days, Centre Class, Action |
| Source | SPEC p.6,34-35; legacy path `classes` |
| Evidence class | SRC |
| Actors / permissions | HO Academics |
| Depends on | FR-092, FR-111, FR-033 |
| Business owner | Academics |
| Open decisions | D-CAT-1, D-CAT-2, D-CAT-3 |
| Acceptance tests | T-E2E-002, T-CAT-001, T-CAT-002, T-CAT-003, T-CAT-004, T-CM-001, T-CM-002, T-CM-004, T-CM-005, T-CC-002, T-CC-004 |
| Workflows | WF2 Catalogue & availability |
| Data migration | IMPORTED; 1,220 codes, 196 multi-name (DQR); "-delete" courses EXCLUDED/ARCHIVED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-090.01: Special Case - Assign Centre (part of FR-090)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Assign special-case courses to Region/Area/Centre Classes |
| Source | SPEC p.35; legacy path `classes/centre_course_assign` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-090 |
| Business owner | Academics |
| Open decisions | D-CAT-1 |
| Acceptance tests | T-E2E-002, T-CC-003, T-CC-004 |
| Workflows | WF2 Catalogue & availability |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-090.02: Course List (GTEC) (part of FR-090)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filter Category, Certification, Exam, Division; shows mandatory/optional exams and fees; edit via classes/edit_ho/{id}; Final Exam Mapping button |
| Source | SPEC p.35; legacy path `classes/CourseList_GTEC` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-114 |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-RPT-008 |
| Workflows | WF2 Catalogue & availability |
| Data migration | n/a |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-091: Centre Course Assign; Course Centre Class Assign

| Field | Value |
|---|---|
| Description (legacy behaviour) | class_assign crashes (renders every course for every centre). center_class_assign: Centre, Course Category, Country/State/District/Region/Area cascade, Centre Class; Courses table with multi-select Centre Class chips, select-all, Update, Log List |
| Source | SPEC p.6,35; legacy path `classes/class_assign; classes/center_class_assign` |
| Evidence class | SRC (center_class_assign); REC (class_assign) (needs centre-side or manager verification) |
| Actors / permissions | HO Academics |
| Depends on | FR-090, FR-033.06 |
| Business owner | Academics |
| Open decisions | D-CAT-1 |
| Acceptance tests | T-E2E-002, T-CM-002, T-CM-003, T-CM-006 |
| Workflows | WF2 Catalogue & availability |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | class_assign rebuilt (PR-07) |

#### FR-092: Certification master

| Field | Value |
|---|---|
| Description (legacy behaviour) | Name, Type (req; Voucher, Licence), Short Code, Description; 57 bodies (X4: filters say 58) |
| Source | SPEC p.35; legacy path `admin/Master/certification_master` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Certification |
| Open decisions | - |
| Acceptance tests | T-SEC-007, T-CC-001, T-CC-004 |
| Workflows | WF2 Catalogue & availability |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-140.10: Certification Type master (sub-types) (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Sub-types of a certification body (e.g. Microsoft Access Expert under MOS); 29 rows |
| Source | SPEC p.17,43; legacy path `admin/master/CertificationType` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-092 |
| Business owner | Tech Support |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | WF10 Voucher & licence |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-152.01: Subjects / modules master (part of FR-152)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre Name, Subject Name (req), Subject Code (req), Programme multi-select; DataTable ID, Subject, Subject Code, Action; 376 rows |
| Source | SPEC p.31; legacy path `admin/subject` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-090 |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-156: Syllabus (search, Add Module, Create Syllabus)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Search: Centre, Course (req), Subject; table SL No, Module, Topics, Duration, Total. Add Module: Centre (req), Module Name (req), Display Order (req); DataTable No., Module Name, Syllabus Count, Display Order, Status, Action. Create Syllabus: Institution, Programme, Subject, Module (req) |
| Source | SPEC p.9,32; legacy path `Syllabus/searchModule_syllabus; Questionbank/quest_modules; Syllabus/quest_syllabus_new` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-152.01 |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

### 8.4 Enquiries and CRM

- **Requirements:** 5
- **Owners:** Admissions (2), Admissions/PRO (2), Marketing (1)
- **Workflows (05):** WF-X1 BDO activity planning; WF-X16 Front office & call log; WF-X4 CRM lead pipeline; WF1 Enquiry to admission
- **Open decisions (04):** D-ADM-1, D-ADM-4, D-GAP-1, D-GAP-2, PR-02
- **Distinct acceptance tests (09):** 14

#### FR-080: Set Up Front Office (4 masters)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Tabs Purpose, Complaint Type, Source, Reference; each Name (req), Description; DataTable Name, Description, Action |
| Source | SPEC p.5,33; legacy path `admin/visitorspurpose; admin/complainttype; admin/source; admin/reference` |
| Evidence class | SRC |
| Actors / permissions | centre / HO |
| Depends on | - |
| Business owner | Admissions |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-SEC-007 |
| Workflows | WF-X16 Front office & call log |
| Data migration | IMPORTED if used |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | usage unchecked |

#### FR-081: Enquiry Form + Enquiry list + Enroll Student

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Student Name, Address, Pincode, Contact No, Mobile/WhatsApp, DOB (req), Enquiry Path (req; 16 values; quick-add), Academic Qualification (18), Last Studied School, Date, Gender (req), Enquiry Type (req; Walk In, Online, Website, TeleCaller, Phone Enquiry, Other Ref, Direct call + telecaller names), Instagram ID, Parent/Guardian, Remark; preference rows (Division, Category, Course req) showing Course, Scheme, Scheme Rule, Total, Disc %, Disc Amt, Net, Mandatory/Optional Certificates, Batch, Join/End Date, Mode of Learning, Course Status, With/Without Installment; list filters Date From/To, Enrollment Status (All, Enrolled, Not Enrolled), contact search; DataTable Enquiry No, Name, Course Info, DOB, Gender, Contact, Source, Action; Enroll Student modal converts to admission |
| Source | SPEC p.5,33; legacy path `student/enqForm_gtec; student/enroll_directenq_student` |
| Evidence class | SRC |
| Actors / permissions | centre counsellor |
| Depends on | FR-150, FR-085 |
| Business owner | Admissions/PRO |
| Open decisions | D-ADM-1, D-ADM-4 |
| Acceptance tests | T-E2E-001, T-ENQ-001, T-ENQ-002, T-ENQ-004, T-ENQ-005 |
| Workflows | WF-X4 CRM lead pipeline; WF1 Enquiry to admission |
| Data migration | enquiries IMPORTED; merged with CRM leads per D-ADM-1 |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-084: Phone Call Log

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre (req), Name, Phone (req), Date, Description, Next Follow Up Date, Call Duration, Note, Call Type (req; Incoming, Outgoing), Tele Caller Name; DataTable Name, Phone, Date, Next Follow Up Date, Call Type, Action |
| Source | SPEC p.5,34; legacy path `admin/generalcall` |
| Evidence class | SRC |
| Actors / permissions | centre |
| Depends on | FR-085 |
| Business owner | Admissions |
| Open decisions | D-ADM-1 |
| Acceptance tests | T-SEC-002, T-ENQ-002, T-CL-001, T-CL-002, T-CL-003 |
| Workflows | WF-X16 Front office & call log |
| Data migration | IMPORTED if used |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-085: CRM sub-app (Leads, Calendar, Status master, lead form)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Leads filters AY, Assigned (148 logins), Status (Affordability, Converted, Enrolled...), Source (Collegedunia, Mcube, parent referral, Internet), Lost/Junk/Public/Contacted Today/Created Today, Application Type (Online, Walk-in), geography, Pincode, Institution, Courses, Last Contact; Bulk Change Status/Lead Source/Last Contact; Export; ~34,120 leads; lead form (candidate, parent, DOB, address, mobiles, landline, email, course completed, institution, course interested, Mode of Enquiry, contact person, counsellor, enquiry date, address, reminder date/note, business segment, sub-segment, customer category); Status master (Name, Color, Order); Calendar month/week/day |
| Source | SPEC p.3,54; legacy path `crm/admin/leads; crm/admin/utilities/calendar` |
| Evidence class | SRC (list); REC (lead detail: Access denied) (needs centre-side or manager verification) |
| Actors / permissions | CRM users (148) |
| Depends on | FR-081 |
| Business owner | Admissions/PRO |
| Open decisions | D-ADM-1, PR-02 |
| Acceptance tests | T-E2E-X04, T-ENQ-002, T-ENQ-003, T-ENQ-005, T-ENQ-006 |
| Workflows | WF-X4 CRM lead pipeline; WF1 Enquiry to admission |
| Data migration | leads MERGED with enquiries per D-ADM-1 |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-098: BDO Activity (master + plan)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Master Name, Sort Order; Plan Centre, Date, Activity, Remarks, Details; filter User and dates; columns Sl No, User, Activity, Details, Plan Date, Remarks, Action |
| Source | SPEC p.8,46; legacy path `admin/admin/bdo_activity` |
| Evidence class | SRC |
| Actors / permissions | BDO users / HO |
| Depends on | FR-022 |
| Business owner | Marketing |
| Open decisions | D-GAP-1 |
| Acceptance tests | T-E2E-X01 |
| Workflows | WF-X1 BDO activity planning |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

### 8.5 Student records and admission

- **Requirements:** 8
- **Owners:** Admissions/PRO (6), PRO (1), Academics (1)
- **Workflows (05):** WF-X15 Bulk imports; WF-X2 ID card generation; WF1 Enquiry to admission; WF7 Student data & course change
- **Open decisions (04):** D-ADM-1, D-ADM-2, D-ADM-3, D-ADM-4, D-FEE-4, D-SCH-2, D-SEC-4, D-SEC-5, D-STU-1, D-STU-2, D-STU-3, D-STU-4
- **Distinct acceptance tests (09):** 28

#### FR-095: Student correction tickets (FNC, LNC, MNC, GPC, FPC, SMS, GDR, EMC, GNC, NC), CSC, CC

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre states old/new value + proof; HO approves; record rewritten by the system; until ADR-002, proof-less correction types may go live (correction-tickets DD-19: temporary deviation, PRO to confirm) |
| Source | SPEC p.37; WF 13-14; legacy path `tickets` |
| Evidence class | SRC |
| Actors / permissions | centre raise / PRO approve |
| Depends on | FR-094 |
| Business owner | PRO |
| Open decisions | D-STU-1, D-STU-2, D-STU-3 |
| Acceptance tests | T-E2E-007, T-TKT-011, T-PER-005, T-COR-001, T-COR-002, T-COR-003, T-COR-004, T-COR-005, T-COR-006 |
| Workflows | WF7 Student data & course change |
| Data migration | n/a |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-150: Admission form (student/create)

| Field | Value |
|---|---|
| Description (legacy behaviour) | 3 tabs (Student Details, Additional Information, Documents Upload), single SAVE, "Missing Fields" panel; multi-course enrolment; Name/intake: First Name (req), Last Name, Academic Year (req, quick-add), G-TEC Course (req, admission class), Centre Name, Admission No (auto from Gcourse prefix), Admission Date (req, default today) |
| Source | SPEC p.9,30-31; legacy path `student/create` |
| Evidence class | SRC (HO view); centre behaviour REC (needs centre-side or manager verification) |
| Actors / permissions | centre admin (PRO: students.admission.create) |
| Depends on | FR-029, FR-090, FR-053, FR-059 |
| Business owner | Admissions/PRO |
| Open decisions | D-ADM-1, D-ADM-2, D-ADM-3, D-ADM-4, D-STU-4 |
| Acceptance tests | T-E2E-001, T-NUM-001, T-SEC-002, T-PER-001, T-PER-002, T-PER-004, T-ADM-001, T-ADM-002, T-ADM-003, T-ADM-005, T-ADM-006 |
| Workflows | WF1 Enquiry to admission |
| Data migration | persons + admissions IMPORTED/MERGED/SPLIT (C-03) |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-150.01: Admission course grid (part of FR-150)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Repeatable rows (Add More Course / Select All): Fee Assign checkbox, Division (23 values listed), Category (12 listed), Course (~1,200, "(name) code"), Scheme (req), Scheme Rule, Total Amt, Discount %, manual discount %, Discount Amt, Batch, Join Date, End Date, Course Mode (Normal Mode), Course Status (Active, Drop, Leave, Transfer); Installment type With/Without |
| Source | SPEC p.30; legacy path `student/create` |
| Evidence class | SRC |
| Actors / permissions | centre admin |
| Depends on | FR-053, FR-054, FR-059, FR-155 |
| Business owner | Admissions/PRO |
| Open decisions | D-SCH-2, D-FEE-4, D-STU-4 |
| Acceptance tests | T-E2E-001, T-FEE-002 |
| Workflows | WF1 Enquiry to admission |
| Data migration | registrations SPLIT from XLS rows; IMPORTED from MySQL |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-150.02: Admission personal/parent/address sections (part of FR-150)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Employment Status (req), Pincode (req), Remarks, Academic Qualification (req, list), Course Specialization, Course Category, Sub Course Category, Gender (Male, Female, Other), Contact No, DOB, Age, Nationality (253), Blood Group, Mobile, SMS Mobile 1/2, Current Address, Current Place; Guardian Occupation, Father Name/Occupation, Mother Name/Phone/Occupation; Permanent Address with same-as-current |
| Source | SPEC p.30; legacy path `student/create` |
| Evidence class | SRC |
| Actors / permissions | centre admin |
| Depends on | - |
| Business owner | Admissions/PRO |
| Open decisions | D-SEC-4 |
| Acceptance tests | T-AUD-005, T-LD-001, T-LD-002, T-LD-003, T-LD-004 |
| Workflows | WF1 Enquiry to admission |
| Data migration | IMPORTED with normalisation |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-150.04: Admission previous marks (part of FR-150)

| Field | Value |
|---|---|
| Description (legacy behaviour) | SSLC, Plus Two, Degree: Year of Passing, Mark %, Institution, Class/Division; plus Graduation |
| Source | SPEC p.31; legacy path `student/create` |
| Evidence class | SRC |
| Actors / permissions | centre admin |
| Depends on | - |
| Business owner | Admissions/PRO |
| Open decisions | - |
| Acceptance tests | T-E2E-001 |
| Workflows | WF1 Enquiry to admission |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-150.05: Additional Information tab (part of FR-150)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Aadhaar No, Email, Religion (quick-add), Caste (quick-add), Differently Abled, Last Studied School/College, State (36), District (612), Qualification Status (Passed/Failed); Guardian: If Guardian Is (Father/Mother/Other), Name, Relation, Phone, Address |
| Source | SPEC p.31; legacy path `student/create` |
| Evidence class | SRC |
| Actors / permissions | centre admin |
| Depends on | FR-020.03, FR-020.04 |
| Business owner | Admissions/PRO |
| Open decisions | D-SEC-4 |
| Acceptance tests | T-AUD-005 |
| Workflows | WF1 Enquiry to admission |
| Data migration | Aadhaar masked/encrypted per D-SEC-4 |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-150.06: Documents Upload tab (part of FR-150)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Student photo + five titled document slots (title + file) with Remove |
| Source | SPEC p.31; legacy path `student/create` |
| Evidence class | SRC |
| Actors / permissions | centre admin |
| Depends on | - |
| Business owner | Admissions/PRO |
| Open decisions | D-SEC-5 |
| Acceptance tests | T-SEC-007 |
| Workflows | WF1 Enquiry to admission |
| Data migration | legacy /uploads/ files migrated with references |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-218: Student Photo Upload (single / bulk zip) (part of FR-087)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Course, Section, Admission Year; Upload Picture or Bulk Image Upload (zip) |
| Source | SPEC p.34; legacy path `admin/Generateidcard/updateStudentDetails` |
| Evidence class | SRC |
| Actors / permissions | centre |
| Depends on | FR-150.06 |
| Business owner | Academics |
| Open decisions | D-SEC-5 |
| Acceptance tests | T-IMP-001 |
| Workflows | WF-X15 Bulk imports; WF-X2 ID card generation |
| Data migration | photos migrated from /uploads/ |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

### 8.6 Academics: batches, attendance, syllabus, placement

- **Requirements:** 17
- **Owners:** Academics (14), Placement (2), Accounts (1)
- **Workflows (05):** WF-X17 Feedback / appraisal; WF-X19 Batch / class / semester assignment; WF-X2 ID card generation; WF14 Year closing & promotion; WF15 Attendance, syllabus, placement
- **Open decisions (04):** D-ACA-1, D-ACA-2, D-ACA-3, D-GAP-1, D-GAP-2, D-HR-2, D-YEAR-1, D-YEAR-2, PR-09
- **Distinct acceptance tests (09):** 11

#### FR-020.01: Semester / Section (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Form Centre Name, Section/Division Name, Capacity, Sort Order; shortcut links Create Class, Add Sem Start & End Date, Update Student Sem Start & End Date; list S No, Section Id, Section/Division, Capacity, Sort_Order, Action (edit) |
| Source | SPEC p.11; legacy path `sections` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Academics |
| Open decisions | D-YEAR-1 |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | migrate if used |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | School-ERP origin; usage unchecked |

#### FR-021: GROUP: Assign dashboard

| Field | Value |
|---|---|
| Description (legacy behaviour) | 3 pages |
| Source | SPEC p.9,12; legacy path `admin/master/assign_dashboard` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | - |
| Workflows | WF-X19 Batch / class / semester assignment |
| Data migration | - |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-021.01: Assign/Change Class (Branch/Batch assign) (part of FR-021)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Criteria Centre Name, Batch (course dropdown), Academic Year (req), Section (req, All); Search lists students; Save assigns to chosen class |
| Source | SPEC p.12; legacy path `student/AssignClass` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | FR-150 |
| Business owner | Academics |
| Open decisions | D-YEAR-1 |
| Acceptance tests | T-SEC-002 |
| Workflows | - |
| Data migration | migrate assignments |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-021.02: Assign Section (Semester assign) (part of FR-021)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Criteria Centre Name, Batch, Section (All, A), Academic Year (req); Search then Save |
| Source | SPEC p.12; legacy path `student/AssignSection` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | FR-020.01 |
| Business owner | Academics |
| Open decisions | D-YEAR-1 |
| Acceptance tests | T-SEC-002 |
| Workflows | - |
| Data migration | migrate if used |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | usage unchecked |

#### FR-021.03: Class Sort Order (part of FR-021)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre then Search; DataTable Sl, Batch List, Sort Order checkbox + number per row (~1,400 batches, 100/page); Submit saves order used for promotion |
| Source | SPEC p.12; legacy path `classes/classSortOrder` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-161 |
| Business owner | Academics |
| Open decisions | D-YEAR-1 |
| Acceptance tests | - |
| Workflows | WF14 Year closing & promotion |
| Data migration | only if promotion kept |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |
| Removal / scope note (UNAPPROVED) | Tied to PR-09 |

#### FR-087: ID Card: templates + generation

| Field | Value |
|---|---|
| Description (legacy behaviour) | Template per centre: Background Image, two-sided with Back Side Image, Logo, Signature, Centre Name text, Address/Phone/Email, ID Card Title, Header Color, field toggles (student: admission no, name, class, father, mother, address, phone, DOB, blood group; staff: employee id, name, phone, DOB, address, email, blood group); preview. Generate Student: Centre (req), Batch/course (req), Section, template, Year of Study. Generate Staff: Centre, Designation (req), template |
| Source | SPEC p.5,34; legacy path `admin/studentidcard; admin/studentidcard/staffId; admin/generateidcard; admin/generateidcard/search_teachers_details` |
| Evidence class | SRC |
| Actors / permissions | centre / HO |
| Depends on | FR-150, FR-182 |
| Business owner | Academics |
| Open decisions | D-GAP-1 |
| Acceptance tests | T-E2E-X02 |
| Workflows | WF-X2 ID card generation |
| Data migration | templates IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-088: G-TEC Feedback / Appraisal

| Field | Value |
|---|---|
| Description (legacy behaviour) | Questions per centre; Feedback Type (Centre, Criteria Type, Short Code); Feedback Category (Centre, Category Name); Infrastructure Feedback Report (Centre, Programme, Semester; Sl No, Centre, Student, Class, Semester, Action); Self Appraisal Report (Centre, Teacher); Consolidated Report (Centre, Report Type, Programme, Semester, Subject, Department, Teacher) |
| Source | SPEC p.5,34; legacy path `admin/admin/teacher_appraisal; criteria_type_master; feedback_category; infrastructure_appraisal_report; teacher_selfappraisal_list; teacher_appraisal_consolidated` |
| Evidence class | SRC |
| Actors / permissions | centre / HO |
| Depends on | FR-182 |
| Business owner | Academics |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-E2E-X17 |
| Workflows | WF-X17 Feedback / appraisal; WF15 Attendance, syllabus, placement |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | usage unchecked |

#### FR-102: Placement require updation

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Course then Search; mark Placement Required Yes/No; columns #, Student, Admission No, Reg No, Placement Status; Update, Reports |
| Source | SPEC p.8,42; legacy path `admin/admin/placement_require_updation` |
| Evidence class | SRC |
| Actors / permissions | centre / HO |
| Depends on | FR-154 |
| Business owner | Placement |
| Open decisions | D-ACA-3 |
| Acceptance tests | T-E2E-015 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | IMPORTED |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-151.01: Faculty - Course List (part of FR-151)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Faculty Wise Print, Department Wise Print |
| Source | SPEC p.17; legacy path `Student/TeacherWiseClasses` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-152 |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-RPT-008 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-152: GROUP: Attendance dashboard (4 tiles, side panels)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Master, Assign, Attendance Marking, Reports |
| Source | SPEC p.9,31-32; legacy path `evaluation/dashboard_collegeattendance` |
| Evidence class | SRC |
| Actors / permissions | centre |
| Depends on | FR-182 |
| Business owner | Academics |
| Open decisions | D-ACA-1, D-ACA-2 |
| Acceptance tests | T-E2E-015 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | - |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-152.02: Faculty Assign (part of FR-152)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Criteria Centre, Course Division (req), Course Category (req), Course, Module (req), Day (Mon-Sat multi), Fixed Hour, Batch (req); sub-forms Assign Module, Fixed Hour, Batch Updation (Search, Add, Update) |
| Source | SPEC p.31; legacy path `admin/teacher/assignteacher` |
| Evidence class | SRC |
| Actors / permissions | centre |
| Depends on | FR-182, FR-155 |
| Business owner | Academics |
| Open decisions | D-HR-2 |
| Acceptance tests | T-SEC-002 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-152.03: Attendance Marking (part of FR-152)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Course, Batch (+ shortcut Create Course Batch), Attendance Date, Subject, Attendance Type (Full Day); Search then mark |
| Source | SPEC p.31; legacy path `admin/stuattendence/index_new` |
| Evidence class | SRC |
| Actors / permissions | centre / faculty |
| Depends on | FR-155 |
| Business owner | Academics |
| Open decisions | D-ACA-1, D-ACA-2 |
| Acceptance tests | T-E2E-015 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-153: Academic Calendar (+ FY Closing / Cancel Previous Year Closing modals)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Month grid + events table (S. No, Date, Description); FY Closing and Cancel Previous Year Closing modals (FY dropdown + confirmation password) |
| Source | SPEC p.9,32; legacy path `admin/master/show_eventcalendar` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts + step-up |
| Depends on | FR-027 |
| Business owner | Accounts |
| Open decisions | D-YEAR-2 |
| Acceptance tests | T-E2E-014, T-AUTH-015 |
| Workflows | WF14 Year closing & promotion |
| Data migration | events IMPORTED if used |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |
| Removal / scope note (UNAPPROVED) | Password prompt replaced by step-up |

#### FR-154: Placement List

| Field | Value |
|---|---|
| Description (legacy behaviour) | Department, Programme then Search; DataTable Sl, Student, University Reg No, Batch, Mobile No., Placement Company, Company address, Salary Details, Placement Status, Action |
| Source | SPEC p.9,32; legacy path `placement/placement_list` |
| Evidence class | SRC |
| Actors / permissions | centre / HO |
| Depends on | FR-102 |
| Business owner | Placement |
| Open decisions | D-ACA-3 |
| Acceptance tests | T-E2E-015 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | IMPORTED |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-155: Create Course Batch; Timeslot Updation (part of FR-152)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Batch: Centre, Batch Name, Batch Code, Time Slot, Maximum Number, Custom Batch; DataTable Sl.No, Batch Name, Batch Code, Time Slot, Action. Timeslot: Centre, Course Name, Batch, Custom Time Slot then Search; table #, Student Name, Admission No, Reg No, Batch Name, Time Slot; Update, Reports |
| Source | SPEC p.31-32; legacy path `admin/admin/course_batch_master; admin/admin/gtech_batchUpdation` |
| Evidence class | SRC |
| Actors / permissions | centre |
| Depends on | - |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-SEC-002, T-CB-001, T-CB-002, T-CB-003 |
| Workflows | WF-X19 Batch / class / semester assignment |
| Data migration | IMPORTED |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |

#### FR-161: Student Promotion / Depromotion; College Promotion; College Depromotion Single

| Field | Value |
|---|---|
| Description (legacy behaviour) | Promotion: Centre, Programme, Section; Promote/Depromote modals; link Class Sort Order. Depromotion: Centre, From, To AY; per-course table (~1,375 courses); Set Depromotion Sort Order, Set New Academic Year. Single: Centre, Admission No (req) |
| Source | SPEC p.4,54; legacy path `admin/stdtransfer; studentDePromotion; transferCollege; Depromote_single` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-021.03, FR-027 |
| Business owner | Academics |
| Open decisions | D-YEAR-1, PR-09 |
| Acceptance tests | T-E2E-014 |
| Workflows | WF14 Year closing & promotion |
| Data migration | history ARCHIVED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |
| Removal / scope note (UNAPPROVED) | Proposed removal (PR-09); usage unchecked |

#### FR-220: Add Sem Start & End Date; Update Student Sem Start & End Date (part of FR-020.01)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Linked from Semester page; fields not described |
| Source | SPEC p.11; legacy path `admin/stuattendence/Semester_date; admin/stuattendence/Student_Sem_Date_Updation` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | not documented |
| Depends on | FR-020.01 |
| Business owner | Academics |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | unknown |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Pending decision |

### 8.7 Fees, schemes and concessions

- **Requirements:** 20
- **Owners:** Accounts (19), Marketing/Accounts (1)
- **Workflows (05):** WF-X15 Bulk imports; WF-X5 Receipt transfer; WF14 Year closing & promotion; WF2 Catalogue & availability; WF4 Fee setup & collection; WF5 Schemes & concessions
- **Open decisions (04):** D-CAT-3, D-FEE-1, D-FEE-2, D-FEE-4, D-FEE-5, D-FEE-6, D-FIN-1, D-FIN-2, D-FIN-3, D-FIN-4, D-FIN-7, D-MIG-1, D-ROY-2, D-SCH-1, D-SCH-2, D-SCH-3, D-STU-2, D-YEAR-2, NP-6, PR-03, PR-08
- **Distinct acceptance tests (09):** 28

#### FR-012.07: Student Concession Log (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | S.No, Student Name, Admission No, Course, Fee Type, Fee Amount, Concession Details (Scheme ID, Rule ID), Action By, Date |
| Source | SPEC p.37; legacy path `LogReport/studentConcessionLogList` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | FR-053 |
| Business owner | Accounts |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001 |
| Workflows | - |
| Data migration | ARCHIVED; used for K7 concession totals |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-050: Fee Category

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Fee Category Name, Listing Order; 12 categories (ADMISSION FEE, COURSE FEE, Academic Kit, Exam Fee, EXAM PROCESSING FEE, Material Cost, Misc Fee, MSU Certification Fee, RE-EXAM PROCESSING FEE, RE-EXAMINATION FEE, Term Fee I, Voucher Fee) |
| Source | SPEC p.4,47; legacy path `admin/Jvfeescategory` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-FEE-001, T-FS-001 |
| Workflows | WF4 Fee setup & collection |
| Data migration | IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-051: Fee Type Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Fees Category, flags (misc, royalty, course fee, down payment, add admission fee, excluding GST), misc kind (Voucher Cost, Academic Kit Cost, Exam Fee, Welcome Kit Cost, Exam Processing Fee, Re-Exam Fee, Re-Exam Processing Fee), Fee Type Category (General, Admission), Name, Previous Year Fee, Fee Order, Fee Particular (REGISTRATION, DOWN PAYMENT, COURSE FEE, MATERIALS, MISCELLANEOUS), Payment Mode (Yearly), Term 1-4 amounts, 12 month checkboxes, Assign Type (Misc, Class), Fee Amount, Due Date, HSN Code, Short Code; fee types in order (REGISTRATION FEE HSN 999293 ... WELCOME KIT COST HSN 899294, Online Fee, Additional Registration Fee, misc) |
| Source | SPEC p.4,47; legacy path `admin/Jvfees` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts |
| Depends on | FR-050, FR-042 |
| Business owner | Accounts |
| Open decisions | D-ROY-2, D-FIN-4 |
| Acceptance tests | T-FEE-003, T-FS-001 |
| Workflows | WF4 Fee setup & collection |
| Data migration | IMPORTED; mapped to accounts (R-042) |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-052: Fine Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | Fine Master Name, Fine Type (Fixed, Per Day Increment, Per Day After Days, Weekly Increment, Monthly...), Fees Type, From Day, To Day, Amount; empty today |
| Source | SPEC p.4,48; legacy path `admin/Jvfees/Finemaster` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts |
| Depends on | FR-051 |
| Business owner | Accounts |
| Open decisions | D-FEE-6, PR-08 |
| Acceptance tests | - |
| Workflows | WF4 Fee setup & collection |
| Data migration | none (empty) |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Proposed removal (PR-08); usage = empty per SPEC |

#### FR-053: Scheme Master (Scheme Type Master)

| Field | Value |
|---|---|
| Description (legacy behaviour) | DataTable Id, Scheme, Valid From/To, Nature, Area, Live, Default Live, Action; 242 schemes; Add: Centre, Name, Valid From/To (req), Live toggle, Nature (Normal, Constant Percentage, Constant Amount, Variable Percentage, Variable Amount); Applicability (Category/Division or Region/Area/Centres, Targeted Courses with Select All; Geographical Area Wise Country/State/District/Region/Area or Centre Wise) |
| Source | SPEC p.4,48; legacy path `admin/jvfees/ConcessionMaster; ConcessionMaster_new` |
| Evidence class | SRC |
| Actors / permissions | HO Marketing/Accounts |
| Depends on | FR-090 |
| Business owner | Marketing/Accounts |
| Open decisions | D-SCH-1, D-SCH-2, D-SCH-3 |
| Acceptance tests | T-E2E-005 |
| Workflows | WF4 Fee setup & collection; WF5 Schemes & concessions |
| Data migration | IMPORTED; test schemes EXCLUDED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-054: Scheme Rule Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, AY, Scheme; rows Fees Type, Amount Type, Amount/Percentage; list Fee Type, Scheme, Amount/% |
| Source | SPEC p.4,48; legacy path `Student/Concession_master` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-053 |
| Business owner | Accounts |
| Open decisions | D-SCH-2 |
| Acceptance tests | T-E2E-005 |
| Workflows | WF4 Fee setup & collection; WF5 Schemes & concessions |
| Data migration | IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-055: Student Fee Remarks

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, AY, Batch & Section, Student, Remarks |
| Source | SPEC p.4,48; legacy path `admin/jvfees/FeeRemarks` |
| Evidence class | SRC |
| Actors / permissions | centre |
| Depends on | FR-150 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-AUD-001 |
| Workflows | WF4 Fee setup & collection |
| Data migration | IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-057: Fee Caption Master (Fee Type Year)

| Field | Value |
|---|---|
| Description (legacy behaviour) | AY (req), Name (req), Due Date (req), Sort Order (req), Down Payment checkbox; 13 captions (e.g. INSTALLMENT 1 due 30-11-2025) |
| Source | SPEC p.4,48; legacy path `admin/master/FeeTypeYearMaster` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-FEE-002, T-FS-001, T-FS-002 |
| Workflows | WF4 Fee setup & collection |
| Data migration | IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-058: Miscellaneous Fee Centre Assign

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centres (multi), Fee Types (multi); Assigned Centres grid with fee-type multi-select per centre |
| Source | SPEC p.4,48; legacy path `admin/Admin/assignMiscellaneousFeeCentre` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-051 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-FEE-001 |
| Workflows | WF4 Fee setup & collection |
| Data migration | IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-059: Regular Fee Assign (+ Beta by Centre Class)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, AY (req), Batch (course), Section, Category, Sub Category, Fee Type; schedule layouts Term 1-4 / Monthly May-Apr / Yearly + Optional Fee, Excluded from consolidated, Bank Account; Beta keyed by Centre Class + multi centres |
| Source | SPEC p.4,48-49; legacy path `admin/jvfees/assign_regular; assign_regular_gems` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts |
| Depends on | FR-057, FR-033.06 |
| Business owner | Accounts |
| Open decisions | D-CAT-3, PR-03 |
| Acceptance tests | T-FEE-001, T-XM-05, T-FS-002, T-FS-003, T-FD-001, T-FD-002, T-FD-003 |
| Workflows | WF2 Catalogue & availability; WF4 Fee setup & collection |
| Data migration | structures IMPORTED per AY |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Merge normal+Beta (PR-03) |

#### FR-060: Scheme Assign - Beta; Scheme Edit

| Field | Value |
|---|---|
| Description (legacy behaviour) | Assign: Centre, AY, Course, Admission No, Concession Type; grid + Update Scheme; Scheme Amount link. Edit: Centre, AY, Course, Category, Scheme, Admission No; grid Student, Adm No, Course, Fee Type, Fee Amount, Scheme Amount, Due Date, Scheme (editable) |
| Source | SPEC p.4,49; legacy path `student/StudentScheme; Student/ConcessionEdit` |
| Evidence class | SRC |
| Actors / permissions | Accounts + ticket (PMC) |
| Depends on | FR-053 |
| Business owner | Accounts |
| Open decisions | D-SCH-2, D-FEE-2 |
| Acceptance tests | T-E2E-005, T-AUD-001 |
| Workflows | WF4 Fee setup & collection; WF5 Schemes & concessions |
| Data migration | concession applications IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-061: Miscellaneous Fee Assign; Other Fee Assignment

| Field | Value |
|---|---|
| Description (legacy behaviour) | Misc: Centre, AY, Batch, Section, Admitted Year, Payment Mode (Monthly, Yearly, Termly), Quota, Category, Student Type (In, Out), Gender; 3 rows Fee Type, Amount, Due Date; student tick list. Other: Centre, AY, Batch, Out-student; rows Category, Type, Amount |
| Source | SPEC p.4,49; legacy path `Student/fee_assign; admin/jvfees/assign_other` |
| Evidence class | SRC |
| Actors / permissions | centre / Accounts |
| Depends on | FR-051 |
| Business owner | Accounts |
| Open decisions | D-FEE-1 |
| Acceptance tests | T-FEE-001 |
| Workflows | WF4 Fee setup & collection |
| Data migration | dues IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Quota/Student Type are school-ERP fields: usage unchecked |

#### FR-062: Fee Import; Fee Import Update; Paid Fee Import

| Field | Value |
|---|---|
| Description (legacy behaviour) | Import: Centre, Class & Section, CSV + sample; shortcuts Fee Year Name, Semester Name Update (admin/jvfees/semester_add_caption), Fee Master, Courses. Update: Centre, Batch & Section, AY, Fee Type. Paid: Centre + CSV of historic paid receipts |
| Source | SPEC p.4,49; legacy path `student/feeimport; student/Student_importupdate; Student/paidfeeimport` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-051 |
| Business owner | Accounts |
| Open decisions | D-FIN-7 |
| Acceptance tests | T-IMP-001 |
| Workflows | WF-X15 Bulk imports; WF4 Fee setup & collection |
| Data migration | imports under C-03 rules |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-063: Student Balance Due Posting = Fee Due Posting (+ Posted List)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, AY, From Date, Due Date, Class (multi), Section (multi), Fee Type, Group By (All Fees, Individual except Previous & Deposit, Previous Only, Deposit Only, Group); posts last year's balances as dues in new year |
| Source | SPEC p.4,49; legacy path `Student/duePosting; Student/dueposting; Student/duePosted_list` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-027 |
| Business owner | Accounts |
| Open decisions | D-YEAR-2 |
| Acceptance tests | T-E2E-014 |
| Workflows | WF14 Year closing & promotion; WF4 Fee setup & collection |
| Data migration | carried-over dues reconciled K7 |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |
| Removal / scope note (UNAPPROVED) | Duplicate pages merged (PR-03) |

#### FR-064: Collect Fee (Student Fee Payment) + receipt screen

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Batch & Section; DataTable Student, Admission No, Class, Payment; receipt screen NOT seen (expected: fee heads due/paid, amount, mode, bank, reference, FEEREC number, print) |
| Source | SPEC p.4,49; legacy path `Student/Student_feePayment` |
| Evidence class | SRC (list); REC (receipt screen) (needs centre-side or manager verification) |
| Actors / permissions | centre cashier |
| Depends on | FR-051, FR-026 |
| Business owner | Accounts |
| Open decisions | D-FEE-4, D-FIN-1, D-FIN-2, NP-6 |
| Acceptance tests | T-FEE-001, T-FEE-002, T-FEE-003, T-FEE-007, T-FEE-008, T-FEE-009, T-FEE-010, T-FEE-027, T-FR-001, T-FR-002, T-FR-003, T-FR-004 |
| Workflows | WF4 Fee setup & collection |
| Data migration | receipts IMPORTED per FY (K7) |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-065: Fee Cancel (Cancel, Multiple Revert, Submit)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centre (req), Division, Course & Section, From/To, keyword, Listing Type (Fee Collection List, Cancelled Fees List); each action has remarks modal + access password |
| Source | SPEC p.4,49; legacy path `student/feesDetails` |
| Evidence class | SRC |
| Actors / permissions | Accounts + ticket RCT (PMC) |
| Depends on | FR-064, FR-094 |
| Business owner | Accounts |
| Open decisions | D-FEE-2, D-FIN-3 |
| Acceptance tests | T-FEE-012, T-FEE-013 |
| Workflows | WF4 Fee setup & collection |
| Data migration | cancelled receipts IMPORTED with reversal links |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Shared password replaced |

#### FR-066: Fee Amount Change (Student Fee Updation)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, AY, Batch, Fee Type, new Amount; grid Student, Adm No, Batch, Fee Type, Amount; Submit asks password |
| Source | SPEC p.4,50; legacy path `Student/Fee_change` |
| Evidence class | SRC |
| Actors / permissions | Accounts + ticket (PMC) |
| Depends on | FR-061 |
| Business owner | Accounts |
| Open decisions | D-FEE-2 |
| Acceptance tests | T-AUD-001, T-AUTH-015 |
| Workflows | WF4 Fee setup & collection |
| Data migration | n/a |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Shared password replaced |

#### FR-067: Fee Hold/Unhold (+ report)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, AY, Course, Hold List / Unhold List; report: Fees Type, Report Type (All, Hold, UnHold) |
| Source | SPEC p.4,50; legacy path `Student/FeesHold; Jvstudent/feeHoldreport` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-061 |
| Business owner | Accounts |
| Open decisions | D-FEE-5 |
| Acceptance tests | T-FEE-011 |
| Workflows | WF4 Fee setup & collection |
| Data migration | hold flags IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-073: G-TEC Fee Particulars

| Field | Value |
|---|---|
| Description (legacy behaviour) | Caption, HSN Code, Receipt Type (AdmissionType, Misc, Registration; categories admin/admin/receipt_type_categories); 5 rows |
| Source | SPEC p.5,53; legacy path `admin/admin/Gtecfee_particulars` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts |
| Depends on | FR-030 |
| Business owner | Accounts |
| Open decisions | NP-6 |
| Acceptance tests | T-FEE-003, T-FS-001 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-076: Receipt Transfer (Fee Transfer List / New Fee Transfer)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Institution, Status (Active Only, Cancelled Only), keyword; moves a paid receipt from one student to another; table #, Date & Time, Source Student, Target Student, Fee Details, Transferred Amount, Status, Action; bulk Cancel Selected |
| Source | SPEC p.6,35-36; legacy path `Studentfeetransfer/transfer_list; Studentfeetransfer/search` |
| Evidence class | SRC |
| Actors / permissions | Accounts + ticket (PRO) |
| Depends on | FR-064, FR-094 |
| Business owner | Accounts |
| Open decisions | D-FEE-2, D-STU-2 |
| Acceptance tests | T-FEE-014 |
| Workflows | WF-X5 Receipt transfer; WF4 Fee setup & collection |
| Data migration | transfers IMPORTED with links (K7) |
| Delivery stage | 4 Fees, receipts, payments, accounting |

### 8.8 Payments and gateways

- **Requirements:** 3
- **Owners:** Accounts (3)
- **Workflows (05):** WF-X20 Gateway configuration; WF-X6 Online payment recheck & settlement; WF3 Centre onboarding; WF4 Fee setup & collection
- **Open decisions (04):** D-FEE-3, D-FIN-9, D-SEC-6
- **Distinct acceptance tests (09):** 10

#### FR-024.01: Payment Gateway config (add, list, edit) (part of FR-024)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Company, Class, Vendor Code, Salt, Payment For, Gateway type (world_line, traknpay, bill_desk), Merchant Id, Access Code, Encryption Code, Response/Payment/Status/Refund/Cancel/Return Url, Card type (Debit Card, Others), Bank Account No |
| Source | SPEC p.14; legacy path `admin/school/settingsInstitution` |
| Evidence class | SRC |
| Actors / permissions | HO + step-up (PRO) |
| Depends on | FR-068 |
| Business owner | Accounts |
| Open decisions | D-FEE-3, D-SEC-6 |
| Acceptance tests | T-AUTH-015, T-AUD-005 |
| Workflows | WF-X20 Gateway configuration; WF3 Centre onboarding |
| Data migration | secrets re-entered/rotated, never migrated in plaintext (D-SEC-6) |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-068: Online Payment Recheck & Settlement; A/C Posted Details

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Batch, Fee Type (Current AY Fee, Online Application Fee, Advance Payment During Admission, Next AY Application Fee, Next AY Advance Fee, Stationery), Date From/To, Status (Failed, Generated, Processed, Success), Settlement Date, MID, Payment Type |
| Source | SPEC p.4,50; legacy path `Student/onlinePaymentDetails; Student/OnlinePaymentPostedList` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-024.01 |
| Business owner | Accounts |
| Open decisions | D-FEE-3, D-FIN-9 |
| Acceptance tests | T-FEE-018, T-FEE-019, T-FEE-020, T-FEE-021, T-FEE-022, T-FEE-023, T-FEE-024 |
| Workflows | WF-X6 Online payment recheck & settlement; WF4 Fee setup & collection |
| Data migration | attempts IMPORTED; unmatched -> exceptions |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-077: Payment modes (16)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Cash, Bank, Cheque, DD, NEFT, UPI, Campus Wallet, Card, Online, VAS, Agent, Adjustment Entry Ledger, BBPS, Offline... |
| Source | SPEC p.25,51; legacy path `-` |
| Evidence class | SRC |
| Actors / permissions | - |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | D-FEE-3 |
| Acceptance tests | T-FEE-001 |
| Workflows | WF4 Fee setup & collection |
| Data migration | mode map approved |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Unused modes removal after usage check |

### 8.9 Accounting

- **Requirements:** 40
- **Owners:** Accounts (40)
- **Workflows (05):** WF14 Year closing & promotion
- **Open decisions (04):** D-CUR-1, D-FEE-2, D-FIN-1, D-FIN-3, D-FIN-4, D-FIN-6, D-MIG-2, D-MIG-3, D-YEAR-1, D-YEAR-2, D-YEAR-3, NP-1, NP-6, PR-02
- **Distinct acceptance tests (09):** 10

#### FR-027: Academic & Financial Year management (closing checklist)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Financial Years (No, Start, End, Status); Create FY (Title, Start, End); checklist 1 Create AY, 2 Arrange classes by promotion order, 3 Set last class, 4 Student Promotion, 5 Previous Year Due Posting; Closing Steps (No, Settings, Finished Date, Status); New AY activation: Set Accounts Prefix, Copy Prefix; "Processing, do not close the browser" modal |
| Source | SPEC p.14; legacy path `admin/admin/financial_year_management` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts + step-up (PRO) |
| Depends on | FR-063, FR-161, FR-026 |
| Business owner | Accounts |
| Open decisions | D-YEAR-1, D-YEAR-2, D-YEAR-3 |
| Acceptance tests | T-E2E-014 |
| Workflows | WF14 Year closing & promotion |
| Data migration | period status per FY (K8) |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |
| Removal / scope note (UNAPPROVED) | Promotion steps depend on PR-09 |

#### FR-030: Accounts Prefix Type / Receipt Type Add

| Field | Value |
|---|---|
| Description (legacy behaviour) | Company, Branch (386 centres), Receipt Type (req), Receipt Type Category (Other, Registration Type, Fee Receipt Type); list Sl no, Receipt Type, Category, Action, Add Receipt; View Receipts link |
| Source | SPEC p.15; legacy path `accounts/Reciept_masters/add_Reciept_type` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-043 |
| Business owner | Accounts |
| Open decisions | NP-6 |
| Acceptance tests | T-NUM-006 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-032: GST Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | GST Per, CGST Per, SGST Per, IGST Per (all req); one row 18/9/9/18 |
| Source | SPEC p.15; legacy path `admin/admin/Gst_master` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | D-FIN-4, D-CUR-1 |
| Acceptance tests | T-FEE-003, T-FEE-004, T-FEE-005 |
| Workflows | - |
| Data migration | effective-dated import |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-035: Add Bank (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filter Company, Branch, Bank Name; form Company, Branch, Bank Name, Bank Code, Branch of Bank, Current/Savings/Fixed Deposit, Account Number, Account Type (Asset, Liability), Opening Balance, Opening Balance Type (Debit, Credit), IFSC Code, Online Payment (checkbox); list #, Bank Name, Branch of Bank, Company, Branch, Account No., IFSC Code, Edit |
| Source | SPEC p.11; legacy path `admin/Admin/AccountsBank; admin/Admin/add_bank` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | D-FIN-1, D-MIG-2 |
| Acceptance tests | T-FEE-001 |
| Workflows | - |
| Data migration | Opening balances per FY (K7,K8) |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-040: GROUP: Accounts sub-application

| Field | Value |
|---|---|
| Description (legacy behaviour) | Separate app; own FY selector (2023-24, 2026-2027); A/c Reports menu; notification list; double-entry ledger behind fee receipts; every fee type maps to an account head; receipts post with GST split |
| Source | SPEC p.15; legacy path `accounts/Dashboard` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | D-FIN-1, PR-02 |
| Acceptance tests | T-FEE-001 |
| Workflows | - |
| Data migration | journals per FY (K7,K8) |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Merged into single app (PR-02) |

#### FR-041: Add Prefix (accounting documents) (part of FR-040)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Prefixes Receipt, Voucher, Contra, Journal per branch and FY; list #, Prefix, Starting Number, Current Number, Type, Branch, Action |
| Source | SPEC p.15; legacy path `accounts/General_masters/prefix; add_prefix` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-026 |
| Business owner | Accounts |
| Open decisions | NP-1, NP-6 |
| Acceptance tests | T-NUM-006 |
| Workflows | - |
| Data migration | counters continued |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-042: Chart of accounts (Account List) (part of FR-040)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Company, Ledger Group, Branch, Account Title, Department, Active/Cancelled; columns #, Account Title, Trial Balance Display, Account Head Code, Account Code, Ledger Group, Department, Account Color; 31 heads (income, receivable, CGST/SGST/IGST and receivables, Excess Fee, Excess Misc Fee, Fee_Transfer, Bank Charges, Purchase) |
| Source | SPEC p.15; legacy path `accounts/General_masters/label` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | D-FIN-1 |
| Acceptance tests | T-FEE-001 |
| Workflows | - |
| Data migration | IMPORTED; mapping approved by Accounts |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-043: Receipt List (accounts) (part of FR-040)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Company, Branch, Ledger, Receipt No, Receipt Type, From/To, Account tags, Department, With Adjustment Entries, active/deleted; columns SlNo, Receipt No, Department, Cash, Bank, Receipt Date, Ledger, Account Head, Paid by, Narration, Payment Mode, Action; New Receipt; Print; cancellation needs remarks + password |
| Source | SPEC p.16; legacy path `accounts/Accounts_masters/receipt` |
| Evidence class | SRC |
| Actors / permissions | Accounts + step-up |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | D-FIN-3, D-FEE-2 |
| Acceptance tests | T-FEE-012, T-FEE-013 |
| Workflows | - |
| Data migration | receipts per FY (K7) |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Password prompt replaced (PR-01/D-FEE-2) |

#### FR-044: GROUP: A/c Reports (SPEC says 32; 31 names listed, see X16) (part of FR-040)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Each filtered by Company, Branch, date range, account tags; Print and Excel |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | SRC |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | D-FIN-1 |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | parity K8/K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.01: Day Book (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns Transaction Date, Reference No., Ledger Name, Debit, Credit, Narration |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | SRC |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.02: Day Book Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-044.01 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Possible duplicate of Day Book |

#### FR-044.03: Cash Book Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.04: Bank Book Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.05: Cashbook Detail Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.06: Daily Receipt & Payment (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.07: Receipt Register (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-043 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.08: Ledger Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.09: Cheque Register (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-077 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.10: Caution Deposit Register (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | D-FIN-6 |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.11: Reconciliation Statement (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-035 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.12: Outstanding Collection Cheque (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-077 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.13: Issued Cheques Outstanding (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-077 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.14: Pay In Slip (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-077 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.15: Student Opening Balance (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-063 |
| Business owner | Accounts |
| Open decisions | D-YEAR-2 |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K7 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.16: Ledger Opening Balance (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | D-MIG-2 |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K8 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.17: Account Head Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.18: Account Head Detail Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.19: Fee Collection Statement (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.20: Receipt And Payment Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.21: Income and Expenditure (plain, Ledger Group wise, Account Head wise, Ledger wise, Department wise) (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | 5 variants |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | D-FIN-1 |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K8 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.22: Trial Balance (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K8 nets to zero |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.23: Accumulated Fund Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K8 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.24: Balance Sheet (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Blank for Super Admin |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | D-FIN-1 |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K8 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.25: Fee Collection Summary (accounts) (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |
| Removal / scope note (UNAPPROVED) | Possible duplicate of R-071.05 |

#### FR-044.26: Invalid Bank Transactions (credit/debit difference check) (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Evidence the legacy ledger can be unbalanced |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | SRC |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | D-MIG-3 |
| Acceptance tests | T-FEE-028 |
| Workflows | - |
| Data migration | legacy imbalances reported, never auto-balanced (K8) |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.27: Account Head Wise Fee Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.28: Accounts Head - Ledger Wise Report (single and multiple) (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.29: Previous Due Head - Ledger Wise Report (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-063 |
| Business owner | Accounts |
| Open decisions | D-YEAR-2 |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K7 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.30: Consolidated Fee Collection (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 4 Fees, receipts, payments, accounting |

#### FR-044.31: Financial Year Updation (part of FR-044)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Listed among reports; behaviour unknown |
| Source | SPEC p.16; legacy path `accounts/Accounts/reports_all` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | Accounts |
| Depends on | FR-027 |
| Business owner | Accounts |
| Open decisions | D-YEAR-2 |
| Acceptance tests | T-E2E-014 |
| Workflows | - |
| Data migration | unknown |
| Delivery stage | 4 Fees, receipts, payments, accounting |

### 8.10 Royalty and clearance

- **Requirements:** 3
- **Owners:** Accounts (3)
- **Workflows (05):** WF13 Royalty & clearance
- **Open decisions (04):** D-ROY-1, D-ROY-2, D-ROY-3
- **Distinct acceptance tests (09):** 2

#### FR-031: Royalty Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | Percentage, Deduction Amount; one row 20.00% |
| Source | SPEC p.15; legacy path `admin/admin/Grotality_master` |
| Evidence class | SRC |
| Actors / permissions | HO Accounts |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | D-ROY-1 |
| Acceptance tests | T-ROY-001 |
| Workflows | WF13 Royalty & clearance |
| Data migration | effective-dated import |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-072: Royalty Fee Collection

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centre (req), Month; DataTable Sl No, Centre, Code, Old Collection, New Collection, Total, Royalty Amount, Tax Amount, Total Amount, Payment Status; royalty = Royalty Master % (20%) of franchise collection plus GST |
| Source | SPEC p.5,53; legacy path `FeeCollection/royality_fee_collection_report` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-031, FR-064 |
| Business owner | Accounts |
| Open decisions | D-ROY-1, D-ROY-2 |
| Acceptance tests | T-E2E-013 |
| Workflows | WF13 Royalty & clearance |
| Data migration | royalty history IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-145: Clearance Certificates: Royalty Payment Approval List; Clearance Requests List

| Field | Value |
|---|---|
| Description (legacy behaviour) | Royalty: Centre, dates, Status All/Pending/Approved; columns Sl No, Date, Centre, Month/Year, Amount, Mode, Transaction No, Remarks, Status, Action; Approve Selected, Print. Clearance: dates; columns #, Date, Centre, Month/Year, Approval Stage, Description, Status, Action |
| Source | SPEC p.9,46; legacy path `Clearance/royalty_payment_approval_list; Clearance/clearance_request_list` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-072, FR-130 |
| Business owner | Accounts |
| Open decisions | D-ROY-1, D-ROY-2, D-ROY-3 |
| Acceptance tests | T-E2E-013 |
| Workflows | WF13 Royalty & clearance |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

### 8.11 Tickets and approvals

- **Requirements:** 13
- **Owners:** Operations/PRO (4), Operations (3), Accounts (3), PRO (1), Certification (1), Admissions (1)
- **Workflows (05):** WF-X10 Internship exam + certificate; WF-X11 WE exam registration; WF-X4 CRM lead pipeline; WF-X7 Course mode change; WF-X8 Exam date / special exam requests; WF-X9 Absent / rejected re-exam; WF10 Voucher & licence; WF11 Material kits; WF6 Ticket engine; WF7 Student data & course change; WF8 Exam lifecycle
- **Open decisions (04):** D-FEE-3, D-GAP-2, D-STO-1, D-STU-2, D-STU-3, D-SUP-1, D-TKT-1, D-TKT-2, D-TKT-3, D-TKT-4, NP-1, NP-8, PR-01
- **Distinct acceptance tests (09):** 25

#### FR-033.10: Level (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Level Name, Level No; Levels 1-4 used by ticket approval flows |
| Source | SPEC p.16; legacy path `admin/Level` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-094 |
| Business owner | Operations |
| Open decisions | D-TKT-1 |
| Acceptance tests | T-TKT-004 |
| Workflows | - |
| Data migration | IMPORTED |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-094: GROUP: Tickets (generic request-and-approval engine)

| Field | Value |
|---|---|
| Description (legacy behaviour) | - |
| Source | SPEC p.6,37-38; legacy path `admin/admin/Centre_ticket_dashboard` |
| Evidence class | SRC |
| Actors / permissions | see children |
| Depends on | FR-033.10 |
| Business owner | Operations/PRO |
| Open decisions | D-TKT-1, D-TKT-2, D-TKT-3, D-TKT-4 |
| Acceptance tests | T-TKT-001 |
| Workflows | WF6 Ticket engine |
| Data migration | tickets + actions IMPORTED |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-094.01: Ticket Type (part of FR-094)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Name (req), Inbuilt or Custom Type Code, Type Code (req), Main Category, Sub Category, Document Upload (Mandatory, Optional), Approval Type (User Based, Role Based), Priority (High, Medium, Low), Levels 1-4 each with approver Employee or Role + viewer/collaborator users or roles; 31 types (FNC, LNC, MNC, GPC, FPC, SMS, GDR, EMC, GNC, CSC, CC, EPA, EBPA, GN, NC, CMC, CA, VPA, CCCR, IERA, ICR, MPA, VRA, RSEDR, AERA, RSEDRC, WEERA, RCT and others) |
| Source | SPEC p.37-38; legacy path `admin/Admin/Centre_type_ticket` |
| Evidence class | SRC |
| Actors / permissions | HO admin |
| Depends on | FR-033.10 |
| Business owner | Operations/PRO |
| Open decisions | D-TKT-1 |
| Acceptance tests | T-TKT-004, T-TKT-017 |
| Workflows | WF6 Ticket engine |
| Data migration | types + levels IMPORTED as configured |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-094.02: Ticket Main/Sub Category, Ticket Prefix, Exam Request Ticket Type Certification Mapping (part of FR-094)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Main Category (Student); Sub Category per main; Prefix (Centre, TK-26, start, current 23,652); cert mapping to RSEDR or RSEDRC |
| Source | SPEC p.38; legacy path `admin/Admin/Centre_sub_type_ticket; Centre_sub_category_ticket; ticket_prefix; ticket_type_certification_mapping` |
| Evidence class | SRC |
| Actors / permissions | HO admin |
| Depends on | FR-011 |
| Business owner | Operations |
| Open decisions | NP-1, NP-8 |
| Acceptance tests | T-TKT-002, T-NUM-010 |
| Workflows | WF6 Ticket engine |
| Data migration | counter continued (X8) |
| Delivery stage | 2 Data model, numbering, audit, ticket core |

#### FR-094.03: Centre Tickets (Ticket Management) (part of FR-094)

| Field | Value |
|---|---|
| Description (legacy behaviour) | KPIs Total 16,542, Approved 14,011, Pending 2,412, Rejected 119, Forwarded 2; filters Region, Area, Centre, keyword, Status, Priority (Critical, High, Medium, Low), Type; New Ticket; Approved/Not Approved List; exports; IDs {prefix}/{typecode}/{seq} e.g. TK-26/CMC/23642; columns Ticket Id, Title, Remarks (from/to), Document, Student, Region, Area, Centre, Priority, Status, Created Date, Actions |
| Source | SPEC p.38; legacy path `admin/Admin/list_tickets` |
| Evidence class | SRC |
| Actors / permissions | centre raise / HO view |
| Depends on | FR-094.01 |
| Business owner | Operations/PRO |
| Open decisions | D-TKT-2, D-STO-1 |
| Acceptance tests | T-TKT-001, T-TKT-003, T-TKT-019, T-TKT-020, T-TM-001, T-TM-002, T-TM-003 |
| Workflows | WF6 Ticket engine |
| Data migration | 2,412 pending at cutover need a treatment (C-03) |
| Delivery stage | 5 Ticket workflows |
| Removal / scope note (UNAPPROVED) | Priority list differs (4 vs 3 values): record |

#### FR-094.04: Tickets Approval List (incl. Course Change approval modal) (part of FR-094)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Ticket Type, From/To, status radio; bulk Remarks, Select All; Approve, Reject, Forward (pick employee), View; Course Change modal: From Course Info, Target Course & Schedule (Scheme req, Scheme Rule req, Join Date req, calculated End Date), Confirm & Save Approved Change; columns SL No, Centre, Ticket No, Type, Registration No, Course Code, Date of joining, Date of Completion, Current Level, Description, Document, Priority, Created date, Created By, Action |
| Source | SPEC p.38; legacy path `admin/Admin/center_ticket_list` |
| Evidence class | SRC |
| Actors / permissions | level approvers |
| Depends on | FR-094.01 |
| Business owner | Operations/PRO |
| Open decisions | D-TKT-1, D-TKT-4, D-STU-2 |
| Acceptance tests | T-TKT-005, T-TKT-006, T-TKT-007, T-TKT-018, T-TKT-021, T-TKT-022, T-AW-002, T-AW-003 |
| Workflows | WF6 Ticket engine; WF7 Student data & course change |
| Data migration | n/a |
| Delivery stage | 5 Ticket workflows |

#### FR-096: Course Mode Approval

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, From/To (req), Approval Status (All, Pending, Approved, Rejected), Mode Changing To (Fast Track, Super Fast Track, Normal); columns Sl No, Request Date, Admission No, Reg No, Student, Course, From Mode, To Mode, Centre, Requested By, Remarks, Status, Action; Approve (remarks req), Reject (reason req); 1,680 requests |
| Source | SPEC p.8,46; legacy path `admin/admin/course_mode_stud_approval` |
| Evidence class | SRC |
| Actors / permissions | PRO |
| Depends on | FR-094 |
| Business owner | PRO |
| Open decisions | D-STU-3 |
| Acceptance tests | T-TKT-017 |
| Workflows | WF-X7 Course mode change; WF7 Student data & course change |
| Data migration | requests IMPORTED |
| Delivery stage | 5 Ticket workflows |

#### FR-118: Exam approval queues (EPA, EBPA, IERA, AERA, rejected re-exam, WEERA, RSEDR/RSEDRC, Special Exam Request)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Shared ticket screen (Centre, From/To, Not Approved/Approved/Rejected, bulk Remarks, Select All, Approve, Reject, Cancel, Forward; Ticket Details, Student List, Payment Transaction modals); per-queue columns as SPEC p42 |
| Source | SPEC p.7-8,42; legacy path `admin/admin/exam_ticket_list; exam_bulk_payment_approval; internship_exam_registration_approval; absent_exam_ticket_list; rejected_exam_ticket_list; we_exam_registration_approval; exam_date_request_approval; spExam_request_approval` |
| Evidence class | SRC |
| Actors / permissions | Certification/Accounts approvers |
| Depends on | FR-094, FR-116 |
| Business owner | Certification |
| Open decisions | D-TKT-1 |
| Acceptance tests | T-TKT-017, T-E2E-X08, T-E2E-X09, T-E2E-X10, T-E2E-X11 |
| Workflows | WF-X10 Internship exam + certificate; WF-X11 WE exam registration; WF-X8 Exam date / special exam requests; WF-X9 Absent / rejected re-exam; WF8 Exam lifecycle |
| Data migration | pending tickets treatment |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.06: Voucher Payment Approval ticket (VPA) (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns #, Centre, Certification, Voucher Type, Quantity, Amount, Payment Date, Current Level, Action |
| Source | SPEC p.8,43; legacy path `admin/admin/voucher_payment_approval; Voucher/payment_approval_request` |
| Evidence class | SRC |
| Actors / permissions | Accounts approvers |
| Depends on | FR-094 |
| Business owner | Accounts |
| Open decisions | D-SUP-1 |
| Acceptance tests | T-TKT-017 |
| Workflows | WF10 Voucher & licence |
| Data migration | pending treatment |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-142.05: Material Payment Approval ticket (MPA) (part of FR-142)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Standard ticket queue |
| Source | SPEC p.8; legacy path `admin/admin/material_payment_approval` |
| Evidence class | SRC |
| Actors / permissions | Accounts approvers |
| Depends on | FR-094 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-TKT-017 |
| Workflows | WF11 Material kits |
| Data migration | pending treatment |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-144: Fund Transfer / Exam Approvals dashboard (10 queues); Registration Approval dashboard (3 queues); Approvals tile (4 queues, hard-coded password)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Live queue header, KPI tiles (Total, Pending review, Approved, Rejected), category search/chips, one card per queue with counts, Review queue + History |
| Source | SPEC p.8,44-45; legacy path `admin/Master/fund_transfer_dashboard; registration_approval_dashboard; admin/Master/approvals_dashboard` |
| Evidence class | SRC |
| Actors / permissions | approvers in scope |
| Depends on | FR-094 |
| Business owner | Operations |
| Open decisions | PR-01 |
| Acceptance tests | T-TKT-003, T-SEC-012, T-AW-001, T-AW-002 |
| Workflows | WF6 Ticket engine |
| Data migration | n/a |
| Delivery stage | 5 Ticket workflows |
| Removal / scope note (UNAPPROVED) | Hard-coded password removed (PR-01) |

#### FR-214: CRM Open Ticket (part of FR-085)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Fields not described |
| Source | SPEC p.54; legacy path `crm/admin/tickets/add` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | CRM users |
| Depends on | FR-094 |
| Business owner | Admissions |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | WF-X4 CRM lead pipeline |
| Data migration | unknown |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Purpose unknown |

#### FR-223: Exam Payment Approval (Approvals tile) (part of FR-144)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, dates, Not Approved/Approved; columns Sl No, Centre, Date, Transaction No, Payment Mode, Paid Amount, Certification, Exam, Schedule Date, Payment Status, Action; Approve Payment, Payment Details, Student List modals |
| Source | SPEC p.45; legacy path `admin/Exam_payment/Exam_payment/Exam_payment_approval` |
| Evidence class | SRC |
| Actors / permissions | Accounts approvers |
| Depends on | FR-094, FR-116 |
| Business owner | Accounts |
| Open decisions | D-FEE-3 |
| Acceptance tests | T-TKT-017 |
| Workflows | - |
| Data migration | pending treatment |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

### 8.12 Examinations

- **Requirements:** 12
- **Owners:** Certification (12)
- **Workflows (05):** WF-X12 Faculty exam registration; WF-X15 Bulk imports; WF2 Catalogue & availability; WF8 Exam lifecycle
- **Open decisions (04):** D-EXM-1, D-EXM-2, D-EXM-3, D-GAP-2
- **Distinct acceptance tests (09):** 7

#### FR-110: Exam workflow guides (Semester 7 steps; IAB 5 steps)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Semester: 1 Sub-exam Mapping, 2 SEM exam to certification mapping, 3 tick Semester Enabled on course, 4 Modules/Semesters via Faculty Assign, 5 centre registration (previous sub-exam result must be published; select fee, pay, submit), 6 approval after payment (exam_ticket_list generates exam/hall tickets), 7 result upload/import. IAB: sub-exam mapping, module configuration, IAB registration from centre, approval, result import |
| Source | SPEC p.7,40; legacy path `Exam/SemesterExamWorkflow; Exam/IABExamWorkflow` |
| Evidence class | SRC |
| Actors / permissions | all |
| Depends on | FR-114, FR-120 |
| Business owner | Certification |
| Open decisions | D-EXM-2 |
| Acceptance tests | T-E2E-008 |
| Workflows | WF8 Exam lifecycle |
| Data migration | n/a |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-111: Exam Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Exam Name, flags International Certification, Re-Exam Fee Applicable, Faculty License Number; Heading, Duration, Instruction; Course (multi), Course Certification; Main/Sub (sub picks parent); Centre Specific Rate; Exam Fee (req), Processing Fee (req), Exam Date, Subject (multi, 379 modules), Display Order (req); weekday schedule + patterns (All Saturdays, Second, Alternate, Alternate Second, Repeat Days) + Other Dates; DataTable incl. Sub Exams n button; 61 exams (X4) |
| Source | SPEC p.7,40; legacy path `admin/Jvfees/exam` |
| Evidence class | SRC |
| Actors / permissions | HO Certification |
| Depends on | FR-092 |
| Business owner | Certification |
| Open decisions | D-EXM-1 |
| Acceptance tests | T-E2E-008 |
| Workflows | WF8 Exam lifecycle |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-112: Exam Centre Rate; Re-Exam Centre Rate; Exam Rate List; Exam Duration

| Field | Value |
|---|---|
| Description (legacy behaviour) | Rates per centre: Exam, Certification, Type (Student, Centre), Exam Fee, Processing Fee, Max Exam Fee; Re-exam fees; Rate List by Centre, Class; Duration: Certification, Exam, Duration in Days (due period to register) |
| Source | SPEC p.7,40-41; legacy path `admin/admin/centre_exam_rate; centre_reExam_rate; admin/Jvfees/CourseExamRateList; admin/admin/Gtec_examduration` |
| Evidence class | SRC |
| Actors / permissions | HO Certification |
| Depends on | FR-111 |
| Business owner | Certification |
| Open decisions | D-EXM-1 |
| Acceptance tests | T-E2E-008 |
| Workflows | WF8 Exam lifecycle |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-113: Exam Schedule

| Field | Value |
|---|---|
| Description (legacy behaviour) | Certification (req), Exam (req); rows Registration From/To, Notification From/To, Schedule Date, Payment Date (all req), Applicable Centres (multi), Enable/Disable; drive Home notices |
| Source | SPEC p.7,41; legacy path `Examschedule` |
| Evidence class | SRC |
| Actors / permissions | HO Certification |
| Depends on | FR-111 |
| Business owner | Certification |
| Open decisions | - |
| Acceptance tests | T-E2E-008, T-NTF-003 |
| Workflows | WF8 Exam lifecycle |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-114: Exam mapping: Sub Exam Mapping, Exam Certification Mapping, Course Final Exam Mapping, Registration Form Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | Sub Exam: Centre, Main Exam; rows Course, Sub Exam, Sort Order. Cert mapping: Centre, Exam, Certifications multi. Final Exam: filter Category, Division; 121 master courses with Select Final Main Exam; Bulk Map; mapping log. Form Master: Form Name (1-10), Vendor (multi; 24 vendors), Course Certification, Exam, Exam Flow checkboxes 1-Schedule 2-Registration 3-Payment Approval 4-Result Upload, Registration Type (Exam, Voucher, Both), CSV templates, Registration Period days, Doc Type |
| Source | SPEC p.7,41; legacy path `Exam/CourseSubExamMapping; Exam/ExamCertMapping; Classes/CourseMainExamMapping; admin/Jvfees/certification_exam_form` |
| Evidence class | SRC |
| Actors / permissions | HO Certification |
| Depends on | FR-111, FR-090 |
| Business owner | Certification |
| Open decisions | D-EXM-1 |
| Acceptance tests | T-E2E-008, T-E2E-X02 |
| Workflows | WF2 Catalogue & availability; WF8 Exam lifecycle |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-115: Centre-side Semester/IAB exam registration + hall ticket print

| Field | Value |
|---|---|
| Description (legacy behaviour) | Not inspected from Super Admin login |
| Source | SPEC p.29,40; legacy path `Exam/SemesterStudentExamRegistration; Exam/IABStudentExamRegistration` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | centre |
| Depends on | FR-113, FR-120 |
| Business owner | Certification |
| Open decisions | D-EXM-1, D-EXM-2 |
| Acceptance tests | T-E2E-008 |
| Workflows | WF8 Exam lifecycle |
| Data migration | registrations IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-116: Student Exam Registration List; Student Exam Results; Exam Result Update; Exam Result Import

| Field | Value |
|---|---|
| Description (legacy behaviour) | Lists: Centre, AY, Certification, Exam, Exam Date/period. Update: Region, Area, Centre, Certification (req), Exam (req), Exam Date, result Date, Result (Pass, Fail, Absent, Need Improvement); grid Centre, Student, Reg No, Course, Mark, Grade, Certificate No, Remarks, Result, Date; Save, Export. Import: Centre, Certification, Exam (req), With/Without Grade, file; sample files |
| Source | SPEC p.7,41; legacy path `Student/StudentExamRegistrationReport; Student/StudentExamMarkList; admin/Admin/Gcourse_exam; admin/admin/exam_result_import` |
| Evidence class | SRC |
| Actors / permissions | HO Certification |
| Depends on | FR-115 |
| Business owner | Certification |
| Open decisions | D-EXM-3 |
| Acceptance tests | T-E2E-008, T-IMP-001 |
| Workflows | WF-X15 Bulk imports; WF8 Exam lifecycle |
| Data migration | results IMPORTED (K6 to registrations) |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-117: Student Registration Update; Registration List Report; Payment Details; Complete Registration; G-TEC Examination Report; Internship & WE lists

| Field | Value |
|---|---|
| Description (legacy behaviour) | Update: Centre, Certification, Exam, Exam Date (142 dates), Remarks; Success/Reject. List: Region, Area, Centre, Certification, Exam (req), date/range, Normal/With IDs, Excel with Module Details, Module Marks. Others: Region, Area, Centre, Certification, Exam, Type Scheduled/Registered, dates |
| Source | SPEC p.7,42; legacy path `admin/admin/mark_student_registration; Student/registeredStudentsDetails; Exam_payment report; CompleteStudentExamRegistrationReport; examScheduledStudentsReport; Exam/registeredStudentsDetails_internship; Exam/registeredStudentsDetails_we` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-116 |
| Business owner | Certification |
| Open decisions | - |
| Acceptance tests | T-RPT-008 |
| Workflows | WF8 Exam lifecycle |
| Data migration | n/a |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-117.01: Mark Faculty Registration (part of FR-117)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Certification, Exam; SL, Faculty Name, Certification, Exam, Register Date, Schedule Date, Registration Status, Remarks; Success/Reject |
| Source | SPEC p.7,42; legacy path `admin/Exam_registration/faculty_mark_registration` |
| Evidence class | SRC |
| Actors / permissions | HO Certification |
| Depends on | FR-182 |
| Business owner | Certification |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-E2E-X12 |
| Workflows | WF-X12 Faculty exam registration; WF8 Exam lifecycle |
| Data migration | IMPORTED if used |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-120: Rule: previous sub-exam result must be published before next registration

| Field | Value |
|---|---|
| Description (legacy behaviour) | Stated for semester exams |
| Source | SPEC p.40; WF 16; legacy path `Exam/SemesterStudentExamRegistration` |
| Evidence class | SRC (semester); PMC (others) |
| Actors / permissions | system |
| Depends on | FR-114 |
| Business owner | Certification |
| Open decisions | D-EXM-2 |
| Acceptance tests | T-E2E-008 |
| Workflows | WF8 Exam lifecycle |
| Data migration | n/a |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-121: Rule: passing the mapped final main exam completes the course

| Field | Value |
|---|---|
| Description (legacy behaviour) | Completion driven by mapping |
| Source | SPEC p.7,41; WF 15; legacy path `Classes/CourseMainExamMapping` |
| Evidence class | SRC |
| Actors / permissions | system |
| Depends on | FR-114 |
| Business owner | Certification |
| Open decisions | - |
| Acceptance tests | T-E2E-008, T-XM-02 |
| Workflows | WF8 Exam lifecycle |
| Data migration | completion flags IMPORTED and re-derived for check |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-122: Hall Ticket Approval and Hall Ticket list

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre (All or one of 328), Academic Year, Certification (58 bodies listed), Exam (depends), Exam Date; Search lists registrations for approval / approved registrations for printing |
| Source | SPEC p.9,32; legacy path `Student/StudentExamRegistration_Hallticketapproval; Student/StudentExamRegistration_hallticket` |
| Evidence class | SRC |
| Actors / permissions | HO Certification |
| Depends on | FR-116 |
| Business owner | Certification |
| Open decisions | D-EXM-1 |
| Acceptance tests | T-E2E-008 |
| Workflows | WF8 Exam lifecycle |
| Data migration | hall ticket status IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

### 8.13 Certificates

- **Requirements:** 8
- **Owners:** Certification (7), IT (1)
- **Workflows (05):** WF-X10 Internship exam + certificate; WF-X25 Certificate despatch payment; WF9 Certificate lifecycle
- **Open decisions (04):** D-CRT-1, D-CRT-2, D-CRT-3, D-CRT-4, D-MIG-1, NP-5
- **Distinct acceptance tests (09):** 7

#### FR-012.05: Certificate Log (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Action types Certificate Issue date updated, Certificate Issued, Certificate request Updated, Certificate Requested, Dispatch, Request Approved, Request Deleted, Update Dispatch; Post Data Details modal |
| Source | SPEC p.37; legacy path `student/certificate_logs` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | FR-132 |
| Business owner | Certification |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001 |
| Workflows | - |
| Data migration | ARCHIVED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-012.08: Certificate Validation Log; Centre QR Code Log (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Cert validation: date range only. QR: Upload/Update; S.No, Centre Code, Centre Name, Action, Preview, Action By, IP, Date & Time |
| Source | SPEC p.37; legacy path `LogReport/certValidationLogList; LogReport/qrCodeLogList` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | FR-134, FR-034 |
| Business owner | IT |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001 |
| Workflows | - |
| Data migration | ARCHIVED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-130: Certificate Type (+ Prefix Master)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Certificate Type, flags Transfer Certificate, Workshop Participation, Participation, TALLY-CERT; content type (Income Tax Certificate, Clearance Certificate); content template with student-field picker; types GTEC Certificate, GTEC Internship, GTEC Workshop, G-TEC Participation; Prefix Master renders blank |
| Source | SPEC p.6,38; legacy path `admin/master/cert_type; admin/master/tc_master` |
| Evidence class | SRC (types); REC (prefix master) (needs centre-side or manager verification) |
| Actors / permissions | HO Certification |
| Depends on | - |
| Business owner | Certification |
| Open decisions | D-CRT-1, NP-5 |
| Acceptance tests | T-SEC-014 |
| Workflows | WF9 Certificate lifecycle |
| Data migration | templates rebuilt (safe renderer); IMPORTED types |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-131: Course Completion & Internship Certificate Request Ticket Approval; Approve Certificate Request (Approvals tile)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Standard ticket screen; columns Centre, Admission No, Student Info, Registration No, Student, Course, Certificate Type, Description, Current Level, Action; cert_requestlist adds Course Status, Exam Name, Exam Result, Exam Date, Fee Due link |
| Source | SPEC p.6,38-39,44-45; legacy path `admin/Admin/cert_request_approval; internship_cert_request_approval; admin/Admin/cert_requestlist` |
| Evidence class | SRC |
| Actors / permissions | Certification approvers |
| Depends on | FR-094, FR-121 |
| Business owner | Certification |
| Open decisions | D-CRT-4 |
| Acceptance tests | T-E2E-009, T-TKT-017 |
| Workflows | WF-X10 Internship exam + certificate; WF9 Certificate lifecycle |
| Data migration | pending requests treatment at cutover |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-132: Issue Certificates

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Certificate Type, From/To, Status (Not Issued, Issued, Printed, Validated, Despatched, Received); Issue Selected allocates G-numbers (G806247); preview with zoom (print/download disabled); columns #, Centre, Student, Course, Reg No, Certificate Type, Description, Requested Date, Certificate No, Issue Date, Status, Validation Status, Last Printed, Print Options |
| Source | SPEC p.6,39; legacy path `admin/Admin/issue_certificates` |
| Evidence class | SRC |
| Actors / permissions | Certification |
| Depends on | FR-131 |
| Business owner | Certification |
| Open decisions | D-CRT-1, D-CRT-2, NP-5 |
| Acceptance tests | T-E2E-009, T-NUM-006 |
| Workflows | WF9 Certificate lifecycle |
| Data migration | certificates IMPORTED; numbers continued |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-133: Certificate Issue Report; Despatch; Approve Certificate Payment; Edit Certificate

| Field | Value |
|---|---|
| Description (legacy behaviour) | Issue report columns #, Centre, Student, Register Number, Course, Type, Requested On, Approved On, Certificate Number, Date of Issue, Last Printed On, Current Status. Despatch: Non Dispatched/Dispatched; Dispatch Address, Dispatch Date (req), Courier, Tracking Number (req), Remarks, Courier Amount, Transport Mode; Dispatch, Print All. Payment: Status Pending/Approved; Paid/Approve status. Edit: search by Centre + Admission/Register/Certificate No; Student Name (req), Course/Subject (req), numbers, Institution, Area, Grade, Duration Count/Unit, Completion Month/Year, Issue Date, Mark; live preview; Save |
| Source | SPEC p.6,39; legacy path `admin/Admin/issue_certificates_report; cert_dispatch; alldesp_pay; edit_certificate` |
| Evidence class | SRC |
| Actors / permissions | Certification |
| Depends on | FR-132, FR-221 |
| Business owner | Certification |
| Open decisions | D-CRT-2, D-CRT-3 |
| Acceptance tests | T-E2E-009, T-E2E-X25 |
| Workflows | WF-X25 Certificate despatch payment; WF9 Certificate lifecycle |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |
| Removal / scope note (UNAPPROVED) | Edit after issue -> ticket (D-CRT-3 PMC) |

#### FR-134: Certificate print templates and public QR validation page

| Field | Value |
|---|---|
| Description (legacy behaviour) | Not inspected (open question); Certificate Validation Log exists |
| Source | SPEC p.29,37; legacy path `-` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | public (token) + HO |
| Depends on | FR-132 |
| Business owner | Certification |
| Open decisions | D-CRT-3 |
| Acceptance tests | T-SEC-014 |
| Workflows | WF9 Certificate lifecycle |
| Data migration | unknown |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-221: Transport Mode master (part of FR-133)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Values Courier, Parcel, Train, Bus |
| Source | SPEC p.39; legacy path `admin/admin/transport_mode_master` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Certification |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | WF9 Certificate lifecycle |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

### 8.14 Vouchers, licences, materials and SAP

- **Requirements:** 18
- **Owners:** Tech Support (10), Stores (5), Regional managers (1), Tech Support/Stores (1), Tech Support SAP (1)
- **Workflows (05):** WF-X15 Bulk imports; WF-X26 Voucher exam link & Tally registration; WF10 Voucher & licence; WF11 Material kits; WF12 SAP plans; WF16 College tie-up pricing
- **Open decisions (04):** D-GAP-2, D-MIG-1, D-SEC-4, D-SUP-1, D-SUP-2, D-SUP-3, D-SUP-4, D-SUP-5, D-SUP-6, D-SUP-7, D-SUP-8, D-SUP-9, D-TIE-1, D-TIE-2, D-TIE-3
- **Distinct acceptance tests (09):** 10

#### FR-012.06: Material Logs (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Action types Create Order, Create Payment, Order Payment Approved (via ticket), Order Issued, Order Dispatched, Dispatch Shipment Received, Order Material Received, Cart Order Payment Approved via Ticket; Date & Time, Activity Details, Centre, Material, Login User, Action, IP, Browser, View Data |
| Source | SPEC p.37; legacy path `admin/Admin/material_logs` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | FR-142 |
| Business owner | Stores |
| Open decisions | D-MIG-1 |
| Acceptance tests | T-AUD-001 |
| Workflows | - |
| Data migration | ARCHIVED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-086: College Tie Ups

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Centre (All or 328), From/To, approval status (Non Approval, Approval), Remarks; Search, Approve, Reject; columns #, Centre, College, Class/Course, Department, Reg Fee, Actual Course Fee, Proposed, Suggested, Voucher Fee, Academic Kit Fee, Welcome Kit Fee, Exam Processing Fee, Exam Fee, Certification Fee, University Fee, Net Fee, No. of Students, Validity Period, Tie-up Date, Remarks, Created Date, Approval Status, Approved Date, Action |
| Source | SPEC p.5,34; legacy path `admin/admin/clg_tieuplist` |
| Evidence class | SRC |
| Actors / permissions | centre proposes / HO approves |
| Depends on | FR-094 |
| Business owner | Regional managers |
| Open decisions | D-TIE-1, D-TIE-2, D-TIE-3 |
| Acceptance tests | T-E2E-016 |
| Workflows | WF16 College tie-up pricing |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140: GROUP: Voucher & Licence (two instances of one sub-module)

| Field | Value |
|---|---|
| Description (legacy behaviour) | - |
| Source | SPEC p.8,17,42-43; legacy path `admin/admin/voucher_certificates; admin/admin/licence_certificates` |
| Evidence class | SRC |
| Actors / permissions | see children |
| Depends on | FR-092 |
| Business owner | Tech Support |
| Open decisions | D-SUP-1, D-SUP-2, D-SUP-3 |
| Acceptance tests | T-E2E-010 |
| Workflows | WF10 Voucher & licence |
| Data migration | stock, orders, codes IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.01: Vendor Master (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Vendor Name, Type (Voucher/Licence), Sub Type (multi), Certification (multi), Voucher Display Type; 21 vendors |
| Source | SPEC p.43; legacy path `(voucher/licence module)` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Tech Support |
| Open decisions | - |
| Acceptance tests | T-SEC-007 |
| Workflows | WF10 Voucher & licence |
| Data migration | IMPORTED; test vendors EXCLUDED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.02: Add Voucher / Add Licence (code import) (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Vendor, Type, CSV import (sample); list Sl No, Code, Type, Vendor, Quantity, Exam, Certification, Receive Date, Validity |
| Source | SPEC p.43; legacy path `admin/Admin/vendor_order_form` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-140.01 |
| Business owner | Tech Support |
| Open decisions | - |
| Acceptance tests | T-IMP-001 |
| Workflows | WF-X15 Bulk imports; WF10 Voucher & licence |
| Data migration | codes IMPORTED (codes are secrets: encrypted? PMC) |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.03: Rate Master (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Vendor, Type; rows Certification, buyer Type (ASO, RSO, Student, Bulk College Voucher, Centre), Slab Rate (2-9), Rate, Max Rate, Unit (Bulk, Per) |
| Source | SPEC p.43; legacy path `admin/Admin/voucher_rate` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-140.01 |
| Business owner | Tech Support |
| Open decisions | D-SUP-1 |
| Acceptance tests | T-E2E-010 |
| Workflows | WF10 Voucher & licence |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.04: Stock List (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Sl No, Certification, Code, Received, Issued, Remaining; Available Vouchers modal (Voucher No, Certificate, Vendor, Expiry) |
| Source | SPEC p.43; legacy path `(voucher/licence module)` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-140.02 |
| Business owner | Tech Support |
| Open decisions | - |
| Acceptance tests | T-E2E-010 |
| Workflows | WF10 Voucher & licence |
| Data migration | reconciled received = issued + remaining (K7-like) |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.05: Centre Orders and Issuance (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centre, dates, Payment Status (Paid, Unpaid), Issue Status (Pending, Issued, Partially Issued, All); columns Sl No, Centre, Voucher Type, Certification, Sub Type, Order Qty, Issued Qty, Balance Qty, Amount, Order Date, Issue Date, User Type, Payment Status, Action; modals Approve Payment, Payment Details, Issue Order, Issue Details, Edit Order Certification (New Certification, Reason) + change log |
| Source | SPEC p.43; legacy path `admin/Admin/centre_order_list/{type}` |
| Evidence class | SRC |
| Actors / permissions | HO Tech Support / Accounts |
| Depends on | FR-140.04, FR-094 |
| Business owner | Tech Support |
| Open decisions | D-SUP-1, D-SUP-3 |
| Acceptance tests | T-E2E-010 |
| Workflows | WF10 Voucher & licence |
| Data migration | orders IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.07: Voucher reports: Order Issued, Vendor Order List, Student Voucher Assign, Voucher Assigned Students, Activity Log (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Order Issued: Centre, dates, Type; columns Date, Centre, Certification, Type, Issued/Ordered Qty, Ordered Date, Voucher/Licence No (e.g. 3075-VZ85-5SBT-9Q5W), View. Vendor Order: Vendor, Type, Sub Type, Quantity, Order Date, Details. Assign: Centre, Vendor, Certification, dates, Assign Type; columns incl. Voucher/Licence No; Additional Informations form stores Student ID proof, Exam title, date/time, Mode, Certiport ID and password |
| Source | SPEC p.17,43; legacy path `Voucher/order_issued_report; admin/Admin/ventor_order_report/{type}; Voucher/voucher_assigned_list` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-140.05 |
| Business owner | Tech Support |
| Open decisions | D-SEC-4 |
| Acceptance tests | T-RPT-008, T-AUD-005 |
| Workflows | WF10 Voucher & licence |
| Data migration | IMPORTED; Certiport passwords: do not migrate in plaintext (PMC) |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.09: Import Voucher/Licence; Previous Voucher/Licence Import (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Voucher/Licence radio, CSV; list Centre, Type, Code (e.g. KL1-5-TEC-131026-004), Exam ID, Imported Date, Validity, Certification |
| Source | SPEC p.17,43; legacy path `Import_voucher` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-140.02 |
| Business owner | Tech Support |
| Open decisions | - |
| Acceptance tests | T-IMP-001 |
| Workflows | WF10 Voucher & licence |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.11: Voucher Form Registration List; Voucher Registration Ticket Approval (VRA); Student Registration Status Updation by Admin; Registered Students - Tally; Tally Registration dashboard (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Region, Area, Centre, Certification, dates, status All/Approved/Rejected (Module Marks modal); status updation List Type All/Success/Reject with per-row remarks; Tally: Type All/New/Previous; dashboard groups VRA, Update Registration by Admin, Registration List - Tally, Status Updation |
| Source | SPEC p.17,43; legacy path `Exam/registeredStudentsVoucherForm; admin/admin/mark_voucher_registration_byAdmin; Voucher/registeredStudentsTally; admin/admin/TallyRegistrationCentre` |
| Evidence class | SRC |
| Actors / permissions | HO Tech Support |
| Depends on | FR-094 |
| Business owner | Tech Support |
| Open decisions | D-SUP-2 |
| Acceptance tests | T-E2E-X26 |
| Workflows | WF-X26 Voucher exam link & Tally registration; WF10 Voucher & licence |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-140.12: Student Exam Link Request (part of FR-140)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Certification, dates, link status; Single or Bulk exam URL update; wide export (admission, reg no, name, course, certification, gender, mobile, email, parent, state, city, pincode, qualification, ID proof, program dates, referred by, batch, register status, request date, exam link) |
| Source | SPEC p.43; legacy path `admin/admin/stud_examlinkrequest` |
| Evidence class | SRC |
| Actors / permissions | HO Tech Support |
| Depends on | FR-140.07 |
| Business owner | Tech Support |
| Open decisions | D-SUP-2 |
| Acceptance tests | T-E2E-X26 |
| Workflows | WF-X26 Voucher exam link & Tally registration; WF10 Voucher & licence |
| Data migration | IMPORTED if needed |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-141: Centre-side order screens and cart (vouchers, licences, materials, SAP)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Not inspected |
| Source | SPEC p.29; legacy path `-` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | centre |
| Depends on | FR-140, FR-142, FR-143 |
| Business owner | Tech Support/Stores |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-E2E-010, T-E2E-011 |
| Workflows | WF10 Voucher & licence |
| Data migration | n/a |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-142: GROUP: Material & Product Dashboard

| Field | Value |
|---|---|
| Description (legacy behaviour) | KPI groups Paid Orders (cart, paid/approved, in process, unpaid, ordered units), Issued Orders, Despatched Orders |
| Source | SPEC p.8,17-18,44; legacy path `admin/admin/material_certificates` |
| Evidence class | SRC (dashboard); REC (frozen pages) (needs centre-side or manager verification) |
| Actors / permissions | see children |
| Depends on | FR-140 |
| Business owner | Stores |
| Open decisions | D-SUP-4, D-SUP-5, D-SUP-6 |
| Acceptance tests | T-E2E-011 |
| Workflows | WF11 Material kits |
| Data migration | - |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-142.01: Order Payment Status (part of FR-142)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, dates, Payment Status (Unpaid, Processing/Pending Approval, Paid/Approved, Rejected); columns #, Order ID, Centre, Order Date, Items, Subtotal, Courier, Grand Total, Payment Status, Approval Status (e.g. Pending Approval on PRO), Actions (View Items, Payment Info, printable Indent); Enter Payment Details: Date, Mode, Bank, Transaction/Ref, Payable Amount, Remarks |
| Source | SPEC p.44; legacy path `admin/Admin/order_cart_payment` |
| Evidence class | SRC |
| Actors / permissions | centre / Accounts |
| Depends on | FR-094 |
| Business owner | Stores |
| Open decisions | D-SUP-4 |
| Acceptance tests | T-E2E-011 |
| Workflows | WF11 Material kits |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-142.02: Order Items Issue; Orders Despatch (cart_order_dispatch, material_dispatch, product_dispatch); Import Material + report (part of FR-142)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Froze the browser from Super Admin (not opened); columns to be read from a centre login |
| Source | SPEC p.17,44; legacy path `admin/Admin/centre_cart_order_issue; cart_order_dispatch; material_dispatch; product_dispatch` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | HO Stores |
| Depends on | FR-142.01 |
| Business owner | Stores |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-E2E-011 |
| Workflows | WF11 Material kits |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-142.03: Material masters: Vendor (30), Product (Institution, Vendor, Category Course/Administrative/Promotional/Scheme/Complementary, Name, Code, Initial Stock, Min Stock, Price, photos, spec; Damaged Stock; bulk import), Product Purchase, Material Type (Academic/Welcome/Scheme/Initial/Others; Type Code; 27 kits), Material Rate (per material+course: student, centre, bulk), Kit Prefix, Material Kit Assign (Centre, Kit, Division, Course; product rows Qty, Rate, Total), Kits Overview (part of FR-142)

| Field | Value |
|---|---|
| Description (legacy behaviour) | As listed |
| Source | SPEC p.44; legacy path `(material module)` |
| Evidence class | SRC |
| Actors / permissions | HO Stores |
| Depends on | - |
| Business owner | Stores |
| Open decisions | D-SUP-4, D-SUP-5 |
| Acceptance tests | T-E2E-011 |
| Workflows | WF11 Material kits |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-143: SAP Module (Plan, Rate, Purchase, Approve, Issue, Stock)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Plan: Name, Code, Version, From/To, Certificates included. Rate per plan: buyer Type ASO/RSO/Student/Centre, No of Licence, Amount Charged, Carry Forward. Purchase: Plan, No of Licence, Amount, Date. Approve: Payment Date, Transaction No, Mode, Amount, Centre, Plan, Licences, Order Date, Order Type, Status. Issue: Pending/Issued; Issue Order modal. Stock: Plan, Purchased, Issued, Remaining |
| Source | SPEC p.9,46-47; legacy path `admin/Admin/sap_plan; sap_rate; sap_plan_purchase; sap_paymentRequestlist; sap_requestissue; sap_stockreport` |
| Evidence class | SRC |
| Actors / permissions | HO Tech Support SAP / Accounts |
| Depends on | FR-094 |
| Business owner | Tech Support SAP |
| Open decisions | D-SUP-7, D-SUP-8, D-SUP-9 |
| Acceptance tests | T-E2E-012 |
| Workflows | WF12 SAP plans |
| Data migration | IMPORTED |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

### 8.15 Human resources (HRMS)

- **Requirements:** 11
- **Owners:** HR (10), HR/Accounts (1)
- **Workflows (05):** WF-X15 Bulk imports; WF-X21 HRMS leave; WF-X22 Biometric attendance; WF-X23 Service book & service requests; WF17a HRMS recruitment; WF17b HRMS payroll
- **Open decisions (04):** D-GAP-2, D-HR-1, D-HR-2, D-HR-3, D-MIG-4, D-SEC-4, D-TZ-1, PR-02, PR-10
- **Distinct acceptance tests (09):** 8

#### FR-151: Staff (Faculties list)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Company, Branch, Department (All, IT DEPARTMENT), Designation (111 values); DataTable Faculty Name, Email, DOB, Phone (SMS), Designation, Action (edit faculty code, view, delete); buttons Faculty-Course List, Faculty Group, Non Faculty Group, Staff Group (redirect; group chat unused), Report; staff created in HRMS |
| Source | SPEC p.9,17,31; legacy path `admin/teacher` |
| Evidence class | SRC |
| Actors / permissions | HO / centre |
| Depends on | FR-182 |
| Business owner | HR |
| Open decisions | D-HR-1, PR-02 |
| Acceptance tests | T-SEC-001 |
| Workflows | - |
| Data migration | employees IMPORTED/MERGED (two staff lists) |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Group buttons unused: proposed removal |

#### FR-180: HRMS Home

| Field | Value |
|---|---|
| Description (legacy behaviour) | Greeting, Profile, Clock In/Out, date, Notifications, calendar, attendance chart; header search Employee Tags / Employee; Change Username & Password |
| Source | SPEC p.10,55; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | employees |
| Depends on | FR-182 |
| Business owner | HR |
| Open decisions | D-HR-1 |
| Acceptance tests | T-AUTH-001 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-181: HRMS General Masters

| Field | Value |
|---|---|
| Description (legacy behaviour) | Year Master (Id, Year, From, To, Active, Status) + Month Master; Department (IT DEPARTMENT); Designation (TRAINER; GEMS shows 111); Employee Group; Leave Types (days/year); Shift (Start, End); Earnings & Deductions (Type); Service Request Types (Initiator) |
| Source | SPEC p.10,55; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | HR |
| Depends on | - |
| Business owner | HR |
| Open decisions | D-HR-1, D-MIG-4 |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED; designations deduped |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-182: Employee List; Create Employee (9 tabs); Import; Updation; Service Book

| Field | Value |
|---|---|
| Description (legacy behaviour) | List filters Company, Branch, Department, Designation, Group, Status, Qualification, Type; columns Branch, Name, Code, Id, Biometric Id, Designation, Phone; Log Dashboard, Excel, User Credentials; 39 rows (placeholder). Tabs: Basic (incl. Aadhaar, PAN), Work (Status Permanent/Resigned/Deleted/Probation, Department, Designation, Supervisor, DOJ, Group, Type Teaching/Non Teaching/Teacher-cum-Counsellor, UAN, PF, ESI, Retirement, Religion, Caste), GCT (GCT ID, Validity, Course Division, Level 1-3, Level Topic), Additional Certification, Salary, Bank, Nominee (PAN, Aadhaar, bank), Shift, Login (Username, Password, Role) |
| Source | SPEC p.10,55-56; legacy path `/hrms/#employees; #employees/employeeCreation` |
| Evidence class | SRC |
| Actors / permissions | HR |
| Depends on | - |
| Business owner | HR |
| Open decisions | D-HR-1, D-HR-2, D-SEC-4 |
| Acceptance tests | T-SEC-001, T-AUD-005 |
| Workflows | WF-X15 Bulk imports; WF-X23 Service book & service requests |
| Data migration | employees IMPORTED/MERGED with GEMS staff |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-183: Attendance: Timesheet (biometric Sync Now), Attendance Register, Import Attendance

| Field | Value |
|---|---|
| Description (legacy behaviour) | Timesheet: Branch, dates; Sync Now; Excel; Sl No, Staff Id, Name, date, In, Out, duration. Register: legend Present, Absent, Offday, Holiday, On Duty; Department, dates; Sync Structure, Biometric Master, Mark/Update Attendance; per-day grid. Import CSV Employee Id/Code + Date And Time dd-mm-yyyy H:mm:ss |
| Source | SPEC p.10,56; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | HR |
| Depends on | FR-182 |
| Business owner | HR |
| Open decisions | D-HR-3, D-TZ-1 |
| Acceptance tests | T-E2E-X22 |
| Workflows | WF-X15 Bulk imports; WF-X22 Biometric attendance; WF17b HRMS payroll |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-184: Leave Request / Leave Stock / Apply Leave

| Field | Value |
|---|---|
| Description (legacy behaviour) | Leave Requests (Type, Date, Duration, Status); Leave Stock (Type, Stock) |
| Source | SPEC p.10,56; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | employees / HR |
| Depends on | FR-181 |
| Business owner | HR |
| Open decisions | D-HR-1 |
| Acceptance tests | T-E2E-X21 |
| Workflows | WF-X21 HRMS leave |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-185: Recruitment pipeline

| Field | Value |
|---|---|
| Description (legacy behaviour) | All Recruitments (Branch, dates; Name, Mobile, Application View, Status, Download; Approve/Reject), Approval, Interview List (Schedule, Mark, Remark), Exam List, Demo, Scheduled Demo, Score List (marks + remarks per stage, Total; Approve/Reject), Score Approved List |
| Source | SPEC p.10,56; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | HR |
| Depends on | FR-182 |
| Business owner | HR |
| Open decisions | D-HR-1, PR-10 |
| Acceptance tests | T-E2E-017A |
| Workflows | WF17a HRMS recruitment |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Proposed deferral (PR-10); "appear unused at HO" |

#### FR-186: Shift Management: Employee Shift

| Field | Value |
|---|---|
| Description (legacy behaviour) | Branch, Department, Group, employee tick list, date range, Day-by-Shift weekly grid; Update Shift |
| Source | SPEC p.10,56; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | HR |
| Depends on | FR-181 |
| Business owner | HR |
| Open decisions | D-HR-1 |
| Acceptance tests | T-SEC-007 |
| Workflows | - |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-187: Payroll: Salary Structure, Employee Pay Structure, Payroll, Payslip Multiple Edit, Payroll Verification, Bank Statement

| Field | Value |
|---|---|
| Description (legacy behaviour) | Payroll: Branch, Department, Group, Status, Month; Employee, Code, Staff ID, Designation, Structure, Earnings, Deductions, Gross, Net; View/PDF/Print Payslips; Generate, Cancel; Verification Month, Status All/Pending/Finalized/Verified; Bank Statement (Month; Sl No, Group) |
| Source | SPEC p.10,56; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | HR / Accounts |
| Depends on | FR-182 |
| Business owner | HR/Accounts |
| Open decisions | D-HR-1, PR-10 |
| Acceptance tests | T-E2E-017B |
| Workflows | WF17b HRMS payroll |
| Data migration | IMPORTED if used |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Proposed deferral (PR-10) |

#### FR-226: HRMS Services section

| Field | Value |
|---|---|
| Description (legacy behaviour) | No tiles visible for Super Admin |
| Source | SPEC p.10; legacy path `/hrms/#` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | unknown |
| Depends on | FR-181 |
| Business owner | HR |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | WF-X23 Service book & service requests |
| Data migration | unknown |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-227: Biometric Master; Sync Structure (part of FR-183)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Not described in detail |
| Source | SPEC p.56; legacy path `/hrms/#` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | HR |
| Depends on | FR-183 |
| Business owner | HR |
| Open decisions | D-HR-3 |
| Acceptance tests | - |
| Workflows | WF-X22 Biometric attendance |
| Data migration | unknown |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

### 8.16 Reports and dashboards

- **Requirements:** 51
- **Owners:** MIS (25), Accounts (17), Academics (3), Admissions (1), Operations (1), Marketing (1), Stores (1), HR (1), Certification (1)
- **Workflows (05):** WF-X18 Marketing targets; WF-X6 Online payment recheck & settlement; WF11 Material kits; WF15 Attendance, syllabus, placement; WF17b HRMS payroll; WF4 Fee setup & collection; WF5 Schemes & concessions; WF6 Ticket engine
- **Open decisions (04):** D-ADM-2, D-ADM-4, D-FIN-1, D-GAP-2, D-HR-1, D-ORG-5, D-ROY-2, D-RPT-1, D-RPT-2, D-SCH-3, D-SEC-4, D-STU-4, PR-07
- **Distinct acceptance tests (09):** 20

#### FR-005: Home dashboard

| Field | Value |
|---|---|
| Description (legacy behaviour) | KPI cards Total Enquiries (32,743), Total Admissions (63,779 -> Admission Report), Total Students (43,513 -> Monthly Count), Billings, Total Collections (hover; -> Student Fee Status); each with Year/Month/Scheme sub-filters; Scheme Toppers card (scheme dropdown; tabs All Centres / Area Toppers; top-10 Center Name, Admissions; View All); Collection Toppers link; Notifications feed from Exam Schedule; empty Notice Board |
| Source | SPEC p.2-3; legacy path `Dashboard/centre_dashboard` |
| Evidence class | SRC |
| Actors / permissions | scope: centre / all |
| Depends on | FR-170, FR-212 |
| Business owner | MIS |
| Open decisions | D-ADM-2, D-ADM-4, D-RPT-2 |
| Acceptance tests | T-RPT-014 |
| Workflows | - |
| Data migration | KPI parity check K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-005.01: Area Toppers / Scheme Toppers lists (part of FR-005)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Region, Area, Scheme; columns Center Name / Area Name, Admissions; 13 areas; area toppers leak raw SQL into table header today |
| Source | SPEC p.2,17; legacy path `Toppers/area_toppers_by_center/{area}/{scheme}; Toppers/scheme_toppers; Toppers/area_toppers` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-ADM-2 |
| Acceptance tests | T-RPT-014 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-005.02: Collection Toppers List (part of FR-005)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Region, Area, From/To Date; columns Region, Area, Centre, Collection Amount |
| Source | SPEC p.17; legacy path `Student/collectiveToperListGtec` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-ADM-2 |
| Acceptance tests | T-RPT-014 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-069: Payment Mode Wise Fee Collection (Direct Fee Collection Details)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Class & Section, dates, Payment Mode (Cash, Bank, DD, NEFT) |
| Source | SPEC p.4,50; legacy path `Student/StudentPaymentList` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071: GROUP: Fee reports (shared filters Centre, AY, Course Wise/Course Type/Class Type, Course, Section)

| Field | Value |
|---|---|
| Description (legacy behaviour) | - |
| Source | SPEC p.4-5,50-53; legacy path `-` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.01: Fee Due Report / Balance Due Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | From Date, Due Date, Fee Type (multi), Summary/Detail, Without Zero Due; dues per student |
| Source | SPEC p.50; legacy path `Student/Duereport_gems` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-061 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K7 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.02: Fee Collection Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | From/To, Payment Mode (Cash, Bank, Cheque, DD, NEFT, UPI, Campus Wallet, Card Payment, Online, VAS, Agent, Adjustment Entry Ledger), Users, Bank; columns Sl No, Adm No, Name, Course & Section, Paid Amount, Concession, Fine, Paid Date, Receipt No, Mode, Cheque/DD/Challan No & Date, Bank/Branch, Billed By; Add Receipt Caption link |
| Source | SPEC p.51; legacy path `Student/StudentDetails_gems` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.03: Student Fee Assign Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Division, Fee Type, Report Type; assigned structure per student |
| Source | SPEC p.51; legacy path `Student/StudentFeeAssign_Report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-059 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.04: Fee Collection Summary (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | From/To, Fee Category, Payment Mode (Offline, Online, BBPS, VAS), date category; daily totals |
| Source | SPEC p.51; legacy path `admin/Jvfees/dailyCollection` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.05: Online Payment Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Course, Fee Type, dates, Status, MID, Payment Type; gateway transactions |
| Source | SPEC p.51; legacy path `Student/Online_PaymentReport` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-068 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.06: Fee Collection Detail Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre (All or one), Payment Mode (16), Users, Fee Type (multi); columns incl. Due Date, Paid, Concession, Fine, Discount, Receipt No, Mode, Payment Type, Narration, Transaction SOL Id, instrument, Bank, Billed By |
| Source | SPEC p.52; legacy path `Student/StudentCollectionReport` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.07: Fee Reconciliation Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Class, Section; collection vs accounts |
| Source | SPEC p.52; legacy path `admin/Jvfees/feeReconciliation` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-042 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-FEE-028 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K7/K8 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.08: Concession Assigned Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Concession Type, AY; scheme usage |
| Source | SPEC p.52; legacy path `Student/concessionTypeWiseReport` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-060 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K7 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.09: Fee Type Wise Collection (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | dates, Payment Mode (Cash, Bank); Fee Type, Amount, Mode, Grand Total |
| Source | SPEC p.52; legacy path `FeeReport/fee_details` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.10: Paid Scheme Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Class, Section; Adm No, Name, Class & Section, Assigned Concession, Paid Concession, Remarks |
| Source | SPEC p.52; legacy path `FeeReport/StudentPaidConcession` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-060 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.11: Daily Collection Report (parent wise) (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Dead link ("page doesn't exist") |
| Source | SPEC p.52; legacy path `admin/Jvfees/dailyCollection_parent_wise` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | - |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | PR-07 |
| Acceptance tests | - |
| Workflows | WF4 Fee setup & collection |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Proposed removal (dead link) |

#### FR-071.12: Settlement Summary Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Date From/To, MID; Settlement Date, MID, Total Settlement, Transaction Amount, Difference; Fee Notifications link |
| Source | SPEC p.52; legacy path `Student/reconciliation_report` |
| Evidence class | SRC |
| Actors / permissions | Accounts |
| Depends on | FR-068 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-FEE-023 |
| Workflows | WF-X6 Online payment recheck & settlement; WF4 Fee setup & collection |
| Data migration | K7 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-071.13: Fees Balance Report (part of FR-071)

| Field | Value |
|---|---|
| Description (legacy behaviour) | From Date, Due Date, Fee Type or Category; balances |
| Source | SPEC p.53; legacy path `Student/collectionreport` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-061 |
| Business owner | Accounts |
| Open decisions | - |
| Acceptance tests | T-RPT-009 |
| Workflows | WF4 Fee setup & collection |
| Data migration | K7 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-074: G-TEC Reports: Collective Topper List, Fee Report Total / Student Fee Status Report, Student Fee Status (Home drill-down), Royalty Fee Collection Gtec, Daybook

| Field | Value |
|---|---|
| Description (legacy behaviour) | Keyed by Region, Area, Centre (ALL allowed); Fee Status: dates, AY, Division, Course, Category All/Registration/Course/Other, Fee Type; Royalty: Course Fee only, Paid/All; Daybook: dates req, Division, Course, Category, Fee Type; columns Sl No, Admn no, Reg no, Name, Course, Date of receipt, Amount Paid, Fee Type; Excel, Print |
| Source | SPEC p.5,53; legacy path `admin/Jvfees/feedashboard_gtec; Student/collectiveToperlist; Student/FeeStatusReport; Student/FeeCollectionGtec_G; Student/RoyalityFeeCollectionGtec; FeesDashboard/DaybookReport` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | D-ROY-2 |
| Acceptance tests | T-RPT-014 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-075: Fees Dashboard (quick icon)

| Field | Value |
|---|---|
| Description (legacy behaviour) | From/To Date; per fee head Total Fee and Collected cards split Taxable and Tax (Course Fee 2026: total 692,220,907 / collected 323,277,574) |
| Source | SPEC p.3,53; legacy path `FeesDashboard/fee_dashboard` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-064 |
| Business owner | Accounts |
| Open decisions | D-FIN-1 |
| Acceptance tests | T-RPT-014 |
| Workflows | - |
| Data migration | K7 control total seed |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-082: Enquiry Reports

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Report Type (Enquiry Report, Enquiry Conversion Report), Date From/To, Generate Report |
| Source | SPEC p.5,33; legacy path `student/reports_gtec` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-081 |
| Business owner | Admissions |
| Open decisions | D-ADM-4 |
| Acceptance tests | T-RPT-001 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-083: Admission Reports (31-column canonical export)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region (req; 18 incl. ALL, Aluva, Kochi, KERALA, KARNATAKA, TAMILNADU, North, Outside Kerala, ASO, JHARKHAND, UTTAR PRADESH, LAKSHADWEEP, UAE, EGYPT, BAHRAIN, OUTSIDE INDIA, GREATER LONDON), Area (req), Centre (req), Division (multi), Course, Enquiry Type (req), From/To (req); Search, Export Complete Excel; 31 columns listed |
| Source | SPEC p.5,33; legacy path `admin/Admin/student_report` |
| Evidence class | SRC |
| Actors / permissions | scope + export perm |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-ADM-2, D-ORG-5 |
| Acceptance tests | T-RPT-007, T-RPT-010 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-094.05: Ticket Report/Summary (part of FR-094)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centre, Ticket Type, Approval Status, From/To; summary table; Ticket Action History & Details modal |
| Source | SPEC p.38; legacy path `admin/Admin/ticket_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-094.03 |
| Business owner | Operations |
| Open decisions | - |
| Acceptance tests | T-TKT-014, T-RPT-008, T-TM-001, T-TM-002, T-TM-003 |
| Workflows | WF6 Ticket engine |
| Data migration | n/a |
| Delivery stage | 5 Ticket workflows |

#### FR-099: Marketing: Monthly Target, Scheme Target, Division-wise Monthly Targets Report

| Field | Value |
|---|---|
| Description (legacy behaviour) | Monthly Target (Division, Monthly Target); Scheme Target (Scheme, Target); report Centre, dates, Division; columns Sl No, Division, Course, Total Enquiry, Total Admission, Status |
| Source | SPEC p.9,47; legacy path `admin/marketing/Marketing; Marketing/scheme_target; Marketing/division_wise_report` |
| Evidence class | SRC |
| Actors / permissions | Marketing |
| Depends on | FR-053, FR-170 |
| Business owner | Marketing |
| Open decisions | D-SCH-3 |
| Acceptance tests | T-E2E-X18 |
| Workflows | WF-X18 Marketing targets; WF5 Schemes & concessions |
| Data migration | IMPORTED |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-100: MIS Reports: Course List; Course List - Fee Details; Centre - Course List

| Field | Value |
|---|---|
| Description (legacy behaviour) | Course List filters Category, Division, Certification, Exam; columns Course Name, Duration, GEMS ID, Code, Division, Mandatory/Optional Certifications, Mandatory/Optional Exams, Exam Processing Fee, Exam Fee, Voucher Cost, Kit Amount, Centre Class; 1,359 rows grouped by category. Fee Details per course. Centre-Course per centre |
| Source | SPEC p.8,46; legacy path `classes/courselist; classes/courselist_det; Classes/CentreCourseList` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-090 |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-RPT-008 |
| Workflows | - |
| Data migration | X5/X13 control total |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-142.04: Material reports: Issue, Product Stock, Import Material, Activity Log, Product Specifications (part of FR-142)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Columns not described |
| Source | SPEC p.44; legacy path `(material module)` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | scope |
| Depends on | FR-142.03 |
| Business owner | Stores |
| Open decisions | - |
| Acceptance tests | T-RPT-008 |
| Workflows | WF11 Material kits |
| Data migration | n/a |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-152.04: Attendance Coverage Report (part of FR-152)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Course (req), Batch, Subject; table Sl No, Date, Module, Topic |
| Source | SPEC p.32; legacy path `syllabus/syllabus_coverage` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-156 |
| Business owner | Academics |
| Open decisions | - |
| Acceptance tests | T-RPT-008 |
| Workflows | WF15 Attendance, syllabus, placement |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-170: Admission & Collection report criteria rules

| Field | Value |
|---|---|
| Description (legacy behaviour) | Enquiries: within range excl. deleted/inactive. Admissions: registrations with join date in range and registration fee paid. Billing: taxable course fee for students joined in range. Collection: taxable fees collected from students who joined and paid in range. Down Payment/Installments: join_date and receipt_date in range. Date logic per report; Course Change excluded |
| Source | SPEC p.45; legacy path `admin/admin/reports_dashboard` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-150, FR-064 |
| Business owner | MIS |
| Open decisions | D-ADM-2, D-ADM-4, D-RPT-1 |
| Acceptance tests | T-RPT-001, T-RPT-002, T-RPT-003, T-RPT-004, T-RPT-005, T-RPT-006, T-XM-01 |
| Workflows | - |
| Data migration | K10 parity |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171: GROUP: 16 Admission & Collection reports (12 share one engine)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Region, Area, Centre (req), From/To (req) + report-specific; Search, Detailed, Export Complete Excel, Print, PDF, Excel (Grouped), Excel (Column Wise); grouped table Sl No, Division, Area, Course, Total Enquiry, Total Admission, Billing, Collection, Downpayment Paid, Installment Paid with centre subtotals |
| Source | SPEC p.8,45-46; legacy path `admin/admin/reports_dashboard` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-ADM-2 |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.01: Student Report (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | = Admission Report (R-083) |
| Source | SPEC p.8,45; legacy path `admin/Admin/student_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-083 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Alias of R-083 |

#### FR-171.02: Keltron Report (33-column government portal layout) (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centre, Division, Course, dates; columns salutation, name, DOB, age, Aadhaar, differently abled, alternate mobile, email, gender, nationality, religion, caste, blood group, photo, house, street, PO, country, state, district, pincode, guardian salutation/name/mobile/relationship, qualification category, qualification, college, board, status, document and document type |
| Source | SPEC p.8,45; legacy path `admin/Admin/keltron_report` |
| Evidence class | SRC |
| Actors / permissions | scope + pii.export |
| Depends on | FR-150 |
| Business owner | MIS |
| Open decisions | D-SEC-4 |
| Acceptance tests | T-RPT-017 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.03: Scheme Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | + Scheme filter |
| Source | SPEC p.8,45; legacy path `admin/Admin/scheme_wise` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.04: Date Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Base engine |
| Source | SPEC p.8,45; legacy path `admin/Admin/date_wise` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.05: Course Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | + Division and Course |
| Source | SPEC p.8,45; legacy path `admin/Admin/course_wise` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.06: Division Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Base engine |
| Source | SPEC p.8,45; legacy path `admin/Admin/division_wise` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.07: Enquiry Mode Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | + Enquiry Mode |
| Source | SPEC p.8,45; legacy path `admin/Admin/enquiry_mode_wise` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.08: Drop Out Students (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | By course status |
| Source | SPEC p.8,46; legacy path `admin/Admin/course_status_wise` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.09: Lagging Students (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | By course end date and status |
| Source | SPEC p.8,46; legacy path `admin/Admin/lagging_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.10: Centre Transfer (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | + From Centre, To Centre |
| Source | SPEC p.8,46; legacy path `admin/Admin/centre_transfer_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.11: Fast Track / Super Fast Track (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | + Course Mode (Normal, Fast Track, Super Fast Track) |
| Source | SPEC p.8,46; legacy path `admin/Admin/course_mode_change_wise_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-096 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.12: Centre Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Returns Internal Server Error today |
| Source | SPEC p.8,46; legacy path `admin/Admin/centre_wise_report` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-GAP-2 |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Rebuild (PR-07) |

#### FR-171.13: Monthly Summary (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centre, Month, Year |
| Source | SPEC p.8,46; legacy path `admin/Admin/monthly_summary_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-RPT-1 |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.14: District Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Area, Centre, dates, Scheme; table Area/Centre, Enquiry, Admission, Billing, Down Payment, Total Collection |
| Source | SPEC p.8,46; legacy path `admin/District_wise/district_wise_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | - |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.15: Region Wise (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Region, Scheme, dates; table Region/Area with same measures |
| Source | SPEC p.8,46; legacy path `admin/Region_wise/region_wise_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-ORG-5 |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-171.16: Monthly Count (part of FR-171)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Compares student registrations with course admissions by month |
| Source | SPEC p.8,46; legacy path `admin/Admin/dev_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-STU-4 |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-172: Admission Summary Report (part of FR-005)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Total 65,211; columns Centre, Student Id, Reg No, Course Name and Code, Duration, Division, Schemes, Student, Email, Country, State, RSO, ASO, Centre, Date of Joining, Phone, Student Status, Exam Status, Certificate Status, Certificate Number, Date of Issue, Grade, International Certificate; Export Complete Excel |
| Source | SPEC p.17; legacy path `admin/Admin/admission_report` |
| Evidence class | SRC |
| Actors / permissions | scope |
| Depends on | FR-170 |
| Business owner | MIS |
| Open decisions | D-ADM-2 |
| Acceptance tests | T-RPT-007 |
| Workflows | - |
| Data migration | K10 parity; X3 |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-188: HRMS Reports (17)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Attendance (day grid), Leave, Leave Balance, Shift, Pay Sheet, Component-wise Recovery, Time Sheet, Late Coming, Payment Sheet (A/C No, Amount, Add Cheque Number, print), Teaching Staff Salary, Staff Salary, ESI, Staff EPF, Absence, LOP, Monthly Salary, Attendance Register; filters Company, Branch, Department, Group, Status, Month/date |
| Source | SPEC p.10,57; legacy path `/hrms/#` |
| Evidence class | SRC |
| Actors / permissions | HR |
| Depends on | FR-183, FR-187 |
| Business owner | HR |
| Open decisions | D-HR-1 |
| Acceptance tests | T-RPT-008 |
| Workflows | WF17b HRMS payroll |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Scope per D-HR-1 |

#### FR-216: Course Dashboard (quick icon)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Empty for Super Admin; content unknown |
| Source | SPEC p.3; legacy path `Student/classDashboard` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | Academics |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Pending decision (PR-07) |

#### FR-217: Gtec Centre Dashboard (quick icon)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Crashes with PHP memory error; content unknown |
| Source | SPEC p.3,28; legacy path `admin/admin/dashboard_new` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | MIS |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Rebuild not copy (PR-07) |

#### FR-219: Hidden Academic Kit / Welcome Kit / CC Summary cards (part of FR-005)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Exist in markup, hidden |
| Source | SPEC p.3; legacy path `Dashboard/centre_dashboard` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | MIS |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Pending decision |

#### FR-222: Coursewise exam report (part of FR-114)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Linked from Sub Exam Mapping; columns not described |
| Source | SPEC p.41; legacy path `Exam/CourseWiseExamReport` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | scope |
| Depends on | FR-114 |
| Business owner | Certification |
| Open decisions | - |
| Acceptance tests | T-RPT-008 |
| Workflows | - |
| Data migration | n/a |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

### 8.17 Notifications and communications

- **Requirements:** 6
- **Owners:** Operations (5), Certification (1)
- **Workflows (05):** WF-X3 Notifications (SMS/email/push/in-app); WF4 Fee setup & collection
- **Open decisions (04):** D-COMM-1, PR-03
- **Distinct acceptance tests (09):** 5

#### FR-002: Notification bell + HO Notification List

| Field | Value |
|---|---|
| Description (legacy behaviour) | Bell unread count (2845); list filters From/To Date, Search, View All; DataTable SL, Type, Centre Name, Description, Done By, Module; fed by events (licence orders, payments) |
| Source | SPEC p.2-3; legacy path `admin/Exam_registration/ho_notification` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-213 |
| Business owner | Operations |
| Open decisions | D-COMM-1 |
| Acceptance tests | T-NTF-001 |
| Workflows | WF-X3 Notifications (SMS/email/push/in-app) |
| Data migration | Notification history: migrate or archive (D-MIG-1) |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-070: Generate Challan = Fee Due SMS (Balance Due Report SMS)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre, Course, Section, AY, From Date, Due Date, Fee Type; Push Notification, Send SMS, Send Email to students with dues |
| Source | SPEC p.4,50; legacy path `Student/DuereportSMS` |
| Evidence class | SRC |
| Actors / permissions | Accounts / centre |
| Depends on | FR-071 |
| Business owner | Operations |
| Open decisions | D-COMM-1, PR-03 |
| Acceptance tests | T-NTF-005 |
| Workflows | WF-X3 Notifications (SMS/email/push/in-app); WF4 Fee setup & collection |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |
| Removal / scope note (UNAPPROVED) | Duplicate pages merged (PR-03) |

#### FR-210: Push Notification Report (part of FR-002)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Filters Centre, From/To Date; columns Sl No, Centre Name, Message, Date |
| Source | SPEC p.3; legacy path `admin/Admin/center_custom_push_report` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-213 |
| Business owner | Operations |
| Open decisions | D-COMM-1 |
| Acceptance tests | T-NTF-002 |
| Workflows | WF-X3 Notifications (SMS/email/push/in-app) |
| Data migration | archive candidate |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-211: SMS Log Summary (part of FR-012)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Centre and date range |
| Source | SPEC p.6,37; legacy path `Student/smsLogSummary` |
| Evidence class | SRC |
| Actors / permissions | audit read |
| Depends on | FR-070 |
| Business owner | Operations |
| Open decisions | D-COMM-1 |
| Acceptance tests | T-NTF-004 |
| Workflows | WF-X3 Notifications (SMS/email/push/in-app) |
| Data migration | ARCHIVED |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-212: Exam-schedule notices on Home (part of FR-005)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Text generated from Exam Schedule rows ("The SEM examination is scheduled on ... Registration will be open from ... last date for payment ...") |
| Source | SPEC p.2-3,41; legacy path `Dashboard/centre_dashboard` |
| Evidence class | SRC |
| Actors / permissions | all |
| Depends on | FR-113 |
| Business owner | Certification |
| Open decisions | D-COMM-1 |
| Acceptance tests | T-NTF-003 |
| Workflows | WF-X3 Notifications (SMS/email/push/in-app) |
| Data migration | n/a |
| Delivery stage | 6 Exams, certificates, supply, royalty, year close |

#### FR-213: Notification & fee-communication flags (part of FR-024)

| Field | Value |
|---|---|
| Description (legacy behaviour) | fee_collection_RECEIPT, fee_collection_SMS, fee_collection_EMAIL, fee_due_notification, result_with_held |
| Source | SPEC p.13; legacy path `admin/school/settingsInstitution` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | FR-024 |
| Business owner | Operations |
| Open decisions | D-COMM-1 |
| Acceptance tests | T-NTF-001 |
| Workflows | WF-X3 Notifications (SMS/email/push/in-app) |
| Data migration | migrate values |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

### 8.18 Integrations: legacy Centres API

- **Requirements:** 6
- **Owners:** Dashboard owner (5), IT (1)
- **Workflows (05):** WF-X24 Legacy API consumption
- **Open decisions (04):** D-ADM-4, D-API-1, D-SEC-6, D-STU-4
- **Distinct acceptance tests (09):** 6

#### FR-200: Legacy API /api/Centres/directory

| Field | Value |
|---|---|
| Description (legacy behaviour) | Returns code, name, address, area, region, updated_at (325 centres); HO ID 800 and exclude_type filtered (APIR p5) |
| Source | REQ p.1-2; legacy path `POST JSON + X-API-KEY` |
| Evidence class | SRC |
| Actors / permissions | API consumer key |
| Depends on | FR-022 |
| Business owner | Dashboard owner |
| Open decisions | D-API-1, D-SEC-6 |
| Acceptance tests | T-API-001 |
| Workflows | WF-X24 Legacy API consumption |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-201: Legacy API /api/Centres/enquiries

| Field | Value |
|---|---|
| Description (legacy behaviour) | Input centre_code; per year/month counts; null for uncaptured months (APIR item 6) |
| Source | REQ p.1-2; legacy path `POST JSON + X-API-KEY` |
| Evidence class | SRC |
| Actors / permissions | API consumer key |
| Depends on | FR-081 |
| Business owner | Dashboard owner |
| Open decisions | D-API-1, D-ADM-4 |
| Acceptance tests | T-API-002 |
| Workflows | WF-X24 Legacy API consumption |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-202: Legacy API /api/Centres/admissions

| Field | Value |
|---|---|
| Description (legacy behaviour) | Input centre_code; per year/month counts |
| Source | REQ p.1-2; legacy path `POST JSON + X-API-KEY` |
| Evidence class | SRC |
| Actors / permissions | API consumer key |
| Depends on | FR-150 |
| Business owner | Dashboard owner |
| Open decisions | D-API-1, D-ADM-4 |
| Acceptance tests | T-API-003 |
| Workflows | WF-X24 Legacy API consumption |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-203: Legacy API /api/Centres/courselist

| Field | Value |
|---|---|
| Description (legacy behaviour) | Input centre_code; course_code (TRIMmed), course_name (course_display_name override) |
| Source | REQ p.1-2; legacy path `POST JSON + X-API-KEY` |
| Evidence class | SRC |
| Actors / permissions | API consumer key |
| Depends on | FR-090 |
| Business owner | Dashboard owner |
| Open decisions | D-API-1 |
| Acceptance tests | T-API-004 |
| Workflows | WF-X24 Legacy API consumption |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-204: Legacy API /api/Centres/student_list

| Field | Value |
|---|---|
| Description (legacy behaviour) | Input centre_code + course_code (mandatory); student_name, registernumber; "business admission conditions" undocumented (REQ C7) |
| Source | REQ p.1-2; legacy path `POST JSON + X-API-KEY` |
| Evidence class | SRC |
| Actors / permissions | API consumer key |
| Depends on | FR-150 |
| Business owner | Dashboard owner |
| Open decisions | D-API-1, D-STU-4 |
| Acceptance tests | T-API-005 |
| Workflows | WF-X24 Legacy API consumption |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

#### FR-205: Legacy API transport & security conventions

| Field | Value |
|---|---|
| Description (legacy behaviour) | POST only, JSON body, X-API-KEY (SHA-256 check), 400/401/404/405 errors; key printed in guides (exposed); REQ V1-V12 requested conventions |
| Source | REQ/APIR p.1,8; 5; legacy path `-` |
| Evidence class | SRC |
| Actors / permissions | - |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-SEC-6, D-API-1 |
| Acceptance tests | T-API-006 |
| Workflows | WF-X24 Legacy API consumption |
| Data migration | n/a |
| Delivery stage | 7 HRMS, reports, integrations, hardening |

### 8.19 Proposed out of scope (pending usage evidence and owner sign-off)

- **Requirements:** 12
- **Owners:** IT (6), Academics (2), Accounts (1), Operations (1), Stores/Accounts (1), Admissions (1)
- **Workflows (05):** WF-X4 CRM lead pipeline; WF1 Enquiry to admission; WF4 Fee setup & collection
- **Open decisions (04):** D-GAP-2, D-PORTAL-1, D-SUP-6, PR-04, PR-05, PR-06, PR-11, PR-13
- **Distinct acceptance tests (09):** 0

#### FR-004: Hidden SMS Login modal, Help editor (Save/Edit Help), chatbot widget

| Field | Value |
|---|---|
| Description (legacy behaviour) | Present in markup on every page |
| Source | SPEC p.2; legacy path `every page` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | IT |
| Open decisions | PR-13 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | not migrated unless approved |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal; usage unchecked (DR-07/08) |

#### FR-020.07: Support Login (part of FR-020)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Support Link (text); Settings button; list Support Link id, Support Link, Action |
| Source | SPEC p.11; legacy path `admin/master/Support_link` |
| Evidence class | SRC |
| Actors / permissions | not documented |
| Depends on | - |
| Business owner | IT |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | unknown |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Purpose unknown; usage unchecked |

#### FR-025: Mobile Settings

| Field | Value |
|---|---|
| Description (legacy behaviour) | Per-role Allow/Deny (Admin, Teacher, Parent, Student) for school-app features: Appointment list, Circular add, Home work, Study materials, Syllabus, Teacher leave, Visitors list, User blocking, Student promotion, Student remark, Upload to Amazon; "mostly unused by G-TEC" |
| Source | SPEC p.14; legacy path `admin/school/mobile_settings` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | IT |
| Open decisions | PR-05, D-PORTAL-1 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | not migrated unless approved |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal; usage unchecked |

#### FR-033.12: Legacy school masters (Class Master, Course Category Master, Class Type Master) (part of FR-033)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Test data only |
| Source | SPEC p.16; legacy path `admin/master/classCreate; Course_Cat_Master_create; Class_Master_create` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | IT |
| Open decisions | PR-06 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | EXCLUDED with approved reason |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal (PR-06) |

#### FR-056: Fee Parent Master; Fee Group Master

| Field | Value |
|---|---|
| Description (legacy behaviour) | School-ERP groupings (Academic/Transportation); empty |
| Source | SPEC p.4,48; legacy path `admin/Jvfeescategory/jvfee_parent; admin/jvfees/feeGroupMaster` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | Accounts |
| Open decisions | PR-05 |
| Acceptance tests | - |
| Workflows | WF4 Fee setup & collection |
| Data migration | none (empty) |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal; empty per SPEC |

#### FR-101: Message (legacy internal messaging app)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Did not render for Super Admin |
| Source | SPEC p.8,46; legacy path `cbmessages/index.php/messages/inbox` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | - |
| Depends on | - |
| Business owner | Operations |
| Open decisions | PR-04 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | ARCHIVED if data exists |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal; usage unchecked |

#### FR-146: Purchase sub-app (pos_new, "Gesta ERP")

| Field | Value |
|---|---|
| Description (legacy behaviour) | Super Admin sidebar empty; Timeline, Support calls, Change Password, Log Out, school switcher; centre screens not inspectable |
| Source | SPEC p.3,55; legacy path `pos_new/` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | unknown |
| Depends on | - |
| Business owner | Stores/Accounts |
| Open decisions | D-SUP-6, PR-11 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | unknown |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Out of scope until confirmed (PR-11) |

#### FR-150.03: Admission school-ERP sections: Add Siblings, Transport Details, RTE (part of FR-150)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Siblings (course, section, student); Transport (Required/Not, Route List, Drop Name, Fare); Fee Concession Type (242 schemes) and RTE Yes/No |
| Source | SPEC p.31; legacy path `student/create` |
| Evidence class | SRC |
| Actors / permissions | centre admin |
| Depends on | - |
| Business owner | Academics |
| Open decisions | PR-05 |
| Acceptance tests | - |
| Workflows | WF1 Enquiry to admission |
| Data migration | ARCHIVED or EXCLUDED per usage check |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Proposed removal; usage unchecked |

#### FR-160: TC Master (blank); TC Request Form

| Field | Value |
|---|---|
| Description (legacy behaviour) | TC: Centre, AY, Batch & Section, Student, Date of issue, NCC/Scout/Guide/JRC, Games, Reason for leaving, Last Attendance, Remarks; transfer-in block; Uploaded TC list (school product) |
| Source | SPEC p.4,53-54; legacy path `admin/master/tc_master; certificate/certificate_request_form` |
| Evidence class | SRC |
| Actors / permissions | centre |
| Depends on | - |
| Business owner | Academics |
| Open decisions | PR-05 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | ARCHIVED if data exists |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal; usage unchecked |

#### FR-215: CRM My Profile / My Timesheets / Edit Profile (part of FR-085)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Not described |
| Source | SPEC p.54; legacy path `crm profile menu` |
| Evidence class | REC (needs centre-side or manager verification) |
| Actors / permissions | CRM users |
| Depends on | - |
| Business owner | Admissions |
| Open decisions | D-GAP-2 |
| Acceptance tests | - |
| Workflows | WF-X4 CRM lead pipeline |
| Data migration | unknown |
| Delivery stage | 3 Centre, catalogue, enquiry, admission |
| Removal / scope note (UNAPPROVED) | Usage unchecked |

#### FR-224: Vendor support "New Task" form (part of FR-012.01)

| Field | Value |
|---|---|
| Description (legacy behaviour) | Phone, name, email, issue title, description (support to vendor d'Katia) |
| Source | SPEC p.37; legacy path `log` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | IT |
| Open decisions | PR-13 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | not migrated |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal (vendor-specific) |

#### FR-225: App downloads stats (part of FR-012.01)

| Field | Value |
|---|---|
| Description (legacy behaviour) | SL, Class, Section, Downloads, Users, Non Users |
| Source | SPEC p.37; legacy path `log` |
| Evidence class | SRC |
| Actors / permissions | HO |
| Depends on | - |
| Business owner | IT |
| Open decisions | PR-13, D-PORTAL-1 |
| Acceptance tests | - |
| Workflows | - |
| Data migration | ARCHIVED |
| Delivery stage | 0 Discovery |
| Removal / scope note (UNAPPROVED) | Proposed removal; usage unchecked |

