# Fee dues: EGM step 6 comprehension report

Commit 16859ed was reviewed on 2026-10-30, alongside steps 5 and 7.

**Verdict:** revise. There are 2 blockers, 7 majors and 2 nits; the design revision commit records how each one was resolved.

**Confirmed against the code:**
* `registration` has `course_code` (not a course id), and gets its year from its admission.
* `registration` has no unique `(id, centre_id)`. Adding one conflicts with nothing.
* Role 29 and user `…00f7` are free.
* There is no route collision with `details/`.

| ID | Severity | Finding | Proposed resolution |
|---|---|---|---|
| C1 | Blocker | The guard never ties the plan to the registration's course and centre or class. | Add a check comparing the plan's course with the registration's course, and its centre or class with the registration's. |
| C2 | Blocker | `adminPost` turns `notfound` into a 303, not a 404. The registration is not tied to the person in the URL. | The route returns a 404. The pre-flight also checks that the registration belongs to `personId`. |
| C3 | Major | The guard's comparisons are not NULL-safe. The SQL for check 6 is missing. | Use `is distinct from`, and write the SQL out. |
| C4 | Major | "Course id" is wrong (the column is `course_code`). The plan version is not available for the audit row. | Write the read query out. Read the version. |
| C5 | Major | The order of the `reason` values contradicts itself. | Use one order. |
| C6 | Major | The page wiring is undefined: no `searchParams`, and an unclear shape and order. | Specify them. |
| C7 | Major | The error mapping is incomplete (field rules, `forbidden`, 23503, 42501). | Complete it. |
| C8 | Major | `planId` is ambiguous, fields are missing, and the check behind `canCreate` is unstated. | Define each. |
| C9 | Major | The seed is not reusable, and `tok-stuA` is not view-only. | Use a shared seed helper, and rename. |
| C10 | Nit | No currency regex. The schema edits are not listed. | State both. |
| C11 | Nit | The database allows dues from two plans on one registration. | Add a guard check. |
