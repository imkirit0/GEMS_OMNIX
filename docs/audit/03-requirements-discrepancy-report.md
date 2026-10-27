# 03 Requirements discrepancy report (v1.1)

**Sources.**
- Full wording of DR-01…DR-21 is in `baseline/v1-audit.md` §A.3.
- Link corrections L-01…L-30 are in `revisions/v1.1-corrections.md` §C-09.

This file records the **status** of each item after v1.1, plus new findings from building the page-level matrix.

Severity scale: Critical / High / Medium / Low.

## A. Discrepancies DR-01…DR-21: status after v1.1
| ID | Sev | Short title | Status | Where resolved / what remains |
|---|---|---|---|---|
| DR-01 | High | Matrix grouped, not page-level | **Resolved in docs** | 290 rows in 02 CSV. Groups keep parent IDs for one-to-many and many-to-one mappings |
| DR-02 | High | Missing requirements | **Resolved in docs** | R-210…R-229 added; see C below for pages that still have no behaviour |
| DR-03 | Critical | Legacy Centres API omitted | **Resolved in docs** | R-200…R-205, T-API-001…006, D-API-1 (PMC) |
| DR-04 | Critical | History location conflict (X9) | **Open** | D-MIG-7, D-MIG-8 (PMC). XLS profiled (08 §2). MySQL not yet available |
| DR-05 | High | Person vs registration identity | **Open** | D-STU-4 / NP-7 (PMC) |
| DR-06 | High | Advances and pre-admission payments | **Resolved in design** | F16, D-FIN-9 (PMC), T-FEE-024 |
| DR-07 | High | Removals hidden in defaults | **Resolved in docs** | PR-08…PR-13 added. Matrix `removal` column says "Proposed …; usage unchecked" |
| DR-08 | High | No usage evidence for removals | **Open** | Needs legacy DB counts (Stage 0) |
| DR-09 | High | Tests were labels only | **Partly resolved** | All IDs defined in 09. **0 implemented** |
| DR-10 | High | Cross-module rules tested only per module | **Resolved in docs** | T-XM-01…08 |
| DR-11 | High | Milestones before dependencies | **Resolved in docs** | Ticket core moved to Stage 2 (10) |
| DR-12 | Medium | Evidence misclassified | **Resolved in docs** | Mixed-evidence rows state both parts (e.g. "SRC (list); REC (receipt screen)") |
| DR-13 | Medium | Page refs unverified | **Resolved in docs** | Every SPEC row re-read against the PDF while writing (`ref_checked`). Manual, not machine-verified |
| DR-14 | Medium | Unverified Auth.js claim | **Open** | ADR-001 POC decides (11) |
| DR-15 | Medium | Count conflicts | Recorded | X2/X3/X5 extended; X9, X14, X15, X16 added (section B) |
| DR-16 | Medium | Missing decisions | **Resolved in docs** | D-ORG-5/6, D-RPT-1/2, D-SEC-6, D-TZ-1 (all PMC) |
| DR-17 | Medium | NFRs absent | **Resolved in docs** | PERF-01…07; thresholds PROPOSED |
| DR-18 | Medium | Workflow detail missing | **Resolved in docs** | 05 |
| DR-19 | Low | Empty v0 §5 | Resolved | Not carried into artifacts |
| DR-20 | Medium | Course-code hygiene | **Open (rule PMC)** | Surrogate keys (PRO); normalisation rules need Academics approval |
| DR-21 | Medium | Exposed legacy secrets | **Resolved in design** | D-SEC-6 rotation at cutover (PMC) |

## B. Source conflicts (X-register)
| ID | Conflict | Evidence | Owner | Status |
|---|---|---|---|---|
| X1 | Register numbers per-year reset vs global | SPEC p14–15 vs p18 | Accounts/Certification | Open (NP-2, NP-7) |
| X2 | Centres: 325 (API, 5 Oct), 326 (DQR), 327, 328, 386 (Accounts branches) | REQ p1, DQR §5, SPEC pp. 2, 15, 32 | Operations | Open |
| X3 | Admissions: Home 63,779; Summary 65,211; API 2026 58,301 (29 Sep) | SPEC pp. 2, 17; REQ p3 | MIS | Open |
| X4 | Exams 59/61/62; certifications 57/58 | SPEC pp. 18, 35, 40 | Certification | Open |
| X5 | Divisions 22/23; courses 1,200 / 1,220 (API) / 1,350+ / 1,359 / 1,375; categories 11/12 | SPEC pp. 16, 18, 30, 46, 54; DQR §4 | Academics | Open |
| X6 | Regions 17 (master) vs 18 (filters); region values mix states, countries and directions | SPEC pp. 16, 33; REQ C11 | Operations | Open (D-ORG-5) |
| X7 | Enquiries 32,743 vs CRM leads ~34,120 | SPEC pp. 2, 54 | Admissions | Open (D-ADM-1) |
| X8 | Ticket prefix current 23,652 vs 16,542 tickets | SPEC p38 | Operations | Open |
| X9 | GEMS data "from 2026" (APIR p4) vs AY history 2020-21+ (SPEC) vs XLS 2009–2026 | APIR, SPEC, XLS | IT + Accounts | Open (D-MIG-7) |
| X11 | Students: API 56,336 records vs Home 43,513 | DQR §1, SPEC p2 | MIS | Open (D-RPT-2, D-STU-4) |
| X14 | Test centres GDEMO, KL-01-TEST3, KL-01-TEST6 and HO record GTECHO in production data | DQR §5, APIR item 7 | IT | Open (EXCLUDED rule needs approval) |
| X15 | XLS 2026 sheet JoinDate to 2026-06-29 vs file title "to March" vs GEMS capture from April 2026 | XLS profile; DQR §6.3 | IT | Open (D-MIG-8) |
| X16 | **New:** A/c Reports stated as 32, but 31 names are listed (I&E variants counted as one) | SPEC p16 | Accounts | Open: confirm list from the accounts app |
| X17 | **New:** Centre Class has 15 values listed on the form, 15 rows in the master, but filters say 16 | SPEC pp. 12, 16, 18 | Operations | Open |
| X18 | **New:** Ticket priority has 3 values on Ticket Type (High/Medium/Low) but 4 on the Centre Tickets filter (Critical/High/Medium/Low) | SPEC pp. 37, 38 | Operations | Open |

X10, X12 and X13 were merged into X2, X3 and X5 (L-11).

## C. Requirements without an acceptance test (T-DOC-001 warnings, 12)
These pages crashed, rendered blank, were hidden or have undocumented content. **No honest acceptance test can be written until their behaviour is known.** Each is blocked on D-GAP-2: draw the process, or decide to remove it.

| Requirement | What it is | Owner |
|---|---|---|
| R-216 | Course Dashboard (empty for Super Admin) | Academics |
| R-217 | Gtec Centre Dashboard (PHP memory crash) | MIS |
| R-219 | Hidden Academic Kit / Welcome Kit / CC Summary cards | MIS |
| R-220 | Sem Start/End Date pages | Academics |
| R-020.07 | Support Login (purpose unknown) | IT |
| R-021.03 | Class Sort Order (only if promotion kept) | Academics |
| R-033.09 | Curriculum (empty) | Academics |
| R-033.11 | Centre category quick-add (throws exception) | Operations |
| R-214 | CRM Open Ticket | Admissions |
| R-215 | CRM profile / timesheets | Admissions |
| R-226 | HRMS Services (no tiles) | HR |
| R-227 | Biometric Master / Sync Structure | HR |

## D. Matrix composition (from the T-DOC-001 run; see 12)

**Evidence:**

| Class | Rows |
|---|---|
| SRC | 233 |
| REC | 50 |
| Mixed SRC/REC | 7 |
| VER | 0 |
| IMP | 0 |

**Stage:**

| Stage | Rows |
|---|---|
| S0 | 11 |
| S1 | 7 |
| S2 | 14 |
| S3 | 56 |
| S4 | 61 |
| S5 | 5 |
| S6 | 56 |
| S7 | 80 |

**Target "-":** 12 rows. Each one carries a proposed removal or out-of-scope rationale (all unapproved).
