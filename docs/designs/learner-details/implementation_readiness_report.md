# EGM Stage 9: Implementation readiness report (learner details)

- **Target:** `docs/designs/learner-details/learner-details.md` (commit `68d5d86`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check). Read every file the design changes or depends on, plus `tests/foundation.test.ts`, `tests/catalogue.test.ts`, `scripts/etl/setup.mjs`, migrations 0002, 0007, 0008.
- **Date:** 2026-10-29
- **Result:** **5 Blocker, 8 Major, 8 Nit** (R1–R21); no OWNER items. Verdict: not buildable exactly as written; every fix small and local. Checked and fine: `fd.has` for selects and checkboxes; the bundle scan with `details.ts` (no `db`, Prisma or `node:` import); the gems_app session pattern for direct-SQL tests; the drift gate ignores checks, policies and grants.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | Blocker | The preflight would count `person_detail` as `gems_etl`, which has no grant (verified): every ETL test would fail with 42501 | No preflight change; the foreign key covers it |
| R2 | Blocker | `isWellFormed()` is ES2024; the project targets ES2023 (verified) | `/\p{Cs}/u` |
| R3 | Blocker | The "newline-sensitive flag" would anchor `^`/`$` at every line | No flag |
| R4 | Blocker | Postgres `\s` depends on the database locale; differs from JS `trim()` for NBSP, U+0085, U+FEFF | The JS trim set written out in the checks |
| R5 | Blocker | Phase order: the new required fields break T-ADM tests and the smoke `learner` | Form layer and the test-data changes in D3 together |
| R6 | Major | `person-rules.ts` list incomplete (`ASCII_SPACE`; `invalid`/`optText` not exported) | Completed; `export *` from `people.ts` |
| R7 | Major | `Intl.DisplayNames` in a client component can mismatch on hydration | Names computed on the server, passed as a prop |
| R8 | Major | IN re-applied after an error; the T-LD-001 default case vacuous | Default via the initial state; checked in the smoke |
| R9 | Major | No view-only fixture user | Role 19 and a session in the test's `beforeEach` |
| R10 | Major | The database cannot see NUL or lone surrogates; inner controls unchecked | Control clause in each check; samples per side |
| R11 | Major | The T-AUD-009 scan's line format | `action:` before `permission:` on one line; catalogue entry |
| R12 | Major | Required check vs "missing input kept" | Absent required = empty; the kept case uses an optional key |
| R13 | Major | The 23514 mapping never exercised | Temporarily stricter check in the test |
| R14 | Nit | Files for `submitDetails` and the edit form | Named |
| R15 | Nit | `in` accepts `toString`; `ß` upper-cases to `SS` | `Object.hasOwn`; ASCII check first |
| R16 | Nit | Closure state across `withScope` retries | Reset per attempt |
| R17 | Nit | Dynamic SET invites `Prisma.raw` | Static `case when` SQL, as `changeIdentity` |
| R18 | Nit | 404 at vitest level | Expected exceptions and audit outcomes spelled out |
| R19 | Nit | `scoped_centre_ids` per row in the policy | Wrapped as an initplan |
| R20 | Nit | Fixture truncate; rule versions not CI-checked | Listed; version bump is a review item |
| R21 | Nit | Existing-person admit vs first edit untested | `Promise.all` case in T-LD-003 |

## Resolution

**Status: resolved (2026-10-29).** All 21 applied; file-by-file plan (D1–D4), exact SQL and 27 mutation checks in the design. EGM review complete; awaiting the owner's build approval.
