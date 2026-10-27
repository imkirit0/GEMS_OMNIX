# GEMS OMNIX: project status tracker

**Last updated:** 2026-10-27, after the T-SEC suite (evidence E-020).

**Rule:**
- This file is updated with **every** change to the project, in the same commit.
- Every "done" line cites its evidence: an entry in `docs/audit/12-evidence-and-verification-log.md` (E-xxx), a commit, or a test run file.
- If this file and the evidence log disagree, **the evidence log wins**, and this file must be corrected.

## 1. Snapshot

| Measure | Value | Source |
|---|---|---|
| Requirements (traceability matrix) | 290 | audit 02, T-DOC-001 |
| Requirements verified (VER) | **0** | E-020 |
| Open business decisions | **115** (107 D-/PR- items + NP-1…8), **0 approved** | audit 04 |
| Architecture decisions approved | 1: ADR-001 authentication = first-party module (project owner, chat, 2026-10-27) | `docs/adr/ADR-001-authentication.md` |
| Automated tests | **64 passing** (19 foundation + 21 T-AUTH + 5 auth HTTP + 7 RBAC + 7 admin HTTP/bootstrap + 5 T-SEC), plus real-server checks in CI: admin journey (10 steps) and security smoke (13 checks) | `evidence/tsec-2026-10-27T180310.txt` |
| CI | **GitHub Actions, green**: every push to `main` and every PR runs `scripts/ci.sh`. Runs 40501900222 (`b77d262`) and 40503305157 (`e753f44`) succeeded. **Defect fixed in E-020:** before it, a typecheck error could not fail CI (`set -e` + `&&`) | E-019, E-020 |
| Current roadmap stage | Stage 1 (security POC) in progress; Stage 0 blocked | audit 10 |
| Git | `main`. Pushed to GitHub (public) up to `e753f44`; later commits are local until you approve a push | `git log`, `git status -sb` |

## 2. Completed

| # | Item | Date | Evidence |
|---|---|---|---|
| 1 | Read sources (SPEC 57 pp, WF), legacy XLS profile, API documents | 2026-10-26 | E-001…E-004 |
| 2 | Audit pack v1.1: 12 artifacts, 290-row matrix, 0-error consistency check (T-DOC-001) | 2026-10-26 | E-005, E-006 |
| 3 | Prisma 7.10.1 pinned; Supabase connectivity (session pooler) | 2026-10-26 | E-007, rev. v1.2 |
| 4 | POC P2 (RLS isolation) and P3 (numbering) **locally**: 39/39, mutation-checked | 2026-10-27 | E-008, rev. v1.3 |
| 5 | Supabase version verified (PG 17.6, TLS verified) | 2026-10-27 | E-009 |
| 6 | Old app's database contents wiped from Supabase (as instructed) | 2026-10-27 | E-010 |
| 7 | GEMS 2.0 Refs compared (117 items), classed reference-only | 2026-10-27 | E-011, E-012, rev. v1.5 |
| 8 | BRD and FRD drafts v0.1 (FRD generated from the matrix) | 2026-10-27 | E-013 |
| 9 | App foundation: Next.js 16 + Prisma 7, org/access/session/audit/numbering schema, RLS migration, scoped DB access, authorize + audit gate | 2026-10-27 | E-014, commit `a34600c` |
| 10 | GitHub repository created and pushed (public, by user decision) | 2026-10-27 | commit `a47eaf8` |
| 11 | ADR-001 bake-off: Auth.js eliminated, Better Auth 15/17, first-party 17/17; **B approved** | 2026-10-27 | E-015, commit `cc4766f` |
| 12 | Auth module ported into the app (`src/server/auth`, migration `0003_auth`, permanent T-AUTH suite); Better Auth/Auth.js code and packages removed; `gems_auth` routed through the pooler | 2026-10-27 | E-016, commit `4558768` |
| 13 | Auth follow-ups: second-factor lockout across challenges (T-AUTH-006b); idle timeout and account rules enforced in the DB (T-AUTH-013b); centre deactivation (T-AUTH-012); **timing oracle found and fixed** (ratio 2.62 → 0.99, T-AUTH-002b); password minimum in the module | 2026-10-27 | E-017 |
| 14 | Sign-in screens and route handlers: login, two-step verify, TOTP enrolment (recovery codes shown once), logout, password reset; same-origin check on every POST (T-AUTH-016); verified on a real `next start` server | 2026-10-27 | E-017, commit `6e1d30b` |
| 15 | User and role administration (WF-X13; FR-009/093/228): create/disable users, assign/remove scoped roles, roles and permissions, one-time set-up links; **no over-grant**, step-up, audit, sessions revoked, TOTP requirement automatic; enforced in the app **and** the DB; screens `/admin/*` and `/stepup`; first-admin bootstrap script | 2026-10-27 | E-018, commit `9e93ce2` |
| 17 | T-SEC suite for existing surfaces: centre list/view (first centre-scoped pages, FR-022/022.02) with 404 parity; crafted filters; masters immutable for the app role; generic errors with reference ids on every route and page; no impersonation; per-request CSP nonce + security headers; client-bundle secret scan; real-server smoke in CI | 2026-10-27 | E-020 |
| 16 | Continuous integration: `scripts/ci.sh` (docs consistency, generated-file sync, fresh DB + migrations, schema-drift gate, no unsafe SQL, typecheck, all tests, build) run by GitHub Actions on every push/PR; LF line endings fixed via `.gitattributes` | 2026-10-27 | E-019, commit `b77d262`, run 40501900222 |

## 3. Partly done

| Item | Done | Missing | Evidence |
|---|---|---|---|
| POC P2/P3 on Supabase (C-17) | Each test passed in ≥ 1 full run | No fully green run: 38/39 twice, intermittent connection drops, **cause unknown** (C-26) | E-010, rev. v1.4 |
| BRD / FRD | Drafts written | Your review; named owners (BRD §5, §18) | E-013 |
| ADR-001 approval | Project owner approved B | Named IT / Sponsor countersignature (or a note that yours suffices) | ADR §7 |
| Stage 1 security POC (audit 11) | P0 auth choice, P1 login (module + screens), P2 isolation (local), P3 numbering, part of P4 (audit atomicity, step-up), T-SEC for every surface that exists (see the T-SEC table below) | P4 rest (T-AUD-003…010), P7 export in the app, the T-SEC items waiting on features | E-014–E-020 |

## 4. To do (in roadmap order)

**Authentication (remaining before any real user logs in):**
- [ ] E-mail adapter for reset links. Needs a provider decision (D-COMM-1); today links go to an in-memory outbox, so **reset does not reach users yet**
- [ ] Independent security review of the auth module (required before production)
- [ ] Set `TRUST_PROXY_HEADERS=1` on the hosting platform (otherwise every client shares one rate-limit bucket)
- [ ] T-AUTH-017 API bearer tokens: only when an API consumer needs them (D-API-1)
- [ ] Visual design of the screens. They are unstyled on purpose; needs a design system decision

**Administration (remaining):**
- [ ] Delegated administration (regional admins managing only their region): today RBAC actions need network-wide rights, the safe default
- [ ] Map the 43 legacy roles into roles and permissions (D-SEC-1, business decision)
- [ ] Permission keys for the business modules are added as each module is built

**Platform:**
- [ ] Root-cause the Supabase connection drops (C-26), from inside the region

**Stage 0 (discovery):** ⛔ blocked on legacy MySQL read-only access.

**Stage 2:** identity model (D-STU-4), numbering policy (NP-1…8), ticket core (P5), migration framework (P8).

**Stages 3–8:** not started. These are the business modules, G-FIN gate, rehearsals, UAT and cutover (audit 10).

## 4a. T-SEC coverage (audit 09 §T-SEC)

| Test | Status | Where |
|---|---|---|
| 001 B record page → 404, no oracle | **done** (centre view) | tests/sec.test.ts, smoke-security |
| 002 server action updating a B record | covered at module level (T-RLS-018, sec 013); route-level with the first centre-data mutation route | Stage 3 |
| 003 receipt with tampered centreId | waits on fees/receipts | Stage 4 |
| 004 `/api/v1?centreId=B` | waits on the API | Stage 7 |
| 005 crafted list/search filters | **done** (centre list) | tests/sec.test.ts, smoke-security |
| 006 export with tampered filters | waits on exports in the app | Stage 1 P7 |
| 007 mutate HO-global master without permission | **done** (DB: app role cannot write masters; RBAC) | tests/sec.test.ts, tests/rbac.test.ts |
| 008 approve a ticket raised by B | waits on tickets | Stage 2/5 |
| 009 download a B document | waits on documents/uploads | Stage 3 |
| 010 bulk import naming B's register numbers | waits on imports | Stage 3+ |
| 011 background job output per centre | waits on jobs | Stage 6/7 |
| 012 forced error → generic message + reference | **done** (all routes and pages) | tests/sec.test.ts, smoke-security |
| 013 HO "act as centre" impossible | **done** | tests/sec.test.ts |
| 014 XSS inert; CSP blocks inline script | **done** (escaping + nonce CSP); template rendering still to come (certificates/ID cards) | smoke-security |
| 015 rate limit on exports and search | waits on exports/search | Stage 1 P7 |
| 016 uploads: magic bytes, size, zip bomb | waits on uploads | Stage 3 |
| 017 client bundle secret scan | **done** (CI gate) | scripts/scan-client-bundle.mjs |
| 018 cron endpoint without secret → 401 | waits on jobs | Stage 6/7 |
| 019 legacy-API shim key scope | waits on the API shim | Stage 7 |

## 5. Waiting on you or others

| Item | Who | Since |
|---|---|---|
| Read-only access to legacy GEMS MySQL (blocks Stage 0) | You / vendor d'Katia | 2026-10-26 |
| Delete Supabase storage bucket `resumes` (4 files of the old app) | You | 2026-10-27 |
| Rotate the Supabase DB password (pasted in chat on 26 Oct) | You | 2026-10-26 |
| Named owners and decisions for 115 open items (start with BRD §9.2) | Business owners | 2026-10-26 |
| Review BRD/FRD v0.1 | You | 2026-10-27 |
| Push the local commits to GitHub? The repo is public | You | 2026-10-27 |

## 6. Known risks

| Risk | Note |
|---|---|
| Public repository | Contains internal PDFs and documented weaknesses of the live legacy system (user decision, 2026-10-27) |
| Legacy weaknesses still live | Hard-coded approvals password, centre impersonation (FR-010, FR-013) |
| Supabase connection drops | C-26, open |
| First-party security code | Needs the independent review above |
