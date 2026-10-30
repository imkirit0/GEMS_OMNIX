# Call log: EGM step 7 design critic report

**Reviewed:** commit d8d377d (2026-10-30), alongside steps 5 and 6.
**Verdict:** revise. There is 1 blocker, 4 major findings and 4 nits. How each is resolved is recorded in the design revision commit.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Blocker | The insert grant leaves out `id`, but the server inserts the id it reserved with `nextval` first, so every insert is refused with 42501. | Add `id` to the grant, and assert that the returned id is the reserved one. |
| D2 | Major | The audit row's `after` would copy phone and name into the append-only audit log, which `enquiry.create` does not do (enquiry.ts:204). | Audit `{ fields }` only, and assert that the audit row holds no phone or name. |
| D3 | Major | The tele-caller guard combines its conditions with AND, which does not short-circuit, so a role other than gems_app can be refused EXECUTE on the function. | Use nested ifs, or drop the branch. |
| D4 | Major | Adding `call_log` to `scripts/etl/reset.sql` would delete real calls on every ETL re-run, although the table does not depend on admissions. | Leave it out of `reset.sql`. |
| D5 | Major | Historical tele-caller names are lost, and the logger shows as "Staff". | Accept "Staff" as a limit, or add a `call_people` definer function. |
| D6 | Nit | The fixtures already use `session_replication_role`. | Add `app.call_log` to the fixtures' truncate list. |
| D7 | Nit | The database name check uses `btrim`, which differs from the app's trimming. | Use the `ws`/`ctl` constants. |
| D8 | Nit | The phone filter, its rate limit and its index serve nothing. | Drop them until the page has a POST search. |
| D9 | Nit | The page's 404 is not specified for an `RbacError` (a bad centre id). | The page parses the id; add a smoke check for `centre=abc`; T-RLS-005 is unchanged. |

**Open point:** `enquiry_may_receive` requires view. This is resolved because manage implies view (T-ENQ-005).
