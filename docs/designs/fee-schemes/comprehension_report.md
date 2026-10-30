# Schemes and concessions: EGM step 6 comprehension report

**Reviewed:** commit 6713404, 2026-10-30, in parallel with steps 5 and 7.

**Verdict:** revise. There are no blockers. In about ten places a builder would have to guess or read the code; each has a fix taken from an existing pattern.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Major | A registration's course is known only by its code. | Join through `course.code = r.course_code`. |
| C2 | Major | Joining concessions into `fee_due_balance` multiplies rows. The `concession` column has no source. | Use a scalar subquery. Add a `concession` column at the end. |
| C3 | Major | The design leaves unclear whose lock a raw-SQL concession runs under. | The concession guard takes the lock itself. |
| C4 | Major | A concession could be added after the assignment. | The guard requires `assignment.created_at = now()`. |
| C5 | Major | The status flow is underspecified: no retired check, no IST date, no `for share`. | Use a `to_jsonb` diff, the retired check, IST dates and `for share`. |
| C6 | Major | RLS falls short of T-RLS-002's four commands, and `fee_scheme_centre` is missing. | Add all four policies, and update the expected list. |
| C7 | Major | The column grants are not specified. | List them. |
| C8 | Major | There is no error mapping. | Add a table of constraint names to keys. |
| C9 | Major | The fixtures and `schema.prisma` changes are not listed. Sequence-created role ids will shift. | List them. |
| C10 | Major | The ETL reset's trigger names are missing. | Name them. |
| C11 | Nit | The fixture ids are muddled (`…00ff` belongs to hoAll), and `tok-feeS2` is confusing. | Use `SC = { maker …00fe, checker …0100, concede …0101 }` with tokens `tok-schM`, `tok-schA` and `tok-feeK`. |
| C12 | Nit | Terms are undefined, a file name is inconsistent, FKs are missing, and the gate toggle is not mentioned. | Define the terms and list the FKs. Use the seed lines for the rounding case. |
| C13 | Nit | The database checks only part of the permissions. | Split by status, or say so plainly. |
