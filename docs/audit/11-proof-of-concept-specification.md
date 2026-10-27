# 11 Proof-of-concept specification (v1.1)

**Status:** proposed and **not started**. It is implemented only after explicit approval.

**Scope:** a minimal Next.js + Prisma app, no styling work, with:
- the tables needed for P1–P8;
- local Postgres (Neon's major version) behind PgBouncer in transaction mode;
- a second run on a Neon branch through its pooled URL.

**Evidence:** every result goes to `poc/evidence/<proof>-<date>.json` plus raw test output, and is logged in 12 with command, commit and timestamp.

**Fixture:** FX-BASE (09). The data is synthetic, with no real PII. Using the real XLS needs separate approval.

| # | Proof | Tests | Expected | Failure conditions |
|---|---|---|---|---|
| P0 | ADR-001 auth bake-off | T-AUTH-001…020 against candidates A/B/(C) | One candidate passes all mandatory tests with the smallest surface | No candidate passes, so revisit before Stage 2 |
| P1 | Login and scoped authorization | T-AUTH-001, 005, 009–015; T-SEC-001…008 | HO login requires TOTP; revoked sessions fail on the next request; out-of-scope access is denied with no side effects | Any revoked/expired session works; TOTP bypass; any cross-scope data |
| P2 | Cross-centre RLS isolation | T-RLS-001…018 | All pass, including PgBouncer reuse (2,000 interleaved transactions), missing scope, cross-centre writes, export cursor, job scope, raw SQL and views | Any row leak or write; silent empty result without an error; setting persists across transactions; overhead not measured |
| P3 | Concurrent numbering | T-NUM-001…010, in both NP-3 modes | Gapless mode: consecutive, no gaps after rollbacks and kills. Unique mode: distinct | Duplicate; gap in gapless mode; number consumed by a failed attempt |
| P4 | Auditable sensitive mutation | T-AUD-001…005, T-AUTH-015 | Change + audit in one transaction; rejected without step-up; audit tamper denied; redaction applied | Change without audit; orphan audit after rollback; editable audit |
| P5 | Ticket approval applies exactly once | T-TKT-004…007, 010, 011 | Domain change only on final approval; concurrent approvals apply once; apply failure rolls back fully | Partial state; double application; self-approval allowed |
| P6 | Fee collection with balanced posting | T-FEE-001, 003, 007, 008, 012, 017, 018, 019 | Journal balanced; exact GST; retries idempotent; reversal linked and original untouched | Unbalanced commit; duplicate receipt; float drift; editable posted line |
| P7 | Authorized server-paged export | T-SEC-006, T-RPT-010, 012, 013, T-RLS-011; PERF-04 (local smoke only) | Only in-scope rows; streamed with bounded memory; audited with the actual scope | Out-of-scope rows; memory blow-up; unaudited export |
| P8 | Repeatable migration dry run with reconciliation output | T-MIG-001…009 on a synthetic XLS-shaped dataset with seeded defects (whitespace codes, duplicate persons, test centre, corrupted cells, unbalanced voucher) | Identical key_map and totals across 2 runs; 100% dispositions; seeded defects in exceptions; **no balancing entry created**; reconciliation report produced | Source key without disposition; non-deterministic IDs; silent drop; auto-balancing |

**Exit:** P0–P8 green in CI, with P2 and P6 re-run on the Neon pooled endpoint. The results feed back into the ADR, the RLS overhead figure and the numbering approach. **POC code is not production code.** Only the chosen patterns carry forward.
