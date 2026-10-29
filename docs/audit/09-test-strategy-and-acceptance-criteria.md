# 09 Test strategy and acceptance criteria (v1.1)

Status: **definitions only. 0 tests implemented. 1 documentation check executed (T-DOC-001, see 12).**
Every ID below is referenced from `02-requirements-traceability-matrix.csv`. A requirement may move to VER only when its linked tests pass in CI and the run is logged in `12-evidence-and-verification-log.md`.

## Levels and tools (PROPOSED, confirmed after ADR-001)

| Level | Tool | Runs against |
|---|---|---|
| Unit | Vitest | Pure functions (formatting, GST split, scheme maths) |
| Integration | Vitest + real Postgres (Docker, same major as Neon) behind PgBouncer (transaction mode) | Server actions, route handlers, DB roles/RLS |
| E2E | Playwright | Running app on a preview deployment |
| Performance | k6 + seeded generator | Neon branch + Vercel preview, production-sized (see 01 C-06) |
| Docs | `tools/build_matrix.py` | Audit files |

Shared fixture **FX-BASE**:
- Regions: R1, R2.
- Centres: A (R1, intra-state GST), B (R2), O (overseas, no GST).
- Users: `uA`, `uB`, `hoR1`, `hoAll`, `acctHO`, `approverL1`, `approverL2`.
- Catalogue: a course offered to A's class, a live scheme, and a 2-head fee structure (one head GST-bearing).
- Number series in both NP-3 modes.

Expected results that depend on an unapproved decision (PMC) are written **parameterised by the decision**, never hard-coded.

## Catalogue

### T-DOC: documentation integrity
| ID | Test | Pass condition |
|---|---|---|
| T-DOC-001 | `python -I tools/build_matrix.py .` | 0 errors: unique IDs; parents and dependencies resolve; every decision ID is defined in an audit .md; evidence class valid; no VER/IMP without a run; every row has a target or a removal rationale. Warnings list tests not yet defined |

### T-AUTH: authentication (C-08.1 of 01; run identically against each ADR-001 candidate)
| ID | Test | Expected | Negative / failure |
|---|---|---|---|
| T-AUTH-001 | Valid login | DB session row; `__Host-` cookie HttpOnly/Secure/SameSite=Lax; audit LOGIN_SUCCESS | Missing cookie flags |
| T-AUTH-002 | Wrong password | Generic message; failure counter +1; audit LOGIN_FAILURE | Response reveals the account exists |
| T-AUTH-003 | N failures (N PMC, proposed 5) | Account locked; unlocks after window | Bypassed by alternating IPs |
| T-AUTH-004 | Per-IP rate limit | 429 after limit | — |
| T-AUTH-005 | HO user without TOTP | Forced enrolment; zero data access before it | Any data endpoint reachable |
| T-AUTH-006 | TOTP wrong or replayed | Rejected | Accepted |
| T-AUTH-007 | Recovery codes | Single use; regenerating invalidates old codes | Reuse works |
| T-AUTH-008 | Password reset | Single-use token, 30 min, identical response for unknown email | Token reusable; account enumeration |
| T-AUTH-009 | Password change | All other sessions revoked | Old session still valid |
| T-AUTH-010 | Role/scope change | User's sessions revoked; new scope applies | Stale scope |
| T-AUTH-011 | User deactivated | Next request rejected | — |
| T-AUTH-012 | Centre deactivated | All users of that centre rejected | — |
| T-AUTH-013 | Idle and absolute timeout (PMC, proposed 30 min / 12 h) | Expired | — |
| T-AUTH-014 | Session fixation | Session id rotated on login and privilege change | Same id kept |
| T-AUTH-015 | Step-up re-auth | Sensitive action needs re-auth ≤ 5 min old | Older step-up accepted |
| T-AUTH-016 | Server action from foreign Origin | Rejected | Accepted |
| T-AUTH-017 | API bearer token | Scoped to consumer and centres; revocable | — |
| T-AUTH-018 | Legacy password path (D-MIG-6) | Rehash on first login, or forced reset | Weak hash retained |
| T-AUTH-019 | Hash parameters | argon2id with documented cost | — |
| T-AUTH-020 | Auth audit coverage | login, logout, lockout, 2FA enrol/reset and reset request all audited | Missing event |

### T-SEC: application-level isolation (FX-BASE; attacker = `uA` or `hoR1`)
| ID | Attempt | Expected |
|---|---|---|
| T-SEC-001 | GET a B record page | 404 (no existence oracle) |
| T-SEC-002 | Server action updating a B record | Forbidden; row unchanged; denial audited |
| T-SEC-003 | Create a receipt with tampered centreId=B | Forbidden; no receipt; no number consumed |
| T-SEC-004 | `/api/v1/...?centreId=B` | Empty or 403 |
| T-SEC-005 | List/search with crafted filter | Only in-scope rows |
| T-SEC-006 | Export with tampered filters | File holds only in-scope rows; audit records actual scope |
| T-SEC-007 | Mutate an HO-global master without permission | Forbidden |
| T-SEC-008 | Approve a ticket raised by B | Forbidden |
| T-SEC-009 | Download a B document URL | 404 |
| T-SEC-010 | Bulk import naming B's register numbers | Those rows rejected |
| T-SEC-011 | Background job output (two centres) | Each centre's output contains only its own data |
| T-SEC-012 | Error responses (forced DB error) | Generic message + request id; no SQL or stack trace |
| T-SEC-013 | HO "act as centre" | Not possible; HO acts within scope, every action audited (PR-01 PMC) |
| T-SEC-014 | Template/XSS injection in certificate/ID-card templates and free-text fields | Rendered inert; CSP blocks inline script |
| T-SEC-015 | Rate limit on exports and search | 429 above limit |
| T-SEC-016 | Upload: wrong magic bytes, oversize, zip bomb | Rejected |
| T-SEC-017 | Secrets: client bundle scan for keys/salts | None found |
| T-SEC-018 | Cron endpoint without `CRON_SECRET` | 401 |
| T-SEC-019 | Legacy-API shim key used for another consumer's scope | Rejected |

### T-RLS: database isolation (18 tests, defined in 01 §C-04; same IDs T-RLS-001…T-RLS-018)
Pass condition: all 18 pass against the production role set, **through PgBouncer in transaction mode and through the Neon pooled URL**. Until then, no RLS security claim is made.

T-RLS-015 (defined in v1.1 C-04): `gems_etl` is created only by `scripts/etl/setup.mjs` in a migration environment and dropped at go-live, followed by the queries in `docs/designs/migration-framework/migration-framework.md`. Schemas `raw` and `migration` have no RLS: they have no `centre_id` and are revoked from every role except the schema owner and `gems_etl`.

### T-NUM: numbering mechanism (10 tests, defined in 01 §C-02.3; T-NUM-001…T-NUM-010)
Each test runs in both NP-3 modes. The shipped mode is set only by the Accounts sign-off of NP-1…NP-8.

### T-AUD: audit
| ID | Test | Expected |
|---|---|---|
| T-AUD-001 | Each action in the sensitive-action catalogue | Exactly one audit row in the same transaction, with all fields (actor, session, role, scope, centre, entity, before/after, reason, ip, request_id) |
| T-AUD-002 | Business transaction rolls back | No audit row |
| T-AUD-003 | Denied attempt | Denial row only |
| T-AUD-004 | `gems_app` UPDATE/DELETE/TRUNCATE on activity_log | Denied |
| T-AUD-005 | Redaction | Aadhaar/PAN/bank/secret fields masked in audit data and logs |
| T-AUD-006 | Bulk import | One batch row with counts, plus one row per changed record |
| T-AUD-007 | Job actor | `system:<job>` with run id |
| T-AUD-008 | Hash chain (only if D-FIN-8 approved) | Edited row detected |
| T-AUD-009 | Coverage gate | CI fails if a mutating action/route has no audit assertion |
| T-AUD-010 | Audit read scope (PMC) | Centre users see only own-centre audit; HO sees by scope |

### T-TKT: ticket engine
| ID | Test | Expected |
|---|---|---|
| T-TKT-001 | Raise without a mandatory document | Rejected |
| T-TKT-002 | Ticket number | Format per NP policy; counter continuity (NP-8). Stage 2 covers format and the network-wide counter; NP-8 continuity waits for the NP sign-off |
| T-TKT-003 | Level-1 queue | Shows only in-scope tickets |
| T-TKT-004 | L1 approve on a 2-level type | Level advances; no domain change |
| T-TKT-005 | Final approve | Domain change applied exactly once; history row; audit row |
| T-TKT-006 | Concurrent final approvals | One application; the other gets a conflict |
| T-TKT-007 | `apply` throws | Ticket stays at its level; domain unchanged |
| T-TKT-008 | Reject | Remarks mandatory; centre notified. Stage 2 covers remarks; notification waits for D-COMM-1 |
| T-TKT-009 | Forward | Only to an in-scope employee |
| T-TKT-010 | Self-approval | Blocked (D-TKT-4 PMC) |
| T-TKT-011 | Stale request | Re-validated at apply; rejected with reason |
| T-TKT-012 | Viewer | Read-only |
| T-TKT-013 | Role-based level | Resolved at action time |
| T-TKT-014 | History | Immutable |
| T-TKT-015 | Re-raise | New ticket linked to the rejected one (D-TKT-2 PMC) |
| T-TKT-016 | SLA reminder job | Idempotent per ticket per day |
| T-TKT-017 | Per-type handler (one sub-case per type: 31 types + CMC queue + exam/supply/cert queues) | Correct domain effect |
| T-TKT-018 | Bulk approve | Per-ticket transactions; failures isolated and reported |
| T-TKT-019 | Document download | Needs `ticket.document.view` for the centre; 404 outside scope; audited |
| T-TKT-020 | Upload check | Refused when the stored object's real size or file signature breaks the limit (D-STO-1), when it belongs to another user or centre, or when it is already attached |
| T-TKT-021 | Distinct approvers | One user cannot approve two levels of the same ticket (D-TKT-4 PMC) |
| T-TKT-022 | Administrator reassign | A `ticket.type.manage` holder reassigns a ticket whose named approver was disabled; the new assignee can act |

### T-PER: person, admission and registration core (`docs/designs/person-core/person-core.md`)
| ID | Test | Expected |
|---|---|---|
| T-PER-001 | One person, several admissions and registrations | Persons and registrations counted separately (with T-XM-01). An HO user, and a regional user within their region, admit an existing person at a second centre; a single-centre user cannot see or pass them |
| T-PER-002 | Likely duplicate at entry | Flagged in the caller's scope, never across centres; single-name learners and swapped name order match; concurrent admits of one learner give one person; a bulk insert gets its match key |
| T-PER-003 | Admission No and Register No | Admission No network-wide per academic year (years chain), Register No network-wide; never clash between centres; allocated in the admission transaction; a rollback releases them; a missing series fails loudly |
| T-PER-004 | Scope | A centre sees only its own admissions and registrations, and a person only through one of them; another centre's record raises the same error as a missing one |
| T-PER-005 | Identity changes | Go through one function that returns before and after, only for a person admitted at the given centre |

### T-CAT: centre and catalogue skeleton (`docs/designs/catalogue-skeleton/catalogue-skeleton.md`)
| ID | Test | Expected |
|---|---|---|
| T-CAT-001 | One record per code | Courses, categories, divisions, centre classes and academic years each have one row per code; codes are normalised (`normCode()` agrees with the database checks) and unique |
| T-CAT-002 | References are real | The database refuses a registration with an unknown course, an admission with an unknown academic year and a centre with an unknown class; `admit()` also refuses a deactivated course or a closed year; existing registrations of a deactivated course stay |
| T-CAT-003 | Controlled, audited writes | Only a holder of `catalogue.manage` with a fresh step-up changes the catalogue, in the app and in the database; every change is audited with before and after; deactivation needs a reason |
| T-CAT-004 | Everyone signed in reads | A centre user without catalogue rights reads all five tables in full |

### T-ADM: admission screens (`docs/designs/admission-screens/admission-screens.md`)
| ID | Test | Expected |
|---|---|---|
| T-ADM-001 | Admit through the form | A `student.admit` holder admits a learner and is redirected to the learner's page showing Admission No, Register Nos, centre and course names; every role with `student.admit` also holds `student.view` |
| T-ADM-002 | Duplicate choice | Likely duplicates in the caller's scope are shown before anything is written; "Admit this person" links, "None of these" creates a new person only when every match was shown; the refusal is audited; no URL carries the values |
| T-ADM-003 | Errors keep the values | Field errors land on the right input and course row; other errors are form messages; DOB and mobile required for a new person; a lost connection at COMMIT says "submit again" and keeps the form id; an Origin-less post is refused |
| T-ADM-004 | List and view scope | Only learners at centres in the caller's `student.view` scope; out-of-scope and malformed ids give 404; search terms travel only in POST bodies; LIKE characters literal; the search rate limit applies; no mobile in the list |
| T-ADM-005 | Cross-site action posts | On the real server, a foreign-Origin and an Origin-less post write nothing; a same-origin post admits and answers 303 |
| T-ADM-006 | Never admit twice | A resubmitted form (in turn, concurrently, before hydration) admits once and says "already saved", naming no one outside the caller's scope; one admission per person, centre and academic year; only the three action functions are exported |

### T-LD: learner details (`docs/designs/learner-details/learner-details.md`)
| ID | Test | Expected |
|---|---|---|
| T-LD-001 | Details at admission | Saved with the admission for a new person (pincode, employment status, qualification required; "same as current" copies); for an existing learner saved only when none exist, otherwise ignored; the admit audit lists the fields written |
| T-LD-002 | Editing details | A `student.view` and `student.admit` holder at a centre where the learner is admitted edits them; a stale version is refused; clearing works, required fields stay required; a missing input keeps its value; the audit row carries field names only; other callers get the 404 path |
| T-LD-003 | Scope and integrity | Other centres cannot read or change details, also by direct SQL; identity and match key never change; concurrent first edits save once |
| T-LD-004 | Values | App and database accept and refuse the same values (nationality: format only in the database), independent of the database locale; the migration reset clears details |

### T-FEE: fee collection, payments and posting (all policy-dependent expectations follow C-07 flags)
| ID | Test | Expected |
|---|---|---|
| T-FEE-001 | Single due, full payment | Receipt + allocation; journal balanced (F1, F3) |
| T-FEE-002 | Partial payment | Allocation order per D-FEE-4 |
| T-FEE-003 | Multi-due, intra-state | CGST/SGST exact |
| T-FEE-004 | Inter-state | IGST |
| T-FEE-005 | Overseas centre O | No GST; currency per D-CUR-1 |
| T-FEE-006 | Overpayment | Per F5 policy |
| T-FEE-007 | Retry with same idempotency key | Same receipt |
| T-FEE-008 | Concurrent double submit | One receipt |
| T-FEE-009 | Concurrent different students on one series | Unique numbers |
| T-FEE-010 | Over-allocation | Rejected (F4) |
| T-FEE-011 | Held due | Collectibility per D-FEE-5 |
| T-FEE-012 | Cancel via ticket | Reversal linked to the original; allocations reversed; due restored; number retained |
| T-FEE-013 | Second cancel | Rejected |
| T-FEE-014 | Receipt transfer | Reversal + new allocation; both balances and books correct |
| T-FEE-015 | Closed period | Rejected (F12) |
| T-FEE-016 | Rounding residual | Per D-FIN-4 |
| T-FEE-017 | Random amounts (property test) | No float drift |
| T-FEE-018 | Online success callback | Exactly one receipt |
| T-FEE-019 | Duplicate callback | No second receipt |
| T-FEE-020 | Forged signature | Rejected and logged |
| T-FEE-021 | Amount/order mismatch | Exception; no receipt |
| T-FEE-022 | Late callback after Failed | No backward state transition |
| T-FEE-023 | Settlement import | Matched; differences reported (F14) |
| T-FEE-024 | Advance payment (D-FIN-9) | Held unapplied, then applied |
| T-FEE-025 | Refund | Blocked until D-FIN-5 approved |
| T-FEE-026 | Out-of-scope centre | 403; no side effects |
| T-FEE-027 | Receipt print | Equals stored values |
| T-FEE-028 | Reconciliation job | Detects an injected mismatch |

### T-RPT: reporting
| ID | Test | Expected |
|---|---|---|
| T-RPT-001 | Golden data: enquiry rule (SPEC p45) | Exact count |
| T-RPT-002 | Golden data: admission rule (join date + registration fee paid) | Exact count; result also shown under each D-ADM-2 option |
| T-RPT-003 | Golden data: billing rule | Exact amount |
| T-RPT-004 | Golden data: collection rule (join date and receipt date) | Exact amount |
| T-RPT-005 | Golden data: down payment / installments | Exact amount |
| T-RPT-006 | Course Change exclusion | Excluded |
| T-RPT-007 | Each of the 16 admission reports vs golden data | Equal (one sub-case per report) |
| T-RPT-008 | Scope on every report | Centre / region / all as permitted |
| T-RPT-009 | Export totals | Equal on-screen totals (one sub-case per fee/A/c report) |
| T-RPT-010 | Export audit | Filters, row count, scope recorded |
| T-RPT-011 | PII columns | Require `pii.export` |
| T-RPT-012 | Pagination | Stable ordering; no duplicate or missing rows across pages |
| T-RPT-013 | Large export | Bounded memory (PERF-04) |
| T-RPT-014 | Home and dashboard KPIs | Equal report totals |
| T-RPT-015 | Month boundaries | Per D-TZ-1 |
| T-RPT-016 | Snapshot vs live | Per D-RPT-1 |
| T-RPT-017 | Keltron 33-column layout | Exact |
| T-RPT-018 | Legacy parity during rehearsal | T-MIG-010 |

### T-NTF: notifications (WF-X3; providers PMC)
| ID | Test | Expected |
|---|---|---|
| T-NTF-001 | Event → in-app notification + HO list | Exactly one per event; scoped |
| T-NTF-002 | Push report | Lists sent pushes per centre/date |
| T-NTF-003 | Exam schedule notice | Text generated from schedule rows within the notification window |
| T-NTF-004 | SMS/email log | Every send logged with status; failure retried per policy |
| T-NTF-005 | Due reminder | Recipients = students with dues > 0 in scope; idempotent per day |

### T-IMP: bulk imports (WF-X15)
| ID | Test | Expected |
|---|---|---|
| T-IMP-001 | Valid file | Rows applied under authorize + RLS; batch audit |
| T-IMP-002 | Same file re-uploaded | No duplicate effect (file hash + job key) |
| T-IMP-003 | Mixed valid/invalid rows | Per-row exception report; valid rows per policy (all-or-nothing vs partial: PMC per import type) |
| T-IMP-004 | Oversize / row cap | Rejected before processing |

### T-ROY: royalty (formula PMC: D-ROY-2)
| ID | Test | Expected |
|---|---|---|
| T-ROY-001 | Effective-dated royalty rate | Correct rate per centre and month |
| T-ROY-002 | Monthly computation on golden data | Equals the Accounts-approved worked example |
| T-ROY-003 | Recompute same month | Idempotent |

### T-API: legacy Centres API contract (D-API-1)
| ID | Test | Expected |
|---|---|---|
| T-API-001 | directory | Same fields and filters as the legacy contract (R-200) |
| T-API-002 | enquiries | Same shape; null for uncaptured months |
| T-API-003 | admissions | Same shape; counting rule per D-ADM-4 |
| T-API-004 | courselist | Trimmed codes; one display name per code |
| T-API-005 | student_list | Same fields; business conditions documented (REQ C7) |
| T-API-006 | Transport | POST JSON, X-API-KEY, 400/401/404/405; key hashed at rest; rate limit documented |

### T-MIG: migration reconciliation (K1–K11 of 01 §C-03.3)
Each test runs on every dry run and rehearsal. Exit criteria are in 08.

| ID | Check | Stage 2 |
|---|---|---|
| T-MIG-001 | K1 source coverage | P8 on synthetic data |
| T-MIG-002 | K2 disposition balance | P8 on synthetic data |
| T-MIG-003 | K3 target provenance | P8 on synthetic data |
| T-MIG-004 | K4 merge integrity | P8 on synthetic data |
| T-MIG-005 | K5 split integrity | P8 on synthetic data (unit test of `k5`) |
| T-MIG-006 | K6 referential integrity | P8 on synthetic data |
| T-MIG-007 | K7 amount control totals | Stage 4 (migration-framework DD-4) |
| T-MIG-008 | K8 ledger | Stage 4 (migration-framework DD-4) |
| T-MIG-009 | K9 determinism | P8 on synthetic data |
| T-MIG-010 | K10 report parity | needs legacy data |
| T-MIG-011 | K11 sampled field fidelity | needs legacy data |

### T-XM: cross-module scenarios
| ID | Scenario |
|---|---|
| T-XM-01 | Enquiry → admission → fee → Admission report count |
| T-XM-02 | Exam pass → course completion → certificate → placement flag |
| T-XM-03 | Scheme applied → course change ticket → dues recalculated → receipts reallocated → books balance |
| T-XM-04 | Collections → royalty → payment → clearance |
| T-XM-05 | Centre class change → catalogue visibility → fee structure for new admissions only |
| T-XM-06 | Year close → numbering restart → dues carry-over → reports per AY/FY |
| T-XM-07 | Cross-centre isolation through every module's list, export and job |
| T-XM-08 | Migration dry run → report parity |

### T-E2E: workflow end-to-end (spec per workflow in 05)
| ID | Workflow |
|---|---|
| T-E2E-001 | WF1 Enquiry to admission |
| T-E2E-002 | WF2 Catalogue and availability |
| T-E2E-003 | WF3 Centre onboarding |
| T-E2E-004 | WF4 Fee setup and collection |
| T-E2E-005 | WF5 Schemes and concessions |
| T-E2E-006 | WF6 Ticket engine |
| T-E2E-007 | WF7 Corrections and course change |
| T-E2E-008 | WF8 Exam lifecycle |
| T-E2E-009 | WF9 Certificate lifecycle |
| T-E2E-010 | WF10 Voucher and licence |
| T-E2E-011 | WF11 Material kits |
| T-E2E-012 | WF12 SAP plans |
| T-E2E-013 | WF13 Royalty and clearance |
| T-E2E-014 | WF14 Year closing |
| T-E2E-015 | WF15 Attendance, syllabus, placement |
| T-E2E-016 | WF16 College tie-up |
| T-E2E-017A | WF17a Recruitment |
| T-E2E-017B | WF17b Payroll |
| T-E2E-X01 | WF-X1 BDO activity |
| T-E2E-X02 | WF-X2 ID card generation |
| T-E2E-X03 | WF-X3 Notifications |
| T-E2E-X04 | WF-X4 CRM lead pipeline |
| T-E2E-X08 | WF-X8 Exam date / special exam requests |
| T-E2E-X09 | WF-X9 Absent re-exam |
| T-E2E-X10 | WF-X10 Internship exam and certificate |
| T-E2E-X11 | WF-X11 WE exam |
| T-E2E-X12 | WF-X12 Faculty exam registration |
| T-E2E-X13 | WF-X13 User/role administration |
| T-E2E-X17 | WF-X17 Feedback/appraisal |
| T-E2E-X18 | WF-X18 Marketing targets |
| T-E2E-X21 | WF-X21 Leave |
| T-E2E-X22 | WF-X22 Biometric attendance |
| T-E2E-X25 | WF-X25 Certificate despatch payment |
| T-E2E-X26 | WF-X26 Voucher exam link and Tally registration |

The E2E tests for WF9–17b and WF-X* stay **draft** until their diagrams are drawn and signed (D-GAP-1, D-GAP-2).

### PERF: performance (01 §C-06)
PERF-01…PERF-07, as defined there. Thresholds stay PROPOSED until D-OPS-1 is approved. Results are recorded either way.

## Acceptance rules
1. A requirement is **done** only when all its linked tests pass in CI on a production-like environment, its decisions are approved, and the run is logged in 12.
2. A UI that exists or a build that succeeds is never evidence.
3. A test whose expected result depends on a PMC decision may pass in "parameterised" form, but the requirement stays non-done until the decision is signed.
