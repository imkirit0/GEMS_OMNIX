# GEMS OMNIX: Architecture Review and Pre-Implementation Gate

Status: **REVIEW ONLY. Nothing has been implemented, no code exists, and no test has been run.** This document replaces the earlier draft plan. Implementation of the foundation waits for approval.

---

## 0. Actual repository state (inspected 2026-10-26)

| Item | Finding |
|---|---|
| `D:\GEMS OMNIX` | Contains exactly 2 files: `GEMS ERP Rebuild Specification.pdf` (1.21 MB, 57 pages) and `GEMS Workflows for Manager Review.pdf` (1.43 MB, 24 pages) |
| Source code, config, package files | None |
| Git | Not a git repository |
| Legacy MySQL schema or dump | **Not available.** The only schema evidence is the table prefix `gsch_` and a truncated name `gsch_student_co…` (Spec p20) |
| Both PDFs | Read in full, every page |
| Evidence gap | Workflows doc diagrams for WF9–WF17 (pp. 17–22) render only as grey placeholder boxes carrying step counts ("certificate lifecycle · 8 steps, 1 decision"). The step boxes are **not** in the PDF, so those flows are known only from their prose |

### Evidence tags used throughout
- **[C] Confirmed:** observed in the live system and stated in the PDFs.
- **[I] Inferred:** the PDFs mark it as deduced, or it is drawn from page names or the Super Admin view only ("centre side, to confirm").
- **[Q] Manager question:** open in the Workflows doc or the Spec's open-questions list.
- **[P] Proposed architecture:** a design choice in this document. Not a business rule.
- **[U] Unresolved:** a conflict or gap that needs a decision before the build.

### Source discrepancies found while reading (must be resolved; they also matter for migration control totals)
| ID | Discrepancy | Sources |
|---|---|---|
| X1 | Register numbers "reset per academic year prefix" vs "2000001 onwards, global" | Spec p14–15 vs p18 |
| X2 | Centre count: 327 (header/filters), 328 (Hall Ticket, Tie-ups filters), 386 (Accounts "Branch") | p2, p32, p34, p15 |
| X3 | Total admissions: 63,779 (Home KPI) vs 65,211 (Admission Summary) | p2, p17 |
| X4 | Exams: 62 (p18, p28), 61 (p40), 59 (mandatory exam list p35). Certifications: 58 (p18) vs 57 (p35) | — |
| X5 | Course divisions: 23 (p18, p30) vs 22 (Course Division master p16). Courses: ~1,200 (p30), 1,350+ (p18), 1,359 (p46), ~1,400 batches (p12), 1,375 (p54) | — |
| X6 | Regions: 17 (Region master p16) vs 18 (filters p18, p33) | — |
| X7 | Enquiries 32,743 (Home) vs CRM leads ~34,120 (two pipelines, overlap unknown) | p2, p54 |
| X8 | Ticket Prefix current number 23,652 vs 16,542 tickets raised | p38 |

---

## 1. Requirements traceability matrix

Columns: **ID** · **Legacy feature** · **Source (doc:page)** · **Evidence** · **Target module** · **Status** · **Acceptance test** · **Open questions / dependencies**.
`S` = Spec, `W` = Workflows. Every row is currently **Not started**. A status changes only when its acceptance test passes in CI with evidence attached.

Target modules (new): `core` (auth/RBAC/audit/shell), `org`, `catalogue`, `tickets`, `crm` (enquiry+lead), `students`, `fees`, `accounts`, `payments`, `exams`, `certs`, `supply` (voucher/licence/SAP/material), `royalty`, `academics`, `hrms`, `reports`, `comms`, `migration`.

### 1.1 Cross-cutting and shell
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-001 | Header quick icons, global search (Course/Staff/Student/Reg No/Enq No), Search Student page | S:2–3 | C | core | AT-CORE-01: search returns only in-scope records | RBAC |
| R-002 | Notification bell + HO Notification List (licence orders, payments) | S:3 | C | comms | AT-COMM-01 | event catalogue (D-COMM-1) |
| R-003 | Change password, logout, last-login, session-year selector (2020-21…2025-26) | S:2–3 | C | core | AT-CORE-02 | D-YEAR-3 |
| R-004 | Help editor, chatbot widget, SMS login modal (hidden on every page) | S:2 | C | — | — | Proposed removal PR-08 |
| R-005 | Home dashboard: 5 KPI cards w/ Year/Month/Scheme filters, Scheme Toppers, Area Toppers, Collection Toppers, notifications feed, notice board | S:2–3, 17 | C | reports | AT-REP-01: KPIs equal criteria-based queries (R-170) | D-ADM-2 (what counts as an admission) |
| R-006 | DataTable standard (search, sort, page size, Copy/Excel/CSV/PDF/Print/Columns) | S:10, 18 | C | core | AT-CORE-03: server paging; export authorized and audited | — |
| R-007 | Filter cascade Region→Area→Centre, AY, category, division, course, cert, exam, fee type, scheme, dates | S:18 | C | core | AT-CORE-04: options limited to the user's scope | X2, X6 |
| R-008 | Masters quick-add + refresh list | S:18 | C | core | AT-CORE-05 | — |
| R-009 | Data-driven menus/roles/permissions (Menu Settings, Permission Master 854 perms/151 modules, Role Permissions, Users, Role List export) | S:2, 36 | C | core | AT-SEC-* (section 5) | D-SEC-1 (role matrix) |
| R-010 | Centre impersonation (Centre List "Login" column, switchSchoolloginAdmin) | S:2, 35 | C | core (replaced) | AT-SEC-08: HO acts in scope without impersonation, and every act is audited | PR-01, D-SEC-2 |
| R-011 | Scope & numbering (centre + AY ownership; prefix counters) | S:18 | C | core | AT-NUM-01..04 | X1, D-NUM-1 |
| R-012 | Audit & logs: 15 log reports (login, user status, payment login, SMS, mark entry, observation, remarks, enquiry enrol, certificate, material, student, concession, cert validation, QR) | S:6, 19, 36–37 | C | core (single ActivityLog) + log views | AT-AUD-01..03 | — |
| R-013 | Security observations to redesign: hard-coded approvals password, password prompts on fee cancel/amount change, impersonation, SQL leak | S:19, 28, 44 | C | core | AT-SEC-05, 06, 08, 12 | — |

### 1.2 Organisation and Master Settings
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-020 | Masters dashboard: Semester/Section, Student Category, Religion (51, dirty), Caste (963), Mother Tongue (24), Category (OBC/GENERAL/SC), Support Login, Add Bank, Blood Group (8), Academic/Admitted Year | S:9, 10–11 | C | org | AT-ORG-01: CRUD + soft delete + audit + uniqueness | D-MIG-4 (dedupe) |
| R-021 | Assign dashboard: Branch/Batch assign (Assign/Change Class), Semester assign, Class Sort Order (~1,400 batches) | S:9, 12 | C | academics | AT-ACA-01 | D-YEAR-1 (promotion) |
| R-022 | Centre Master/List: view, edit, delete, password reset, Permission, Mobile Settings | S:12 | C | org | AT-ORG-02 | — |
| R-023 | Centre Creation form: identity, classification (board, type, category, class 16 values, level 4 values, parent), cascading location, finance (GST, state/interstate), default permission, Login Details table, resend credentials | S:12–13 | C | org | AT-ORG-03 + WF3 E2E | D-ORG-1..3 |
| R-024 | Centre Permission settings (~60 flags: fee, parent login, notification, timetable, payment gateway credentials, format, email SMTP) | S:13–14 | C | org | AT-ORG-04: flags exist that change behaviour; gateway secrets encrypted | D-ORG-4 (flags in use) |
| R-025 | Mobile Settings (per-role app switches) | S:14 | C, "mostly unused" | — | — | PR-05; Spec open Q (portal/app) |
| R-026 | Accounts Prefix ({centre}/{TYPE}/{FY}/; ADMREC, CON, FEEREC, INV, JOU, REC, VOU) + New Prefix | S:14 | C | accounts / core numbering | AT-NUM-02 | D-NUM-1 |
| R-027 | Academic & Financial Year mgmt: FY table, closing checklist (5 steps), closing steps table, new AY activation, copy prefix; "do not close browser" | S:14 | C | accounts (year-end) | AT-YE-01 (WF14) | D-YEAR-1..3 |
| R-028 | Academic Year Master (sessions) | S:14 | C | org | AT-ORG-05 | — |
| R-029 | G-TEC Admission No & Register No prefix (GTEC2627 current 43887; 2000001 current 2064112) | S:14–15 | C | core numbering | AT-NUM-01 | X1 |
| R-030 | Accounts Prefix Type / Receipt Type (Other, Registration, Fee Receipt) | S:15 | C | accounts | AT-ACC-01 | — |
| R-031 | Royalty Master (20.00%, one row) | S:15 | C | royalty | AT-ROY-01 | D-ROY-1 |
| R-032 | GST Master (18/9/9/18, one row) | S:15 | C | accounts | AT-FIN-GST-* | D-FIN-4 |
| R-033 | Location & classification masters: Country 255, State 73, District 43, Region 17, Area 48, Centre Class 15, Course Category 11, Division 22, Curriculum (empty), Level 1–4; centre category page crashes; 3 legacy school masters (test data) | S:16 | C | org / catalogue | AT-ORG-06 | X5, X6; PR-06 |
| R-034 | QR Code Master (centre payment QR, 2 of 327 uploaded) | S:36; W:5 | C | org | AT-ORG-07 | D-ORG-3 |
| R-035 | Support Login, Add Bank (company, branch, account type, opening balance, IFSC, online payment flag) | S:11 | C | org / accounts | AT-ACC-02 | — |

### 1.3 Accounts sub-application
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-040 | Separate app with its own FY selector, A/c Reports menu, notification list | S:15 | C | accounts (merged into the single app) | — | PR-02 |
| R-041 | Add Prefix (Receipt/Voucher/Contra/Journal per branch & FY) | S:15 | C | accounts | AT-NUM-02 | — |
| R-042 | Chart of accounts (31 heads with codes: income, assets, liabilities incl. CGST/SGST/IGST and receivables, Excess Fee, Fee_Transfer, expenses) | S:15 | C | accounts | AT-ACC-03: every fee type maps to exactly one income head | D-FIN-1 |
| R-043 | Receipt List (filters, columns, new receipt, print, cancellation needs remarks + password) | S:16 | C | accounts | AT-FIN-REV-01 | D-FIN-3 |
| R-044 | 32 A/c reports (Day Book, Cash/Bank Book, Ledger, Cheque Register, Caution Deposit Register, Reconciliation Statement, Outstanding/Issued cheques, Pay-in slip, Opening balances, Account Head reports, Fee Collection Statement, Receipt & Payment, I&E variants, Trial Balance, Accumulated Fund, Balance Sheet [blank for Super Admin], Invalid Bank Transactions, Consolidated Fee Collection, FY Updation) | S:16 | C | accounts | AT-ACC-RPT-nn, one per report; trial balance nets to zero | "Invalid Bank Transactions (credit/debit difference check)" means the legacy ledger can be unbalanced. Migration must reconcile (section 7) |

### 1.4 Fee Management
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-050 | Fee Category (12) | S:4, 47 | C | fees | AT-FEE-01 | — |
| R-051 | Fee Type Master (behaviour flags, misc kind, category, previous-year mapping, order, particular, term 1–4, 12 months, assign type, HSN, short code; royalty flag) | S:4, 47; W:20 | C | fees | AT-FEE-02 | D-ROY-2 (royalty-bearing types) |
| R-052 | Fine Master (empty) | S:48 | C | fees | AT-FEE-03 | D-FEE-6 (are fines used?) |
| R-053 | Scheme Master (242, 146 live; nature 5; applicability by category/division/courses, geography Area/Centre) | S:48; W:9–10 | C | fees | AT-SCH-01..04 | D-SCH-1..3 |
| R-054 | Scheme Rule Master (per AY, fee type, amount or %) | S:48 | C | fees | AT-SCH-02 | — |
| R-055 | Student Fee Remarks | S:48 | C | fees | AT-FEE-04 | — |
| R-056 | Fee Parent / Fee Group Master (school, empty) | S:48 | C | — | — | PR-05 |
| R-057 | Fee Caption Master (installments, 13 captions, down-payment flag) | S:48 | C | fees | AT-FEE-05 | — |
| R-058 | Misc Fee Centre Assign | S:48 | C | fees | AT-FEE-06 | — |
| R-059 | Regular Fee Assign (term/monthly/yearly layouts; optional; excluded-from-consolidated; bank account) and Regular Fee Assign – Beta (by centre class + centres) | S:48–49; W:7–8 | C | fees (one page) | AT-FEE-07: one structure applies to every centre in the tier | PR-03 (merge normal and Beta) |
| R-060 | Scheme Assign – Beta, Scheme Edit | S:49 | C | fees | AT-SCH-05 | D-SCH-2; maker-checker? D-FEE-2 |
| R-061 | Miscellaneous Fee Assign, Other Fee Assignment | S:49 | C | fees | AT-FEE-08 | D-FEE-1 |
| R-062 | Fee Import, Fee Import Update, Paid Fee Import (historic receipts CSV) | S:49 | C | fees / migration | AT-FEE-09 | Paid Fee Import must post accounting (D-FIN-7) |
| R-063 | Student Balance Due Posting = Fee Due Posting (prev-year balances to new year) | S:49 | C | fees / year-end | AT-YE-02 | D-YEAR-2 |
| R-064 | Collect Fee (receipt screen **not seen**: centre side) | S:49, 29 | I | fees + accounts | AT-FIN-COL-01..06 | Spec open Q #1; D-FIN-2 |
| R-065 | Fee Cancel (cancel, multiple revert; remarks + access password) | S:49 | C | fees (ticket RCT) | AT-FIN-REV-01 | D-FEE-2 |
| R-066 | Fee Amount Change (password) | S:50 | C | fees (ticket) | AT-FEE-10 | D-FEE-2 |
| R-067 | Fee Hold/Unhold | S:50 | C | fees | AT-FEE-11 | meaning of "hold" (blocks what?) D-FEE-5 |
| R-068 | Online Payment Recheck & Settlement; A/c Posted Details (statuses Failed/Generated/Processed/Success, MID) | S:50 | C | payments | AT-PAY-01..06 | D-FEE-3 (live gateways) |
| R-069 | Payment Mode Wise Fee Collection Report | S:50 | C | reports | AT-RPT-FEE-01 | — |
| R-070 | Generate Challan = Fee Due SMS (push/SMS/email) | S:50 | C | comms | AT-COMM-02 | PR-03 merge; Spec open Q (providers) |
| R-071 | Fee reports: Hold/Unhold, Fee Due/Balance Due, Fee Collection, Student Fee Assign, Fee Collection Summary, Online Payment, Collection Detail, Reconciliation, Concession Assigned, Fee Type Wise, Paid Scheme, Daily Collection (dead link), Settlement Summary (with Difference), Fees Balance | S:4–5, 50–53 | C | reports | AT-RPT-FEE-02..15 | Daily Collection: PR-07 |
| R-072 | Royalty Fee Collection (per centre/month: old/new/total collection, royalty, tax, total, payment status) | S:5, 53; W:19–20 | C | royalty | AT-ROY-02 | D-ROY-1..3 |
| R-073 | G-TEC Fee Particulars (5 rows, HSN, receipt type categories) | S:5, 53 | C | fees | AT-FEE-12 | — |
| R-074 | G-TEC Reports: Collective Topper List, Fee Report Total, Student Fee Status (Home drill-down), Royalty Fee Collection Gtec, Daybook | S:5, 53 | C | reports | AT-RPT-FEE-16..20 | — |
| R-075 | Fees Dashboard quick icon (per fee head Total vs Collected, taxable/tax split) | S:3, 53 | C | reports | AT-RPT-FEE-21 | — |
| R-076 | Receipt Transfer (move a paid receipt between students; bulk cancel) | S:6, 35–36 | C | fees (ticket) | AT-FIN-TRF-01: transfer is reversal + new allocation, books balance | D-FEE-2 |
| R-077 | Payment modes (16: Cash, Bank, Cheque, DD, NEFT, UPI, Card, Online, Campus Wallet, VAS, Agent, Adjustment, BBPS…) | S:25, 51 | C | payments | AT-PAY-07 | D-FEE-3 |

### 1.5 General: front office, CRM, centres, courses, permissions, tickets
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-080 | Set Up Front Office (Purpose, Complaint Type, Source, Reference) | S:33 | C | crm | AT-CRM-01 | — |
| R-081 | Enquiry Form (fields, 16 paths, 13 types, preference rows with scheme/price preview) + Enquiry list + Enroll Student modal | S:33; W:1–2 | C | crm | AT-CRM-02 + WF1 E2E | D-ADM-1 |
| R-082 | Enquiry Reports (Enquiry, Conversion) | S:33 | C | reports | AT-RPT-CRM-01 | — |
| R-083 | Admission Reports (31-column canonical export) | S:33 | C | reports | AT-RPT-ADM-01 | — |
| R-084 | Phone Call Log | S:34 | C | crm | AT-CRM-03 | — |
| R-085 | CRM sub-app (leads ~34,120, statuses, sources, bulk actions, lead form, status master, calendar, tickets add) | S:3, 54 | C | crm (merged) | AT-CRM-04 | PR-02; D-ADM-1 |
| R-086 | College Tie-ups (proposal fee breakdown, approve/reject) | S:5, 34; W:21–22 | C | supply/tieups | WF16 E2E | D-TIE-1..3 |
| R-087 | ID Card: student/staff templates, generate, photo upload (single/bulk zip) | S:5, 34 | C | academics | AT-ACA-IDC-01 | missing workflow (W:24) |
| R-088 | G-TEC Feedback/Appraisal (questions, types, categories, infra/self/consolidated reports) | S:5, 34 | C | academics | AT-ACA-FB-01 | — |
| R-089 | Centre Creation, Centre List (+ Update Web/App Permissions push) | S:5, 35 | C | org | AT-ORG-03, 08 | — |
| R-090 | G-TEC Courses (course master, full field list, fee rows, Special Case – Assign Centre, Course List GTEC, Final Exam Mapping button) | S:6, 34–35; W:3–4 | C | catalogue | AT-CAT-01..05 + WF2 E2E | D-CAT-1..3 |
| R-091 | Centre Course Assign (crashes), Course Centre Class Assign | S:6, 35 | C | catalogue | AT-CAT-06 | PR-07 (crashing page replaced) |
| R-092 | Certification master (Voucher/Licence, 57) | S:35 | C | catalogue | AT-CAT-07 | X4 |
| R-093 | Role Permissions, Role List, Users, Permission Master, Menu Settings | S:6, 36 | C | core | AT-SEC-* | D-SEC-1 |
| R-094 | Tickets: Ticket Type (31 types, codes, categories, doc mandatory, approval type, priority, levels 1–4, viewers), Main/Sub Category, Prefix, Exam-Request→Cert mapping, Centre Tickets (KPIs), Tickets Approval List (Course Change modal), Ticket Report & History | S:6, 37–38; W:11–12 | C | tickets | AT-TKT-01..10 + WF6 E2E | D-TKT-1..4 |
| R-095 | Student correction tickets (FNC, LNC, MNC, GPC, FPC, SMS, GDR, EMC, GNC, NC), CSC, CC, CMC | S:37; W:13–14 | C | students + tickets | WF7 E2E | D-STU-1..3 |
| R-096 | Course Mode Approval (separate queue, 1,680 requests) | S:8, 46 | C | tickets | AT-TKT-11 | D-STU-3 |
| R-097 | Certificates dashboard (R-130..) | S:6, 38–39 | C | certs | see 1.8 | — |
| R-098 | BDO Activity (master + plan) | S:8, 46 | C | crm | AT-CRM-05 | missing workflow (W:24) |
| R-099 | Marketing (Monthly Target, Scheme Target, Division-wise report) | S:9, 47 | C | reports | AT-RPT-MKT-01 | D-SCH-3 |
| R-100 | MIS Reports (Course List, Fee Details, Centre-Course List) | S:8, 46 | C | reports | AT-RPT-MIS-01..03 | — |
| R-101 | Message (internal messaging app; does not load) | S:8, 46 | C | — | — | PR-04 |
| R-102 | Placement require updation | S:8, 42 | C | academics | AT-ACA-PL-01 | D-ACA-3 |

### 1.6 Admission and Collection reports (business rules)
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-170 | Criteria Reference rules: enquiries by enquiry date excluding deleted/inactive; admissions = registrations with join date in range **and registration fee paid**; billing = taxable course fee by join date; collection = taxable fees by join date **and** receipt date; down payment & installments by both dates; "Course Change" excluded | S:45 | C | reports | AT-RPT-RULE-01..06: golden dataset with expected numbers | D-ADM-2 |
| R-171 | 16 reports: Student, Keltron (33-col govt layout), Scheme Wise, Date Wise, Course Wise, Division Wise, Enquiry Mode Wise, Drop Out, Lagging, Centre Transfer, Fast Track/Super Fast, Centre Wise (500 error), Monthly Summary, District Wise, Region Wise, Monthly Count | S:8, 45–46 | C | reports | AT-RPT-ADM-02..17 | Keltron layout must be exact (external portal) |
| R-172 | Admission Summary Report (65,211) and toppers lists | S:17 | C | reports | AT-RPT-ADM-18 | X3 |

### 1.7 Exams
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-110 | Workflow guides (Semester 7 steps, IAB 5 steps) | S:7, 40 | C | exams (in-app help) | — | — |
| R-111 | Exam Master (main/sub, fee, processing fee, subjects, schedule patterns) | S:7, 40 | C | exams | AT-EXM-01 | X4 |
| R-112 | Exam Centre Rate, Re-Exam Centre Rate, Exam Rate List, Exam Duration | S:7, 40–41 | C | exams | AT-EXM-02 | — |
| R-113 | Exam Schedule (registration/notification/schedule/payment dates, applicable centres) → dashboard notices | S:7, 41 | C | exams | AT-EXM-03 | — |
| R-114 | Sub Exam Mapping, Exam Cert Mapping, Course Final Exam Mapping (+log), Registration Form Master (vendor flow flags 1–4, CSV templates, period) | S:7, 41 | C | exams | AT-EXM-04..07 | — |
| R-115 | Centre-side Semester/IAB registration screens + hall ticket print (**not seen**) | S:29, 40 | I | exams | AT-EXM-08 | Spec open Q #2 |
| R-116 | Student Exam Registration List, Exam Results, Result Update (single), Result Import (with/without grade) | S:7, 41 | C | exams | AT-EXM-09..11 | D-EXM-3 |
| R-117 | Student Registration Update, Registration List Report, Payment Details, Complete Registration, G-TEC Examination Report, Internship & WE lists, Mark Faculty Registration | S:7, 42 | C | exams/reports | AT-EXM-12..16 | — |
| R-118 | Approval queues: EPA, EBPA, IERA, AERA, rejected re-exam, WEERA, exam date request (RSEDR/RSEDRC), Special Exam Request | S:7–8, 42 | C | tickets | AT-TKT-12..18 | D-TKT-1 |
| R-119 | Exam Result Log (1,941) | S:42 | C | core audit view | AT-AUD-04 | — |
| R-120 | Rule: previous sub-exam result published before next registration | S:40; W:16 | C (semester) / Q (others) | exams | AT-EXM-17 | D-EXM-2 |
| R-121 | Rule: passing mapped final main exam completes the course | S:7, 41; W:15–16 | C | exams | AT-EXM-18 | — |
| R-122 | Hall Ticket Approval, Hall Ticket (Academics menu) | S:9, 32 | C | exams | AT-EXM-19 | — |

### 1.8 Certificates
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-130 | Certificate Type (flags, content type incl. Income Tax & Clearance, template with student-field picker); Prefix Master renders blank | S:38 | C | certs | AT-CRT-01 (template rendering sanitized) | — |
| R-131 | CCCR & ICR approval (with exam result + Fee Due link) | S:38–39, 44–45; W:17 | C | certs + tickets | AT-CRT-02 | D-CRT-4 (block if dues?) |
| R-132 | Issue Certificates (G###### numbers, statuses Not Issued→Issued→Printed→Validated→Despatched→Received, preview with print disabled) | S:39 | C | certs | AT-CRT-03..05 | D-CRT-1..2 |
| R-133 | Certificate Issue Report, Despatch (courier, tracking, transport mode master), Approve Certificate Payment, Edit Certificate (live preview) | S:39 | C | certs | AT-CRT-06..09 | D-CRT-3 |
| R-134 | Certificate print templates + public QR validation page (**not seen**) | S:29 | I | certs | AT-CRT-10 | Spec open Q #6; D-CRT-3 |

### 1.9 Centre commerce
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-140 | Voucher & Licence (vendor master 21, add/import codes, rate master by buyer type & slab, stock list, centre orders & issuance, edit order certification + log, payment approval VPA, reports, exam link request, Tally registration dashboard, certification type master 29, voucher form registration list, registration status updation, tally) | S:8, 17, 42–43; W:17–18 | C | supply | WF10 E2E, AT-SUP-01..10 | D-SUP-1..3 |
| R-141 | Centre-side order screens & cart (**not seen**) | S:29 | I | supply | AT-SUP-11 | Spec open Q #3 |
| R-142 | Material & Product (order payment status, issue, despatch, import, vendor 30, product master, damaged stock, purchase, material type 27 kits, rate master, kit prefix, kit assign, kits overview, reports) | S:8, 17–18, 44; W:18–19 | C (some pages froze, not opened) | supply | WF11 E2E, AT-SUP-12..20 | D-SUP-4..6 |
| R-143 | SAP Module (plan, rate w/ carry forward, purchase, approve, issue, stock) | S:9, 46–47; W:19 | C | supply | WF12 E2E | D-SUP-7..9 |
| R-144 | Fund Transfer / Exam Approvals dashboard (10 queues), Registration Approval dashboard (3 queues), Approvals tile (hard-coded password; 4 queues) | S:8, 44–45 | C | tickets (unified queue) | AT-TKT-19 | PR-01 |
| R-145 | Clearance Certificates (Royalty Payment Approval, Clearance Requests) | S:9, 46; W:19–20 | C | royalty | WF13 E2E | D-ROY-3 |
| R-146 | Purchase sub-app (pos_new "Gesta ERP"; not inspectable) | S:3, 55 | I | **unknown** | — | D-SUP-6, Spec open Q #5 |

### 1.10 Academics
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-150 | Admission form (3 tabs, missing-fields panel, multi-course grid with fee assign/division/category/course/scheme/rule/discounts/batch/dates/mode/status, installment type; personal, parent, address, siblings, transport, concession/RTE, previous marks; additional info; 5 documents) | S:9, 30–31; W:1–2 | C | students | AT-STU-01..05 + WF1 E2E | D-ADM-1..3; PR-05 (siblings, transport, RTE) |
| R-151 | Staff (Faculties list; created in HRMS; groups redirect) | S:9, 17, 31 | C | hrms | AT-HR-01 | PR-02 (one staff list) |
| R-152 | Attendance dashboard: subjects (376), faculty assign, attendance marking, course batch, coverage report | S:9, 31–32; W:21 | C | academics | WF15 E2E | D-ACA-1..2 |
| R-153 | Academic Calendar (+ FY closing/cancel modals with password) | S:9, 32 | C | academics / accounts | AT-YE-03 | D-YEAR-2 |
| R-154 | Placement List | S:9, 32 | C | academics | AT-ACA-PL-02 | D-ACA-3 |
| R-155 | Timeslot Updation (Batch Updation) | S:9, 32 | C | academics | AT-ACA-03 | — |
| R-156 | Syllabus (modules, syllabus) | S:9, 32 | C | catalogue | AT-CAT-08 | — |

### 1.11 Non Academics
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-160 | TC Master (blank), TC Request Form | S:4, 53–54 | C | — | — | PR-05 |
| R-161 | Student Promotion/Depromotion, College Promotion/Depromotion Single | S:4, 54; W:20 | C | academics (conditional) | AT-YE-04 | D-YEAR-1 |

### 1.12 HRMS
| ID | Feature | Source | Ev | Target | Acceptance test | Open / deps |
|---|---|---|---|---|---|---|
| R-180 | Home (clock in/out, calendar, attendance chart) | S:10, 55 | C | hrms | AT-HR-02 | D-HR-1 |
| R-181 | General masters (Year/Month, Department, Designation 111, Group, Leave Types, Shift, Earnings & Deductions, Service Request Types) | S:10, 55 | C | hrms | AT-HR-03 | D-MIG-4 |
| R-182 | Employee List, Create Employee (9 tabs incl. GCT competency, additional certification, salary, bank, nominee, shift, login), Import, Updation, Service Book | S:10, 55–56 | C | hrms | AT-HR-04..06 | D-HR-2; D-SEC-4 (Aadhaar/PAN) |
| R-183 | Attendance (Timesheet with biometric Sync Now, Register, Import) | S:10, 56 | C | hrms | AT-HR-07 | D-HR-3 |
| R-184 | Leave Request / Stock | S:10, 56 | C | hrms | AT-HR-08 | — |
| R-185 | Recruitment (application → approval → interview → exam → demo → score → approved) | S:10, 56; W:22 | C | hrms | WF17a E2E | D-HR-1 |
| R-186 | Shift Management | S:10, 56 | C | hrms | AT-HR-09 | — |
| R-187 | Payroll (salary structure, pay structure, payroll generate/cancel, payslips, multiple edit, verification, bank statement) | S:10, 56 | C | hrms | WF17b E2E | D-HR-1 (may be unused) |
| R-188 | 17 HR reports (attendance … ESI, EPF, LOP, monthly salary) | S:10, 57 | C | reports | AT-RPT-HR-01..17 | D-HR-1 |

### 1.13 Workflows (all 18 manager-review workflows)
| WF | Name | Source | Diagram | Requirement rows | E2E acceptance | Decisions blocking |
|---|---|---|---|---|---|---|
| WF1 | Enquiry to admission (8 steps, 1 decision) | W:1–2 | yes | R-081, 085, 150, 029 | E2E-01 | D-ADM-1..3 |
| WF2 | Course catalogue & centre availability (9) | W:3–5 | yes | R-090–092, 114, 059 | E2E-02 | D-CAT-1..3 |
| WF3 | Centre onboarding (9, 1) | W:5–7 | yes | R-023–026, 034 | E2E-03 | D-ORG-1..3 |
| WF4 | Fee setup & collection (10) | W:7–9 | yes | R-050–071 | E2E-04 | D-FEE-1..3, D-FIN-* |
| WF5 | Schemes & concessions (9) | W:9–11 | yes | R-053, 054, 060 | E2E-05 | D-SCH-1..3 |
| WF6 | Generic ticket approval engine (7, 1) | W:11–12 | yes | R-094 | E2E-06 | D-TKT-1..3 |
| WF7 | Student data & course change tickets (7, 1) | W:13–14 | yes | R-095, 096 | E2E-07 | D-STU-1..3 |
| WF8 | Exam lifecycle (9, 1) | W:15–17 | yes | R-110–122 | E2E-08 | D-EXM-1..3 |
| WF9 | Certificate lifecycle (8, 1) | W:17 | **prose only** | R-130–134 | E2E-09 | D-CRT-1..3 |
| WF10 | Voucher & licence supply (9) | W:17–18 | prose only | R-140–141 | E2E-10 | D-SUP-1..3 |
| WF11 | Material kits & products (9, 1) | W:18–19 | prose only | R-142 | E2E-11 | D-SUP-4..6 |
| WF12 | SAP licence plans (7) | W:19 | prose only | R-143 | E2E-12 | D-SUP-7..9 |
| WF13 | Royalty & clearance (6, 1) | W:19–20 | prose only | R-031, 072, 145 | E2E-13 | D-ROY-1..3 |
| WF14 | Academic & financial year closing with promotion (8, 1 loop) | W:20 | prose only | R-027, 063, 161 | E2E-14 | D-YEAR-1..3 |
| WF15 | Attendance, syllabus coverage & placement (9) | W:21 | prose only | R-152, 154, 156, 088 | E2E-15 | D-ACA-1..3 |
| WF16 | College tie-up pricing approval (6, 1) | W:21–22 | prose only | R-086 | E2E-16 | D-TIE-1..3 |
| WF17a | HRMS recruitment (7, 1) | W:22 | prose only | R-185 | E2E-17a | D-HR-1..3 |
| WF17b | HRMS payroll (9) | W:22 | prose only | R-187 | E2E-17b | D-HR-1..3 |
| (missing) | BDO activity, ID card generation, SMS & push notifications, CRM lead pipeline | W:24 | none | R-098, 087, 070, 085 | — | D-GAP-1: must be drawn and signed off |

Acceptance-test ID convention: `AT-<AREA>-nn` are automated (Vitest against real Postgres, or Playwright). `E2E-nn` are Playwright scripts that follow the workflow, plus manager UAT sign-off on the W:23–24 sheet.

---

## 2. Proposed removals and merges (none approved; each needs owner sign-off)
| ID | Proposal | Source evidence | Business impact if wrong | Owner |
|---|---|---|---|---|
| PR-01 | Replace HO impersonation and the Approvals password with scoped access + step-up re-auth | S:19, 28–29, 44 | HO staff lose the "see exactly what the centre sees" view. Mitigation: a read-only "view as centre scope" filter | Operations / IT |
| PR-02 | Merge the 5 apps (GEMS, HRMS, CRM, Accounts, Purchase) into one; one staff list; one enquiry pipeline | S:2, 28, 54 | Users of CRM features absent from GEMS (bulk status, sources, calendar) lose them unless ported. Purchase usage unknown | Admissions, HR, Accounts |
| PR-03 | Merge duplicate pages (normal/Beta fee assign, normal/Beta scheme assign, Due Posting pages, Challan/Due SMS, Log Report/Activity Log) | S:28 | Low, if the Beta behaviour is the one kept. Confirm which variant is live | Accounts |
| PR-04 | Drop the legacy Message app (does not load) in favour of notifications | S:46 | If any centre uses it, internal messaging is lost | Operations |
| PR-05 | Drop school-ERP leftovers: transport, hostel, house/clubs, mess, library, TC master/request, siblings, RTE, quota, mobile settings, fee parent/group, timetable flags | S:1, 28 | Low per Spec, but **TC Request Form, Promotion and Siblings show some data** (S:53–54). Confirm zero live use from DB counts before dropping | Academics |
| PR-06 | Do not migrate test/legacy data: 3 legacy school masters, "-delete" courses, test schemes/vendors/roles | S:16, 28 | Historic registrations may reference them; need FK-safe archival rather than deletion | IT + Accounts |
| PR-07 | Rebuild (not copy) crashing/blank pages: Gtec Centre Dashboard, Centre Course Assign, Centre Wise Report, Daily Collection, User Status Log, Enquiry Enrolment Log, TC/Prefix Master, Course Dashboard | S:28 | Requirements for these pages are partially unknown because they never rendered | Each module owner |

---

## 3. Decision register

Every **Proposed default is UNCONFIRMED**. It is used only to unblock design and must not ship as an approved rule until the owner signs it. Defaults are implemented as configuration where possible.

| ID | Decision required | Owner | Evidence | Proposed default (UNCONFIRMED) | If wrong | Test after approval |
|---|---|---|---|---|---|---|
| D-ADM-1 | Real lead source: GEMS Enquiry, CRM or both; keep one | Admissions/PRO | W:2 Q1; S:54 two pipelines | One merged enquiry/lead entity | Lost lead history or duplicated counts | E2E-01; dedupe test on migration |
| D-ADM-2 | Admission counted on save or on registration-fee paid | Admissions + MIS | W:2 Q2; S:45 reports count on fee paid | Store both states; reports use "fee paid" (matches legacy reports) | KPI totals change vs legacy; targets/toppers misstated | AT-RPT-RULE-02 golden data |
| D-ADM-3 | Who may edit an admission after save; which fields need tickets | PRO | W:2 Q3; W:14 Q1 | Identity/contact fields only via tickets; others editable by centre admin | Uncontrolled edits to certificate names, or too much friction | AT-STU-05 field-level permission |
| D-CAT-1 | Is centre class still the course availability mechanism | Academics | W:4 Q1 | Keep centre class + special-case centres | Courses sold where not allowed | AT-CAT-06 |
| D-CAT-2 | Who approves new courses and fee heads; recorded? | Academics/Accounts | W:4 Q2 | New course goes live only via approval ticket | Unapproved pricing live | AT-CAT-09 |
| D-CAT-3 | Course versioning by intake vs edit in place | Academics | W:5 Q3 | Versioned fee structures per AY (already AY-keyed); course master edit in place with audit | Historical registrations repriced | AT-FEE-13: old registrations unchanged after fee edit |
| D-ORG-1 | Who creates centres; agreement/royalty/GST checks before login | Operations | W:7 Q1 | Centre created Inactive; activation requires a checklist + approver | Centres trading before agreement | AT-ORG-09 |
| D-ORG-2 | Centre class decided at creation or revisable; by whom | Operations | W:7 Q2 | Revisable via ticket; history kept | Wrong prices/courses retroactively | AT-ORG-10 |
| D-ORG-3 | What a centre must finish before admitting (QR, bank, staff, batches) | Operations | W:7 Q3; 2/327 QR uploaded | Nothing beyond Active status (matches practice) | Admissions without payment setup | AT-ORG-11 |
| D-ORG-4 | Which of the ~60 centre permission flags are actually used | IT/Ops | S:13–14 | Migrate only flags with non-default values in the DB | Lost centre-specific behaviour | migration exception report |
| D-FEE-1 | Allow fees not first assigned as dues (walk-in misc) | Accounts | W:9 Q1 | Allowed only through an "ad-hoc due" created in the same transaction | Unreconcilable receipts | AT-FIN-COL-05 |
| D-FEE-2 | Fee cancel/amount change/transfer/scheme edit: password or approval ticket | Accounts | W:9 Q2; RCT ticket type exists (S:38) | Tickets (maker-checker) + step-up re-auth | Fraud risk, or operational delay | AT-FIN-REV-01, AT-SEC-06 |
| D-FEE-3 | Payment modes really used; which gateway is live (Worldline, Traknpay, BillDesk) | Accounts | W:9 Q3; S:14, 50 | Build adapter interface; implement only the confirmed live gateway(s) | Wasted build, or a missing live gateway at cutover | AT-PAY-* per gateway |
| D-FEE-4 | Partial and installment payment rules; allocation order across dues | Accounts | S:29 open Q #1 | Oldest due date first, then fee order | Wrong outstanding per head; GST misreported | AT-FIN-COL-03 |
| D-FEE-5 | Meaning of Fee Hold | Accounts | S:50 | Hold = due excluded from collection and reminders | Collection blocked or allowed wrongly | AT-FEE-11 |
| D-FEE-6 | Fines used? (Fine Master empty) | Accounts | S:48 | Fine engine not built; field kept | Missing late fees | — |
| D-SCH-1 | Who creates/signs off schemes; may centres propose | Marketing/Accounts | W:10 Q1 | HO creates; goes live only after approval | Unauthorized discounts | AT-SCH-06 |
| D-SCH-2 | Multiple schemes per student; course-change effect on discount | Marketing/Accounts | W:10 Q2 | One scheme per registration; course change re-evaluates via ticket | Wrong dues | AT-SCH-07 |
| D-SCH-3 | Expired schemes for old admissions; targets ↔ admissions | Marketing | W:11 Q3 | Existing registrations keep their scheme; new selection only if valid on admission date | Mispriced new admissions | AT-SCH-04 |
| D-TKT-1 | Level-1 approver and number of levels per ticket type | Ops/PRO | W:12 Q1 | Migrate current configuration as-is | Approvals stuck or bypassed | AT-TKT-03 |
| D-TKT-2 | Rejected ticket re-openable or new ticket | Ops | W:12 Q2; W:14 "centre may re-raise" | New ticket linked to the rejected one | Lost audit trail | AT-TKT-06 |
| D-TKT-3 | Turnaround target, auto-reminder/escalation | Ops | W:12 Q3 | Reminders on; no auto-escalation | Backlog (2,412 pending today) | AT-TKT-09 |
| D-TKT-4 | Approval with self-interest: may the requester approve their own ticket | Ops | not documented | Prohibited (segregation of duties) | Fraud | AT-TKT-10 |
| D-STU-1 | Fields editable freely vs via ticket | PRO | W:14 Q1 | As D-ADM-3 | — | AT-STU-05 |
| D-STU-2 | Course change: fees already paid and old registration | Accounts/PRO | W:14 Q2 | Old registration status "Course Change" (excluded from reports); paid amounts transferred to the new registration via a reversal + reallocation journal | Revenue double-counted or lost | AT-FIN-TRF-02 |
| D-STU-3 | Mode/scheme change separate queues or merged | PRO | W:14 Q3 | Merged engine, separate ticket types | Queue ownership confusion | AT-TKT-11 |
| D-EXM-1 | G-TEC-run vs vendor exams and flow differences | Certification | W:17 Q1 | Configured per Registration Form Master flags (as legacy) | Wrong steps enforced | AT-EXM-05 |
| D-EXM-2 | Previous-sub-exam rule scope | Certification | W:17 Q2; S:40 semester only | Semester exams only; per-form flag | Students blocked or allowed wrongly | AT-EXM-17 |
| D-EXM-3 | Who enters results; change after publication | Certification | W:17 Q3 | HO certification team; post-publication change via ticket with audit | Certificate integrity | AT-EXM-20 |
| D-CRT-1 | Printed only at HO, or centres print some types | Certification | W:17 Q1 | HO only | Delays or forgery risk | AT-CRT-11 |
| D-CRT-2 | Meaning of "Validated"; required before despatch | Certification | W:17 Q2 | Required step: second-person check | Wrong certificates despatched | AT-CRT-05 |
| D-CRT-3 | Digital copy / public verification link; who edits after issue | Certification | W:17 Q3; S:29 | Public verification page with an unguessable token, minimal PII; edits after issue via ticket + reissue | Forgery, or PII leakage | AT-CRT-10, AT-SEC-14 |
| D-CRT-4 | Is certificate approval blocked by outstanding dues | Certification/Accounts | S:44–45 shows a Fee Due link only | Warn, do not block | Unpaid certificates or blocked students | AT-CRT-02 |
| D-SUP-1 | Pay before/after code issue; unassigned centre stock | Tech Support | W:18 Q1 | Pay → approval → issue (as drawn) | Credit exposure | E2E-10 |
| D-SUP-2 | Tally registration/exam link steps; automate | Tech Support | W:18 Q2 | Keep manual steps | — | — |
| D-SUP-3 | Edit Order Certification after issue: who and why | Tech Support | W:18 Q3 | Ticket with reason | Stock mismatch | AT-SUP-08 |
| D-SUP-4 | Kits as student fee and centre purchase: must match | Accounts/Stores | W:18 Q1 | Independent, reconciled by a report | Margin leakage | AT-SUP-15 |
| D-SUP-5 | Stock/reorder ownership; damaged stock | Stores | W:19 Q2 | Track damaged stock; reorder alert at min level | Stock-outs | AT-SUP-16 |
| D-SUP-6 | Purchase (Gesta ERP) still used | Stores/Accounts | W:19 Q3; S:55 | **Out of scope until confirmed** | Missing procurement | — |
| D-SUP-7 | SAP Carry Forward meaning | Tech Support SAP | W:19 Q1 | No default; blocked | Wrong licence balances | AT-SUP-18 |
| D-SUP-8 | SAP licence per student or pool | Tech Support SAP | W:19 Q2 | Pool at centre, assigned on use | — | AT-SUP-19 |
| D-SUP-9 | One supply module for SAP/voucher/licence | Tech Support | W:19 Q3 | One module, vendor-specific settings [P] | Over-generalised UI | — |
| D-ROY-1 | Royalty 20% for all, or by agreement/class/region | Accounts | W:20 Q1; S:15 one row | Per-centre rate with a 20% default, effective-dated | Royalty misbilled | AT-ROY-01 |
| D-ROY-2 | Old vs New Collection; royalty-bearing fee types | Accounts | W:20 Q2 | **No default; blocked.** Formula must be specified by Accounts | Wrong royalty invoices | AT-ROY-02 golden data |
| D-ROY-3 | What clearance entitles; what is blocked without it | Accounts | W:20 Q3 | Informational only | Missing enforcement | AT-ROY-03 |
| D-YEAR-1 | Is promotion between years needed for G-TEC | Academics/IT | W:20 Q1; S:54 | Not built; registrations continue to completion | Lost function if used | AT-YE-04 |
| D-YEAR-2 | Who runs closing; past failures; dues carry-forward method | Accounts/IT | W:20 Q2 | Dues remain open across years (no re-posting); FY close locks the period | Lost or duplicated dues | AT-YE-02 |
| D-YEAR-3 | Separate academic and financial years, or FY + join date | Accounts | W:20 Q3 | Keep both (fees are AY-keyed, books FY-keyed) | Report period mismatch | AT-YE-05 |
| D-ACA-1 | Is attendance daily; does it drive eligibility/certificate/royalty | Academics | W:21 Q1 | Recorded only; drives nothing | Missing eligibility control | AT-ACA-04 |
| D-ACA-2 | Faculty own login, mobile marking | Academics | W:21 Q2 | Faculty login with a "faculty" role, own batches only | — | AT-SEC-03 |
| D-ACA-3 | Placement tracking scope | Placement | W:21 Q3 | All courses, flag-driven | — | — |
| D-TIE-1 | Tie-up approver; floor price | Regional managers | W:21 Q1 | Approval levels via ticket engine; no floor | Under-pricing | AT-TIE-01 |
| D-TIE-2 | Tie-up → scheme/fee structure: manual today? | Regional managers | W:22 Q2 | Manual link (scheme reference on tie-up) | Double entry errors | — |
| D-TIE-3 | Tie-ups for Keltron/internship | Regional managers | W:22 Q3 | Allowed | — | — |
| D-HR-1 | HRMS scope: HO only, all centres, payroll used? | HR | W:22 Q1; S:57 masters empty | Phase scope: employee master + GCT + attendance; payroll/recruitment deferred until confirmed | Payroll rebuilt for nothing, or missing | — |
| D-HR-2 | GCT as eligibility master for teaching assignment | HR/Academics | W:22 Q2 | Warn on assignment, do not block | Unqualified trainers assigned | AT-HR-10 |
| D-HR-3 | Biometric devices; what staff attendance feeds | HR | W:22 Q3 | CSV import only | Device integration missing | AT-HR-07 |
| D-GAP-1 | Undrawn workflows: BDO, ID card, SMS/push, CRM pipeline | Owners per W:24 | W:24 | Must be drawn before their milestone | Wrong build | sign-off sheet row |
| D-SEC-1 | Which of the 43 roles are in use; exact permission matrix | IT/Ops | S:29 open Q #8; S:36 | Export legacy matrix; map to new permission keys; review with owners | Over- or under-privileged users at go-live | AT-SEC-15: role matrix snapshot test |
| D-SEC-2 | HO "view as centre" read-only mode needed | Operations | S:35 | Read-only scope filter, no impersonation | — | AT-SEC-08 |
| D-SEC-3 | Session timeouts, password policy, 2FA scope | IT | not documented | 2FA mandatory for HO roles; idle 30 min, absolute 12 h | Lockouts or weak sessions | AT-SEC-09..11 |
| D-SEC-4 | Aadhaar/PAN storage (students, employees, nominees) and DPDP Act 2023 obligations | IT + Legal | S:24, 27, 55–56 | Store only masked Aadhaar (last 4) + encrypted full value if legally justified; consent text at capture | Legal non-compliance | AT-SEC-16 |
| D-SEC-5 | Data retention and backup RPO/RTO | IT | not documented | Neon PITR 7–30 days + daily logical backup off-provider | Data loss | restore drill |
| D-FIN-1..8 | Financial rules | Accounts | see section 6 | — | — | — |
| D-MIG-1..6 | Migration rules | IT/Accounts | see section 7 | — | — | — |
| D-NUM-1 | Register number global or per-year reset (X1); numbering gaps allowed | Accounts/Certification | S:14–15 vs 18 | Unique per series & FY; gapless for receipts/invoices; register number global (per p18) | Duplicate or non-compliant numbers | AT-NUM-01..04 |
| D-CUR-1 | **Multi-currency and non-GST centres** (UAE, Egypt, Bahrain, UK; flags currency_type INR/USD, enable_dollar_feepay) | Accounts | S:2, 13 | Currency per centre; GST only for Indian centres; no FX conversion in books | Wrong tax on overseas receipts; mixed-currency totals | AT-FIN-CUR-01 |
| D-COMM-1 | SMS/email/push providers and templates | Ops | S:29 open Q #7 | Provider adapters; only confirmed providers built | Notifications fail at go-live | AT-COMM-* |
| D-PORTAL-1 | Student/parent portal or mobile app needed | Ops | S:29 open Q #4 | API-first, no portal in scope | — | — |

---

## 4. Security design and threat model

### 4.1 Changes to the earlier plan (evidence-based)
- **Auth.js Credentials → database sessions.** Auth.js documents that its Credentials provider works only with JWT sessions. A stateless JWT cannot meet the session-revocation requirement without an extra denylist. **Proposed:** Better Auth (DB sessions, TOTP 2FA plugin, session revoke APIs). Fallback is a small first-party session module (opaque random token, SHA-256 hash stored, argon2id passwords, otplib TOTP). The POC (section 8) must confirm this choice before M2.
- **Audit is written in the same transaction** as the mutation, not by a fire-and-forget hook.
- **RLS context uses transaction-local settings** because of pooling (4.3).

### 4.2 Design
| Area | Design [P] |
|---|---|
| Authentication | argon2id; per-IP and per-account rate limit; lockout after N failures with time decay; generic error messages; password reset by single-use hashed token with 30-min expiry; no password emailing (legacy "Resend Username and Password" is replaced by an invite/reset link) |
| HO 2FA | TOTP mandatory for any role with scope wider than one centre, or with finance/RBAC permissions. Recovery codes hashed. 2FA enrolment forced at first login. Removing 2FA needs another admin + audit |
| Sessions | DB table `session(id_hash, user_id, created, last_seen, expires, ip, ua, step_up_at)`; cookie `__Host-` prefix, HttpOnly, Secure, SameSite=Lax; rotated at login and privilege change; idle and absolute timeouts (D-SEC-3) |
| Revocation | Revoke all sessions of a user on password change, role/scope change, deactivation, 2FA reset, and centre deactivation (all users of the centre). Admin "revoke sessions" action. Validated on **every** request: no cached authorization |
| Authorization | Permission keys `domain.resource.action`; roles → permissions; `user_role_assignment(user, role, scope_type ALL/REGION/AREA/CENTRE, scope_ids[])`. Single gate `authorize(ctx, permission, resource)` in all server actions, route handlers, export jobs and cron. Denial is the default. A lint/test rule fails the build when an action file lacks an `authorize` call |
| Scoping | Centre-owned rows carry `centre_id`. Scope is resolved from the DB per request, **never** from a request parameter. Region/area scope expands to centre ids through the centre table at query time, so centre moves take effect immediately |
| RBAC administration | Users cannot grant permissions or scopes they do not hold. RBAC changes need `rbac.manage` + step-up, are audited and revoke the affected sessions |
| Sensitive mutations | Catalogue of sensitive actions (receipt cancel, amount change, fee transfer, scheme edit, result change after publication, certificate edit after issue, role change, FY close, gateway credential edit). Each needs step-up re-auth (< 5 min), a reason, and audit. Configured ones go through tickets (maker-checker, D-FEE-2) |
| Exports | Separate permission `*.export`. Same query path (authorize + RLS). Server-side streaming. Large exports run as background jobs writing to private Blob, served by a 5-min signed URL that is re-authorized on download. Audited with filters + row count. Per-user rate limit. PII columns need `pii.export` |
| Background jobs | Vercel Cron → route handler checks `Authorization: Bearer CRON_SECRET`. Runs as a named system principal with explicit permissions and `ALL` scope, recorded in `job_run` (start, end, status, counts). Idempotent by (job, period) unique key |
| Audit | `activity_log` append-only: the app DB role has INSERT/SELECT only; UPDATE/DELETE are revoked and a trigger raises. Fields: actor, session, role, scope, centre, entity, entity_id, action, before, after, reason, ip, ua, request_id, ts. Optional hash chain (prev_hash) for tamper evidence, a decision for Accounts |
| Files | Private Vercel Blob; uploads validated (size, magic-byte MIME allowlist); key contains no PII; download only via an authorized route that checks the owning record's centre scope, then redirects to a short-lived URL |
| Secrets | Gateway credentials encrypted with AES-256-GCM (key in env, versioned for rotation); never returned to the client; edit requires step-up; reads audited |
| Web | CSP with nonces, no inline scripts; HSTS; X-Frame-Options DENY; server actions' origin check; `/api/v1` for mobile uses bearer tokens (not cookies). Certificate/ID-card templates use a restricted field-placeholder renderer, not HTML from users (template-injection risk) |
| Errors | Generic user errors with a request id; details only in server logs; `statement_timeout` per role |
| Injection | Prisma parameterized queries; `$queryRawUnsafe`/`$executeRawUnsafe` banned by lint; raw SQL only as tagged templates |

### 4.3 PostgreSQL RLS and connection pooling
- Roles: `gems_owner` (owns schema, runs migrations over the **direct** Neon URL), `gems_app` (runtime, `NOBYPASSRLS`, no DDL, pooled URL), `gems_etl` (migration loads), `gems_report_ro` (optional read replica).
- All centre-owned tables use `ENABLE` + `FORCE ROW LEVEL SECURITY`, with policies `USING (app.can_access_centre(centre_id)) WITH CHECK (app.can_access_centre(centre_id))`.
- `app.can_access_centre(cid)` is `STABLE SECURITY DEFINER`. It reads `current_setting('app.session_id', true)`, resolves user → assignments → centres from tables, and returns **false when the setting is missing (fail closed)**.
- **Pooling:** Neon's pooled endpoint uses PgBouncer in transaction mode, so session-level `SET` would leak between clients. Every request therefore runs its queries inside a transaction that first executes `SELECT set_config('app.session_id', $1, true)` (transaction-local). This is wired through one Prisma client extension. No query runs outside it, enforced by exporting only the scoped client.
- HO-global tables (catalogue, masters) have no centre_id. Writes are guarded by permission, and RLS allows read to authenticated sessions.
- Performance: an index on `centre_id` everywhere; policy function cost measured in the POC (target < 10% overhead on paged list queries; failure → cache resolved centre ids in a transaction-local temp setting, still DB-derived).

### 4.4 Threat model (STRIDE summary)
| # | Threat | Asset | Control | Test |
|---|---|---|---|---|
| T1 | Credential stuffing / brute force | Accounts | rate limit, lockout, argon2id, HO 2FA | AT-SEC-09 |
| T2 | Session hijack/fixation | Sessions | rotation, `__Host-` cookie, idle/absolute expiry, revoke | AT-SEC-10, 11 |
| T3 | IDOR / cross-centre access via parameters | Student, fee, exam data | DB-derived scope + RLS fail-closed | AT-SEC-01 (4.5) |
| T4 | Privilege escalation via RBAC UI | RBAC | no grant beyond own permissions, step-up, audit | AT-SEC-07 |
| T5 | Bulk exfiltration via exports/search | PII | export permission, PII gating, audit, rate limit | AT-SEC-12 |
| T6 | Tampering with posted financial records | Ledger | immutability triggers, reversal-only, append-only audit | AT-FIN-IMM-01 |
| T7 | Forged/replayed gateway callback | Receipts | signature + server-side status recheck + amount match + unique txn id | AT-PAY-02..04 |
| T8 | Double submit / race | Receipts, numbers | idempotency keys, row locks | AT-FIN-COL-02, AT-NUM-03 |
| T9 | SQL injection | DB | parameterized queries, lint ban | AT-SEC-13 (static) |
| T10 | XSS / template injection | Sessions | CSP nonce, no user HTML, safe template renderer | AT-SEC-14 |
| T11 | CSRF | Mutations | server action origin check, SameSite, bearer for API | AT-SEC-17 |
| T12 | Malicious upload / file leakage | Documents | MIME allowlist, private blob, scoped signed URLs | AT-SEC-18 |
| T13 | Secret leakage | Gateway creds | encryption at rest, no client exposure, bundle scan | AT-SEC-19 |
| T14 | Cron endpoint abuse | Jobs | bearer secret, idempotent jobs | AT-SEC-20 |
| T15 | Insider misuse by HO | All | scoped access, step-up, reasons, audit review report | AT-AUD-03 |
| T16 | Certificate verification enumeration | Certificates | random token, minimal fields, rate limit | AT-CRT-10 |
| T17 | DoS via heavy reports | Availability | server paging, statement_timeout, pre-aggregation, async exports | AT-PERF-01 |
| T18 | Info leakage via errors (legacy SQL leak) | Schema | generic errors | AT-SEC-12 |
| T19 | Data loss | All | PITR + off-provider backups + restore drill | DR-01 |

### 4.5 Cross-centre isolation test plan (AT-SEC-01; to be implemented in the POC, **not yet run**)
Fixture: centres A (region R1) and B (region R2); users `uA` (centre A admin), `uB` (centre B admin), `hoR1` (HO, region R1 scope), `hoAll` (HO, ALL); student `sB` in centre B.

| Case | Attempt by `uA` / `hoR1` | Expected |
|---|---|---|
| 1 | GET page `/students/{sB.id}` | 404 (no existence oracle) |
| 2 | Server action `updateStudent({id: sB.id})` | Forbidden; row unchanged; denial audited |
| 3 | Server action `createReceipt({centreId: B, studentId: sB})` with tampered centreId | Forbidden; no receipt, no number consumed |
| 4 | `/api/v1/students?centreId=B` | Empty or 403, never B rows |
| 5 | List/search with crafted filter `centreId in (A,B)` | Only A rows |
| 6 | Export with tampered filters | File contains only A rows; audit shows actual scope |
| 7 | Document download URL of a B document | 404 |
| 8 | Approve a ticket raised by centre B | Forbidden |
| 9 | Raw SQL as `gems_app` with session of `uA`: `SELECT * FROM student WHERE centre_id=B` | 0 rows |
| 10 | Raw SQL as `gems_app` with **no** session setting | 0 rows on all centre tables (fail closed) |
| 11 | `INSERT` into B via raw SQL under `uA` session | Rejected by `WITH CHECK` |
| 12 | Pool reuse: request by `uA` then `uB` on the same pooled connection | `uB` cannot see A; settings do not leak |
| 13 | `hoR1` reads A (R1) | Allowed. Reads B (R2) → denied |
| 14 | `uA` role changed mid-session | Next request uses new scope (sessions revoked) |
Pass criteria: all 14 cases pass in CI against a real Postgres with the production role setup. Any single failure blocks M2.

---

## 5. (reserved: data model detail is in sections 6–7 and the Spec pp. 20–28)

## 6. Financial integrity design

**Not to be implemented until Accounts signs off D-FIN-1..8 (milestone M7).**

### 6.1 Entities
- `fee_structure` (AY, centre class or centre, course, fee type, amounts per caption).
- `fee_due` (registration, fee type, caption, due_date, gross, concession, fine, currency).
- `concession_application` (due, scheme, rule, amount, source: admission/scheme edit/ticket).
- `payment_attempt` (online order: gateway, merchant id, order id, amount, status, idempotency key).
- `gateway_event` (raw callback/recheck payload, signature-verified flag, unique (gateway, event id)).
- `receipt` (number, centre, student, date, currency, total, mode, instrument, status Active/Cancelled, idempotency_key unique, payment_attempt_id unique nullable).
- `receipt_allocation` (receipt → fee_due, amount, taxable, cgst, sgst, igst).
- `refund` (receipt/allocation, amount, reason, approval ticket, journal).
- `journal_entry` (number, FY, period, date, source type/id, status Draft/Posted, reversal_of).
- `journal_line` (entry, account, centre, debit, credit, one side > 0).
- `account` (chart of accounts S:15).
- `fee_type_account_map`.
- `accounting_period` (FY, month, Open/Closed).
- `settlement` (gateway, MID, settlement date, gross, fees, net) + `settlement_line` (attempt, amount).
- `number_series` (centre, type, FY, prefix, current).

### 6.2 Invariants (each enforced in the DB where possible, and each has a test)
| ID | Invariant | Enforcement | Test |
|---|---|---|---|
| F1 | Every posted journal entry: Σdebit = Σcredit, > 0 | Deferred constraint trigger at commit | AT-FIN-JNL-01 |
| F2 | Posted journals and active receipts are immutable (no UPDATE/DELETE of amounts) | Trigger + revoked privileges; corrections only by reversal entry | AT-FIN-IMM-01 |
| F3 | Receipt total = Σ allocations = Σ payment lines | Constraint trigger | AT-FIN-COL-01 |
| F4 | Allocation ≤ due outstanding; outstanding = gross − concession + fine − Σ active allocations ≥ 0 | Row lock on dues + check in the transaction; CHECK on derived balance | AT-FIN-COL-03 |
| F5 | Excess payment goes to the "Excess Fee" liability account (exists S:15), never as negative due | Posting rule | AT-FIN-COL-04 |
| F6 | Cancellation = receipt status Cancelled + reversing journal + reversed allocations, in one transaction; number never reused | Service + F2 | AT-FIN-REV-01 |
| F7 | Receipt/invoice numbers unique per (centre, type, FY); gapless if D-NUM-1 says so | `number_series` row `FOR UPDATE` in the same transaction; unique index | AT-NUM-03 (100 parallel collections → 100 distinct, consecutive numbers) |
| F8 | GST: taxable + CGST + SGST (intra-state) or + IGST (inter-state) = line total; rounding per D-FIN-4; residual to Round Off account (exists S:15); no GST for non-Indian centres (D-CUR-1) | Posting function + CHECK | AT-FIN-GST-01..04 |
| F9 | One receipt per successful payment attempt | Unique `receipt.payment_attempt_id` | AT-PAY-03 |
| F10 | Gateway events deduped; success only after signature verification **and** server-side status recheck with amount + order id match | Unique (gateway, event_id); state machine Generated→Processed→Success/Failed, no backward transitions | AT-PAY-02, 04 |
| F11 | Every client "Collect" submission carries an idempotency key; a retry returns the original receipt | Unique `receipt.idempotency_key` | AT-FIN-COL-02 |
| F12 | No posting into a Closed period; back-dated corrections post in the current open period with a reference | Trigger on journal_entry | AT-FIN-PER-01 |
| F13 | Money as `numeric(14,2)`, single currency per receipt/journal; never floats in code (decimal.js) | Types + lint | AT-FIN-CUR-01 |
| F14 | Settlement: Σ settlement lines = settlement gross; difference recorded, never silently absorbed | Constraint + reconciliation report | AT-PAY-06 |
| F15 | Receivable control: Σ outstanding dues per centre = balance of the Admission Fee Receivable account (if accrual, D-FIN-1) | Nightly reconciliation job | AT-FIN-REC-01 |

### 6.3 Transaction boundaries
- **Collect fee (offline):** `BEGIN` → set RLS session → `authorize` → idempotency check → `SELECT … FOR UPDATE` the student's open dues → validate allocations (F4) → `next_number` (F7) → insert receipt + allocations → build journal (Dr Cash/Bank; Cr income heads per fee type; Cr CGST/SGST/IGST output) → post (F1 checked at commit) → audit row → `COMMIT`. Any failure rolls back everything, including the number.
- **Online payment:** creating an attempt is its own transaction. The callback is a separate transaction: insert gateway_event (dedupe) → verify signature → server-side recheck (outside the DB transaction, before it) → transition state → on Success call the same collect routine with `idempotency_key = attempt.id`.
- **Reversal / refund / transfer:** one transaction each, through approved tickets. A ticket's final approval and its `apply` handler commit together.
- **Settlement import:** one transaction per settlement file; unmatched lines go to an exception table.

### 6.4 Reconciliation procedures (scheduled, with reports)
1. Daily: Σ receipts by centre/day/mode = Σ journal lines on cash/bank accounts.
2. Daily: gateway Success attempts vs receipts (F9) vs settlements (F14); unmatched list.
3. Nightly: trial balance per FY nets to zero; F15 receivable control.
4. Monthly: royalty computation inputs frozen per period (D-ROY-2).
Each run is stored in `reconciliation_run` with differences; non-zero differences notify Accounts.

### 6.5 Period and year closing
`accounting_period` closes monthly (Accounts permission + step-up). FY close = all periods closed + trial balance zero + reconciliation clean → closing entries (I&E to Accumulated Fund, S:16) → opening balances in the new FY. Reopening a period needs a ticket and audit. Academic-year rollover (dues carry-over, prefixes) follows D-YEAR-2/3.

### 6.6 Financial decisions (Accounts owner; all UNCONFIRMED)
| ID | Decision | Proposed default |
|---|---|---|
| D-FIN-1 | Accrual (book receivable when due is created) vs cash basis (book income at receipt) | Cash basis, matching the observed "receipt posts with GST split" (S:15); receivable tracked in the sub-ledger only |
| D-FIN-2 | GST invoice format and when the tax point arises | Tax invoice at receipt |
| D-FIN-3 | Cancellation window and approver | Same-day cancel by centre admin with step-up; later → ticket |
| D-FIN-4 | GST rounding: per line or per receipt | Per line, half-up to 2 dp; residual to Round Off |
| D-FIN-5 | Refunds (not documented anywhere in the PDFs) | **Gap: must be specified**; until then refunds are not supported |
| D-FIN-6 | Caution deposit (liability account exists) handling | Liability; refund via D-FIN-5 |
| D-FIN-7 | Paid Fee Import (historic receipts): post journals or memo only | Post journals into an "opening/migration" period |
| D-FIN-8 | Hash-chained audit for finance tables | Yes for receipts/journals |

---

## 7. Migration strategy (discovery starts now, in parallel with M1, not in the final phase)

### 7.1 Current knowledge
- Source: MySQL behind a CodeIgniter monolith plus HRMS, CRM, Accounts and Purchase apps (possibly separate schemas). Prefix `gsch_` (S:20). **No schema, dump or row counts available.**
- Documented volumes (control-total seeds, with discrepancies X1–X8): enquiries 32,743; CRM leads ~34,120; admissions 63,779/65,211; students 43,513; tickets 16,542 (14,011 approved, 2,412 pending, 119 rejected, 2 forwarded); course mode requests 1,680; result log 1,941; schemes 242 (146 live); courses ~1,359; centres 327; roles 43; permissions 854; religions 51; castes 963; designations 111; HRMS employees 39; Course Fee 2026 total 692,220,907 / collected 323,277,574 (S:53).
- Known quality issues: duplicate/misspelt religions and castes, "-delete" courses, test schemes/vendors/roles (S:28), possibly unbalanced ledger (Invalid Bank Transactions report, S:16).

### 7.2 Discovery deliverables (M0, needs IT access to a read-only replica or dump)
1. `information_schema` export (tables, columns, types, PK/FK, indexes) for all apps' databases.
2. Row counts per table; per centre and per AY for the core tables.
3. Identify the tables behind each requirement row (R-xxx). Mark unmapped tables explicitly as "unsupported / archive only".
4. Control-total queries replicating the legacy reports: the 16 admission reports by criteria (S:45), fee collection per centre/FY, trial balance per FY, dues outstanding.
5. Data-quality profile: duplicates, orphans (missing FKs, since a CodeIgniter app likely has few declared FKs [I]), invalid dates, encoding problems, plaintext secrets (gateway creds, possibly passwords: password hashing scheme must be identified; if weak, force reset at cutover).

### 7.3 Source-to-target mapping (skeleton; filled during discovery)
`migration/mapping.yaml`: per target table, list source table(s), column transforms, dedupe key, FK resolution and an exceptions rule. Example rows:
| Target | Source (to confirm) | Key | Transform |
|---|---|---|---|
| centre | gsch_school? | centre code | normalise class/category enums; encrypt gateway creds |
| student | gsch_student? | legacy id → `legacy_map` | split names, normalise phone, mask Aadhaar (D-SEC-4) |
| course_registration | gsch_student_co…? (S:20) | legacy id | status/mode enums |
| fee_due / receipt / allocation | fee tables (unknown) | legacy id | rebuild allocations; flag unbalanced receipts |
| journal_* | accounts app tables | legacy voucher | import per FY; non-balancing vouchers → exceptions |
| lookups | religion, caste, etc. | normalised name | merge map approved by owners (D-MIG-4) |

### 7.4 ETL design
- Stages: `raw` schema (verbatim MySQL copy via pgloader or CSV) → `stage` (typed, cleaned) → `public` (target), plus `migration.legacy_map(entity, legacy_id, new_id)`, `migration.exception(run_id, entity, legacy_id, rule, detail)` and `migration.run(id, started, finished, counts JSON)`.
- Scripts are idempotent and re-runnable from scratch on a fresh Neon branch. Loaded by the `gems_etl` role with RLS bypass **only** in that role; audit rows carry actor `migration:<run>`.
- **Dry runs:** at least 2 full rehearsals on production-sized copies before cutover, with timing measured.
- **Checks per run:** record counts per entity/centre/AY (source vs target vs exceptions, all three must sum); control totals per centre/FY for collections, dues, concessions, GST; trial balance per FY = legacy A/c Trial Balance; 16 admission reports match within zero tolerance or each difference is explained; random sample of 50 students with full timeline compared side-by-side by managers.
- **Exception report:** every rejected or modified record listed with a rule; owners sign the exceptions before cutover.

### 7.5 Cutover and rollback
1. Freeze window announced; legacy set read-only (or final delta captured by `updated_at`, if the legacy schema has it [U]).
2. Final ETL run → checks → Accounts and Operations sign-off.
3. Switch DNS/login → new system.
4. **Rollback:** legacy stays intact and read-only for N weeks (decision D-MIG-5). If go/no-go fails or a severity-1 issue appears within the agreed window, revert DNS and resume legacy. Transactions entered in the new system during the window are exported for re-entry (procedure written before cutover).
5. Post-migration verification: day-1 reconciliation (6.4), report parity spot checks, user access review (D-SEC-1).

### 7.6 Migration decisions
D-MIG-1 how much history: all years vs last N + archive (default: all core records; logs older than N years archived read-only). D-MIG-2 historic journals: full vs opening balances (default: full for open FYs, opening balances for closed ones). D-MIG-3 unbalanced legacy vouchers: correct or carry to a suspense account (default: suspense + exception sign-off). D-MIG-4 master dedupe map approval. D-MIG-5 rollback window length. D-MIG-6 legacy passwords: rehash on first login vs forced reset (depends on the legacy hash algorithm).

---

## 8. Technical proof of concept (smallest executable prototype)

Scope: one Next.js app, Prisma, local Postgres in Docker (same major version as Neon) **and** one run on a Neon branch through the pooled URL. Tables: centre, region, user, session, role, permission, user_role_assignment, student, number_series, ticket_type, ticket, ticket_action, fee_due, receipt, receipt_allocation, account, journal_entry, journal_line, activity_log. No styling work. Tests use Vitest against real Postgres, plus Playwright for UI paths.

| # | Proof | Test | Expected | Failure conditions |
|---|---|---|---|---|
| P1 | Authentication + scoped authorization | Login (password + TOTP for HO), DB session, revoke | Login works; revoked session rejected on the next request; HO without TOTP cannot reach the app | Any request succeeds with a revoked/expired session; TOTP bypass; JWT-only sessions forced by the library |
| P2 | RLS isolation across centres | AT-SEC-01 cases 1–14 (4.5) | All pass, including pooled-connection reuse and fail-closed | Any cross-centre row visible or writable; missing setting returns rows; setting leaks between pooled requests; RLS overhead > agreed threshold |
| P3 | Transaction-safe numbering | 100 concurrent "collect" calls on one series; 10 forced mid-transaction failures | 90 receipts with consecutive unique numbers, no gaps from the failures | Duplicate number; gap (if gapless required); deadlock not retried |
| P4 | Auditable sensitive mutation | Change a student's mobile with step-up; attempt without step-up; attempt UPDATE/DELETE on activity_log as gems_app | Change + audit row (before/after, actor, reason) in the same tx; no step-up → rejected; audit tampering rejected | Mutation committed without audit; audit editable; rollback leaves an orphan audit row |
| P5 | Ticket approval applies a domain change atomically | Two-level MNC ticket; approve L1, approve L2; inject failure in `apply` | Student updated only after the final approval; on injected failure, neither ticket status nor student changes; requester cannot approve own ticket | Partial state (ticket Approved, student unchanged or vice versa); approval by an out-of-scope user |
| P6 | Fee collection with balanced posting | Collect against 2 dues incl. GST intra-state; retry with the same idempotency key; cancel | One receipt; journal Dr = Cr; GST split exact; retry returns the same receipt; cancel creates a reversal and the original journal is untouched | Unbalanced journal commits; duplicate receipt on retry; posted line editable; float rounding drift |
| P7 | Server-paged authorized report export | Seed 50k students across 2 centres; page list; export CSV/XLSX as centre A user with tampered filter | p95 page < 500 ms locally; export contains only A rows; streamed (memory bounded); export audited | Out-of-scope rows; memory blow-up; unaudited export; timeout under the Vercel function limit |

POC exit criteria: all 7 pass in CI with logs attached to the review, and P2/P6 are re-run on Neon pooled. Outcome feeds back into this document (library choice, RLS overhead, numbering approach).

---

## 9. Revised milestone sequence

Rule: a milestone is complete only when its acceptance tests pass in CI, the required decisions are signed, and the owner signs the related W:23 sign-off row. A finished UI or a green build does not count. Every schema change uses expand/contract migrations (reversible). Modules ship behind feature flags. Legacy remains the system of record until cutover.

| M | Milestone | Depends on | Acceptance | Approvals needed | Rollback |
|---|---|---|---|---|---|
| M0 | Decisions & discovery: managers complete the W:23 sign-off; legacy schema/dump obtained; discrepancies X1–X8 explained; role matrix exported | — | Decision register rows for M1–M4 signed; schema inventory + row counts committed | All workflow owners; IT for DB access | n/a (documents) |
| M1 | POC (section 8) | M0 partially (no business rules needed) | P1–P7 pass | Architecture approval (you) | Discard POC branch |
| M2 | Foundation: auth/2FA/sessions, RBAC/scope, RLS, audit, app shell, DataTable, export framework, numbering, master CRUD pattern, CI with security suite | M1 | AT-SEC-*, AT-AUD-*, AT-NUM-* green; external review of the auth/RLS code recommended | D-SEC-1..5 | Feature-flagged; schema reversible |
| M3 | Organisation & centre onboarding (WF3), masters, users/roles UI | M2 | AT-ORG-*, E2E-03 | D-ORG-1..4, D-MIG-4 (masters) | Flag off; data seeded only in staging |
| M4 | Catalogue (WF2) | M3 | AT-CAT-*, E2E-02 | D-CAT-1..3 | as above |
| M5 | Ticket engine (WF6) | M2 | AT-TKT-*, E2E-06 | D-TKT-1..4 | as above |
| M6 | Enquiry→admission + correction tickets (WF1, WF7) | M3–M5 | AT-CRM-*, AT-STU-*, E2E-01, E2E-07 | D-ADM-1..3, D-STU-1..3 | as above |
| M7 | **Financial specification sign-off** (no posting code): section 6 completed by Accounts with worked examples (golden datasets) | M0 | Signed spec + golden data files | D-FIN-1..8, D-NUM-1, D-CUR-1, D-FEE-1..5 | n/a |
| M8 | Fees, schemes, receipts, accounts posting, reversals (WF4, WF5) | M6, M7 | AT-FEE-*, AT-SCH-*, AT-FIN-*, E2E-04, E2E-05; reconciliation jobs clean on golden data | D-SCH-1..3 | Flag off; no production money until cutover |
| M9 | Online payments & settlement | M8 | AT-PAY-* incl. replay/forgery tests against the gateway sandbox | D-FEE-3 | Gateway disabled per centre |
| M10 | Exams (WF8) | M4, M5, M8 | AT-EXM-*, E2E-08 | D-EXM-1..3 | Flag |
| M11 | Certificates (WF9) | M10 | AT-CRT-*, E2E-09 | D-CRT-1..4; WF9 diagram drawn | Flag |
| M12 | Supply: vouchers/licences/SAP/materials, tie-ups (WF10–12, 16) | M5, M8 | AT-SUP-*, AT-TIE-*, E2E-10..12, 16 | D-SUP-1..9, D-TIE-1..3 | Flag |
| M13 | Royalty & clearance (WF13) | M8 | AT-ROY-* on golden data | D-ROY-1..3 | Flag |
| M14 | Academic ops (WF15), ID cards, feedback, BDO | M6 | AT-ACA-*, E2E-15 | D-ACA-1..3, D-GAP-1 | Flag |
| M15 | HRMS (WF17a/b, scope per D-HR-1) | M2 | AT-HR-*, E2E-17a/b | D-HR-1..3 | Flag |
| M16 | Reports, dashboards, comms | M8–M13 | AT-RPT-* parity against legacy control totals | D-COMM-1, D-ADM-2 | Flag |
| M17 | Year-end & period closing (WF14) | M8 | AT-YE-*, E2E-14 | D-YEAR-1..3 | Period reopen procedure |
| M18 | Migration rehearsals (≥ 2) → cutover | M0 discovery, all in-scope modules | Section 7.4 checks all pass; exceptions signed | D-MIG-1..6; go/no-go by Accounts + Operations | Section 7.5 |

Migration ETL code is written incrementally: each module milestone M3–M17 includes its entity mappings and a dry-run load, so problems surface early.

---

## 10. What happens after approval
1. Implement **M1 POC only** in `D:\GEMS OMNIX` (after `git init`), report the P1–P7 results with real test output, and update this document with the findings.
2. In parallel, request from you: legacy DB read access or dump (M0), the legacy role/permission export, and manager sign-off on the decision rows that block M2–M4.
3. No foundation or module work starts until the POC results are reviewed.
