# Fee ledger: EGM step 6 comprehension report

**Reviewed:** commit f318175, 2026-10-30, in parallel with steps 5 and 7.

**Verdict:** changes are needed before the build. There is 1 blocker, 6 majors and 5 nits.

**Confirmed against the code:**
- the 0027 trigger names, the `receipt(id, centre_id)` key, and `financial_year`;
- 0028 stamps `cancelled_at` before an AFTER trigger runs;
- role 32 and user `…00fc` are free;
- the owner-bypass and inventory rules hold.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Blocker | The post runs before the total check, so T-FR-002 would fail. | Sort the post trigger after the total check. |
| C2 | Major | The trigger wrappers are not specified. EXECUTE and status preconditions are missing. | Use definer trigger functions and test a direct call. |
| C3 | Major | The FK needs a unique `(id, centre_id)` on `journal_entry`. NOT NULL is unstated. | Add both. |
| C4 | Major | `account` has no select grant and no ENABLE/FORCE. | Add both. |
| C5 | Major | The chart seed is unspecified: double codes, non-numeric codes, unclear kinds. | Give the full seed table. |
| C6 | Major | The `accountId` contract is unspecified: required or not, null allowed or not, `GUARD_KEY`, grants, existing tests. | Spell each one out. |
| C7 | Major | Currency is not addressed. | Add a currency column, or refuse non-INR. |
| C8 | Nit | `seedMasters` and `fee.ts` names are wrong. | Use `masters()` and `src/server/fees.ts`. |
| C9 | Nit | The `ledger.view` permission and its `role_permission` fixture rows are missing. | Add them. |
| C10 | Nit | The unbalanced-entry test is vague. | State the method. |
| C11 | Nit | The ETL reset's trigger names and truncate list are not given. | Name them. |
| C12 | Nit | References are undefined. | Link fee-receipts DD-5. |
