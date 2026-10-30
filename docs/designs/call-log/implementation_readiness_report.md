# Call log: EGM step 9 implementation readiness report

**Reviewed:** commit 4532eb5, 2026-10-30.
**Verdict:** ready to build once R1–R5 are applied in the plan. All findings below were applied at build.

**Checked and holding:**
* `ticket_immutable` fires for the owner.
* The fixtures can truncate the table while replica mode is on.
* No test enumerates triggers.
* `reset.sql` is unaffected.
* The 0018 constants are at `:174-178`.
* T-RLS-002 places `call_log` after `batch`.
* T-RLS-005 is unchanged.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Blocker | The field rules throw `PersonError`, but `adminPost` maps only `RbacError`, so field errors would surface as 500s. | Wrap the rules as `centres.ts` `rb` does. |
| R2 | Major | "Forged `by_user`/`at`" cannot be tested as written. | Assert three things: an app insert that names those columns gives 42501; a plain app insert gets the session user and now(); an owner insert with a forged `at` stores now(). |
| R3 | Major | The Prisma relation names and referential actions are not given. | Name the relations `callLogTeleCaller` and `callLogBy`; use Restrict/Restrict. |
| R4 | Major | The smoke test has no enquiry viewer without manage. | Add a `smoke_enq_view` role, assigned to the viewer at A. |
| R5 | Major | The audit `fields` order and contents are open. | Fixed order; stored non-null fields; `centreId` excluded. |
| R6 | Nit | The tele-caller default's "otherwise null" branch is unreachable. | Default to `ctx.userId`. |
| R7 | Nit | There is no label map. | Add `CALL_FIELD_LABELS` and `ID`. |
| R8 | Nit | The `at` format uses `+00:00`. | Select a Date and call `.toISOString()`. |
| R9 | Nit | Row triggers do not fire on 0 rows. | Insert a row first; also test truncate. |
| R10 | Nit | The `ws` constant is literal Unicode, and `enquiry_remark_check` is the twin of the description and note checks. | Copy it byte for byte; compare constraint definitions. |
| R11 | Nit | No manage holder exists at centre 2. | Assign one in the test. |
| R12 | Nit | The id of the manage-only role is open. | Role 27, local to the test. |
| R13 | Nit | `enquiryOptions` costs six queries; the preselect needs the current user. | Accept the cost; call `currentUser()`. |
| R14 | Nit | The insert grant is not pinned by a test. | Assert the column privileges. |

**Plan:**
* **L1:** audit 09 T-CL rows; matrix-03 row for R-084; audit 05 WF-X16; regenerate.
* **L2:** schema, migration 0022, `call-log.ts`, fixtures, T-RLS-002 and T-AUD-009, tests.
* **L3:** the `/calls` page and save route, home and enquiry links, T-CL-003.
* **L4:** smoke checks and 42 mutation checks (database 1–19, fixtures 20, server 21–36, route 37–38, pages 39–41, G6 42).
