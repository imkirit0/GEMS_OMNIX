# Fee dues: EGM step 8 intermediate zoom-out report

**Reviewed:** commit af6bd89, 2026-10-30.

**Verdict:** approve with changes.

The core design holds up against the code. These references were checked:
* `resolvePlan`;
* the `fee_plan_line` unique key, used as the FK target;
* the caption's year, which the line FK pins;
* `ticket_immutable`;
* the admission → registration FK, which cascades on update (so D6 is real);
* the policies, under which every role can read published plans.

Every finding from Z, C and D is resolved, except Z6: audit 07 was not updated.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z8-1 | Major | Z6 is unfinished. Audit 07 §1 still lists concession, fine and hold as columns of `fee_due`. F4 still says "Row lock + check". | Update audit 07: `fee_due` holds the gross amount only; the other amounts are append-only rows; outstanding is computed; F4 uses the `fee-dues:<registrationId>` advisory lock. |
| Z8-2 | Major (YAGNI) | The ADHOC scaffolding is built only so that F2 can refuse it. | Make `plan_id` and `caption_id` NOT NULL. Drop `source`, its check, guard step 2 and the ADHOC test. Keep DD-7 as a recorded decision: F3 adds `source` and relaxes the NOT NULLs. |
| Z8-3 | Minor | Guard check 7 is not safe under READ COMMITTED without a lock. | Take the `fee-dues:` advisory lock inside the guard. "Once per registration" then becomes a database invariant. |
| Z8-4 | Nit | `createDuesTx` is exported with no second caller. | Do not export it. |
| Z8-5 | Nit | `RegistrationDues` repeats fields that `getPerson` already returns, and `planId` has no consumer. | Cut it to `{ registrationId, dues, total, canCreate, noPlan }`. |
| Z8-6 | Nit | The currency regex check is redundant once the guard checks the currency equals the plan's. | Optional: drop it. |
