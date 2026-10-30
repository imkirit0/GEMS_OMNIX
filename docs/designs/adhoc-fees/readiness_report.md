# Ad-hoc fees: EGM step 9 implementation readiness report

**Reviewed:** commit 20bebd9, 2026-10-30.

**Verdict:** ready with fixes (1 blocker in the text).

**Checked and holding:**
* the `fee_due_guard` lock and stamps come before every check;
* the one-plan check skips ADHOC rows;
* 0027 and 0028 need no other change;
* `fee_type` is readable by everyone;
* `adminPost` passes `FormData`;
* the left join in `getReceipt` works;
* `receipt-cancel` tests are unchanged;
* `reset.sql` still works.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Blocker | The view refers to its own alias `outstanding`. | Repeat the expression. |
| R2 | Major | `create or replace view` must repeat `with (security_invoker = true)`. | Write the full head and test `reloptions`. |
| R3 | Major | The total in `createDuesTx` would include ADHOC dues. | Filter PLAN and assert `20500.60`. |
| R4 | Major | "A plan fee cannot be charged twice" is false before Create dues. | Choose one rule and test it. |
| R5 | Major | T-FR-004's `canCollect: false` for TALLY becomes true, and T-FD-001's shape changes. | State both changes. |
| R6 | Major | The Collect form sits inside the dues branch, and its prefill is null without dues. | State the layout and the prefill. |
| R7 | Nit | The allocation guard does not read `source` or `created_at`. | Add them to the declare block and the select. |
| R8 | Nit | Validation order: extras before the amount. | Validate extras, then the amount, then the mode. |
| R9 | Nit | The SQL details are missing. | Fill them in: `owed` in both queries; `over` false when the plan is 0; the extras total from an array; the ADHOC insert columns; the audit `lines` count; INR only via `bad()`. |
| R10 | Nit | The Prisma diff must keep the composite FK as Restrict. | Note it. |
