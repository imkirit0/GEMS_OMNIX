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
