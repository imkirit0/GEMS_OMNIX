# 10 Implementation roadmap (v1.1)

**Order.** Stages 0–8 follow the user's order. The one justified change: a minimal **ticket core** is in Stage 2, because centre activation, catalogue approval and fee reversals depend on it (DR-11). Full approval workflows stay in Stage 5.

**Rules for every stage:**
- **Exit:** linked tests (09) pass in CI on a production-like environment, logged in 12, plus:
  - the cross-centre suites T-SEC and T-RLS are still green;
  - the stage's decisions are signed;
  - the migration mapping and dry run for its entities pass T-MIG-001…011.
- **A built page or a green build is never an exit.**
- **Rollback:**
  - expand/contract migrations;
  - a feature flag per module;
  - the legacy system stays the system of record until Stage 8.

| Stage | Scope | Requirements (02) | Prerequisites | Tests | Security checks | Migration impact | Approvals |
|---|---|---|---|---|---|---|---|
| 0 Discovery | Legacy DB access; schema, counts and usage; file inventory; role matrix export; API consumer list; draw WF-X and placeholder workflows; manager sign-off sheet | all (S0 rows: R-000, R-004, R-025, R-033.12, R-056, R-101, R-146, R-160, R-224, R-225, R-020.07) | Access granted by IT/vendor | T-DOC-001; discovery scripts reproducible | Read-only access; PII handling agreed | Source inventory; X1–X18 explained | D-SEC-1, D-MIG-7, D-MIG-8, D-TZ-1, D-OPS-1; PR usage results |
| 1 Security POC | ADR-001 bake-off; P1, P2, P4, P7 (11) | S1 rows (R-003, R-006, R-007, R-009, R-010, R-013, R-093) | Stage 0 partial; architecture approval | T-AUTH-*, T-RLS-*, T-SEC-*, T-AUD-001…004 | Real roles, PgBouncer, Neon pooled | None | ADR-001 acceptance |
| 2 Data model, numbering, audit, ticket core, migration foundation | Person/admission/registration core; centre/catalogue skeleton; number series; audit; ticket core; ETL framework; P3, P5, P8 | S2 rows (R-011, R-012*, R-026, R-028, R-029, R-033.10, R-094 core) | Stage 1 passed | T-NUM-*, T-TKT-004…007, T-AUD-*, T-MIG-* on synthetic data | RLS coverage test on every new table | Key map, rules, exceptions live | NP-1…8, D-STU-4, D-MIG-1…3 |
| 3 Centre, catalogue, enquiry, admission, student lifecycle | WF1, WF2, WF3, WF7, WF-X4, X13, X14, X16, X19 | S3 rows | Stage 2 | T-E2E-001/002/003/007, T-XM-01, T-XM-05 | Scope on all lists and exports | Centres, masters (merge maps), courses, enquiries/leads, persons, registrations | D-ADM-*, D-ORG-*, D-CAT-*, D-STU-*, D-SEC-4, PR-02/05/06/12 |
| **G-FIN gate** | Accounts signs every UNAPPROVED item in 07 that Stage 4 needs | — | Golden datasets and worked examples | — | — | — | D-FIN-1…9, D-FEE-1…5, D-SCH-*, D-CUR-1, NP-* |
| 4 Fees, receipts, payments, accounting | WF4, WF5, WF-X5, X6, X20; accounts app; confirmed gateway(s); P6 | S4 rows | Stage 3 + G-FIN | T-FEE-*, T-E2E-004/005, T-XM-03, gateway sandbox tests | Step-up, maker-checker, secret encryption | Dues, receipts, journals per FY (K7, K8) | D-FEE-3, D-MIG-2/3 |
| 5 Ticket workflows | All 31 types, queues, SLA, dashboards | S5 rows (R-094.03–05, R-096, R-144) | Stage 2 core; handlers from Stages 3–4 | T-TKT-*, T-E2E-006 | Out-of-scope and self-approval | Historic tickets; 2,412 pending treated | D-TKT-1…4 |
| 6 Exams, certificates, supply, royalty, tie-ups, year close | WF8–WF14, WF16, WF-X8–X12, X25, X26 | S6 rows | Stages 4–5 | T-E2E-008…014/016, T-XM-02/04/06, T-ROY-* | Public verification page; imports | Exam/cert/supply/royalty history | D-EXM, D-CRT, D-SUP, D-ROY, D-YEAR, D-TIE; WF9–14/16 diagrams signed |
| 7 HRMS, reports, integrations, hardening | WF15, WF17a/b, WF-X1–X3, X17, X18, X21–X24; reports; notifications; legacy API shim; NFRs | S7 rows | Stage 6 | T-RPT-*, T-NTF-*, T-API-*, PERF-01…07, accessibility checks, DR drill | External pen test (recommended) | HR; report snapshots | D-HR, D-RPT, D-COMM, D-API-1, D-ACA, PR-10 |
| 8 Rehearsal, UAT, cutover | ≥ 2 rehearsals; UAT against the WF sign-off sheet; cutover; hypercare | all | Stages 0–7 exit | T-MIG-* full; UAT scripts | Secret rotation; access review | Final load; 100% dispositions | Go/no-go: Accounts + Operations + IT |

Crosswalk from the v0 milestones (M0–M18): see `revisions/v1.1-corrections.md` L-08.
