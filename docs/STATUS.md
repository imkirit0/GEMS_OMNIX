# GEMS OMNIX: project status tracker

**Last updated:** 2026-10-28, C-26 cause located (last evidence: E-030).

**Rule:**
- This file is updated with **every** change to the project, in the same commit.
- Every "done" line cites its evidence: an entry in `docs/audit/12-evidence-and-verification-log.md` (E-xxx), a commit, or a test run file.
- If this file and the evidence log disagree, **the evidence log wins**, and this file must be corrected.

## 1. Snapshot

| Measure | Value | Source |
|---|---|---|
| Requirements (traceability matrix) | 290 | audit 02, T-DOC-001 |
| Requirements verified (VER) | **0** | E-022 |
| Open business decisions | **116** (108 D-/PR- items + NP-1…8), **0 approved** | audit 04 |
| Architecture decisions approved | 1: ADR-001 authentication = first-party module (project owner, chat, 2026-10-27) | `docs/adr/ADR-001-authentication.md` |
| Automated tests | **112 passing + 3 todo** (19 foundation + 21 T-AUTH + 5 auth HTTP + 7 RBAC + 7 admin HTTP/bootstrap + 5 T-SEC + 10 exports + 6 T-AUD + 30 T-TKT), plus real-server checks in CI: admin journey (10 steps) and security smoke (18 checks) | `evidence/audit-2026-10-27T190404.txt` |
| CI | **GitHub Actions, green**: every push to `main` and every PR runs `scripts/ci.sh`. Runs 40501900222 (`b77d262`), 40503305157 (`e753f44`) and 40508221829 (`b1c5962`, first with the real-server stage) and 40511940652 (`857b51a`) succeeded. **Defect fixed in E-020:** before it, a typecheck error could not fail CI (`set -e` + `&&`) | E-019, E-020 |
| Current roadmap stage | Stage 1 (security POC) in progress; Stage 0 blocked | audit 10 |
| Git | `main`. Pushed to GitHub (public) on 2026-10-28 at the owner's request, again after the dev-origin change (2008a2b); later commits local; outgoing commits scanned for the keys pasted in chat, signed-URL tokens and the project ref: none | `git log`, `git status -sb` |

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
| 19 | Audit trail (T-AUD): complete field set (actor, session, roles, scope, request id, ip, target, before/after, reason) written only via `app.audit()` (actor cannot be forged); redaction of personal identifiers and secrets in audit data and logs; request id on every response and audit row; coverage gate: every audited action catalogued and asserted | 2026-10-27 | E-022 |
| 18 | Exports (Stage 1 P7): one generic, permissioned, PII-gated, streamed (cursor + backpressure, transaction opens only on first read), audited, rate-limited CSV export with formula-injection guard; datasets centres and users; download buttons; real-server check | 2026-10-27 | E-021 |
| 17 | T-SEC suite for existing surfaces: centre list/view (first centre-scoped pages, FR-022/022.02) with 404 parity; crafted filters; masters immutable for the app role; generic errors with reference ids on every route and page; no impersonation; per-request CSP nonce + security headers; client-bundle secret scan; real-server smoke in CI | 2026-10-27 | E-020 |
| 16 | Continuous integration: `scripts/ci.sh` (docs consistency, generated-file sync, fresh DB + migrations, schema-drift gate, no unsafe SQL, typecheck, all tests, build) run by GitHub Actions on every push/PR; LF line endings fixed via `.gitattributes` | 2026-10-27 | E-019, commit `b77d262`, run 40501900222 |
| 20 | Ticket-engine design **approved** after EGM review stages 5–9; build phase P1: ADR-002 (Proposed), D-STO-1, T-TKT-019…022, matrix and FRD regenerated; `ci.sh` green (80 tests, smoke 16/16) | 2026-10-28 | E-023, commit `eeb42b2` |
| 21 | Ticket engine P2: migration `0009_tickets` (10 tables, RLS, guard and append-only triggers, 6 eligibility functions, permissions, grants), schema, fixtures; guard probe 11/11; `ci.sh` green (80 tests) | 2026-10-28 | E-024, commit `9ff5d54` |
| 22 | Ticket engine P3: engine (raise, act, reassign, re-raise, reads, documents), type setup, handler contract, storage (Supabase + fake), failure-audit hook; `tests/tickets.test.ts` 30 + 3 todo; mutation checks 3/3 caught; `ci.sh` green (110 tests) | 2026-10-28 | E-025, commit `3ec391e` |
| 23 | Ticket engine P4: routes (upload, raise, act, reassign, download as POST + 303), screens (list, raise, detail, approvals, ticket-type admin), CSP storage origin, bundle scan for Supabase keys, `storage-setup.mjs`; ticket 404 parity on the real server; `ci.sh` green (111 tests, smoke 18/18) | 2026-10-28 | E-026, commits `00ab8a0`, `6fbab77` |
| 24 | Ticket engine P5: manual Supabase run. Private bucket `ticket-documents` created; storage calls, Range, overwrite refusal, type limit checked; **DD-15 Data API check passed** (no `app` schema); end to end through the real app: upload, raise, two-level approval, download | 2026-10-28 | E-027 |
| 25 | Ticket engine real-browser check in Chrome: upload PUT to Supabase under CORS, raise, two-level approval by clicks, download redirect followed under CSP `form-action` | 2026-10-28 | E-028 |
| 26 | Search rate limit (T-SEC-015 search part): `app.rate_take`, 30 per minute per user (PMC); `ci.sh` green (112 tests) | 2026-10-28 | E-029, commit `eed7d01` |

## 3. Partly done

| Item | Done | Missing | Evidence |
|---|---|---|---|
| POC P2/P3 on Supabase (C-17) | **Two fully green runs (39/39) on 2026-10-28** (E-030); every test has passed | A third run dropped one connection (C-26: Supabase's transaction pooler; cause located, app mitigation open). No wrong data in any run | E-010, E-030 |
| Ticket/approval engine design (Stage 2 core) | Design workflow chosen: EGM plugin (`egm@egm`, google/elephant-goldfish-model 0.1.0). Input brief `docs/designs/ticket-engine/input-brief.md`; `CLAUDE.md` points EGM artifacts to `docs/designs`. **Design drafted 2026-10-27** (EGM draft skill followed manually: its skills are not registered as commands): `docs/designs/ticket-engine/ticket-engine.md`, status Proposed, every section approved by the project owner in session. Owner decisions DD-1…6: rules in app code + DB guard; test-only handler in Stage 2; forward = reassign at same level; documents in Supabase Storage (needs ADR-002); role-level approver = role held over the ticket's centre; direct browser-to-Supabase upload (Vercel 4.5 MB body cap). Open: Q2 numbering series scope, Q4 self-approval sign-off, Q7 migration, Q8 legacy config, Q9 storage limits  EGM review in progress (interactive): Stage 5 zoom-out found 1 blocker (ticket numbers collide across centres), 4 major, 7 nit (`zoom_out_report.md`); all resolved in the design, owner decisions DD-7 (screens as test harness) and DD-8 (one network-wide counter); Stage 5 re-audit: 2 major, 5 nit, all applied (re-audit cap reached); Stage 6 comprehension (2026-10-28): 0 blocker, 15 major, 8 nit (`comprehension_report.md`), all 23 addressed in the design (2026-10-28), NP-2/NP-3 mix-up corrected; proposed decisions DD-9 re-raise, DD-10 number format, DD-11 type editing, DD-12 deactivation approved by owner (DD-9/DD-10 stay PMC under D-TKT-2/NP-5); Stage 6 re-audit: 21/23 confirmed, 9 major + 8 nit new (R1-R17), all fixed; R5 (raiser cannot act at all) and R9 (no handler change with open tickets) flagged to owner; Stage 7 critic review (2026-10-28): 1 blocker (stuck tickets), 20 major, 27 nit (`critic_report.md`); proposed DD-13 admin reassign, DD-14 distinct approvers, DD-15 service-key limits, DD-16 upload retention gate accepted by owner; all fixes applied (Risks section, CUJ 5, Alternatives I-K, guard triggers on insert, idempotent raise, `ticket_stranded`); Stage 8 intermediate zoom-out (2026-10-28): 0 blocker, 3 major, 5 nit (`intermediate_zoom_out_report.md`), all applied (DD-9, DD-13, DD-16 narrowed by owner); Stage 9 implementation readiness (2026-10-28): 6 blocker, 29 major, 19 nit (`implementation_readiness_report.md`), all applied; plan rewritten in 5 build phases against the real code. Stage 9 re-audit: 6 blocker, 20 major, 30 nit (incl. `for share` filtered by RLS UPDATE policy → `app.ticket_type_lock`; CSP `form-action` blocking the download redirect; own `ticketDb()` mapper), all applied; re-audit cap reached. **EGM review concluded 2026-10-28** (owner); design **Approved** for implementation by the owner (2026-10-28), then Stage 7 critic review | Engine core built and verified end to end, including in a real browser (P1–P5, E-023–E-028). Open: ADR-002 signatures; business sign-offs (NP-1…8, D-TKT-4, D-STO-1); the first domain handler (Stage 3) | commit `9632364` |
| BRD / FRD | Drafts written | Your review; named owners (BRD §5, §18) | E-013 |
| ADR-001 approval | Project owner approved B | Named IT / Sponsor countersignature (or a note that yours suffices) | ADR §7 |
| ADR-002 approval (document storage) | Written, status Proposed (2026-10-28) | Project owner, IT and Legal signatures; D-STO-1 limits; the Data API check (DD-15) before any production upload | `docs/adr/ADR-002-document-storage.md` |
| Stage 1 security POC (audit 11) | P0 auth choice, P1 login (module + screens), P2 isolation (local), P3 numbering, **P4 audit** (T-AUD 001–005, 009), **P7 exports**, T-SEC for every surface that exists (see the tables below) | T-AUD 006/007 (need imports and jobs), 008 (needs D-FIN-8), 010 (needs an audit viewer and a PMC decision); T-SEC items waiting on features; P2 on Supabase (C-26) | E-014–E-022 |

## 4. To do (in roadmap order)

**Authentication (remaining before any real user logs in):**
- [ ] E-mail adapter for reset links. Needs a provider decision (D-COMM-1); today links go to an in-memory outbox, so **reset does not reach users yet**
- [ ] Independent security review of the auth module (required before production)
- [ ] Set `TRUST_PROXY_HEADERS=1` on the hosting platform (otherwise every client shares one rate-limit bucket)
- [ ] T-AUTH-017 API bearer tokens: only when an API consumer needs them (D-API-1)
- [ ] Visual design of the screens. They are unstyled on purpose; needs a design system decision

**Exports (remaining):**
- [ ] Async export of very large files to private storage with a 5-minute signed link, re-authorised on download (06 §3). **Deferred by the owner (2026-10-28)** until both exist:
  - the first large dataset (students, fees or receipts; Stages 3–4), whose real size sets the threshold;
  - the job runner (Stage 6/7: cron or queue, system principal, T-SEC-011/018, T-AUD-007).
  Why now is too early: today's datasets are small. Centres has 386 legacy rows (about 40 KB CSV) and users is well under 1 MB, both far below the Vercel 4.5 MB response cap and the 120 s export timeout. The storage decision itself is settled: the private Supabase bucket (ADR-002).
- [ ] PII per centre for centre-scoped PII datasets (today `pii.export` must be held for all centres)
- [x] Search rate limit (T-SEC-015, search part): done 2026-10-28 (migration 0010, `app.rate_take`, 30 searches per minute per user, PMC)

**Administration (remaining):**
- [ ] Delegated administration (regional admins managing only their region): today RBAC actions need network-wide rights, the safe default
- [ ] Map the 43 legacy roles into roles and permissions (D-SEC-1, business decision)
- [ ] Permission keys for the business modules are added as each module is built

**Platform:**
- [x] Dev server reachable from any IPv4 address (`allowedDevOrigins: ["*.*.*.*"]` in `next.config.ts`, owner request 2026-10-28; `next dev` only, no effect on production)
- [x] C-26 cause located (E-030): Supabase's transaction pooler, under sustained concurrent load, sometimes resets a client connection and sometimes silently stalls it (the client waits; the database has no session). 2 of 3 full runs were green; no wrong data ever.
- [ ] C-26 mitigation in the app: connection and query timeouts with TCP keepalive (fail fast, never hang), and retry of connection errors before COMMIT in `withScope` (idempotency keys cover a drop during COMMIT)

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
| 006 export with tampered filters | **done** | tests/exports.test.ts, smoke-security |
| 007 mutate HO-global master without permission | **done** (DB: app role cannot write masters; RBAC) | tests/sec.test.ts, tests/rbac.test.ts |
| 008 approve a ticket raised by B | waits on tickets | Stage 2/5 |
| 009 download a B document | waits on documents/uploads | Stage 3 |
| 010 bulk import naming B's register numbers | waits on imports | Stage 3+ |
| 011 background job output per centre | waits on jobs | Stage 6/7 |
| 012 forced error → generic message + reference | **done** (all routes and pages) | tests/sec.test.ts, smoke-security |
| 013 HO "act as centre" impossible | **done** | tests/sec.test.ts |
| 014 XSS inert; CSP blocks inline script | **done** (escaping + nonce CSP); template rendering still to come (certificates/ID cards) | smoke-security |
| 015 rate limit on exports and search | **done**: exports (audit-row count) and search (`app.rate_take`, 30 per minute per user, PMC). Exports answer 429; the search page shows a message, because a page cannot set its own status | tests/exports.test.ts, tests/sec.test.ts |
| 016 uploads: magic bytes, size, zip bomb | waits on uploads | Stage 3 |
| 017 client bundle secret scan | **done** (CI gate) | scripts/scan-client-bundle.mjs |
| 018 cron endpoint without secret → 401 | waits on jobs | Stage 6/7 |
| 019 legacy-API shim key scope | waits on the API shim | Stage 7 |

## 4b. T-AUD coverage (audit 09 §T-AUD)

| Test | Status | Where |
|---|---|---|
| 001 complete field set, one row per action, same transaction | **done** | tests/audit.test.ts, smoke-security (request id over HTTP) |
| 002 rollback leaves no row | **done** | tests/foundation.test.ts, tests/rbac.test.ts |
| 003 denied attempt leaves a denial row only | **done** | tests/foundation.test.ts (T-RLS-018), tests/rbac.test.ts, tests/exports.test.ts |
| 004 no UPDATE/DELETE/TRUNCATE (and no forged inserts) by runtime roles | **done** | tests/audit.test.ts, tests/foundation.test.ts |
| 005 redaction in audit data and logs | **done** | tests/audit.test.ts |
| 006 bulk import audit | waits on imports | Stage 3+ |
| 007 job actor `system:<job>` with run id | waits on jobs (column `actor_kind` is ready) | Stage 6/7 |
| 008 hash chain | waits on decision D-FIN-8 (Accounts) | G-FIN |
| 009 coverage gate | **done** (CI fails on an uncatalogued or untested action) | tests/audit.test.ts, tests/audit-catalogue.ts |
| 010 audit read scope | waits on an audit viewer and the PMC decision on who may read what | Stage 7 |

## 5. Waiting on you or others

| Item | Who | Since |
|---|---|---|
| Read-only access to legacy GEMS MySQL (blocks Stage 0) | You / vendor d'Katia | 2026-10-26 |
| Delete Supabase storage bucket `resumes` (4 files of the old app) | You | 2026-10-27 |
| Rotate the Supabase DB password (pasted in chat on 26 Oct) | You | 2026-10-26 |
| Rotate the Supabase API keys (publishable, secret, anon and service_role were pasted in chat on 28 Oct); then update `SUPABASE_SERVICE_KEY` in `.env.local` | You | 2026-10-28 |
| Named owners and decisions for 116 open items (start with BRD §9.2) | Business owners | 2026-10-26 |
| Review BRD/FRD v0.1 | You | 2026-10-27 |

## 6. Known risks

| Risk | Note |
|---|---|
| Public repository | Contains internal PDFs and documented weaknesses of the live legacy system (user decision, 2026-10-27) |
| Legacy weaknesses still live | Hard-coded approvals password, centre impersonation (FR-010, FR-013) |
| Supabase connection drops | C-26, open |
| First-party security code | Needs the independent review above |
