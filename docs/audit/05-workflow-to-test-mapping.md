# 05 Workflow-to-test mapping (v1.1)

Workflow IDs:
- **WF1–WF16, WF17a, WF17b**: the 18 workflows signed off on WF pp. 23–24.
- **WF-X1…X26**: processes documented in SPEC but not drawn.

WF §18 is the sign-off sheet, not a workflow.

Every approval is **Not signed**. Steps marked **REC** come from the head-office view or from prose only, and need centre-side or manager verification before their E2E test can be finalised.

## Drawn workflows

The per-workflow detail (actors, fixtures, transitions, side effects, negative and duplicate cases, expected DB state, audit) is in `baseline/v1-audit.md` §A.5. It is valid for WF1–WF17b with these v1.1 changes:
1. The row "18 Sign-off inventory" is withdrawn.
2. DB-state expectations for WF9–17b are **REC** (L-25).
3. Test IDs follow the 09 naming.

| WF | Name | Diagram in WF PDF | Requirements | E2E test | Unit/integration tests | Decisions | Owner | REC steps needing verification |
|---|---|---|---|---|---|---|---|---|
| WF1 | Enquiry to admission | yes (p2) | R-081, R-085, R-150*, R-029, R-011 | T-E2E-001 | T-NUM-001, T-SEC-002, T-RPT-002, T-XM-01 | D-ADM-1…4, D-STU-4 | Admissions/PRO | Centre lane; Enroll Student modal; admission save path |
| WF2 | Catalogue & availability | yes (p4) | R-090*, R-091, R-092, R-114, R-059 | T-E2E-002 | T-XM-05 | D-CAT-1…3 | Academics | Course approval step (no evidence) |
| WF3 | Centre onboarding | yes (p6) | R-022*, R-023, R-228, R-024*, R-026, R-034 | T-E2E-003 | T-AUTH-008, T-AUTH-012, T-AUD-005 | D-ORG-1…6, PR-12 | Operations | Centre lane: logo, QR, bank, staff, batches |
| WF4 | Fee setup & collection | yes (p8) | R-050…R-071*, R-076, R-077 | T-E2E-004 | T-FEE-001…028, T-NUM-*, T-XM-03 | D-FEE-1…5, D-FIN-*, NP-* | Accounts | Receipt screen (SPEC p49); partial payments |
| WF5 | Schemes & concessions | yes (p10) | R-053, R-054, R-060, R-099 | T-E2E-005 | T-XM-03 | D-SCH-1…3 | Marketing/Accounts | Centre scheme selection UI |
| WF6 | Ticket engine | yes (p11) | R-094*, R-144 | T-E2E-006 | T-TKT-001…018 | D-TKT-1…4 | Operations/PRO | Level configuration per type |
| WF7 | Student data & course change | yes (p13) | R-095, R-096, R-094.04 | T-E2E-007 | T-TKT-011, T-TKT-017, T-FEE-014 | D-STU-1…4 | PRO | Centre raise form |
| WF8 | Exam lifecycle | yes (p16) | R-110…R-122* | T-E2E-008 | T-TKT-017, T-IMP-001, T-XM-02 | D-EXM-1…3 | Certification | Centre registration screens (SPEC p29) |
| WF9 | Certificate lifecycle | **placeholder box only (p17)** | R-130…R-134, R-221 | T-E2E-009 (draft) | T-NUM-006, T-SEC-014 | D-CRT-1…4 | Certification | **All steps REC**; templates; QR page |
| WF10 | Voucher & licence | placeholder (p18) | R-140*, R-141 | T-E2E-010 (draft) | T-IMP-001 | D-SUP-1…3 | Tech Support | **All REC**; centre cart |
| WF11 | Material kits | placeholder (p18) | R-142* | T-E2E-011 (draft) | — | D-SUP-4…6 | Stores | **All REC**; frozen issue/despatch pages |
| WF12 | SAP plans | placeholder (p19) | R-143 | T-E2E-012 (draft) | — | D-SUP-7…9 | Tech Support SAP | **All REC** |
| WF13 | Royalty & clearance | placeholder (p19) | R-031, R-072, R-145 | T-E2E-013 (draft) | T-ROY-001…003, T-XM-04 | D-ROY-1…3 | Accounts | **All REC**; formula unknown |
| WF14 | Year closing & promotion | placeholder (p20) | R-027, R-063, R-153, R-161, R-021.03 | T-E2E-014 (draft) | T-XM-06, T-FEE-015 | D-YEAR-1…3 | Accounts/IT | **All REC** |
| WF15 | Attendance, syllabus, placement | placeholder (p21) | R-152*, R-154, R-156, R-102, R-088 | T-E2E-015 (draft) | T-SEC-002 | D-ACA-1…3 | Academics/Placement | **All REC** |
| WF16 | College tie-up pricing | placeholder (p21) | R-086 | T-E2E-016 (draft) | T-TKT-017 | D-TIE-1…3 | Regional managers | **All REC** |
| WF17a | HRMS recruitment | placeholder (p22) | R-185 | T-E2E-017A (draft) | — | D-HR-1…3, PR-10 | HR | **All REC**; usage unknown |
| WF17b | HRMS payroll | placeholder (p22) | R-187, R-183, R-188 | T-E2E-017B (draft) | — | D-HR-1…3, PR-10 | HR/Accounts | **All REC** |

`*` = group row; it includes its child rows in 02.

## Undrawn processes (from 01 §C-01)
| WF | Process | Requirements | E2E test | Decision | Owner |
|---|---|---|---|---|---|
| WF-X1 | BDO activity planning | R-098 | T-E2E-X01 | D-GAP-1 | Marketing/Regional |
| WF-X2 | ID card generation | R-087, R-218 | T-E2E-X02 | D-GAP-1 | Academics/Operations |
| WF-X3 | Notifications (SMS/email/push/in-app) | R-002, R-070, R-210…R-213 | T-E2E-X03, T-NTF-001…005 | D-GAP-1, D-COMM-1 | Operations |
| WF-X4 | CRM lead pipeline | R-085, R-081, R-214, R-215 | T-E2E-X04 | D-GAP-1, D-ADM-1 | Admissions/PRO |
| WF-X5 | Receipt transfer | R-076 | T-FEE-014 | D-FEE-2 | Accounts |
| WF-X6 | Online payment recheck & settlement | R-068, R-071.12 | T-FEE-018…023 | D-FEE-3 | Accounts |
| WF-X7 | Course mode change | R-096 | T-TKT-017 | D-STU-3 | PRO |
| WF-X8 | Exam date / special exam requests | R-118 | T-E2E-X08 | D-TKT-1 | Certification |
| WF-X9 | Absent / rejected re-exam | R-118 | T-E2E-X09 | D-TKT-1 | Certification |
| WF-X10 | Internship exam + certificate | R-118, R-131 | T-E2E-X10 | D-TKT-1 | Certification |
| WF-X11 | WE exam registration | R-118 | T-E2E-X11 | D-TKT-1 | Certification |
| WF-X12 | Faculty exam registration | R-117.01 | T-E2E-X12 | D-GAP-2 | Certification |
| WF-X13 | User/role/permission administration | R-009, R-089 | T-E2E-X13, T-AUTH-010 | D-SEC-1, D-GAP-2 | IT |
| WF-X14 | Credential issuance / reset | R-228, R-003 | T-AUTH-008 | PR-12, D-GAP-2 | IT |
| WF-X15 | Bulk imports | R-062, R-116, R-140.02, R-182, R-183, R-218 | T-IMP-001…004 | D-GAP-2 | Owners per import |
| WF-X16 | Front office & call log | R-080, R-084 | T-SEC-002 | D-GAP-2 | Admissions |
| WF-X17 | Feedback / appraisal | R-088 | T-E2E-X17 | D-GAP-2 | Academics |
| WF-X18 | Marketing targets | R-099 | T-E2E-X18 | D-SCH-3 | Marketing |
| WF-X19 | Batch / class / semester assignment | R-021, R-155 | T-SEC-002 | — | Academics |
| WF-X20 | Gateway configuration | R-024.01 | T-AUTH-015, T-SEC-017 | D-FEE-3, D-SEC-6 | Accounts |
| WF-X21 | HRMS leave | R-184 | T-E2E-X21 | D-GAP-2 | HR |
| WF-X22 | Biometric attendance | R-183, R-227 | T-E2E-X22 | D-HR-3 | HR |
| WF-X23 | Service book & service requests | R-182, R-226 | — (blocked: behaviour unknown) | D-GAP-2 | HR |
| WF-X24 | Legacy API consumption | R-200…R-205 | T-API-001…006 | D-API-1 | Dashboard owner |
| WF-X25 | Certificate despatch payment | R-133 | T-E2E-X25 | D-CRT-* | Certification |
| WF-X26 | Voucher exam link & Tally registration | R-140.11, R-140.12 | T-E2E-X26 | D-SUP-2 | Tech Support |

## Minimum content of every E2E spec (applies to all rows above)
1. Actors and permission keys.
2. Fixture: FX-BASE plus workflow-specific data.
3. State transitions, with the DB rows expected after each step.
4. Financial or data side effects (journals, numbers, stock).
5. Negative cases, including out-of-scope access, duplicate or concurrent submit, and stale data.
6. Expected audit events and report deltas.
7. Linked decisions. While unapproved, assertions are parameterised.
