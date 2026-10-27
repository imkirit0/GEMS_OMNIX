---
title: "GEMS OMNIX: Business Requirements Document (BRD)"
subtitle: "Draft v0.1 for review, not approved"
date: "2026-10-27"
---

# GEMS OMNIX: Business Requirements Document (BRD)

## 1. Document control

| Item | Value |
|---|---|
| Document | BRD, GEMS OMNIX (replacement of the G-TEC GEMS ERP) |
| Version | **0.1 DRAFT for review**. Not approved; nothing in it is signed |
| Date | 2026-10-27 |
| Prepared from | Audit pack `docs/audit/` v1.1–v1.5 (artifacts 01–12, decision register 04, matrix 02) |
| Companion | `FRD-GEMS-OMNIX.md`: 290 functional requirements generated from the traceability matrix |
| Approval | Section 18. **All approvals are blank** |

**Source documents** (SHA-256 recorded in `docs/audit/12-evidence-and-verification-log.md`)

| Code | Document | Role in this BRD |
|---|---|---|
| SPEC | GEMS ERP Rebuild Specification (57 pp.): a read-only walk of the live system | Primary source for legacy behaviour |
| WF | GEMS Workflows for Manager Review: 18 workflows; diagrams exist for WF1–8 only | Business processes; sign-off sheet |
| REQ, APIR, DQR | GEMS API request (5 Oct 2026), vendor technical response, API data-quality report | Legacy Centres API and data quality |
| XLS | GEMS legacy data workbook 2009–2026 (≈1.22M enrolment rows) | Candidate history source |
| REFS | GEMS 2.0 Refs proposal (G-290725, Jul 2025) | **Reference only.** It is not a source of any requirement (user decision, 2026-10-27; v1.5 §G). Its extra ideas are listed as backlog in Appendix A |

**Evidence classes** used throughout: SRC (stated in a source), INF (inferred), REC (reconstructed from a broken, blank or uninspected page), PRO (proposed design), PMC (pending manager confirmation), VER (verified by an executed test; **0 today**).

## 2. Executive summary

**The business.** G-TEC runs a franchise network of roughly 325–327 training centres across Kerala, Tamil Nadu, Karnataka, North India, UAE, Egypt, Bahrain and the UK (SPEC p.1; centre counts conflict across sources, X2). Head office (HO, centre code GTECHO) manages the network.

**The current system.** All of it runs on **GEMS**: a school ERP (CareerBook, by d'Katia Software Technologies) adapted for G-TEC. It consists of a CodeIgniter monolith plus four satellite apps: HRMS, CRM, Purchase and Accounts (SPEC pp.1–2). It covers:
- the student lifecycle (enquiry → admission → fees → exams → certificates);
- centre operations (vouchers, licences, materials, royalty, tickets);
- staff (HRMS).

A read-only Centres API feeds a management dashboard (REQ).

**The project.** GEMS OMNIX replaces GEMS. The stated aim is to rebuild "**with the same modules and better features**" (SPEC p.1, SRC). The audit found that "same modules" means 290 page-level capabilities, 18 drawn or placeholder workflows and 26 further undrawn processes. "Better" must address documented defects (§6): security weaknesses, crashing pages, inconsistent KPIs, an unbalanced legacy ledger, and history split across systems.

**State today.**
- The requirements baseline is complete and internally consistent (T-DOC-001: 0 errors).
- A proof of concept has demonstrated the database isolation and numbering mechanisms locally. Its Supabase re-run is close but not stable (v1.4 C-26).
- **No business rule has been approved** and **no application code exists.**
- More than 100 decisions are waiting for named owners (§9). They are the critical path.

## 3. Business objectives

Objective BO-1 is stated in the source. BO-2…BO-8 are **proposed** from audit findings and must be confirmed by the sponsor (PMC). Success measures are proposals.

| ID | Objective | Basis | Success measure (PROPOSED) |
|---|---|---|---|
| BO-1 | Replace GEMS with a system that has the same modules and better features | SPEC p.1 (SRC) | Every in-scope FRD requirement passes its acceptance tests; UAT signed against the WF sign-off sheet |
| BO-2 | One source of truth for students, fees and accounts, across HO and all centres | Five separate apps; duplicate enquiry/lead and staff lists (PR-02) | One enquiry pipeline, one staff list, one ledger |
| BO-3 | Trustworthy management numbers | Admissions 63,779 vs 65,211 vs API 58,301; students 43,513 vs 56,336 (X3, X11) | Signed KPI definitions; report parity with legacy within explained differences (K10) |
| BO-4 | Financial integrity and auditability | Unbalanced legacy vouchers (FR-044.26); password-prompt cancellations (FR-013) | Every journal balances; corrections only by reversal; maker-checker on sensitive changes; 0 unexplained reconciliation differences |
| BO-5 | Secure, least-privilege access across a franchise network | HO impersonation of centres; client-side approvals password; exposed API key (FR-010, FR-013, FR-205) | No shared or impersonated logins; TOTP for HO; all cross-centre isolation tests green |
| BO-6 | Complete and reconciled history | GEMS holds data from 2026 (APIR); XLS 2009–2026; no shared keys (X9) | 100% of source keys carry a disposition; REJECTED = 0 at cutover (K1–K11) |
| BO-7 | Uninterrupted operations at cutover | Dashboard depends on the legacy API (FR-200…205) | Dashboard works on day 1; rollback window available (D-MIG-5) |
| BO-8 | Remove dead school-ERP features and broken pages, but only on evidence | Transport, hostel, TC, etc. "mostly unused" (SPEC p.14); crashing pages | Each removal backed by a usage query and an owner sign-off (PR-01…13) |

## 4. Scope

### 4.1 In scope (subject to the open decisions in §9)

| Module | FRD section | Requirements | Owner(s) |
|---|---|---|---|
| Organisation and centres (centre master, onboarding, settings, location masters) | 8.1 | 24 | Operations |
| Platform core (search, roles, permissions, numbering, logs, shared lists) | 8.2 | 22 | IT, Operations |
| Course catalogue (courses, divisions, certifications, class assignment) | 8.3 | 11 | Academics |
| Enquiries and CRM | 8.4 | 5 | Admissions/PRO |
| Student records and admission | 8.5 | 8 | Admissions/PRO |
| Academics (batches, attendance, syllabus, placement, feedback, ID cards) | 8.6 | 17 | Academics |
| Fees, schemes, concessions | 8.7 | 20 | Accounts, Marketing |
| Payments and gateways | 8.8 | 3 | Accounts |
| Accounting (accounts app, 31 reports) | 8.9 | 40 | Accounts |
| Royalty and clearance | 8.10 | 3 | Accounts |
| Tickets and approvals | 8.11 | 13 | Operations/PRO |
| Examinations | 8.12 | 12 | Certification |
| Certificates | 8.13 | 8 | Certification |
| Vouchers, licences, materials, SAP | 8.14 | 18 | Tech Support, Stores |
| HR (HRMS) | 8.15 | 11 | HR |
| Reports and dashboards | 8.16 | 51 | MIS, owners |
| Notifications | 8.17 | 6 | Operations |
| Legacy Centres API (compatibility) | 8.18 | 6 | Dashboard owner |
| **Total in scope** | | **278** | Plus 12 proposed out of scope (§4.2) = 290 matrix rows |

Also in scope:
- **data migration** from GEMS MySQL (+ HRMS/CRM/Accounts/Purchase databases) and, subject to D-MIG-7/8, the XLS history;
- **cutover**, with a rollback window.

### 4.2 Proposed out of scope (none approved)
- **School-ERP leftovers** (12 FRD rows, §8.19), plus the proposed removals PR-04/05/06/11/13:
  - mobile settings for the school app;
  - fee parent/group masters;
  - TC master;
  - legacy Message app;
  - Purchase app;
  - vendor-support form;
  - app-download stats;
  - SMS login modal.
- **Deferrals:**
  - fines (PR-08);
  - promotion/depromotion (PR-09);
  - HRMS payroll and recruitment (PR-10).
- **Student/parent portal or mobile app:** default API-first, no portal (D-PORTAL-1, PMC).
- **REFS backlog** (Appendix A).

Each item needs a usage query result **and** an owner's signature before it is dropped (DR-08).

## 5. Stakeholders

Names are not recorded in any source. Each role must be assigned a named person before sign-off.

| Role | Interest | Decides |
|---|---|---|
| Sponsor | Overall go/no-go, budget, priorities | Objectives (§3), scope (§4), go-live |
| Accounts | Fees, GST, ledger, royalty, numbering, migration of financial data | D-FEE, D-FIN, D-SCH (with Marketing), D-ROY, NP-1…8, D-MIG-2/3/5, G-FIN gate |
| Operations | Centres, tickets, notifications, roles | D-ORG, D-TKT, D-COMM, D-SEC-1/2 |
| Admissions / PRO | Enquiry, admission, student data, course changes | D-ADM, D-STU |
| Academics | Catalogue, batches, attendance, promotion | D-CAT, D-ACA, D-YEAR-1 |
| Certification | Exams, certificates, numbering (co-owner) | D-EXM, D-CRT |
| MIS | KPI definitions, report parity | D-ADM-2/4, D-RPT |
| Marketing | Schemes, targets, BDO | D-SCH-1/3 |
| Tech Support / Stores | Vouchers, licences, SAP, materials | D-SUP |
| Regional managers | College tie-ups | D-TIE |
| HR | HRMS scope, biometric | D-HR |
| IT | Security, hosting, migration, time zone, NFRs | D-SEC, D-TZ, D-OPS, D-MIG-1/6/7/8 |
| Legal | Personal data (Aadhaar, PAN, caste), residency (Singapore hosting) | D-SEC-4 |
| Dashboard owner | Centres API consumer | D-API-1 |
| Centres (≈325) | Day-to-day users; UAT participants | — (represented by Operations) |

## 6. Current state and problems (SRC unless noted)

| # | Problem | Evidence | Business impact |
|---|---|---|---|
| P1 | Five apps with separate data: HRMS, CRM, Purchase and Accounts beside the core | SPEC pp.1–2 | Duplicate enquiries/leads (32,743 vs ~34,120, X7) and staff lists; no single view |
| P2 | HO acts by impersonating centre logins; approvals use a hard-coded client-side password; password prompts guard fee cancellation and amount change | FR-010, FR-013, FR-065, FR-066 | No accountability for who did what; fraud risk on money changes |
| P3 | Legacy API key printed in guides; gateway secrets held in settings | FR-205, FR-024.01 | Credential misuse (rotate at cutover, D-SEC-6) |
| P4 | KPIs disagree between screens and the API | X3, X11, D-ADM-2/4, D-RPT-2 | Management decisions on inconsistent numbers |
| P5 | Ledger can be unbalanced ("Invalid Bank Transactions" report) | FR-044.26 | Misstated books; migration must not hide it (D-MIG-3) |
| P6 | Pages that crash, freeze or render blank (Gtec Centre Dashboard, Centre Wise report, class assign, order issue/despatch, several logs); a report leaks raw SQL | FR-217, FR-171.12, FR-091, FR-142.02, FR-012.03, FR-005.01 | Functions unavailable; 12 requirements cannot yet be specified (audit 03 §C) |
| P7 | History split: GEMS data from 2026 (vendor), XLS 2009–2026, no shared keys; XLS has no IDs or receipts | X9, X15, XL-1, XL-2 | Lost or double-counted history |
| P8 | Master-data quality: duplicate religions (51 rows), 963 castes, course codes with whitespace and `/`, test centres in production | FR-020.03/.04, DQR, X14 | Wrong reports; merge maps needed (D-MIG-4) |
| P9 | School-ERP leftovers in menus and forms | SPEC p.14, PR-05 | Clutter and confusion |
| P10 | 2,412 tickets pending | FR-094.03 | Backlog; SLA undefined (D-TKT-3) |
| P11 | Personal data at scale: Aadhaar, caste, PAN; ≈1.2M XLS rows on a local drive | FR-150.05, FR-182, XL-8 | DPDP Act exposure (D-SEC-4) |

## 7. Users and access (business view)

**Who uses the system**
- HO staff in about 43 legacy roles. The role list includes test and unused roles, so mapping is pending (D-SEC-1).
- Centre staff.
- Faculty.
- Automated jobs.
- The management dashboard (via API).

Students and parents have no direct access in the proposed scope (D-PORTAL-1).

**Required business access rules** (PRO, from audit 06):
- Every person has their own login. There are no shared centre logins and no impersonation (PR-01).
- Head-office users see only their assigned scope: all centres, a region, an area, or one centre. Centre users see only their centre.
- HO users with wide scope or finance/RBAC rights use two-factor sign-in.
- Money-changing and permission-changing actions need re-authentication and, where D-FEE-2 says so, a second approver.
- Every action is audited.

## 8. Business processes

### 8.1 Drawn and placeholder workflows (WF sign-off sheet; **all unsigned**)

| WF | Process | Owner | Diagram | State |
|---|---|---|---|---|
| WF1 | Enquiry to admission | Admissions/PRO | yes | Centre lane REC |
| WF2 | Catalogue and availability | Academics | yes | Course approval step unevidenced |
| WF3 | Centre onboarding | Operations | yes | Centre lane REC |
| WF4 | Fee setup and collection | Accounts | yes | Receipt screen REC |
| WF5 | Schemes and concessions | Marketing/Accounts | yes | Centre selection REC |
| WF6 | Ticket engine | Operations/PRO | yes | Level configuration per type |
| WF7 | Student data and course change | PRO | yes | Centre raise form REC |
| WF8 | Exam lifecycle | Certification | yes | Centre registration REC |
| WF9 | Certificate lifecycle | Certification | **placeholder** | All steps REC |
| WF10 | Voucher and licence | Tech Support | placeholder | All REC |
| WF11 | Material kits | Stores | placeholder | All REC |
| WF12 | SAP plans | Tech Support SAP | placeholder | All REC |
| WF13 | Royalty and clearance | Accounts | placeholder | All REC; formula unknown |
| WF14 | Year closing and promotion | Accounts/IT | placeholder | All REC |
| WF15 | Attendance, syllabus, placement | Academics/Placement | placeholder | All REC |
| WF16 | College tie-up pricing | Regional managers | placeholder | All REC |
| WF17a | HRMS recruitment | HR | placeholder | All REC; usage unknown |
| WF17b | HRMS payroll | HR/Accounts | placeholder | All REC |

### 8.2 Undrawn processes found in SPEC (WF-X1…X26)
The 26 undrawn processes are:
- BDO planning; ID cards; notifications; CRM pipeline;
- receipt transfer; online payment recheck and settlement; course mode change;
- exam-date, re-exam, internship and WE exam requests; faculty exam registration;
- user/role administration; credential reset; bulk imports;
- front office; feedback; marketing targets; batch assignment;
- gateway configuration; HR leave; biometric attendance; service book;
- legacy API consumption; certificate despatch payment; voucher exam links.

Owners and tests are in audit 05. **WF-X1…X4 must be drawn and signed before their stage** (D-GAP-1); the others are drawn or removed under D-GAP-2.

**Business requirement:** each workflow is signed by its owner **before** its build stage starts. Placeholder workflows (WF9–17b) cannot reach UAT until drawn.

## 9. Business rules and decisions

**No business rule in this section is approved.** Each rule below is either stated in a source (SRC, describing legacy behaviour) or is a proposed default awaiting its owner. The full register, with evidence, defaults and regression tests, is audit 04.

### 9.1 Rules observed in legacy (SRC; to be confirmed for carry-over)
| Area | Rule | Source |
|---|---|---|
| Fees | Fees vary by **centre class** (15 classes); fee structures per course and class | FR-033.06, FR-059 |
| Schemes | Five scheme natures: Normal, Constant %, Constant amount, Variable %, Variable amount; validity dates; applicability by category/division or region/area/centres | FR-053, FR-054 |
| Royalty | Royalty Master holds one 20% rate; GST master 18% (9+9 / 18 IGST); monthly royalty per centre; centre pays, HO approves; clearance request per month | FR-031, FR-032, FR-072, FR-145 |
| Numbering | Admission numbers from per-year prefix counters; receipt prefixes `{centreCode}/{TYPE}/{FY}/` with types ADMREC, CON, FEEREC, INV, JOU, REC, VOU | FR-011, FR-026, FR-029 |
| Reports | Admission and collection report criteria (enquiries within range excluding deleted/inactive; admissions by join date and registration) | FR-170 |
| Exams | Previous sub-exam result must be published before the next (semester); passing the mapped final exam completes the course | FR-120, FR-121 |
| Course mode | Normal / Fast Track / Super Fast Track; change by approval | FR-096 |
| Tickets | Generic request-and-approval engine with levels 1–4, prefixes and categories | FR-094 |

### 9.2 Decision areas blocking delivery (owner must sign; ⛔ = production gate)
| Area | Decisions | Owner | Blocks |
|---|---|---|---|
| Identity and admission counting | D-STU-4 (person vs registration), D-ADM-1…4 | Admissions/PRO, MIS | Stage 2–3 |
| Numbering policy | NP-1…NP-8 (scope, reset, gapless vs unique, format/length, prefix types, register scope, legacy continuation) | Accounts + Certification | Stage 2 |
| Finance ⛔ | D-FIN-1…9 (cash vs accrual, tax point, cancellation window, GST rounding, **refunds undocumented**, caution deposit, paid fee import, hash-chained audit, advances), D-FEE-1…6, D-SCH-1…3, D-CUR-1 | Accounts | **G-FIN gate** before Stage 4 |
| Royalty ⛔ | D-ROY-1 (rate per centre), **D-ROY-2 (old vs new collection, royalty-bearing fee types: no default, blocked)**, D-ROY-3 | Accounts | Stage 6 |
| Organisation | D-ORG-1…6 (centre creation and checks, class revisable, prerequisites, ~60 flags, **region semantics and hierarchy**, lifecycle fields) | Operations | Stage 3 |
| Tickets | D-TKT-1…4 (approvers, reject handling, SLA, **self-approval ⛔**) | Operations/PRO | Stage 5 |
| Exams, certificates, supply | D-EXM-1…3, D-CRT-1…4, D-SUP-1…9 (incl. SAP carry-forward: **no default**) | Certification, Tech Support, Stores | Stage 6 |
| Security and data ⛔ | D-SEC-1…6 (roles, HO view-as-centre, timeouts and 2FA, **Aadhaar/PAN/caste and DPDP**, retention and RPO/RTO, rotate exposed secrets), D-TZ-1 | IT, Legal | Stages 1–8 |
| Migration ⛔ | D-MIG-1…8 (history depth, journals, **never auto-balance**, merge maps, rollback window, legacy passwords, **authoritative history source**, XLS mode) | IT, Accounts, MIS | Stages 2–8 |
| Reporting | D-RPT-1/2 (past months frozen? "current student" definition) | MIS | Stage 7 |
| Removals | PR-01…13 | Module owners | Each stage |

### 9.3 Non-negotiable integrity rules (PRO; need Accounts' acknowledgement)
These are technical invariants, not policies. They are listed so that the business acknowledges them:
- every posted journal balances;
- posted records are never edited, only reversed;
- receipt = sum of allocations;
- no over-allocation;
- one receipt per successful payment;
- verified gateway callbacks only;
- idempotent collection;
- exact decimal money;
- settlement differences recorded, never absorbed;
- unapplied cash tracked.

The full list (F1–F21) is in FRD §5.

## 10. Data and migration requirements (business level)
- **DM-1:** Every legacy record receives exactly one disposition: imported, merged, split, archived, excluded (with an approved reason and approver), or rejected (must be 0 at cutover). **Nothing is silently dropped.**
- **DM-2:** The authoritative history source before 2026 is decided by IT + Accounts (D-MIG-7). The XLS import mode and the Jan–Jun 2026 overlap are decided by D-MIG-8. The XLS is **not** a financial source (it has no receipts or ledger).
- **DM-3:** Amount control totals reconcile per centre, financial year, fee head and account. **Legacy imbalances are reported and treated by Accounts, never auto-balanced** (D-MIG-3).
- **DM-4:** Legacy reports and migrated reports agree for sampled periods; every difference is explained (K10).
- **DM-5:** At least two timed full rehearsals, with all checks green, before cutover.
- **DM-6:** Legacy stays the system of record until cutover. It then stays read-only for the rollback window (default 4 weeks, D-MIG-5).
- **DM-7:** Test centres (GDEMO, KL-01-TEST3, KL-01-TEST6) and test data are excluded only by an approved rule (X14, PR-06).

**Prerequisite:** read-only access to the legacy MySQL databases. **Not yet granted**; this blocks Stage 0.

## 11. Reporting and KPI requirements
- **RP-1:** Signed definitions for "admission" (on save vs registration-fee paid; which date sets the month), "current student", and whether past months can change (D-ADM-2/4, D-RPT-1/2).
- **RP-2:** One shared implementation per KPI, used by screens, exports and the API, so the numbers cannot differ (F18).
- **RP-3:** The 16 admission and collection reports, the fee reports, the 31 accounts reports and the HRMS reports carry over, subject to removal evidence (FRD §8.9, §8.16).
- **RP-4:** Exports are scoped, permissioned, PII-gated and audited.

## 12. Integration requirements
| ID | Integration | Requirement | Decision |
|---|---|---|---|
| IN-1 | Legacy Centres API (5 endpoints) used by the management dashboard | Keep working at cutover via a versioned API plus a compatibility shim; the exposed key is rotated | D-API-1, D-SEC-6 |
| IN-2 | Payment gateways (legacy config lists world_line, traknpay, bill_desk) | Build only gateways confirmed live; verified callbacks; settlement reconciliation | D-FEE-3 |
| IN-3 | SMS / e-mail / push | Provider adapters; DLT templates; consent | D-COMM-1 |
| IN-4 | Biometric attendance | CSV import by default; device integration only if confirmed | D-HR-3 |

## 13. Compliance, security and privacy
- **CS-1:** Personal data, especially Aadhaar, PAN and caste, is stored only where justified, encrypted and masked, under the Digital Personal Data Protection Act. Legal review is required (D-SEC-4).
- **CS-2:** Hosting region is Supabase ap-southeast-1 (Singapore). This data-residency choice needs Legal confirmation (v1.2).
- **CS-3:** GST invoices and receipts follow Accounts and tax-advisor rules, including any serial-length limit (NP-5; not asserted).
- **CS-4:** All legacy secrets (API key, gateway credentials, SMTP) are rotated at cutover (D-SEC-6).
- **CS-5:** The audit trail is append-only. Backups use point-in-time recovery plus daily off-provider dumps, with a quarterly restore drill. RPO/RTO are proposed at 15 min / 4 h (D-SEC-5).

## 14. Non-functional requirements (PROPOSED; approval D-OPS-1)
| Measure | Proposed |
|---|---|
| Users at peak | 650 active (2 per centre); workload mix to confirm with Operations |
| List/search p95 | ≤ 800 ms |
| Save p95 | ≤ 1,000 ms |
| Fee collection p95 | ≤ 1,500 ms |
| Report p95 | ≤ 3 s |
| Error rate | < 0.1% |
| Export 100k rows | ≤ 120 s |
| Availability, RPO/RTO | RPO 15 min / RTO 4 h (D-SEC-5) |
| Accessibility | Usable on desktop and mobile browsers; accessibility checks in Stage 7 |

## 15. Assumptions and constraints
**Constraints (decided by the user):**
- **Stack:** Next.js + TypeScript + Prisma 7.10.1 + PostgreSQL.
- **Hosting:** Vercel with Supabase (ap-southeast-1).
- **Scope:** all modules are rebuilt eventually.
- **Migration:** from MySQL is required.

**Assumptions (to confirm):**
- The vendor can provide a read-only database dump.
- Centres keep working in the legacy system until cutover.
- No student portal.
- HO roles can be re-mapped to the new permission model.

**Dependencies:**
- legacy DB access;
- named decision owners;
- gateway and SMS provider contracts;
- Legal review (D-SEC-4).

## 16. Risks
| # | Risk | Severity | Mitigation | Owner |
|---|---|---|---|---|
| 1 | KPI definitions disagree; management numbers change at cutover | Critical | Signed definitions; golden datasets; parity checks | MIS |
| 2 | History split across GEMS and XLS with no shared keys | Critical | D-MIG-7/8; reporting-only XLS import by default | IT + Accounts |
| 3 | Finance policies unapproved (cash/accrual, GST rounding, refunds, royalty formula) | Critical | G-FIN gate; production configuration unset until signed | Accounts |
| 4 | Cross-centre data leak | Critical | Two independent gates (app + database); isolation suites in CI | IT |
| 5 | Decision backlog (>100 open items) delays every stage | High | Named owners and decision dates per stage (§17) | Sponsor |
| 6 | Centre-side screens never observed (receipt, exam registration, orders) | High | Read-only centre walkthrough in Stage 0 | Operations |
| 7 | Personal-data obligations | High | D-SEC-4/5 with Legal | IT + Legal |
| 8 | Intermittent database connection drops observed via the hosted pooler | Medium | Root-cause in-region before Stage 1 exit; idempotent retries only (v1.4 C-26) | IT |
| 9 | Scope size: 290 requirements, 44 processes | High | Staged delivery; removals on evidence only | Sponsor |

## 17. Delivery approach and acceptance
**Stages** (audit 10). Each stage exits only when:
- its linked tests pass in CI on a production-like environment and are logged;
- the isolation suites are still green;
- its decisions are signed;
- its migration dry run passes.

**A built page or a green build is never an exit.**

| Stage | Business content | Business sign-off needed |
|---|---|---|
| 0 Discovery | Legacy DB access, usage counts, centre-side walkthrough, draw missing workflows | D-SEC-1, D-MIG-7/8, D-TZ-1, D-OPS-1, PR usage results |
| 1 Security POC | Login, isolation, audit, export proofs | ADR-001 (authentication choice) |
| 2 Foundations | Identity model, numbering, audit, ticket core, migration framework | NP-1…8, D-STU-4, D-MIG-1…3 |
| 3 Centres, catalogue, enquiry, admission | WF1–3, WF7 | D-ADM, D-ORG, D-CAT, D-STU, D-SEC-4 |
| G-FIN gate | Accounts signs every finance policy | D-FIN, D-FEE, D-SCH, D-CUR, NP |
| 4 Fees, payments, accounting | WF4, WF5 | D-FEE-3, D-MIG-2/3 |
| 5 Ticket workflows | 31 ticket types, queues, SLA | D-TKT-1…4 |
| 6 Exams, certificates, supply, royalty, year close | WF8–14, WF16 | D-EXM, D-CRT, D-SUP, D-ROY, D-YEAR, D-TIE |
| 7 HR, reports, integrations, hardening | WF15, WF17a/b, reports, API shim, NFRs | D-HR, D-RPT, D-COMM, D-API-1 |
| 8 Rehearsal, UAT, cutover | ≥ 2 rehearsals; UAT against the WF sign-off sheet | Go/no-go: Accounts + Operations + IT |

**UAT acceptance:** each signed workflow is executed end to end by its owner's team on migrated data, and the results are recorded against the sign-off sheet.

## 18. Approval

| Role | Name | Decision (Approve / Approve with changes / Reject) | Date | Signature |
|---|---|---|---|---|
| Sponsor | | | | |
| Accounts | | | | |
| Operations | | | | |
| Admissions / PRO | | | | |
| Academics | | | | |
| Certification | | | | |
| MIS | | | | |
| IT | | | | |
| Legal (§13 only) | | | | |

## Appendix A: REFS backlog (reference only, not in scope)
The 2025 GEMS 2.0 proposal (REFS) was compared item by item in `docs/audit/revisions/v1.5-refs-gap-analysis.md`:
- 117 items in total: 41 already covered, 44 partly, 25 new, 7 conflicting.
- By user decision, REFS is reference only.

Its new ideas are kept as a **backlog**, to be raised again by a business owner if wanted:
- mobile apps (HO analytics; student app with online payment and certificate download);
- Exam Portal and "Gobsbank" APIs;
- fee refund workflow (note: refunds are also undocumented in legacy, D-FIN-5);
- re-registration;
- duplicate/lost certificate handling;
- expense booking → approval → payment;
- Schedule III account grouping; bill-by-bill receipts and overdue-debtor ageing;
- geo-tagged field staff tracking;
- WhatsApp messaging;
- batch suggestion;
- low-stock alerts;
- centre-director login alerts;
- inaugural offers;
- the undefined "Inventory" module.

Two REFS ideas are recorded as questions on existing decisions:
- per-scheme royalty, under D-ROY-2;
- an "RO" level above RSO, under D-ORG-5.

## Appendix B: Glossary
| Term | Meaning |
|---|---|
| HO | Head office (centre code GTECHO) |
| Centre | Franchise or own training centre (~325) |
| Centre class | Pricing/availability tier of a centre (15 values, e.g. METRO, A++, A) |
| Division / Category | Course groupings (≈23 divisions, ≈12 categories) |
| Scheme | Discount/offer rule applied at admission |
| Registration | One student's enrolment in one course (register number) |
| PRO, ASO, RSO | Head-office roles (PRO; Area and Regional Sales Officers) |
| Royalty | Head office's share of a centre's collections |
| Clearance | Monthly confirmation that a centre's royalty is settled |
| GCT | G-TEC Certified Trainer |
| Ticket | Request needing approval (corrections, changes, payments, exam requests) |
| AY / FY | Academic year / financial year (April–March) |
| RLS | Row-level security: the database-side guard that limits rows to the user's scope |
