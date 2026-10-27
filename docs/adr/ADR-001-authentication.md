# ADR-001: Authentication implementation

| Item | Value |
|---|---|
| Status | **Accepted** on 2026-10-27: candidate **B (first-party module)** |
| Date | 2026-10-27 |
| Branch | `adr-001-bakeoff` (throwaway) |
| Decides | Which authentication implementation GEMS OMNIX uses (audit 06 §2, v1.1 C-05) |
| Evidence | `bakeoff/evidence/` (run log, per-candidate results JSON, Auth.js probe); log entry E-015 |

## 1. Context

GEMS OMNIX needs password sign-in for named head-office and centre staff, with:
- TOTP for HO users;
- immediate revocation;
- step-up for sensitive actions;
- sessions that the database's row-level security can trust, because `app.app_session` holds a hash of the session token and the scope of every transaction derives from it.

C-05 fixed the method:
- one test suite (T-AUTH-001…020);
- run against every candidate;
- among the candidates that pass every mandatory test, pick the smallest surface.

**Mandatory criteria (C-05):**
1. DB-backed sessions with immediate revocation.
2. TOTP enforced for HO.
3. Step-up with a timestamp.
4. Session rotation.
5. Lockout and rate-limit hooks.
6. Audit inside the same transaction.
7. App Router compatibility.
8. argon2id with a legacy rehash path.

## 2. Method

- **One contract** (`bakeoff/contract.ts`) and **one suite** (`bakeoff/suite.ts`), run unchanged against each candidate.
  - Policy numbers are the PMC values in `POLICY`: lockout 5, IP limit 20 per 10 min, idle 30 min, absolute 12 h, reset 30 min, step-up 5 min.
- **Same infrastructure for both:**
  - local Postgres 17.11;
  - the foundation schema and RLS;
  - a dedicated `gems_auth` database role;
  - audit fault injection by a shared trigger.
- **Each candidate configured as favourably as its options allow.** Code that a candidate needed beyond its library is marked `GLUE` (A).
- **Contract changes made to fit A**, applied to both:
  - password re-entry for TOTP enrolment and backup-code regeneration;
  - a neutral `clearRateLimits()` test hook. A's built-in 2FA throttle (a plus) tripped on a 4-attempt burst inside one test.
- **Suite validity:** mutation-tested against B.
  - Removing TOTP replay protection failed T-AUTH-006.
  - Moving the login audit outside the transaction failed T-AUTH-020.

**Not compared (identical for every candidate; tested on the platform later):**
- T-AUTH-012: centre deactivation, in the scope function.
- T-AUTH-016: foreign Origin, enforced by Next.js.
- T-AUTH-017: API bearer tokens, a separate machine-auth module.

**Additions beyond the 09 wording, disclosed:**
- T-AUTH-001 also asserts the session token is **not stored in plaintext** anywhere (06 §3 "Opaque token, hash stored").
- T-AUTH-001 also asserts the session is **trusted by RLS** (`withScope`).
- T-AUTH-020 adds the fault-injection check.

## 3. Candidates and results

| | (A) Better Auth 1.7.12 + username + twoFactor | (B) First-party module | (C) Auth.js v5 (`next-auth` 5.0.0-beta.32 → `@auth/core` 0.41.3) |
|---|---|---|---|
| Mandatory: DB sessions with immediate revocation | yes (with glue to mirror sessions for RLS) | yes | **no**: the probe shows `UnsupportedStrategy: Signing in with credentials only supported if JWT strategy is enabled`; the adapter was never called (`bakeoff/evidence/C-authjs-probe.json`) |
| T-AUTH suite (17 compared) | **15 / 17**: fails 001, 006 | **17 / 17** | not run (eliminated) |
| Own code needed | 295 lines of glue (19 `GLUE` sites) | 372 lines (module + schema) | — |
| Added packages (beyond pg/zod) | 20 packages, ~7.5 MB, + `@node-rs/argon2` for argon2id | 3 direct, 6 transitive, ~0.2 MB + argon2 native binary (~0.6 MB, also needed by A) | — |
| Release cadence | 1.7.11 → 1.7.14 in 8 days | primitives only (`@node-rs/argon2`, `@oslojs/otp`) | v5 still beta |
| License | MIT | MIT (deps) | ISC |

**Per-test results** (`bakeoff/evidence/*-results.json`, run `run-2026-10-27T162143.txt` on a fresh database; A also passed 15/17 when run first and alone):

| Test | A | B |
|---|---|---|
| T-AUTH-001 login, cookie, hash at rest, RLS trust | **fail**: raw session token stored in `ba.session.token` | pass |
| T-AUTH-002 generic failure | pass | pass |
| T-AUTH-003 lockout | pass (glue) | pass |
| T-AUTH-004 per-IP rate limit | pass (built in) | pass |
| T-AUTH-005 forced TOTP enrolment, no data before it | pass (glue gate) | pass |
| T-AUTH-006 TOTP wrong or replayed | **fail**: a used code is accepted again within its window | pass |
| T-AUTH-007 recovery codes | pass | pass |
| T-AUTH-008 reset | pass | pass |
| T-AUTH-009 password change revokes others | pass | pass |
| T-AUTH-010 revocation hook (app + RLS) | pass (glue) | pass |
| T-AUTH-011 deactivated user | pass (glue) | pass |
| T-AUTH-013 idle and absolute timeout | pass (glue for absolute) | pass |
| T-AUTH-014 rotation on login and step-up | pass (glue via internal API) | pass |
| T-AUTH-015 step-up ≤ 5 min | pass (glue) | pass |
| T-AUTH-018 legacy rehash | pass (glue) | pass |
| T-AUTH-019 argon2id cost | pass (custom hash) | pass |
| T-AUTH-020 audit coverage and atomicity | pass\* | pass |

\* A passes the fault-injection test only because the login audit was placed in a `session.create.before` hook. The audit row commits on its own connection **before** the session insert. A failed session insert would therefore leave an orphan "login success" audit row. This is not one transaction.

## 4. Findings about Better Auth (each confirmed in its installed source, 1.7.12)

| # | Finding | Where |
|---|---|---|
| A1 | Session token stored raw (`token: generateId(32)`); the cookie carries the same token, signed | `better-auth/dist/db/internal-adapter.mjs` ~L285 |
| A2 | TOTP verified by time window only; the last used step is not recorded, so there is no replay protection | `plugins/two-factor/totp/index.mjs` ~L194 |
| A3 | Backup codes stored as plain JSON by default; `storeBackupCodes: "encrypted"` (used here) is reversible, not hashed | `plugins/two-factor/backup-codes/index.mjs` L14–25 |
| A4 | `__Host-` cookie requires disabling `useSecureCookies` and forcing `secure` per cookie; otherwise the name is forced to `__Secure-…` | `cookies/index.mjs` L20–48 |
| A5 | No password lockout (the 2FA `accountLockout` covers TOTP attempts only), no absolute session cap, no rotation on privilege change: all glue | plugin types; suite |
| A6 | Bulk session deletion (`deleteUserSessions`) does not hand individual sessions to delete hooks, so the RLS mirror must be revoked separately | `db/internal-adapter.mjs` L518 |
| A7 | Schema checked at construction: the instance must be created after migrations | first run |
| A8 | Rotation and revocation glue uses `auth.$context.internalAdapter` (internal API), an upgrade risk at near-daily releases | glue |
| A+ | Strengths: built-in per-route rate limiting, including 2FA endpoints; origin checks on its own endpoints; active maintenance; less first-party crypto | — |

## 5. Decision

**Adopted: (B), the first-party module.** Approved by the project owner in chat on 2026-10-27 ("approve B"). It is the only candidate that passes every compared test. C fails a mandatory criterion outright. A fails T-AUTH-006 (TOTP replay) and the hash-at-rest requirement of 06 §3.

**Sensitivity, stated honestly.**
- Suppose the hash-at-rest addition were waived, and A's replay gap closed with more glue (≈ 40 lines re-implementing TOTP step tracking around the plugin).
- A would then need roughly as much own code as B (≈ 335 vs 372 lines), plus 20 packages and internal-API coupling.
- On that basis, B still has the smaller total surface. But the margin becomes a judgement, not a test result.

## 6. Consequences

- **We own security-critical code.** Before production:
  - an independent security review of the auth module is **required**;
  - the review is scheduled with the Stage 7 external pen test, and earlier if possible.
- **Gaps that the comparison exposed in B,** to fix when porting:
  1. Throttle TOTP and recovery-code attempts per challenge and user. A rate-limits its 2FA endpoints; B currently relies on the 5-minute challenge expiry only.
  2. Enforce the idle timeout in the database scope function, not only in `resolve()`. This applies whichever candidate is chosen.
  3. Route `gems_auth` through the pooler (it is not in the PgBouncer userlist yet).
  4. Measure timing equality for unknown vs known logins (dummy hash present; not measured).
- **On approval:**
  - port B into `src/server/auth/` with a real migration (`0003_auth`);
  - delete A's and C's code and dependencies (`better-auth`, the probe);
  - mark this ADR Accepted;
  - make the audit docs reference only B (C-05).
- **Policy values stay PMC** (lockout, timeouts, reset window: D-SEC-3) and are configuration, not code.

## 7. Approval

| Role | Name | Decision | Date |
|---|---|---|---|
| Project owner (chat approval) | not recorded in chat | **Approved B** | 2026-10-27 |
| IT (owner) | | | |
| Sponsor | | | |

Named IT/Sponsor signatures are still blank. Countersign, or record that the project owner's approval suffices.
