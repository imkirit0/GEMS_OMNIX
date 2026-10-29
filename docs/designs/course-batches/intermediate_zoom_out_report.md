# Course batches: EGM step 8 intermediate zoom-out report

**Reviewed:** commit dc0838a, 2026-10-30.

**Verdict:** approve with one Major fix (I1). Of the 46 findings from steps 5–7, 45 are resolved in substance; D3 was only half resolved until I1.

**Concurrency:** the claim is verified for VOLATILE plpgsql under READ COMMITTED.
* After the lock, a fresh snapshot sees a committed concurrent writer.
* Rows changed earlier in the same command are counted.
* KEY SHARE (the FK) is compatible with NO KEY UPDATE.
* `admit()` inserts `batch_id = null`, which is never counted.
* The owner and `gems_etl` bypass RLS, so their counts are complete.

**Complexity:** the guard's three parts, `batchCentres`, `placementCourses`, the `student.view` check inside writes, and the trading gate are all kept as justified.

| ID | Severity | Finding | Recommendation | Applied |
|---|---|---|---|---|
| I1 | Major | The database does not refuse a `batch_id` on a non-ACTIVE registration. | `batch_registration_guard`, mapped to `registrationIds: not active here`, plus an SQL test. | Yes |
| I2 | Nit | The lock select can find no row, and the guard then fails open. | `if not found or not active`; the function stays VOLATILE. | Yes |
| I3 | Nit | A future ETL writer needs UPDATE on `batch` for the lock. | Note it under Risks. | Yes |
| I4 | Nit | The app's active and capacity checks duplicate the trigger's. | Drop the app copies; keep the locks and the skip logic. | Yes |
| I5 | Nit | `canManage` is returned twice. | Only `batchCentres` returns it. | Yes |
| I6 | Nit | G3 overstates what the database enforces. | Reword: no placement beyond capacity; the `student.view` read rule for placements is enforced by the app. | Yes |
| I7 | Nit | At a centre that is later deactivated, learners cannot be moved, and the page text says "not active yet". | Accept as a limit; reword to "not active". | Yes |
