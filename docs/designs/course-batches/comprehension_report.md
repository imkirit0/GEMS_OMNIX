# Course batches: EGM step 6 comprehension report

Reviewed commit f91bd21 (2026-10-30), run in parallel with steps 5 and 7. Verdict: **not ready to build**, with 4 blockers, 13 major findings and 5 nits. The design-revision commit records how each one was resolved.

| ID | Severity | Finding | Proposed resolution |
|---|---|---|---|
| C1 | Blocker | The test names `tok-uA` as the view-only reader. Role 1 has no `student.view` (fixtures.ts:109, :130). | Use `tok-stuA` (role 17, centre 1). |
| C2 | Blocker | Role 26 and `batch.manage` do not exist in the fixtures. | List every fixture insert: the permission, the role, the users, the assignments and the sessions. |
| C3 | Blocker | `listPlacements` is gated on `student.view` alone, so a manager without view gets a 404 on the place page. | Gate on view or manage, as `listBatches` does. |
| C4 | Blocker | A create with `returning id` cannot set the audit `targetId`, which `scopedAction` fixes before its callback (action.ts:39-52). | Take `nextval` first, as `createCentre` does. |
| C5 | Major | `centreDb` is private, with a fixed map. | Say whether to copy or export it. |
| C6 | Major | The audit shapes are incomplete: no target type or id for each action, and no target for a removal. | Add a table of the audit shapes. |
| C7 | Major | `batchId` has no rule or message (non-integer, unknown, inactive, another centre). | Add `batchId` rules. |
| C8 | Major | Moving learners out of an inactive batch, and skipping rows with no batch on removal, are unstated. | State both. |
| C9 | Major | The place page has no source for its course list. Missing and unknown course codes are not handled. | Name the course source; with no course, show the picker only. |
| C10 | Major | `&batch=` is ambiguous: a filter or a preselected target? | Pick one. |
| C11 | Major | No server function feeds the centre picker or the home link. | Add `batchCentres(session)`. |
| C12 | Major | A non-numeric `centre` parameter throws `RbacError` and gives a 500, not a 404. | The page calls `notFound()` itself. |
| C13 | Major | The POST field names and their type conversions are not stated. | List the fields for each operation. |
| C14 | Major | The trigger timing and level are unclear, a second trigger has no name, and the RAISE is not given. | Name both triggers; row-level, deferred; give the RAISE. |
| C15 | Major | A registration whose status returns to ACTIVE can take its batch over capacity. | Fire the trigger on a `status` update too, or rule it out. |
| C16 | Major | The time format is not stated. | Return `HH:MM`; seconds are zero. |
| C17 | Major | The row types, the sort order, the truncation flag and the join path are not given. | Give them. |
| C18 | Nit | "Validation before any database access" contradicts the merged-row checks, which need the locked row. | Field checks first; merged checks after the lock. |
| C19 | Nit | `updateBatch({})` is undefined. | It gives "nothing to change" before the database. |
| C20 | Nit | The success query parameters and the message text are not given. | State them. |
| C21 | Nit | The code check is described, not quoted. | Quote the SQL. |
| C22 | Nit | Terms are not explained. | Link or explain each one. |

**Found sound:**
* The registration id is a UUID.
* The column grant plus the restrictive policy stop a viewer from writing by SQL.
* The catalogue helpers are exported.
* `adminPost` maps the `detail` field correctly.
