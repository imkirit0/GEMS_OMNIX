# Graph Report - GEMS OMNIX  (2026-10-26)

## Corpus Check
- Corpus is ~41,295 words - fits in a single context window. You may not need a graph.

## Summary
- 368 nodes · 909 edges · 10 communities (9 shown, 1 thin omitted)
- Extraction: 83% EXTRACTED · 17% INFERRED · 0% AMBIGUOUS · INFERRED: 152 edges (avg confidence: 0.83)
- Token cost: 255,711 input · 0 output

## Community Hubs (Navigation)
- Security & Auth Design
- Ops & Module Decisions
- Finance & Fee Policy
- Audit Pack & Discrepancies
- Catalogue, Exam & Cert Decisions
- Tests, Threats & Cutover
- Migration Reconciliation
- Admission KPIs & Identity
- Target Architecture
- Baseline Split Tool

## God Nodes (most connected - your core abstractions)
1. `04 Manager Decision Register` - 65 edges
2. `07 Financial Invariants and Transactions` - 32 edges
3. `GEMS ERP Rebuild Specification` - 30 edges
4. `WF4 Fee setup and collection` - 26 edges
5. `06 Security Design and Threat Model` - 26 edges
6. `05 Workflow-to-Test Mapping` - 23 edges
7. `Fee Management Module` - 22 edges
8. `09 Test Strategy and Acceptance Criteria` - 22 edges
9. `GEMS Workflows for Manager Review` - 20 edges
10. `01 Executive Architecture Review` - 20 edges

## Surprising Connections (you probably didn't know these)
- `Numbering Engine` --semantically_similar_to--> `Prefix Counters`  [INFERRED] [semantically similar]
  docs/audit/01-executive-architecture-review.md → GEMS ERP Rebuild Specification.pdf
- `authorize() Gate plus PostgreSQL RLS` --semantically_similar_to--> `HO Centre Impersonation`  [INFERRED] [semantically similar]
  docs/audit/01-executive-architecture-review.md → GEMS ERP Rebuild Specification.pdf
- `Target Architecture Next.js Prisma PostgreSQL` --semantically_similar_to--> `CodeIgniter Monolith`  [INFERRED] [semantically similar]
  docs/audit/01-executive-architecture-review.md → GEMS ERP Rebuild Specification.pdf
- `Append-only Audit` --semantically_similar_to--> `Activity Log`  [INFERRED] [semantically similar]
  docs/audit/01-executive-architecture-review.md → GEMS ERP Rebuild Specification.pdf
- `D-CRT-4 Block certificate on dues` --conceptually_related_to--> `Fee Management Module`  [INFERRED]
  docs/audit/04-manager-decision-register.md → GEMS ERP Rebuild Specification.pdf

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Two-layer Fail-closed Centre Isolation** — docs_audit_06_security_threat_model_authorize_ctx_permission_resource_gate, docs_audit_baseline_v0_plan_postgresql_row_level_security, docs_audit_baseline_v0_plan_transaction_local_set_config_app_session_id, docs_audit_baseline_v0_plan_app_can_access_centre_scope_function, docs_audit_baseline_v0_plan_pgbouncer_transaction_mode_pooling, docs_audit_09_test_strategy_and_acceptance_criteria_t_rls_database_isolation_tests [EXTRACTED 1.00]
- **Disposition-based Migration Reconciliation** — docs_audit_08_data_migration_and_reconciliation_plan_migration_dispositions_one_per_source_key, docs_audit_08_data_migration_and_reconciliation_plan_migration_key_map_table, docs_audit_08_data_migration_and_reconciliation_plan_migration_reconciliation_table, docs_audit_09_test_strategy_and_acceptance_criteria_t_mig_migration_reconciliation_tests, docs_audit_11_proof_of_concept_specification_p8, docs_audit_10_implementation_roadmap_s8 [EXTRACTED 1.00]
- **Offline Fee Collection Transaction Invariants** — docs_audit_07_financial_invariants_and_transactions_offline_collection_transaction, docs_audit_07_financial_invariants_and_transactions_f1_posted_journals_balance, docs_audit_07_financial_invariants_and_transactions_f3_receipt_total_equals_allocations, docs_audit_07_financial_invariants_and_transactions_f4_allocation_not_above_outstanding, docs_audit_07_financial_invariants_and_transactions_f7_receipt_numbers_unique_within_scope, docs_audit_07_financial_invariants_and_transactions_f11_idempotent_collection, docs_audit_07_financial_invariants_and_transactions_f19_failed_transactions_leave_no_partial_update, docs_audit_07_financial_invariants_and_transactions_receipt_entity, docs_audit_07_financial_invariants_and_transactions_number_series_entity [EXTRACTED 1.00]
- **v0 Baseline to v1 Audit to v1.1 Corrections Lineage** — docs_audit_baseline_v0_plan, docs_audit_baseline_v1_audit, docs_audit_revisions_v1_1_corrections, docs_audit_00_readme_revision_control [EXTRACTED 1.00]
- **Centre Commerce Supply Chain (order, pay, ticket approval, issue)** — gems_workflows_for_manager_review_wf10_voucher_and_licence_supply, gems_workflows_for_manager_review_wf11_material_kits_and_products, gems_workflows_for_manager_review_wf12_sap_licence_plans, gems_erp_rebuild_specification_voucher_and_licence_module, gems_erp_rebuild_specification_material_and_product_module, gems_erp_rebuild_specification_sap_module, gems_erp_rebuild_specification_ticket_and_approval_engine, docs_audit_04_manager_decision_register_d_sup_9_one_supply_module [INFERRED 0.85]
- **Royalty and Clearance Flow and Controls** — gems_workflows_for_manager_review_wf13_royalty_and_clearance_certificate, gems_erp_rebuild_specification_royalty_and_clearance_module, docs_audit_07_financial_invariants_and_transactions_f20_royalty_inputs_frozen_per_period, docs_audit_07_financial_invariants_and_transactions_royalty_period_entity, docs_audit_04_manager_decision_register_d_roy_1_royalty_rate_per_centre_prod_gate, docs_audit_04_manager_decision_register_d_roy_2_old_vs_new_collection_royalty_bearing_types_blocked [INFERRED 0.85]

## Communities (10 total, 1 thin omitted)

### Community 0 - "Security & Auth Design"
Cohesion: 0.07
Nodes (61): DR-14 Unverified Auth.js claim, 06 Security Design and Threat Model, ADR-001 Authentication Bake-off, Append-only activity_log Audit in Same Transaction, argon2id Password Hashing, Auth.js (Candidate C), authorize(ctx, permission, resource) Gate, Authorized Streamed Exports (+53 more)

### Community 1 - "Ops & Module Decisions"
Cohesion: 0.08
Nodes (57): D-ACA-1 Attendance drives anything, D-ADM-1 Lead source: GEMS Enquiry, CRM or both, D-COMM-1 SMS/email/push providers, D-GAP-1 Draw WF-X1..X4, D-HR-1 HRMS scope; payroll/recruitment used, D-SCH-1 Who creates/approves schemes, D-SUP-1 Pay before code issue, D-SUP-7 SAP Carry Forward meaning (blocked) (+49 more)

### Community 2 - "Finance & Fee Policy"
Cohesion: 0.11
Nodes (50): D-CUR-1 Multi-currency, non-GST centres, D-FEE-2 Cancel/amount change/transfer: password or ticket (prod-gate), D-FEE-4 Partial/installment allocation order, D-FIN-1 Cash vs accrual, D-FIN-3 Cancellation window/approver, D-FIN-4 GST rounding, D-FIN-5 Refunds, D-FIN-7 Paid Fee Import posting (+42 more)

### Community 3 - "Audit Pack & Discrepancies"
Cohesion: 0.06
Nodes (44): GEMS OMNIX Audit Pack README (v1.1), Evidence Classes (SRC/INF/REC/PRO/PMC/VER/IMP), Baseline Preservation and Revision Control, Requirements Traceability Matrix (02 CSV), 03 Requirements Discrepancy Report, DR-03 Legacy Centres API omitted, DR-04 History location conflict, DR-06 Advances and pre-admission payments (+36 more)

### Community 4 - "Catalogue, Exam & Cert Decisions"
Cohesion: 0.09
Nodes (42): Risk: Legacy Secrets Exposed, 04 Manager Decision Register, D-CAT-1 Centre class still governs availability, D-CAT-3 Course versioning vs edit in place, D-CRT-1 Print at HO only, D-CRT-3 Public verification; edit after issue, D-CRT-4 Block certificate on dues, D-EXM-1 G-TEC vs vendor exam flows (+34 more)

### Community 5 - "Tests, Threats & Cutover"
Cohesion: 0.08
Nodes (41): DR-05 Person vs registration identity, X1 Register number reset vs global, T7 Forged/replayed gateway callback, T8 Race / double submit, Rehearsal, Cutover and Rollback Plan, 09 Test Strategy and Acceptance Criteria, FX-BASE Shared Test Fixture, T-E2E Workflow End-to-End Tests (+33 more)

### Community 6 - "Migration Reconciliation"
Cohesion: 0.12
Nodes (27): X14 Test centres in production data, 08 Data Migration and Reconciliation Plan, Deterministic UUIDv5 Target IDs, Disposition ARCHIVED, Disposition EXCLUDED, Disposition IMPORTED, Disposition MERGED, Disposition SPLIT (+19 more)

### Community 7 - "Admission KPIs & Identity"
Cohesion: 0.15
Nodes (24): Risk: Personal-data Obligations, Risk: Report and KPI Definitions Disagree, D-ADM-2 Admission counted on save or on registration-fee paid, D-ADM-3 Who may edit an admission; ticket fields, D-ADM-4 What creates an admission record, D-RPT-1 Past-month figures can change, D-SEC-4 Aadhaar/PAN/caste storage; DPDP Act, D-STU-4 Person vs registration identity (+16 more)

### Community 8 - "Target Architecture"
Cohesion: 0.18
Nodes (18): 01 Executive Architecture Review, ADR-001 Auth Library Bake-off, Append-only Audit, authorize() Gate plus PostgreSQL RLS, Double-entry Ledger, Legacy Centres API, Numbering Engine, Risk: History Split Across GEMS and XLS (+10 more)

## Knowledge Gaps
- **36 isolated node(s):** `Hard-coded Approvals Password`, `Super Admin Role`, `Regional Managers`, `Workflow Sign-off Sheet`, `PR-06 Do not migrate test/legacy data` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 42 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `04 Manager Decision Register` connect `Catalogue, Exam & Cert Decisions` to `Target Architecture`, `Ops & Module Decisions`, `Finance & Fee Policy`, `Admission KPIs & Identity`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `GEMS OMNIX Audit Pack README (v1.1)` connect `Audit Pack & Discrepancies` to `Security & Auth Design`, `Tests, Threats & Cutover`, `Migration Reconciliation`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `01 Executive Architecture Review` connect `Target Architecture` to `Ops & Module Decisions`, `Finance & Fee Policy`, `Catalogue, Exam & Cert Decisions`, `Admission KPIs & Identity`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Are the 7 inferred relationships involving `WF4 Fee setup and collection` (e.g. with `F11 Idempotent collection` and `F1 Posted journals balance`) actually correct?**
  _`WF4 Fee setup and collection` has 7 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Hard-coded Approvals Password`, `Super Admin Role`, `Regional Managers` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Security & Auth Design` be split into smaller, more focused modules?**
  _Cohesion score 0.06721311475409836 - nodes in this community are weakly interconnected._
- **Should `Ops & Module Decisions` be split into smaller, more focused modules?**
  _Cohesion score 0.07832080200501253 - nodes in this community are weakly interconnected._