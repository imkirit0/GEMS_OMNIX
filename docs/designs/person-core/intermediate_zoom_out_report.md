# EGM Stage 8: Intermediate zoom-out report (person core)

- **Target:** `docs/designs/person-core/person-core.md`, full file (462 lines, commit `bc8ee86`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Also read `numbering.ts`, `action.ts`, `db.ts`, `tickets/engine.ts`, `tickets/handlers.ts`, migrations 0002/0007/0009, `tests/fixtures.ts`.
- **Date:** 2026-10-28
- **Result:** **0 Blocker, 1 Major, 4 Nit** (Z11–Z15).

The reviewer found that three rounds of fixes had not grown the design past the problem. Each Stage 7 addition is small, lock order is the same on every path (match-key lock, ADMISSION row, REGISTER row), and the three allocator modes each have one real caller. One contradiction between fixes remained (Z11).

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z11 | Major | D9 (duplicate check in the caller's `student.admit` scope) and D3 (linking needs ALL scope) together force a regional user to create a duplicate the system has just named | **OWNER: one rule.** An `existingId` must have an admission at a centre in the caller's `student.admit` scope, the same set `findMatches` searches. HO users qualify everywhere, regional users within their region; the ALL-scope branch is deleted. DD-4 restated; T-PER-001 now expects the regional user to link |
| Z12 | Nit | `registerPeriod` looks configurable but changes nothing | Deleted |
| Z13 | Nit | Reuse `authorize()` for the ALL-scope check | Moot after Z11 |
| Z14 | Nit | The centre binding is written per handler and in `changeIdentity`; `reason` round-trips unused | Exported `assertAdmittedAt(tx, centreId, personId)`, used by `changeIdentity` and handler `validate`. `changeIdentity` drops `reason` and returns `{ before, after }`, the `apply()` contract |
| Z15 | Nit | The consecutive-years rule is app-only, so bulk loads skip it | Moved into the database check with the format; `admit` checks first only for a clean `PersonError("invalid")` before allocating |

**Status: resolved (2026-10-28).**
