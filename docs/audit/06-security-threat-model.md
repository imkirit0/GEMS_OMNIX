# 06 Security design and threat model (v1.1)

Status: **design only. Nothing is implemented, nothing is tested.** No security property is claimed until the linked tests (09) pass against real database roles through the real pooler.

Superseded text: v0 §4.1 (auth candidates, see ADR-001 below); v0 §4.5 and A.6 cases (now T-SEC / T-RLS).

## 1. Principles (PRO)
- **Identity and scope come from the server.** Centre IDs, role names and scope are never trusted from the client. Scope is resolved from the DB session on every request.
- **Fail closed, in two layers.** The app gate `authorize(ctx, permission, resource)` runs in every server action, route handler, export and job. Postgres RLS runs independently. If either one denies, the request is denied.
- **Audit in the same transaction** as the change. Audit storage is append-only.
- **Sensitive changes need step-up re-auth.** Maker-checker via tickets applies where an owner approves it (D-FEE-2).

## 2. Authentication: ADR-001 (Proposed; one implementation will be chosen)
| Item | Content |
|---|---|
| Candidates | (A) Better Auth with DB sessions + TOTP plugin; (B) first-party module (argon2id, otplib TOTP, opaque hashed DB sessions); (C) Auth.js (whether its Credentials provider is JWT-only is **unverified**, DR-14) |
| Method | Time-boxed POC (≤ 3 days). **The same** T-AUTH-001…020 suite runs against each candidate in throwaway branches |
| Mandatory | Revocable DB sessions; TOTP enforced for HO; step-up timestamp; rotation; lockout/rate-limit hooks; audit inside the transaction; App Router server actions + route handlers; argon2id; legacy rehash path |
| Decision rule | Among candidates that pass every mandatory test, pick the smallest surface (fewest dependencies and lines of first-party security code) |
| After approval | Losing candidates deleted. ADR marked Accepted with evidence. All documents name only the winner. No auth code reaches the main line before then |

## 3. Design controls
| Area | Control | Tests |
|---|---|---|
| Passwords | argon2id; policy per D-SEC-3; breach-list check optional (PMC) | T-AUTH-019 |
| Lockout and rate limit | Per account with decay; per IP | T-AUTH-003, 004 |
| HO 2FA | TOTP mandatory for wider-than-centre scope or finance/RBAC permissions; hashed recovery codes; 2FA reset needs a second admin + audit | T-AUTH-005…007 |
| Recovery | Single-use hashed reset token, 30 min; uniform response | T-AUTH-008 |
| Sessions | Opaque token, hash stored; `__Host-` cookie, HttpOnly, Secure, SameSite=Lax; rotation; idle/absolute timeouts | T-AUTH-001, 013, 014 |
| Revocation | On password change, role/scope change, deactivation, 2FA reset, centre deactivation; admin "revoke all" | T-AUTH-009…012 |
| Authorization | Permission keys `domain.resource.action`; role → permissions; assignments with scope ALL/REGION/AREA/CENTRE; deny by default; CI lint fails any action file without `authorize` | T-SEC-001…008 |
| RBAC admin | Cannot grant beyond own permissions; step-up; audit; affected sessions revoked | T-AUTH-010, T-E2E-X13 |
| RLS | `gems_app` NOBYPASSRLS, not owner; FORCE RLS on all centre tables; security-invoker views; scope function fails closed | T-RLS-001…018 |
| Pooling | Every request runs in a transaction that begins with `set_config('app.session_id', …, true)`; only a scoped client is exported; a query outside a transaction throws | T-RLS-006, 009, 010 |
| Raw SQL | Unsafe raw calls banned by lint; tagged templates run under RLS | T-RLS-013 |
| Exports | `*.export` permission; PII columns need `pii.export`; streamed in one transaction; large exports as async job to private Blob with a 5-min signed URL re-authorised on download; audited with filters and row count; rate limited | T-SEC-006, T-RPT-010, 011, T-RLS-011 |
| Jobs | Cron bearer secret; named system principal with declared scope; idempotent by (job, period); run history | T-SEC-011, 018, T-RLS-012, T-AUD-007 |
| Bulk imports | Row by row under authorize + RLS; caps; idempotent by file hash; per-row exceptions; batch audit | T-IMP-001…004, T-SEC-010 |
| Files | Private storage; magic-byte allowlist; size caps; no PII in keys; access through an authorised route only | T-SEC-009, 016 |
| Secrets | Gateway/SMTP/API keys encrypted (AES-256-GCM, versioned key); never sent to the client; step-up to edit; reads audited; **all legacy secrets rotated at cutover** (D-SEC-6) | T-SEC-017, T-AUD-005 |
| Web | CSP with nonces; HSTS; frame deny; server-action origin check; bearer tokens for `/api/v1` | T-AUTH-016, T-SEC-014 |
| Errors and logs | Generic errors with a request id; structured logs without PII; audit and log redaction | T-SEC-012, T-AUD-005 |
| Audit | Append-only (privileges + trigger); complete field set; optional hash chain (D-FIN-8) | T-AUD-001…010 |
| Backups and DR | PITR + daily encrypted off-provider dump; quarterly restore drill; RPO/RTO PROPOSED 15 min / 4 h (D-SEC-5) | DR drill (logged in 12) |
| Incident response | Runbook: revoke sessions, rotate keys, preserve audit, notify owners; alerts on auth anomalies, 5xx rate, reconciliation differences, job failures | tabletop exercise before Stage 8 |

## 4. Threat model (STRIDE)
| # | Threat | Asset | Control | Tests |
|---|---|---|---|---|
| T1 | Credential stuffing | Accounts | Rate limit, lockout, argon2id, HO 2FA | T-AUTH-002…005 |
| T2 | Session hijack/fixation | Sessions | Rotation, cookie flags, expiry, revocation | T-AUTH-009…014 |
| T3 | IDOR / tampered centreId | Centre data | Server-side scope + RLS | T-SEC-001…006, T-RLS-008 |
| T4 | Privilege escalation via RBAC UI | RBAC | No over-grant, step-up, audit | T-AUTH-010 |
| T5 | Bulk exfiltration | PII | Export permissions, PII gate, audit, rate limit | T-SEC-006, 015, T-RPT-011 |
| T6 | Tampering with posted finance | Ledger | Immutability, reversal-only, append-only audit | T-FEE-012, T-AUD-004 |
| T7 | Forged/replayed gateway callback | Receipts | Signature + server recheck + amount match + unique event | T-FEE-019…022 |
| T8 | Race / double submit | Receipts, numbers | Idempotency keys, row locks | T-FEE-007, 008, T-NUM-001…005 |
| T9 | SQL injection | DB | Parameterised queries; lint | T-RLS-013 |
| T10 | XSS / template injection | Sessions, documents | CSP nonce, safe renderer | T-SEC-014 |
| T11 | CSRF | Mutations | Origin check, SameSite, bearer API | T-AUTH-016 |
| T12 | Malicious upload / file leak | Documents | Allowlist, private storage, scoped access | T-SEC-009, 016 |
| T13 | Secret leakage | Gateway/API keys | Encryption, no client exposure, rotation | T-SEC-017 |
| T14 | Cron abuse | Jobs | Bearer secret, idempotency | T-SEC-018 |
| T15 | Insider misuse by HO | All | Scoped access, step-up, reasons, audit review | T-SEC-013, T-AUD-001 |
| T16 | Certificate verification enumeration | Certificates | Random token, minimal fields, rate limit | T-SEC-014 |
| T17 | DoS via heavy reports | Availability | Paging, timeouts, async exports | PERF-04, PERF-06 |
| T18 | Info leak via errors | Schema | Generic errors | T-SEC-012 |
| T19 | Data loss | All | PITR, off-provider backup, drill | DR drill |
| T20 | **Scope leak across pooled connections** | Centre data | Transaction-local settings; fail-closed scope function | T-RLS-009, 010 |
| T21 | **RLS bypass via owner-rights views or definer functions** | Centre data | security_invoker views; definer inventory | T-RLS-003, 005 |
| T22 | **Legacy API key reuse** (exposed in guides) | Integration | New per-consumer hashed keys; rotation | T-SEC-019, T-API-006 |

## 5. Production gate
Deployment is blocked unless:
- all T-AUTH, T-SEC, T-RLS and T-AUD tests pass in CI on the production-like environment;
- ADR-001 is Accepted;
- D-SEC-1…6 and D-TZ-1 are approved;
- a recorded run of each is in 12.
