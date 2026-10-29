# EGM Stage 9: Implementation readiness report (admission screens)

- **Target:** `docs/designs/admission-screens/admission-screens.md` (commit `e6d645b`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check). Read every file the design changes or depends on, plus `catalogue.ts` usages, `tests/admin-http.test.ts`, `tests/foundation.test.ts`, `etl/canonical.ts`, `etl/checks.ts`, `build_matrix.py`, `proxy.ts`, `next.config.ts`, Next's `action-handler.js`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 11 Major, 14 Nit** (R1–R25); no OWNER items. The design is buildable as written; every Next claim checked against the installed version (missing Origin only warns; host mismatch aborts; URL-encoded MPA posts ignored; MPA `redirect()` 303; MPA `notFound()` renders the 404 page; `ReadonlyHeaders` is a `Headers`). Gaps were in existing tests broken by DD-16 and `confirmNew: string[]`, the P8 fixture and rule versions, and tests that could pass vacuously or cannot run in vitest.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | Major | DD-16 breaks T-PER-001 (re-admits at the same centre and year, `people.test.ts:31`, verified) | Re-admission in `2027-28` |
| R2 | Major | `confirmNew: true` call sites stop compiling; naive replacement fails the chained-years test | Per-site replacements in plan item 12 |
| R3 | Major | DD-15 adds a FAILED row where `people.test.ts:52` asserts none | Assert the `duplicate` row |
| R4 | Major | P8: merged pairs may share a centre by chance; DD-16 would then fail the run | Pin the pairs to different centres; append a Vani pair as the planted case |
| R5 | Major | Only the admission rule bumped; `people.ts` is hashed with every rule | All three rules to v3 |
| R6 | Major | DD-16 rule algorithm unspecified | Check after survivor grouping, in source-key order |
| R7 | Major | Button-order test cannot run in vitest (`next/*` imports, no renderer) | Moved to the smoke |
| R8 | Major | Exports test must not import the action files | Static text scan |
| R9 | Major | Lost-connection injection unspecified (`withScope` retries pre-COMMIT losses) | Deferred constraint trigger terminating the backend at COMMIT |
| R10 | Major | T-ADM-005 vacuous with a wrong action id; case 3 impossible on the smoke DB (no catalogue or series) | One builder copying the real hidden fields; smoke seed |
| R11 | Major | Primary-key mapping and the `student.view` filters untested | Role assignments inserted in the tests (three cases) |
| R12 | Major | "Error digest only" smoke had no trigger | Dropped from this piece |
| R13 | Nit | 0014 SQL form | The `CREATE UNIQUE INDEX` Prisma generates |
| R14 | Nit | Errors built without `field` | Built with `invalid()` |
| R15 | Nit | App and ETL rule texts differ | One text: "already admitted at this centre this year" |
| R16 | Nit | Case of the UUID splits the lock | Lower-cased; key built in TypeScript |
| R17 | Nit | Mapping edge cases | Stated in plan items 5 and 8 |
| R18 | Nit | FAILED rows carry a never-created person id | Accepted, documented |
| R19 | Nit | T-AUD-009 scans names only | FAILED rows asserted exactly in T-ADM-002/006 |
| R20 | Nit | DD-9 test could pass on an empty set | Also asserts an admit role exists |
| R21 | Nit | Edited-identity case needs a second person; A2 needs `sr` | Stated |
| R22 | Nit | `%` and filter cases could pass vacuously | In-scope "Anu…", positive filter control, 31st search |
| R23 | Nit | Row mapping passes with a compacted-index bug | Rows 1 valid, 2 empty, 3 inactive |
| R24 | Nit | Generated matrix files omitted | Regenerated in A1 |
| R25 | Nit | Client imports | `import type`; `app/students/search.tsx` |

## Resolution

**Status: resolved (2026-10-29).** All 25 applied; the file-by-file plan (A1–A4) and 22 mutation checks are in the design. EGM review complete; the design awaits the owner's build approval.
