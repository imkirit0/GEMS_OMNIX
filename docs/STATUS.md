# GEMS OMNIX: project status tracker

**Last updated:** 2026-10-27, after user and role administration (evidence E-018).

**Rule:**
- This file is updated with **every** change to the project, in the same commit.
- Every "done" line cites its evidence: an entry in `docs/audit/12-evidence-and-verification-log.md` (E-xxx), a commit, or a test run file.
- If this file and the evidence log disagree, **the evidence log wins**, and this file must be corrected.

## 1. Snapshot

| Measure | Value | Source |
|---|---|---|
| Requirements (traceability matrix) | 290 | audit 02, T-DOC-001 |
| Requirements verified (VER) | **0** | E-018 |
| Open business decisions | **115** (107 D-/PR- items + NP-1…8), **0 approved** | audit 04 |
| Architecture decisions approved | 1: ADR-001 authentication = first-party module (project owner, chat, 2026-10-27) | `docs/adr/ADR-001-authentication.md` |
| Automated tests | **59 passing** locally (19 foundation + 21 T-AUTH + 5 auth HTTP + 7 RBAC + 7 admin HTTP/bootstrap), 0 failing | `evidence/rbac-2026-10-27T173016.txt` |
| CI | **none yet** | — |
| Current roadmap stage | Stage 1 (security POC) in progress; Stage 0 blocked | audit 10 |
| Git | `main`. Pushed to GitHub (public) up to `6e1d30b`; later commits are local until you approve a push | `git log`, `git status -sb` |

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
| 15 | User and role administration (WF-X13; FR-009/093/228): create/disable users, assign/remove scoped roles, roles and permissions, one-time set-up links; **no over-grant**, step-up, audit, sessions revoked, TOTP requirement automatic; enforced in the app **and** the DB; screens `/admin/*` and `/stepup`; first-admin bootstrap script | 2026-10-27 | E-018 |

## 3. Partly done

| Item | Done | Missing | Evidence |
|---|---|---|---|
| POC P2/P3 on Supabase (C-17) | Each test passed in ≥ 1 full run | No fully green run: 38/39 twice, intermittent connection drops, **cause unknown** (C-26) | E-010, rev. v1.4 |
| BRD / FRD | Drafts written | Your review; named owners (BRD §5, §18) | E-013 |
| ADR-001 approval | Project owner approved B | Named IT / Sponsor countersignature (or a note that yours suffices) | ADR §7 |
| Stage 1 security POC (audit 11) | P0 auth choice, P1 login (module + screens), P2 isolation (local), P3 numbering, part of P4 (audit atomicity, step-up) | T-SEC-001…019 (app-level cross-centre suite), P4 rest (T-AUD-003…010), P7 export in the app | E-014–E-017 |

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
- [ ] CI pipeline running migrate + tests on every push
- [ ] Root-cause the Supabase connection drops (C-26), from inside the region
- [ ] `.gitattributes` for stable line endings (evidence hashes)

**Stage 0 (discovery):** ⛔ blocked on legacy MySQL read-only access.

**Stage 2:** identity model (D-STU-4), numbering policy (NP-1…8), ticket core (P5), migration framework (P8).

**Stages 3–8:** not started. These are the business modules, G-FIN gate, rehearsals, UAT and cutover (audit 10).

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
