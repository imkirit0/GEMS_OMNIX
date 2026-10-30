# Ad-hoc fees: EGM step 6 comprehension report

**Reviewed:** commit d35e2c3, 2026-10-30, in parallel with steps 5 and 7.

**Verdict:** revise. There is 1 blocker and 3 majors.

**Confirmed:**
- `adminPost` passes `FormData`, so `getAll` works.
- Null captions are distinct under the unique key.
- The MATCH SIMPLE FK holds.
- The view and the D15 rule hold.
- Commit errors are mapped.
- `listFeeTypes` returns `active`.
- T-FD-002 inserts default to PLAN and still pass.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Blocker | `createDuesTx` and `canCreate` count every `fee_due`, so a receipt with only extras blocks Create dues forever. | Make both PLAN-only, name them in the design, and add a test. |
| C2 | Major | The UI can't reach a receipt with only extras: the form needs dues and `owing`. | Add a flag for taking extras, or state the limit. |
| C3 | Major | ADHOC rows have no FK on `fee_type_id`. | Add `fee_due_fee_type_id_fkey` and the Prisma relation. |
| C4 | Major | "Steps 3–7" doesn't match anything in the guard. | Describe the branch in code terms. The one-plan check ignores ADHOC because the plan column is null. |
| C5 | Minor | `getReceipt` and `duesForPerson` inner-join captions, so ADHOC lines vanish and the totals are inflated. | Use a left join with `coalesce`, and list the three queries. |
| C6 | Minor | A non-INR plan with extras fails as a generic mismatch. | Refuse it with a field message, or state the limit. |
| C7 | Nit | A CTE insert makes the allocation guard blind to the new due. | Use separate statements with `returning id`. |
| C8 | Nit | The `extras` label is missing, and the select needs an empty option. | Add both. |
