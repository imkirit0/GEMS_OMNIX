# GEMS OMNIX: Master Requirements Audit and Implementation Readiness (v1)

Status: **AUDIT AND PROPOSED PLAN ONLY.** No application code exists, no dependency was installed, no database was touched and **no tests have been run**. Part B below is the baseline v0 draft (written earlier in this session). It is preserved unmodified as the "original matrix" the user chose to audit. All corrections live in Part A and in the artifacts proposed in A.12.

---

# PART A: Audit (v1)

## A.0 Actual repository and environment state (inspected read-only, 2026-10-26)
| Item | Finding | Evidence |
|---|---|---|
| `D:\GEMS OMNIX` | 2 files only: `GEMS ERP Rebuild Specification.pdf` (1,211,130 B, 57 pp), `GEMS Workflows for Manager Review.pdf` (1,430,484 B, 24 pp). No hidden files | `Get-ChildItem -Force -Recurse` |
| Code, package config, dependencies, DB config, tests | **None** | same |
| Git | Not a repository (no `.git`) | same; environment info |
| Requirements matrix | None in the project. User chose the v0 draft in this plan file (Part B) as the matrix to audit | AskUserQuestion answer |
| Additional sources found (user approved read-only use) | `D:\Legacy_Data\GEMS LEGACY DATA (2009-2026 March).xlsx` (157,589,257 B); `C:\Users\DELL\Downloads\GEMS-API-Data-Quality-Report.docx` (21 Sep 2026; Desktop copy has identical text); `C:\Users\DELL\Downloads\GEMS-API-Technical-Response.pdf` (GEMS-API-RESP-2026-09, 5 pp); `C:\Users\DELL\Downloads\GEMS_REQUEST.pdf` (5 Oct 2026, 9 pp) | file search; text extraction; `Compare-Object` of the two docx copies printed no differences |
| Duplicates | Both source PDFs also exist on the Desktop with identical sizes and timestamps | file search |
| Tooling available | Python 3.14.6 with openpyxl 3.1.5 (python-docx absent). Node/npm not checked | `python --version` |
| Legacy MySQL access | **None.** No schema, dump or credentials | — |

Short names used below: **SPEC** = Rebuild Specification, **WF** = Workflows, **DQR** = Data Quality Report, **APIR** = API Technical Response, **REQ** = GEMS_REQUEST, **XLS** = legacy data workbook.

## A.1 Evidence standard (replaces the C/I/Q/P/U tags of v0)
| Code | State | Meaning |
|---|---|---|
| **SRC** | Confirmed from source | Stated as observed in SPEC/WF (or DQR/APIR/REQ for API facts) with a page reference |
| **INF** | Inferred | Deduced from interface or data shape; the source says "inferred", or it is a page-name deduction |
| **REC** | Reconstructed | From an uninspected, crashing, frozen or blank page, or a "centre side, to confirm" step |
| **PRO** | Proposed | An architecture or design decision of this plan. **Not a business rule** |
| **PMC** | Pending manager confirmation | A business rule or default awaiting its owner's decision |
| **VER** | Verified by executable test | Only with a linked, recorded test run. **Count today: 0** |
| **IMP** | Implemented, unverified | Code exists without a passing test. **Count today: 0** |

Rule: a menu entry proves that a page exists, not that it is used. Usage is only established by data counts (A.7 discovery).

## A.2 What the v0 plan gets right
1. It treats the PDFs as the source, cites pages, and separates confirmed, inferred and question items.
2. It concentrates authorization in one server-side gate with DB-derived scope plus fail-closed RLS, and calls out pooling leakage with transaction-local `set_config`.
3. It writes audit in the same transaction, makes the audit table append-only, and replaces shared "access passwords" with step-up re-auth plus maker-checker.
4. It sets financial invariants (balanced journals, reversal-only, idempotency, locked numbering, closed periods) and gates posting behind Accounts sign-off.
5. It starts migration discovery early, using control totals, exception tables, rehearsals and rollback.
6. It records 8 source discrepancies (X1–X8), 7 removal proposals with impact, and ~80 decisions with UNCONFIRMED defaults.
7. It requires a POC before the build and refuses to count UI or build success as completion.

## A.3 Discrepancy report on the v0 matrix
Severity: **Critical** (would ship wrong money, access or data) · **High** (missing or misleading requirement or plan) · **Medium** · **Low**.

| ID | Sev | Finding | Evidence | Affected | Recommended correction | Owner |
|---|---|---|---|---|---|---|
| DR-01 | High | Matrix is grouped, not exhaustive. Many rows bundle 10–32 legacy pages (R-044: 32 A/c reports; R-071: 14 fee reports; R-140: ~15 voucher pages; R-171: 16 reports; R-188: 17 HR reports; R-012: 15 logs). About 230 pages map to ~140 rows, so per-page fields, filters, actions and permissions are not traceable | SPEC pp. 3–10 inventory vs v0 §1 | R-012, 044, 071, 140, 142, 171, 188 and others | Expand to **one row per legacy page or capability** (estimate 260–300 rows) in a CSV matrix with the 14 required columns; keep parent IDs for one-to-many and many-to-one links | Analyst |
| DR-02 | High | **Missing requirements** (no row at all): Push Notification Report (SPEC p3); Course Dashboard and Gtec Centre Dashboard as requirements (appear only in PR-07); hidden Academic Kit / Welcome Kit / CC Summary cards (p3); Add/Update Sem Start & End Date (p11); Transport Mode master (p39); Coursewise exam report (p41); Exam Payment Approval in Approvals tile (p45); vendor-support "New Task" form and app-download stats (p37); CRM Open Ticket and My Timesheets (p54); HRMS Services section, Biometric Master, Sync Structure (pp. 10, 56); Login Details / credential modal as an admin action (p13); Search Student "Detailed View" tab (p2) | page refs given | new rows | Add rows; classify evidence | Analyst |
| DR-03 | **Critical** | **The live GEMS Centres API is missing entirely.** Five endpoints (directory, enquiries, admissions, courselist, student_list) feed G-TEC's management dashboard; REQ adds 24 new data requests (N1–N24), 12 clarifications (C1–C12) and 12 API conventions (V1–V12). Cutover would break that consumer | REQ pp. 1–9; APIR pp. 1–5; DQR | new R-API-01..05; R-005 | Add an "Integration API" module: preserve these contracts or provide a versioned replacement, list the consumers, and add a contract test suite | Management dashboard owner + IT |
| DR-04 | **Critical** | **Data-location conflict not recorded.** APIR p4 states GEMS holds enquiries/admissions only "starting from the 2026 calendar year", and DQR shows capture effectively starting **April 2026**. Yet SPEC shows AY selectors 2020-21→2025-26, an Admitted Year master 2019–2023 (p11), and a separate XLS covering **2009 → March 2026**. So history may live outside GEMS MySQL, and migration has at least **two sources** | APIR p4; DQR §6.2–6.3; SPEC pp. 2, 11, 14; XLS file name | migration, reports, R-005 | Record as X9 and make the history-source decision (D-MIG-7) blocking. Profile XLS (A.7). The migration plan must handle two sources and their overlap | IT + Accounts |
| DR-05 | High | **Identity model gap.** Repeated names appear under different register numbers; it is unknown whether a register number is per course or per person (REQ C6). v0 models one Student with one register number. Enquiry→admission conversion cannot be computed (58,301 admissions vs 30,374 enquiries in 2026; 283 of 310 centres show admissions > enquiries; REQ C1) | REQ p3; SPEC pp. 14–15, 18, 24 | R-029, R-150, D-ADM-2, X1 | Add decision **D-STU-4** (person vs registration identity, register-number scope) and a person-dedupe rule for migration. Model Person → Student/Admission → CourseRegistration until decided | Admissions/PRO |
| DR-06 | High | **Pre-admission and future-year payments are not modelled.** Online payment fee types include Online Application Fee, Advance Payment During Admission, Next AY Application Fee, Next AY Advance Fee and Stationery. These are payments that can exist before a registration or due, but v0's financial model assumes every receipt allocates to a due | SPEC p50 | §6 of v0, F3/F4 | Add an `advance/unapplied payment` liability flow and invariant F16 (unapplied cash tracked until applied/refunded). Add decision D-FIN-9 | Accounts |
| DR-07 | High | **Removals hidden inside defaults.** The defaults for D-YEAR-1 (promotion "not built"), D-FEE-6 (fines "not built"), D-HR-1 (payroll/recruitment "deferred"), D-SUP-6 (Purchase "out of scope") and the auth design's "Resend Username and Password replaced" are scope cuts that bypass the PR register. R-004, R-025, R-056, R-101 and R-160 have target "—" before any usage check | v0 §3, §4.2, §1 | PR-01..07, listed Ds | Move every scope cut into the removal register (PR-08..PR-13) with **status "Proposed, usage unchecked"**; targets become "Pending decision", not "—" | Each owner |
| DR-08 | High | **No usage evidence behind any removal.** PR-05 cites "mostly unused" (SPEC p14) with no DB counts. Promotion/depromotion, TC request, siblings, mobile settings, fines and HRMS payroll all need row counts by year | SPEC pp. 14, 28, 53–54, 57 | PR-05, PR-06 | Each PR needs a usage query (count, last-used date, centres using) from M0 discovery before approval | IT |
| DR-09 | High | **Acceptance tests are labels only.** ~300 AT/E2E IDs are referenced, but there are **0 definitions and 0 executable tests**. Naming is inconsistent (AT-RPT-FEE vs AT-RPT-*, AT-ACC-RPT-nn "one per report" undefined) | v0 throughout | all | Write test definitions (fixture, steps, expected DB state, audit events, negative cases) in artifact 09; a naming scheme `T-<module>-<nnn>`; each requirement row links ≥ 1 test | QA lead |
| DR-10 | High | **Cross-module rules are tested only per module.** Admission counting (CRM→students→fees→reports), course completion (exams→registration→certificates→placement), scheme discount (fees↔students↔course change tickets), royalty (fees→accounts→royalty→clearance), centre class (org→catalogue→fees→schemes) and year closing (accounts, fees, numbering, academics) | SPEC pp. 18–19, 45; WF 1–14 | R-170, 121, 053, 072, 059, 027 | Add cross-module scenario tests XM-01..XM-08 (A.5) | QA lead |
| DR-11 | High | **Milestones scheduled before their dependencies.** Proposed defaults in M3 (centre activation by approver, D-ORG-1) and M4 (course approval ticket, D-CAT-2) need the ticket engine (M5). Fee cancellation/transfer (M8) need tickets. Migration discovery (M0) needs DB access nobody has granted | v0 §9 | M3, M4, M8, M0 | Build a minimal ticket engine in the foundation stage (documented reason), keep the full approval workflows in stage 5, and make DB access an explicit M0 blocker | Architect |
| DR-12 | Medium | **Evidence misclassified.** R-142 (material) is marked C although its order/issue/despatch pages froze (SPEC pp. 17–18) → REC. Workflow diagrams WF1–8 are marked "yes" without flagging the "centre side, to confirm" steps (WF p1) → those steps are REC. R-150's admission form is seen only from HO → centre-side behaviour REC. R-115 and R-141 are correctly INF but should be REC | SPEC pp. 17–18, 29; WF p1 | R-142, 150, 115, 141, WF1–17 | Reclassify; mark per-step centre-side verification (A.5) | Analyst |
| DR-13 | Medium | **Source-page references: not exhaustively verified.** A spot check of 25 v0 references against the PDFs found no wrong page. The remaining references are unverified | manual check this session | all | Verify each reference during the CSV expansion; add a `ref_checked` column | Analyst |
| DR-14 | Medium | **Unverified external claim in v0.** "Auth.js Credentials works only with JWT sessions" comes from my prior knowledge and was not verified in this session | v0 §4.1 | auth design | Mark PRO/unverified; the POC verifies the library before choosing it | Architect |
| DR-15 | Medium | **Missing count conflicts** (control totals): centres 325 (REQ, 5 Oct), 326 (DQR, 21 Sep), 327/328/386 (SPEC); courses 1,220 distinct codes with 196 codes carrying 2–4 names (REQ A6, DQR §4); student_list records 56,336 vs Home "Total Students" 43,513; test centres GDEMO, KL-01-TEST3, KL-01-TEST6 and head-office GTECHO (HO ID 800) in production data; 6 malformed centre codes | REQ, DQR, APIR, SPEC | X2, X5 | Extend the discrepancy list (X9–X14 in A.4) | IT |
| DR-16 | Medium | **Missing decisions:** timestamp time zone (REQ C10); region semantics mixing states, countries and directions (REQ C11; X6); centre lifecycle (closing, agreement dates, franchise vs own; REQ C9, N11); "current student" definition (REQ C12); whether past-month figures can change (REQ C3); legacy API key exposed in guides (REQ V11) | REQ pp. 3–4, 8 | decision register | Add D-ORG-5, D-ORG-6, D-RPT-1, D-RPT-2, D-SEC-6, D-TZ-1 | listed in A.4 |
| DR-17 | Medium | **Non-functional requirements largely absent** (performance, export limits, connection limits, job retries, observability, accessibility, DR) | v0 | all | Add A.9 with **proposed** targets awaiting approval | Architect + Ops |
| DR-18 | Medium | **The workflow mapping lacks actors, fixtures, transitions, side effects, negative cases, DB state and audit events** | v0 §1.13 | WF1–17 | A.5 | QA lead |
| DR-19 | Low | v0 §5 is an empty "reserved" heading; numbering gap | v0 | — | Remove in the artifact version | Analyst |
| DR-20 | Medium | **Course-code hygiene risks the new data model:** codes contain spaces, `/` and `&` (`UI/UX`, `DUI&GD CLTX`), leading/trailing spaces, and empty codes | DQR §3–4, REQ A7 | catalogue, migration | Surrogate keys everywhere; codes validated by pattern on write; migration normalisation rules approved by Academics | Academics |
| DR-21 | Medium | **Payment and API secrets.** The legacy API key was printed in the guides (REQ V11) and legacy gateway credentials (salt, keys) sit in centre settings (SPEC p14). v0 covers encryption at rest but not rotation of exposed legacy secrets at cutover | REQ p8; SPEC p14 | security | Add to the cutover runbook: rotate all gateway credentials and API keys; never migrate secrets in plaintext | IT + Accounts |

## A.4 Additions to the decision register (all proposed defaults UNCONFIRMED)
New source conflicts: **X9** history location (GEMS only from 2026 vs SPEC AY history vs XLS 2009–Mar 2026); **X10** centres 325/326/327/328/386; **X11** students 56,336 registrations (API) vs 43,513 (Home KPI); **X12** 2026 admissions 58,301 (REQ, 29 Sep) vs Home 63,779 vs Admission Summary 65,211; **X13** 1,220 course codes (API) vs ~1,359 (MIS); **X14** test centres and the HO record inside production data.

| ID | Decision | Owner | Evidence | Proposed default (UNCONFIRMED) | If wrong | Regression test |
|---|---|---|---|---|---|---|
| D-STU-4 | Is identity per person or per registration; is the register number per course or per person | Admissions/PRO | REQ C6; SPEC pp. 14–15, 18, 24 | Person entity + admission + course registration; register number per registration (matches the observed duplicates) | Cannot count people; duplicate persons; wrong certificates | T-STU person dedupe; XM-01 |
| D-ADM-4 | What event creates an admission record, and which date assigns it to a month | Admissions + MIS | REQ C1, C2; SPEC p45 | Record exists on save; counted by join date when the registration fee is paid (SPEC p45 rule) | Conversion KPIs wrong | T-RPT rule tests, XM-01 |
| D-RPT-1 | Can past-month figures change (cancellations, refunds) | MIS | REQ C3 | Figures are recomputed live; a monthly snapshot is frozen at month close for reporting | Reports drift silently | T-RPT snapshot |
| D-RPT-2 | Definition of "current student" | MIS | REQ C12 | Registration status Active with end date ≥ today | KPI mismatch with HO | T-RPT KPI |
| D-ORG-5 | Region semantics (state vs country vs direction) and hierarchy | Operations | REQ C11; SPEC p33 | Separate Country/State fields from a sales "Region" grouping | Mis-grouped reports | T-ORG hierarchy |
| D-ORG-6 | Centre lifecycle: status, opening/closing dates, franchise/own, agreement start/expiry | Operations | REQ C9, N11 (not in the legacy form) | Add the fields; closing keeps history (soft close) | Lost renewal tracking | T-ORG lifecycle |
| D-TZ-1 | Time zone of legacy timestamps; storage zone for the new system | IT | REQ C10, V9 | Store UTC (`timestamptz`); display Asia/Kolkata by default, per-centre zone for overseas centres; legacy zone **to be determined** | Month boundaries shift | T-MIG timezone |
| D-SEC-6 | Exposed legacy API key and gateway secrets | IT | REQ V11 | Rotate at cutover; new API issues per-consumer keys, hashed at rest | Credential misuse | cutover checklist |
| D-API-1 | Keep the legacy Centres API contract for the management dashboard, or replace it with a versioned API | Dashboard owner | REQ, APIR | Versioned `/api/v1` replacement + a compatibility shim for the 5 legacy endpoints until the dashboard migrates | Dashboard breaks at cutover | contract tests T-API-01..05 |
| D-MIG-7 | Authoritative source for pre-April-2026 history: legacy MySQL, the XLS workbook, or both | IT + Accounts | X9 | Both are profiled. The XLS is an import source only for history absent from MySQL | Duplicated or missing history | T-MIG control totals |
| D-FIN-9 | Advance and application payments before admission or for the next AY | Accounts | SPEC p50 | Unapplied-payment liability; applied to dues when created; refund per D-FIN-5 | Revenue recognised early; lost advances | T-FIN advances |
| D-OPS-1 | Approval of NFR targets in A.9 | IT + Operations | none in sources | Use A.9 values | Under- or over-built infrastructure | load tests |

Removal register additions (status **Proposed; usage unchecked**): **PR-08** fines (D-FEE-6) · **PR-09** promotion/depromotion (D-YEAR-1) · **PR-10** HRMS payroll & recruitment (D-HR-1) · **PR-11** Purchase app (D-SUP-6) · **PR-12** emailing credentials ("Resend Username and Password" → reset link) · **PR-13** vendor-support "New Task" form and app-download stats (SPEC p37). Each needs a usage query result + the owner's approval before its status can change.

## A.5 Workflow-to-test mapping (specification for artifact 05)

For each workflow: **Actors/permissions · Preconditions/fixtures · State transitions · Side effects · Negative/duplicate cases · Expected DB state · Reports/audit · Centre-side or manager verification (REC steps) · Questions · Owner/approval**. All approvals are currently **Not signed**.

| WF | Actors · fixtures | Transitions · side effects | Negative / duplicate cases | Expected DB, reports, audit | REC steps needing verification | Qs · owner |
|---|---|---|---|---|---|---|
| 1 Enquiry→admission | centre counsellor (crm.enquiry.create), centre admin (students.admission.create); fixture: centre, course offered by centre class, live scheme, fee structure, prefix counters | enquiry New→FollowUp→Converted/Lost/Junk; admission saved → admission no + register no allocated; registrations created; dues generated when Fee Assign is ticked | double-click Save → one admission (idempotency); enquiry already converted → rejected; course not offered to the centre → rejected; out-of-scope centre → 403; counter contention → unique numbers | 1 person/admission, n registrations, dues = structure − scheme; enquiry.converted_student_id set; audit: create admission, number allocation; Admission report counts only per D-ADM-2 | whole centre lane is from HO view; "Enroll Student" modal behaviour (SPEC p33) | D-ADM-1..4, D-STU-4 · Admissions/PRO |
| 2 Catalogue & availability | HO academics (catalogue.course.manage); fixture: categories, divisions, certifications, exams | course Draft→Approved(?)→Live; centre class assign; special-case centres; final exam mapping | course without final exam mapping → cannot be Live (proposed); centre class removed while registrations exist → existing ones unaffected | course visible only to assigned classes; mapping log rows | Who approves (no evidence) | D-CAT-1..3 · Academics |
| 3 Centre onboarding | HO operations (org.centre.create, org.centre.activate) | Inactive→Active; credentials invite; permissions; prefixes; course & fee assignment | duplicate centre code (incl. whitespace variants) → rejected; login before activation → blocked; activation without prefixes → blocked (proposed) | centre + users + number_series rows; audit of each setting; secrets encrypted | centre lane: logo, QR, bank, staff, batches | D-ORG-1..6 · Operations |
| 4 Fee setup & collection | HO accounts (fees.structure.manage); centre cashier (fees.receipt.create) | due Open→PartPaid→Paid; receipt Active→Cancelled (via ticket); online attempt Generated→Processed→Success/Failed; posting to journal | retry with same idempotency key → same receipt; over-allocation → rejected; cancelled receipt re-cancel → rejected; forged callback → rejected; closed period → rejected | F1–F16 hold; Day Book, Fee Collection, Fee Due reports equal journal/sub-ledger; audit for receipt, cancel, step-up | receipt screen unseen (SPEC p49); partial/installment rules | D-FEE-1..5, D-FIN-1..9 · Accounts |
| 5 Schemes & concessions | HO marketing/accounts (fees.scheme.manage) | scheme Draft→Live→Expired; rule per fee type; applied at admission; later change via ticket | expired scheme on new admission → rejected; scheme not applicable to course/geo → rejected; two schemes per registration → per D-SCH-2 | concession_application rows; Concession log; Scheme Wise report | centre selection UI unseen | D-SCH-1..3 · Marketing/Accounts |
| 6 Ticket engine | centre raiser; HO approvers per level/role; viewers | Pending→(L1..L4 Approved)→Approved/Rejected; Forwarded; final approval applies change once | approve twice / concurrent approvers → one application; requester approving own ticket → rejected; approver out of scope → rejected; apply failure → full rollback | ticket_action history; domain change + audit in one tx | per-type level configuration unknown | D-TKT-1..4 · Ops/PRO |
| 7 Student corrections & course change | centre raiser; PRO approver | correction ticket → record updated automatically; course change sets scheme, rule, join/end dates; mode change queue | proof missing where mandatory → rejected; stale old value (record changed meanwhile) → rejected; course change with paid fees → per D-STU-2 | old registration status Course Change; reports exclude it; audit before/after | centre-side ticket form | D-STU-1..4 · PRO |
| 8 Exam lifecycle | HO certification; centre admin | schedule → registration (+ payment) → approval ticket → hall ticket → result → completion | registration outside window → rejected; prerequisite result unpublished → rejected (semester); duplicate registration same exam/date → rejected; result import with unknown reg no → exception row | registration, payment, result rows; completion flag; Exam Result Log | centre registration screens unseen (SPEC p29) | D-EXM-1..3 · Certification |
| 9 Certificate | centre raiser; certification team; despatch | Requested→Approved→Issued(no.)→Printed→Validated→Despatched→Received | issue without approved request → rejected; duplicate certificate number → impossible (unique); edit after issue → ticket | certificate log events; public verification token | **diagram absent (prose only)**; templates & QR page unseen | D-CRT-1..4 · Certification |
| 10 Voucher & licence | centre orderer; HO tech support; accounts approver | order → payment → approval ticket → codes issued (expiry) → assigned to student → vendor registration status | issuing more codes than stock → rejected; assigning an expired code → rejected; same code twice → unique | stock decrement, order balance, activity log | **prose only**; centre order/cart screens unseen | D-SUP-1..3 · Tech Support |
| 11 Material kits | centre orderer; HO stores; accounts | cart → order → payment → approval → issue from stock → despatch → received | stock below zero → rejected; despatch before issue → rejected | material log action types (SPEC p37) | **prose only**; order/issue/despatch pages froze | D-SUP-4..6 · Stores |
| 12 SAP plans | centre; HO SAP support | plan/rate → order → payment approval → issue licences → stock report | issue > purchased → rejected | purchased = issued + remaining | **prose only** | D-SUP-7..9 · Tech Support SAP |
| 13 Royalty & clearance | system job; centre payer; HO accounts | monthly computation → payment → approval → clearance request → certificate | recompute same month twice → idempotent; pay twice → rejected | royalty rows tie to collections per D-ROY-2 | **prose only**; formula unknown | D-ROY-1..3 · Accounts |
| 14 Year closing & promotion | HO accounts/IT | AY create → class order → (promotion?) → due carry-over → prefixes → FY close; reversible today | closing with open reconciliation differences → blocked; posting to closed period → rejected | period status, opening balances, new number series | **prose only**; promotion use unknown | D-YEAR-1..3 · Accounts/IT |
| 15 Attendance, syllabus, placement | faculty/centre admin; HO reader | batch → faculty assign → attendance per session → coverage → placement flag/entry | attendance for a batch outside scope → rejected; duplicate session mark → upsert | coverage report | **prose only** | D-ACA-1..3 · Academics/Placement |
| 16 Tie-up pricing | centre proposer; regional approver | proposal → approve/reject (+ suggested fee) → scheme/special case | approval below floor (if adopted) → rejected | tie-up approval audit | **prose only**; downstream fee link manual? | D-TIE-1..3 · Regional managers |
| 17a Recruitment | HR | application → approval → interview → exam → demo → score → approved → employee | score approval without all stages → per HR | employee created with login | **prose only**; usage unknown | D-HR-1..3 · HR |
| 17b Payroll | HR/accounts | structure → timesheet → register → LOP → payroll Pending→Finalized→Verified → payslips → bank statement | regenerate a finalized payroll → rejected | payroll rows; bank statement totals | **prose only**; HO masters empty | D-HR-1..3 · HR/Accounts |
| 18 Sign-off inventory | each owner | per-workflow Confirmed / Corrections | — | signed sheet stored with the evidence log | sheet empty today (WF pp. 23–24) | all owners; lists 4 missing workflows (BDO, ID card, SMS/push, CRM pipeline) → D-GAP-1 |

Cross-module scenarios (DR-10):
- **XM-01** enquiry→admission→fee→Admission report count.
- **XM-02** exam pass→course completion→certificate→placement flag.
- **XM-03** scheme applied→course change ticket→dues recalculated→receipts reallocated→books balance.
- **XM-04** collections→royalty→payment→clearance.
- **XM-05** centre class change→catalogue visibility→fee structure for new admissions only.
- **XM-06** year close→numbering restart→dues carry-over→reports per AY/FY.
- **XM-07** cross-centre isolation through every module's list, export and job.
- **XM-08** migration dry run→report parity.

## A.6 Security review addendum (beyond v0 §4)
- **Client-supplied identifiers are never trusted.** Centre IDs, role names and scope arrive only from the DB session. Request bodies carrying `centreId` are validated against the resolved scope and the target row's own `centre_id` (the row is loaded under RLS first).
- **Bulk operations and imports** (fee import, result import, code import, employee import, bulk approvals) run row by row under the same authorize + RLS path inside a batch job. They produce a per-row exception report, cap file size and row count, are idempotent by file hash + job key, and are audited per batch with counts.
- **Raw SQL paths:** only report SQL views running as `gems_app` (RLS applies). Lint bans unsafe raw calls. A test enumerates every policy and asserts that every table with `centre_id` has RLS FORCE enabled (a schema test that fails when a new table forgets RLS).
- **Background jobs:** each job declares the permissions and scope it needs. A test runs every job against two centres and checks the outputs per centre. Job inputs are never taken from request parameters.
- **Recovery / incident response:** backups (Neon PITR + daily off-provider logical dump, encrypted), a quarterly restore drill, a security incident runbook (revoke sessions, rotate keys, preserve audit), and alerting on auth anomalies (failure spikes, new-device HO logins).
- **Redaction:** audit before/after JSON stores masked Aadhaar/PAN/bank numbers, and secrets are never logged. Log scrubbing is tested.
- **Cross-centre suite (executable plan):** v0 cases 1–14, plus 15 background job output isolation, 16 bulk import that names a foreign centre's register numbers → rows rejected, 17 failed authorization leaves no side effects (no number consumed, no audit "success" row, a denial row only), 18 legacy-API shim keys scoped per consumer, 19 schema test for RLS coverage. **None of these has run yet.** "RLS is secure" may only be claimed after they pass against the real roles and policies.

## A.7 Migration and data-quality addendum
**Legacy workbook profile:** see A.7.1 (filled from the read-only profiling run; no row values were copied).
Sources to profile in M0: (1) GEMS MySQL `gsch_*` and the HRMS/CRM/Accounts/Purchase databases (**access required**); (2) the XLS workbook; (3) the legacy Centres API as a cross-check for counts only.
Known quality issues to carry into the exception rules (from DQR/APIR/REQ):
- 6 malformed centre codes;
- test centres GDEMO, KL-01-TEST3, KL-01-TEST6, and HO record GTECHO;
- 1,274 centre-course rows with whitespace codes;
- 196 codes with multiple names;
- codes containing `/` and `&`;
- 3 empty course codes;
- 4 codes missing from the master (since added per APIR);
- 1 blank student name (KL-01-TEST6);
- Jan–Mar 2026 near-zero capture;
- 38 centres with admissions but no enquiries.
Rules (in addition to v0 §7): every source record ends in exactly one of **migrated / merged (with survivor id) / archived / rejected (with rule)**, so the ledger table `migration.disposition` covers 100% of source keys. Legacy accounting inconsistencies are **reported, never auto-balanced**; each needs an approved treatment (D-MIG-3).

### A.7.1 Legacy workbook profile
**Method:** a read-only openpyxl pass (`python -I` with a scratchpad script). It printed only headers, counts, fill rates, distinct-count estimates (capped at 5,000) and min/max dates, with **no row values**. Run time 108 s. The output is saved to the session scratchpad.

**Structure:**
- 18 sheets, one per calendar year `2009`…`2026`.
- All sheets share the same 20 columns: `CenterID, LocationName, Name, address, TotalFee, FirstInsallment, NoofInstallments, InstallmentAmount, Duration, JoinDate, Completed, ParentName, Sex, FeeCompleted, CourseCode, CourseName, SchemeName, District, State, Country`.
- Grain appears to be **one row per course enrolment**. This is inferred (INF) from JoinDate + Course per row.

**Rows (iterator count, which includes a few trailing partial rows):**

| Sheet | Rows |
|---|---|
| 2009 | 15,681 |
| 2010 | 72,475 |
| 2011 | 98,809 |
| 2012 | 97,054 |
| 2013 | 41,746 |
| 2014 | 59,531 |
| 2015 | 46,647 |
| 2016 | 51,211 |
| 2017 | 57,201 |
| 2018 | 56,492 |
| 2019 | 54,813 |
| 2020 | 27,617 |
| 2021 | 62,646 |
| 2022 | 105,643 |
| 2023 | 116,807 |
| 2024 | 108,024 |
| 2025 | 116,094 |
| 2026 | 29,712 |
| **Total** | **≈ 1,218,203** |

Distinct centres per year rise from 198 (2009) to 320 (2025).

**Findings (each becomes a migration exception rule or decision):**

| # | Finding | Consequence |
|---|---|---|
| XL-1 | **No student ID, admission number, register number, DOB, phone or email.** Person identity is only name + parent name + address + sex | Persons cannot be deterministically deduplicated or linked to GEMS records. Fuzzy matching needs an approved rule and manual review (D-STU-4, D-MIG-7) |
| XL-2 | **No receipts, dates of payment or accounting entries.** Only a fee plan (TotalFee, first installment, count, amount) and a `FeeCompleted` flag | The XLS **cannot** support ledger migration. At most it is historical memo/reporting data (D-MIG-2) |
| XL-3 | **2026 sheet JoinDates run 2026-01-01 → 2026-06-29**, despite the file title "2009–2026 March" and GEMS capture starting April 2026 | Overlap with GEMS for Apr–Jun 2026. Double-count risk (**X15**) |
| XL-4 | Excel type corruption: date values appear in `TotalFee` (2011, 2019), `Duration` (2011, 2024), `NoofInstallments`/`InstallmentAmount` (2024), and `address`, `Name`, `ParentName` (several years) | Values must be validated by type; corrupted cells are rejected to exceptions, never coerced |
| XL-5 | Enum drift: `Completed` has 2–4 distinct values, `Sex` 2–4, `FeeCompleted` 2–6 depending on the year | Value maps must be approved per year |
| XL-6 | CourseCode vs CourseName counts disagree every year (e.g. 2023: 813 codes / 699 names; 2021: 745 / 760) | Many-to-many naming. Catalogue mapping must be approved by Academics |
| XL-7 | `CenterID` and `LocationName` are 1:1 per year except 2024 (315 vs 316, plus 1 blank ID) | Centre key mapping to GEMS codes is needed; the legacy CenterID format is unknown |
| XL-8 | The workbook holds PII (names, parent names, addresses) for ~1.2M rows on a local drive | Handling and retention decision (D-SEC-4/5). Do not copy it into the repo or the POC |

New conflict **X15**: XLS 2026 rows (Jan–Jun) vs GEMS records from April 2026 vs the file title "to March". New decision **D-MIG-8**: overlap resolution rule for Jan–Jun 2026, plus whether the XLS is imported as full person/registration history or as reporting-only aggregates. Default (UNCONFIRMED): reporting-only historical table, no person merge, with the overlap excluded from the XLS side.

## A.8 Proof of concept: addition to v0 §8
**P8 Migration dry run with reconciliation output.**
- Fixture: a synthetic dataset shaped like the XLS/legacy tables (no real PII), with seeded defects (whitespace codes, duplicate persons, a test centre, an unbalanced voucher).
- Test: run the ETL twice from scratch.
- Expected:
  - identical target state both times (idempotent);
  - the disposition table covers 100% of source keys;
  - counts per entity/centre match source = migrated + merged + archived + rejected;
  - control totals per centre/FY match;
  - seeded defects appear in the exception report;
  - **no balancing entry is created**.
- Failure conditions: any source key without a disposition; a non-deterministic id mapping; a silent drop; an auto-generated balancing entry.
- Evidence artifact: `poc/evidence/P8-<date>.json` plus the exception CSV.
- Every P1–P8 result is recorded in the evidence log (artifact 12) with command, commit, timestamp and output. Using the real XLS in the POC requires separate approval.

## A.9 Operational and UI quality requirements (PROPOSED targets, awaiting D-OPS-1)
Sizing basis (from sources): ~325 centres; ~56–65k course registrations and ~30–33k enquiries per year (2026); 1,220 course codes; ~241k centre-course offer rows; ~16.5k tickets; history back to 2009 (XLS). Assumed peak load, **to be confirmed**: 2 active users per centre, 100 concurrent requests.

| Area | Proposed target |
|---|---|
| Lists | All server-paged (max page size 100), indexed filters/sorts; p95 ≤ 800 ms at 100 concurrent requests on production-sized data |
| Reports | p95 ≤ 3 s for the 16 admission reports over one AY; heavier ones pre-aggregated |
| Exports | Streamed; ≤ 100k rows synchronous; above that an async job; function memory ≤ 512 MB; every export audited |
| DB connections | Pooled endpoint for runtime; per-function pool size 1–5; alarm at 70% of the Neon limit; `statement_timeout` 15 s for interactive, 120 s for jobs |
| Jobs | At-least-once delivery with idempotency keys; 3 retries with exponential backoff; dead-letter table; run history UI; alert on failure |
| Files | Max 10 MB per upload (zip 100 MB for bulk photos); retention per D-SEC-5; signed URLs ≤ 5 min |
| DR | RPO ≤ 15 min, RTO ≤ 4 h; quarterly restore drill with recorded result |
| Accessibility | WCAG 2.2 AA; full keyboard operation of forms, tables and dialogs; visible focus; labels and error association; axe checks in CI |
| Layout | Usable from 360 px width up; data tables scroll horizontally inside their container |
| Forms | zod validation shared client/server; field-level messages; a "missing fields" summary (as legacy); no data loss on validation error |
| States | Empty, loading and error states on every list; errors say what to do next and carry a request id |
| Observability | Structured JSON logs with request id, user id and centre id (no PII); metrics for latency, error rate and job outcomes; alerts on 5xx rate, auth failures, reconciliation differences and job failures |

## A.10 Revised roadmap (user's stage order; one justified change)
**Justified change:** a **minimal ticket engine core** (types, levels, approve/reject, atomic `apply`) moves into Stage 2. Centre activation (S3), catalogue approval (S3), and fee cancel/amount change/transfer (S4) depend on it (DR-11). Stage 5 then delivers the full approval workflows, queues, SLA reminders and all 31 ticket types.

Every stage needs:
- **Exit criteria:** linked tests pass in CI with evidence logged; the cross-centre suite stays green; owners' decisions for the stage are signed; migration mapping + dry run for the stage's entities pass control totals. **UI completeness or a green build alone is never exit.**
- **Rollback:** expand/contract migrations, module feature flags, and legacy remaining the system of record until Stage 8.

| Stage | Scope | Requirements | Prerequisites | Tests | Security checks | Migration impact | Approvals |
|---|---|---|---|---|---|---|---|
| 0 Discovery | Expanded CSV matrix (DR-01/02/03); legacy DB access; schema + counts + usage queries; XLS profile; consumers of the legacy API; manager sign-off sheet; role matrix export | all | DB/API access granted | data-profile scripts reproducible | access to legacy data read-only, PII handling agreed | source inventory, X1–X14 explained | all owners for D-ADM, D-ORG, D-CAT, D-SEC, D-MIG-7, D-TZ-1, D-OPS-1 |
| 1 Security POC | P1–P7 minimal app | R-009..013 | Stage 0 partial; architecture approval | P1–P7 + cross-centre 1–19 | RLS roles/policies, pooling, session revoke | none | you (architecture) |
| 2 Data model, numbering, audit, migration foundation | schema core (person/student/registration, centre, catalogue skeleton), number series, audit, ticket core, ETL framework + P8 | R-011, 012, 029, 094 (core) | Stage 1 passed | numbering concurrency, audit immutability, ticket atomicity, P8 | schema RLS coverage test | ETL framework, disposition ledger | D-NUM-1, D-STU-4, D-MIG-1..3 |
| 3 Centre, catalogue, enquiry, admission, student lifecycle | WF1, 2, 3, 7 (corrections need ticket core) | R-020..035, 080..092, 150..156 | Stage 2 | WF1/2/3/7 E2E, XM-01, XM-05 | scope on all lists/exports | centres, masters (dedupe map), courses, enquiries, persons, registrations | D-ADM-*, D-ORG-*, D-CAT-*, D-STU-*, PR-05 usage |
| 4 Fees, receipts, payments, accounting | WF4, 5; accounts; gateway(s); advances | R-040..077 | Stage 3; **signed financial spec** (v0 §6 + DR-06) | F1–F16, P6 at scale, gateway sandbox replay/forgery, XM-03 | step-up, maker-checker, secret rotation | dues, receipts, journals per FY; reconciliation vs legacy A/c reports | D-FEE-*, D-FIN-1..9, D-SCH-*, D-CUR-1 |
| 5 Ticket workflows | all 31 types, queues, SLA, approval dashboards | R-094..096, 118, 144 | Stage 2 core; Stages 3–4 handlers | WF6 E2E, per-type apply tests | out-of-scope approval, self-approval | historical tickets + actions | D-TKT-1..4 |
| 6 Exams, certificates, supply, royalty, year closing | WF8–14, 16 | R-110..146 | Stages 4–5 | WF E2E each, XM-02, XM-04, XM-06 | public verification page, imports | exam/cert/supply/royalty history | D-EXM, D-CRT, D-SUP, D-ROY, D-YEAR, D-TIE |
| 7 HRMS, reports, integrations, hardening | WF15, 17a/b; 16 admission reports + all others; comms; legacy API shim; NFRs | R-150s, 170..188, R-API | Stage 6 | report parity vs legacy control totals; load tests vs A.9; a11y checks; DR drill | pen test (external, recommended) | HR, report snapshots | D-HR, D-RPT, D-COMM, D-API-1, D-OPS-1 |
| 8 Rehearsal, UAT, cutover | ≥ 2 full rehearsals, UAT on the sign-off sheet, cutover, hypercare | all | Stages 0–7 exit | full migration checks, UAT scripts | key/secret rotation, access review | final load + disposition 100% | go/no-go: Accounts + Operations + IT |

## A.11 Remaining unknowns (what is missing, why it matters, how to obtain it, what it blocks)
| Unknown | Why it matters | How to obtain | Blocks |
|---|---|---|---|
| Legacy MySQL schema, counts, usage | Mapping, removals, control totals | Read-only replica or dump from the vendor (d'Katia) | Stage 0 exit, all migration |
| Where pre-2026 history lives (X9) | Two-source migration | IT + XLS profile + vendor answer to REQ C4/A1 | D-MIG-7, Stage 2 |
| Centre-side screens (receipt, exam registration, orders, cart, hall ticket print) | REC requirements | A centre login walkthrough (read-only) | Stages 3, 4, 6 |
| Diagrams WF9–17 | Steps known only from prose | Analyst redraw + manager review | Stage 6 |
| Role/permission matrix | RBAC seed | Role List export (SPEC p36) | Stage 1/2 |
| Gateway in use, SMS/email/push providers | Integrations | Accounts/Ops | Stages 4, 7 |
| Legacy password hash scheme | Credential migration | Vendor | Stage 8 |
| Legacy time zone | Month boundaries | Vendor (REQ C10) | Stage 2 |
| Royalty formula, refunds policy | Money correctness | Accounts | Stages 4, 6 |
| Legal position on Aadhaar storage | Compliance | Legal | Stage 3 |

## A.12 Artifacts to create after approval (no overwrites; new folder)
Folder `D:\GEMS OMNIX\docs\audit\` (it does not exist today; each file is created only if absent). PDFs untouched; no `git init`, no app code.

| File | Content |
|---|---|
| `00-README.md` | index, evidence standard (A.1), how to update |
| `00-baseline-v0-plan.md` | **verbatim copy of Part B** (the original matrix, preserved) |
| `01-executive-architecture-review.md` | A.0, A.2, the architecture with corrections (DR-14 etc.), top risks |
| `02-requirements-traceability-matrix.csv` + `02-…-summary.md` | expanded matrix with the 14 columns (ID, source doc, page, original name, fields/filters/actions/permissions, target, deps, evidence, owner, decision status, test ID, impl status, verification evidence, migration treatment, removal rationale) + `ref_checked` |
| `03-requirements-discrepancy-report.md` | A.3 + X1–X14 |
| `04-manager-decision-register.md` | v0 §3 + A.4 + PR-01..13, all UNCONFIRMED |
| `05-workflow-to-test-mapping.md` | A.5 expanded with per-step REC flags |
| `06-security-threat-model.md` | v0 §4 + A.6 |
| `07-financial-invariants-and-transactions.md` | v0 §6 + F16, D-FIN-9 |
| `08-data-migration-and-reconciliation-plan.md` | v0 §7 + A.7 |
| `09-test-strategy-and-acceptance-criteria.md` | naming scheme, test definitions, XM scenarios, NFR tests |
| `10-implementation-roadmap.md` | A.10 |
| `11-proof-of-concept-specification.md` | v0 §8 + P8 |
| `12-evidence-and-verification-log.md` | every command run, file read and test result; today lists **0 tests run** |

Expanding the CSV to page level (DR-01) is the largest task. It is done by re-reading SPEC pages section by section, not from memory, with page references checked as rows are written.

After the artifacts are written: stop and wait for review. No foundation work begins until the POC plan is approved.
