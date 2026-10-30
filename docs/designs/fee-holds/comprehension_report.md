# Fee holds: EGM step 6 comprehension report

**Reviewed:** commit b58ba35, 2026-10-30, in parallel with steps 5 and 7.

**Verdict:** buildable once fixed. There are no blockers, 3 majors and 7 nits.

**Confirmed against the code:**
* `fee_due` has no `(id, centre_id)` key yet.
* Role 33 and user `…00fd` are free.
* The `receipt_allocation_guard` body in 0029 is the current one.
* The `collectFee` queries are as the design describes.
* The `student.view` select policy matches.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Major | The form's default amount includes held dues, so collecting it is refused as over. | Add a `collectable` figure, use it as the default, and state what the totals mean. |
| C2 | Major | The lock needs `registration_id`, but neither the guard nor the pre-flight reads it. | Read the due first, then lock. The pre-flight returns the registration. |
| C3 | Major | `schema.prisma` is not mentioned. | List `FeeHoldEvent` and `FeeDue @@unique([id, centreId])`. |
| C4 | Nit | Where `canHold` lives is unclear, and it ignores an inactive centre. | Put `canHold` on the registration and include the centre's ACTIVE status. Put `held` on each due row. |
| C5 | Nit | The error mapping is incomplete: no key, no inactive-centre case, no range error. | Name the keys. |
| C6 | Nit | The callback steps are misattributed, and "trading gate" is undefined. | Say "inside the callback" and define the term. |
| C7 | Nit | The `receipt_hold_guard` mapping order is not given. | Place it before the generic 23514 mapping. |
| C8 | Nit | `personId` is not tied to the due. | Join registration → admission to the person in the pre-flight. |
| C9 | Nit | The audit catalogue file is not named. | Name it. |
| C10 | Nit | The trigger names are missing, and "one row per due" is loose. | Name the triggers. Say the view uses a left join. |
