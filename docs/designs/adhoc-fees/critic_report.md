# Ad-hoc fees: EGM step 7 design critic report

**Reviewed:** commit d35e2c3, 2026-10-30, alongside steps 5 and 6.

**Verdict:** revise. There is 1 blocker and 5 majors.

The core mechanism is sound:
* the ADHOC due and its allocation are created in one transaction;
* the deferred paid check and the receipt total check are independent, and both fail closed;
* the lock order is the same everywhere;
* the MATCH SIMPLE FK and the source check are correct.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Blocker | A receipt that collects only extras, before any PLAN dues exist, blocks the plan dues forever. `createDuesTx` and `canCreate` count every `fee_due`. | Make those checks PLAN-only. Test: extras first, then `createDues`. Grep every reader. |
| D2 | Major | The database does not prove "never collected again": a void ADHOC due can still be allocated. | In the allocation guard, accept an ADHOC due only when it was created in the same transaction. Test this. F5 refuses ADHOC dues too. |
| D3 | Major | "Owed" is defined separately in each reader. | Add an `owed` column to `fee_due_balance`. |
| D4 | Major | A cashier can create dues, or collect tuition as an ad-hoc line, while the PLAN due stays owed. This weakens the separation of duties. | Refuse an ADHOC fee type that is on the registration's plan, or add `fee_type.adhoc_allowed`. Get the owner to sign the separation change. |
| D5 | Major | GST on ad-hoc lines is assumed, not designed: whether the amount includes GST, goods versus services, mixed documents. | State that the amount includes GST and label the form. Add this to the tax advisor's check. Limit goods HSN, or document why not. |
| D6 | Major | The UI cannot reach a receipt of extras only, because `canCollect` needs PLAN dues owed. | Decide: show the form whenever collection is live and allowed, or drop DD-4. |
| D7 | Nit | The total can overflow `numeric(14,2)` (error 22003). | Cap the total, or map the error. |
| D8 | Nit | A replay ignores the payload. | Compare the total on replay. |
| D9 | Nit | `getReceipt` inner-joins captions, so it drops ADHOC lines. | Use a left join, and filter by source. |
| D10 | Nit | Errors are opaque, the T-FD-002 codes may change, and `scoped(...)` is pseudo-code. | Name the ADHOC refusal, re-check T-FD-002, and write `app.scoped_centre_ids`. |
