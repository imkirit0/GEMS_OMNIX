# 04 Manager decision register (v1.1)

**Every proposed default is UNCONFIRMED.** Status for all rows: **Open, not approved** (2026-10-26).
- A default may be used only in non-production environments to unblock design and tests.
- Unresolved financial, access-control and data-retention decisions (marked **⛔ prod-gate**) block deployment through the configuration approval check (01 §C-07).
- Longer evidence notes for v0 rows are in `baseline/v0-plan.md` §3 and §6.6.

Column order: ID · decision · owner · evidence · proposed default (UNCONFIRMED) · if wrong · regression tests.

## Admissions, students, CRM
| ID | Decision | Owner | Evidence | Default | If wrong | Tests |
|---|---|---|---|---|---|---|
| D-ADM-1 | Lead source: GEMS Enquiry, CRM or both (merge) | Admissions/PRO | WF p2; SPEC p54 | One merged enquiry/lead entity | Lost history; double counts | T-E2E-001, T-E2E-X04 |
| D-ADM-2 | Admission counted on save or on registration-fee paid | Admissions + MIS | WF p2; SPEC p45 | Store both states; reports use fee-paid | KPI drift vs legacy | T-RPT-002 |
| D-ADM-3 | Who may edit an admission; which fields need tickets | PRO | WF p2, p14 | Identity/contact fields via ticket only | Uncontrolled edits | T-TKT-017, T-AUD-001 |
| D-ADM-4 | What creates an admission record; which date sets its month | Admissions + MIS | REQ C1, C2 | Record on save; counted by join date when registration fee paid | Conversion KPIs wrong | T-RPT-002, T-API-003 |
| D-STU-1 | Fields editable freely vs via ticket | PRO | WF p14 | As D-ADM-3 | — | T-TKT-017 |
| D-STU-2 | Course change: fees paid and old registration ⛔ prod-gate | Accounts/PRO | WF p14 | Old registration = Course Change; paid amounts reversed and reallocated | Revenue double-counted | T-FEE-014, T-XM-03 |
| D-STU-3 | Mode/scheme change queues separate or merged | PRO | WF p14 | One engine, separate ticket types | Ownership confusion | T-TKT-017 |
| D-STU-4 | Person vs registration identity; register-number scope | Admissions/PRO | REQ C6; SPEC pp. 14–15, 18 | Person → admission → registration; register number per registration | Cannot count people | T-XM-01, T-MIG-004 |

## Catalogue and organisation
| ID | Decision | Owner | Evidence | Default | If wrong | Tests |
|---|---|---|---|---|---|---|
| D-CAT-1 | Centre class still governs availability | Academics | WF p4 | Keep centre class + special cases | Courses sold where not allowed | T-E2E-002 |
| D-CAT-2 | Who approves new courses and fee heads | Academics/Accounts | WF p4 | Course goes live via approval ticket | Unapproved pricing | T-E2E-002 |
| D-CAT-3 | Course versioning vs edit in place | Academics | WF p5 | AY-keyed fee structures; course edits audited | Historic registrations repriced | T-XM-05 |
| D-ORG-1 | Who creates centres; pre-login checks | Operations | WF p7 | Created Inactive; activation checklist + approver | Trading before agreement | T-E2E-003 |
| D-ORG-2 | Centre class fixed or revisable | Operations | WF p7 | Revisable via ticket with history | Retroactive price changes | T-XM-05 |
| D-ORG-3 | Prerequisites before admitting (QR, bank, staff, batches) | Operations | WF p7; 2 of 327 QR uploaded | Active status only | Admissions without payment setup | T-E2E-003 |
| D-ORG-4 | Which ~60 centre flags are used | IT/Operations | SPEC pp. 13–14 | Migrate only non-default flags | Lost behaviour | T-MIG-002 |
| D-ORG-5 | Region semantics and hierarchy | Operations | REQ C11; X6 | Separate geography from sales region | Mis-grouped reports | T-SEC-005, T-RPT-008 |
| D-ORG-6 | Centre lifecycle fields (status, open/close, franchise/own, agreement dates) | Operations | REQ C9, N11 | Add fields; soft close keeps history | Lost renewals | T-E2E-003 |

## Fees, schemes, finance (all ⛔ prod-gate, owner Accounts unless noted)
| ID | Decision | Evidence | Default | If wrong | Tests |
|---|---|---|---|---|---|
| D-FEE-1 | Ad-hoc fees without a prior due | WF p9 | Ad-hoc due created in the same transaction | Unreconcilable receipts | T-FEE-001 |
| D-FEE-2 | Cancel / amount change / transfer / scheme edit: password or ticket | WF p9; RCT type exists | Ticket (maker-checker) + step-up | Fraud or delay | T-FEE-012, T-AUTH-015 |
| D-FEE-3 | Payment modes and live gateway(s) | WF p9; SPEC pp. 14, 50 | Adapter interface; build confirmed gateways only | Missing gateway at cutover | T-FEE-018…023 |
| D-FEE-4 | Partial/installment allocation order | SPEC p29 Q1 | Oldest due date, then fee order | Wrong outstanding/GST | T-FEE-002 |
| D-FEE-5 | Meaning of fee hold | SPEC p50 | Excluded from collection and reminders | Collection wrongly blocked | T-FEE-011 |
| D-FEE-6 | Fines used (master empty) | SPEC p48 | Not built (PR-08) | Missing late fees | — |
| D-SCH-1 | Who creates/approves schemes (owner Marketing/Accounts) | WF p10 | HO creates; live after approval | Unauthorised discounts | T-E2E-005 |
| D-SCH-2 | Multiple schemes; course-change effect | WF p10 | One per registration; re-evaluated via ticket | Wrong dues | T-XM-03 |
| D-SCH-3 | Expired schemes; targets link (owner Marketing) | WF p11 | Existing keep; new only if valid on admission date | Mispricing | T-E2E-005 |
| D-FIN-1 | Cash vs accrual | SPEC p15 | Cash basis | Wrong books | T-FEE-001 |
| D-FIN-2 | Tax point / invoice | — | Tax invoice at receipt | GST non-compliance | T-FEE-003 |
| D-FIN-3 | Cancellation window/approver | SPEC p16 | Same day by centre admin + step-up; later via ticket | Fraud | T-FEE-012 |
| D-FIN-4 | GST rounding | — | Per line, half-up, residual to Round Off | Tax mismatch | T-FEE-016 |
| D-FIN-5 | Refunds (undocumented) | none | Not supported until specified | Cannot refund | T-FEE-025 |
| D-FIN-6 | Caution deposit | SPEC p15 (account exists) | Liability; refund per D-FIN-5 | — | T-FEE-001 |
| D-FIN-7 | Paid Fee Import posting | SPEC p49 | Post into an opening/migration period | Ledger gaps | T-IMP-001 |
| D-FIN-8 | Hash-chained finance audit | — | Yes | Weak tamper evidence | T-AUD-008 |
| D-FIN-9 | Advances / application fees | SPEC p50 | Unapplied-payment liability | Early revenue | T-FEE-024 |
| D-CUR-1 | Multi-currency, non-GST centres | SPEC pp. 2, 13 | Currency per centre; GST India only | Wrong tax | T-FEE-005 |
| NP-1…NP-8 | Numbering policy (owner Accounts + Certification) | see 01 §C-02.1 | Unset. Tickets (PMC, ticket-engine design, 2026-10-28): NP-1 one network-wide ticket counter (DD-8, accepted by the project owner); NP-5 sequence not padded, at most 30 characters, prefix fixed text per type (DD-10) | Duplicates; non-compliant serials | T-NUM-001…010, T-TKT-002 |

## Tickets, exams, certificates, supply, royalty, year end
| ID | Decision | Owner | Evidence | Default | If wrong | Tests |
|---|---|---|---|---|---|---|
| D-TKT-1 | Approvers and levels per type | Ops/PRO | WF p12 | Migrate current configuration | Stuck or bypassed | T-TKT-004 |
| D-TKT-2 | Rejected: reopen or new ticket | Ops | WF p12, p14 | New ticket linked to rejected; only the raiser re-raises, once, with the same type and centre (ticket-engine DD-9) | Lost trail | T-TKT-015 |
| D-TKT-3 | SLA and escalation | Ops | WF p12; 2,412 pending | Reminders on, no auto-escalation | Backlog | T-TKT-016 |
| D-TKT-4 | Self-approval ⛔ prod-gate | Ops | — | Prohibited; also nobody approves more than one level of the same ticket (ticket-engine DD-14) | Fraud | T-TKT-010, T-TKT-021 |
| D-EXM-1 | G-TEC vs vendor exam flows | Certification | WF p17 | Registration Form Master flags | Wrong steps | T-E2E-008 |
| D-EXM-2 | Previous-sub-exam rule scope | Certification | SPEC p40 | Semester only; per-form flag | Wrong blocks | T-E2E-008 |
| D-EXM-3 | Result entry; change after publication | Certification | WF p17 | HO; later change via ticket | Certificate integrity | T-TKT-017 |
| D-CRT-1 | Print at HO only | Certification | WF p17 | HO only | Forgery or delays | T-E2E-009 |
| D-CRT-2 | Meaning of "Validated" | Certification | WF p17 | Second-person check before despatch | Wrong despatch | T-E2E-009 |
| D-CRT-3 | Public verification; edit after issue | Certification | WF p17; SPEC p29 | Token page with minimal PII; edits via ticket + reissue | Forgery or PII leak | T-SEC-014 |
| D-CRT-4 | Block certificate on dues | Certification/Accounts | SPEC p45 | Warn, not block | Unpaid certificates | T-E2E-009 |
| D-SUP-1 | Pay before code issue | Tech Support | WF p18 | Pay → approve → issue | Credit exposure | T-E2E-010 |
| D-SUP-2 | Tally/exam-link automation | Tech Support | WF p18 | Manual | — | T-E2E-X26 |
| D-SUP-3 | Edit order certification after issue | Tech Support | WF p18 | Ticket with reason | Stock mismatch | T-E2E-010 |
| D-SUP-4 | Kit fee vs centre purchase | Accounts/Stores | WF p18 | Independent, reconciled by report | Margin leak | T-E2E-011 |
| D-SUP-5 | Stock/reorder/damaged | Stores | WF p19 | Track damaged; min-level alert | Stock-outs | T-E2E-011 |
| D-SUP-6 | Purchase app still used | Stores/Accounts | WF p19; SPEC p55 | Out of scope (PR-11) | Missing procurement | — |
| D-SUP-7 | SAP Carry Forward meaning | Tech Support SAP | WF p19 | **No default (blocked)** | Wrong balances | T-E2E-012 |
| D-SUP-8 | SAP licence per student or pool | Tech Support SAP | WF p19 | Pool at centre | — | T-E2E-012 |
| D-SUP-9 | One supply module | Tech Support | WF p19 | One module, vendor settings | Over-general UI | T-E2E-010 |
| D-ROY-1 | Royalty rate per centre ⛔ | Accounts | WF p20; SPEC p15 | Per-centre, effective-dated, 20% default | Misbilling | T-ROY-001 |
| D-ROY-2 | Old vs New Collection; royalty-bearing types ⛔ | Accounts | WF p20 | **No default (blocked)** | Wrong invoices | T-ROY-002 |
| D-ROY-3 | What clearance entitles | Accounts | WF p20 | Informational | Missing enforcement | T-E2E-013 |
| D-YEAR-1 | Promotion needed | Academics/IT | WF p20 | Not built (PR-09) | Lost function | T-E2E-014 |
| D-YEAR-2 | Closing owner; dues carry-forward ⛔ | Accounts/IT | WF p20 | Dues stay open; FY close locks period | Lost/duplicate dues | T-E2E-014, T-XM-06 |
| D-YEAR-3 | AY vs FY | Accounts | WF p20 | Keep both | Period mismatch | T-RPT-015 |
| D-TIE-1 | Tie-up approver; floor price | Regional managers | WF p21 | Ticket levels; no floor | Under-pricing | T-E2E-016 |
| D-TIE-2 | Tie-up → scheme link | Regional managers | WF p22 | Manual reference | Double entry | T-E2E-016 |
| D-TIE-3 | Tie-ups for Keltron/internship | Regional managers | WF p22 | Allowed | — | T-E2E-016 |

## Academics, HR, communications, reporting
| ID | Decision | Owner | Evidence | Default | If wrong | Tests |
|---|---|---|---|---|---|---|
| D-ACA-1 | Attendance drives anything | Academics | WF p21 | Recorded only | No eligibility control | T-E2E-015 |
| D-ACA-2 | Faculty own login / mobile | Academics | WF p21 | Faculty role, own batches | — | T-SEC-002 |
| D-ACA-3 | Placement scope | Placement | WF p21 | All courses, flag-driven | — | T-E2E-015 |
| D-HR-1 | HRMS scope; payroll/recruitment used | HR | WF p22; SPEC p57 | Employee master + GCT + attendance; payroll/recruitment deferred (PR-10) | Wasted or missing build | T-E2E-017A, T-E2E-017B |
| D-HR-2 | GCT as assignment eligibility | HR/Academics | WF p22 | Warn, not block | Unqualified trainers | T-SEC-002 |
| D-HR-3 | Biometric devices | HR | WF p22 | CSV import | No device integration | T-E2E-X22 |
| D-COMM-1 | SMS/email/push providers, templates, consent, DLT | Operations | SPEC p29 Q7 | Adapters; confirmed providers only | Failures at go-live | T-NTF-001…005 |
| D-PORTAL-1 | Student/parent portal or app | Operations | SPEC p29 Q4 | API-first; no portal | — | — |
| D-RPT-1 | Past-month figures can change | MIS | REQ C3 | Live + frozen month-end snapshot | Silent drift | T-RPT-016 |
| D-RPT-2 | "Current student" definition | MIS | REQ C12 | Active, end date ≥ today | KPI mismatch | T-RPT-014 |
| D-API-1 | Keep legacy Centres API or replace | Dashboard owner | REQ, APIR | Versioned API + compatibility shim | Dashboard breaks | T-API-001…006 |
| D-GAP-1 | Draw WF-X1…X4 (BDO, ID card, notifications, CRM) | Owners per WF p24 | WF p24 | Must be drawn before their stage | Wrong build | T-E2E-X01…X04 |
| D-GAP-2 | Draw or remove other undrawn/broken processes (WF-X12, X13, X14, X15, X16, X21, X23, X24 + 03 §C pages) | Owners | 01 §C-01.2 | Must be drawn before their stage | Wrong build | per row |

## Security, data, operations (⛔ prod-gate)
| ID | Decision | Owner | Evidence | Default | If wrong | Tests |
|---|---|---|---|---|---|---|
| D-SEC-1 | Roles in use; permission matrix | IT/Ops | SPEC p36; 43 roles | Export legacy matrix; map; owner review | Over/under-privilege | T-AUTH-010, T-SEC-007 |
| D-SEC-2 | HO read-only "view as centre" | Operations | SPEC p35 | Scope filter, no impersonation | — | T-SEC-013 |
| D-SEC-3 | Timeouts, password policy, 2FA scope | IT | — | 2FA for HO; 30 min idle / 12 h absolute | Lockouts or weak sessions | T-AUTH-005, T-AUTH-013 |
| D-SEC-4 | Aadhaar/PAN/caste storage; DPDP Act duties | IT + Legal | SPEC pp. 24, 27, 31, 55 | Masked + encrypted where justified; consent | Legal exposure | T-AUD-005 |
| D-STO-1 | Document upload limits: size, types, files per ticket, retention, virus scan | IT + Legal | ticket-engine design Q9; ADR-002 §3; D-SEC-4 | 10 MB; PDF, JPEG, PNG by file signature; 5 files per ticket; unattached uploads deleted after 24 h (go-live gate); retention and virus scan open | Personal data kept too long; unsafe files | T-TKT-020 |
| D-SEC-5 | Retention, backups, RPO/RTO | IT | — | PITR + daily off-provider dump | Data loss | PERF/DR drill |
| D-SEC-6 | Rotate exposed legacy keys/secrets | IT | REQ V11; SPEC p14 | Rotate all at cutover | Credential misuse | T-SEC-017 |
| D-TZ-1 | Legacy time zone; storage zone | IT | REQ C10 | UTC storage; Asia/Kolkata display; legacy zone TBD | Month shifts | T-RPT-015 |
| D-OPS-1 | Approve NFR thresholds | IT + Ops | none | 01 §C-06 values | Mis-sized system | PERF-01…07 |
| D-MIG-1 | History depth; log archive | IT/Accounts | — | All core records; old logs archived | Lost or bloated data | T-MIG-002 |
| D-MIG-2 | Historic journals: full vs opening balances | Accounts | — | Full for open FYs, opening balances for closed | Ledger gaps | T-MIG-008 |
| D-MIG-3 | Legacy unbalanced vouchers | Accounts | SPEC p16 | Report + approved treatment; **never auto-balance** | Misstated books | T-MIG-008 |
| D-MIG-4 | Master dedupe maps (religion, caste, designation, course names) | Owners | SPEC p11; DQR §4 | Approved merge maps | Wrong merges | T-MIG-004 |
| D-MIG-5 | Rollback window | Accounts + Ops | — | 4 weeks legacy read-only | No fallback | cutover runbook |
| D-MIG-6 | Legacy passwords | IT | — | Depends on hash; rehash or forced reset | Weak credentials | T-AUTH-018 |
| D-MIG-7 | Authoritative pre-2026 history source | IT + Accounts | X9 | Both profiled; XLS only for history absent from MySQL | Duplicated/missing history | T-MIG-001 |
| D-MIG-8 | XLS import mode and Jan–Jun 2026 overlap | IT + MIS | X15 | Reporting-only history table; overlap excluded from XLS side | Double counts | T-MIG-002 |

## Proposed removals and deferrals (none approved; each needs a usage query result + owner sign-off)
| ID | Proposal | Usage evidence today | Owner |
|---|---|---|---|
| PR-01 | Replace HO impersonation and the hard-coded approvals password | n/a (security) | Operations/IT |
| PR-02 | Merge the 5 apps into one; one staff list; one enquiry pipeline | none | Admissions, HR, Accounts |
| PR-03 | Merge duplicate pages (Beta variants, due posting, challan/SMS, log pages) | none | Accounts |
| PR-04 | Drop the legacy Message app | page did not load | Operations |
| PR-05 | Drop school-ERP leftovers (transport, hostel, TC, siblings, RTE, quota, mobile settings, fee parent/group, timetable flags) | "mostly unused" (SPEC p14). Promotion/TC show data | Academics |
| PR-06 | Do not migrate test/legacy data (school masters, "-delete" courses, test schemes/vendors/roles/centres) | SPEC p16, p28; DQR | IT + Accounts |
| PR-07 | Rebuild (not copy) crashing/blank pages | SPEC p28 | Module owners |
| PR-08 | Fines | Fine Master empty (SPEC p48) | Accounts |
| PR-09 | Promotion/depromotion | none | Academics/IT |
| PR-10 | HRMS payroll and recruitment (deferral) | HO masters empty (SPEC p57) | HR |
| PR-11 | Purchase app | not inspectable | Stores/Accounts |
| PR-12 | Emailing credentials → reset link | n/a (security) | IT |
| PR-13 | Vendor-support "New Task" form, app-download stats, SMS login modal, help editor, chatbot | none | IT |
