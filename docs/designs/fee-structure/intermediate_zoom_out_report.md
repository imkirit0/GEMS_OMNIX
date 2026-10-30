# Fee structure: EGM step 8 intermediate zoom-out report

**Reviewed:** commit c1caf9c, 2026-10-30.

**Verdict:** approve after small revisions. There are no blockers. All findings from steps 5–7 are resolved in substance, and nothing unneeded was added.

These points were checked against the code and hold:
* The line guard's `for share` read works for `fee.setup` holders, who have UPDATE on `status` and pass the update policy.
* Publish stamping does not conflict with the guard.
* The caption guard sees published plans under RLS.
* T-RLS-002 sorts correctly.
* Adding a `MasterKind` breaks no test.
* `adminWrite` wraps its callback in `db()`.

| ID | Severity | Finding | Recommendation | Applied |
|---|---|---|---|---|
| I1 | Major | The offering rule contradicts `admit()`: named centres are exclusive. | Reuse the `admit()` rule, and refuse class plans for courses with named centres. | Yes |
| I2 | Major | A caption change or a deactivation can race a publish. | `publishPlan` reads each line's type and caption `for share`. Add a race test. | Yes |
| I3 | Major | Where `feeDb` sits is not stated. | Put it inside `adminWrite`, and match on the constraint name in the message. | Yes |
| I4 | Nit | A frozen caption shows the plan's error message. | Add `fee.caption.locked`. | Yes |
| I5 | Nit | The "unchanged columns" wording is unclear. | Exclude `status`, `published_at` and `published_by`. | Yes |
| I6 | Nit | The `for share` privilege and policy requirement is not stated; a non-holder's insert can fail with 23514 instead of 42501. | State it. Tests accept either code. | Yes |
| I7 | Nit | The "0021 lesson" wording is misleading. | Reword it. | Yes |
| I8 | Nit | The database has no 200-character catalogue name rule. | Add an explicit `char_length` check. | Yes |
