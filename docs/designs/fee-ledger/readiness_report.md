# Fee ledger: EGM step 9 implementation readiness report

**Reviewed:** commit f92640b, 2026-10-30.

**Verdict:** ready with fixes.

**Checked and holding:**
* `receipt_zpost` fires after `receipt_total_commit`, both in deferred queue order and under `set constraints all immediate`.
* The 0028 guard order holds.
* A definer function can be used as a trigger. Revoking EXECUTE only blocks direct calls.
* The owner is `postgres`: superuser locally, BYPASSRLS on Supabase.
* The T-RLS-002 and T-RLS-005 positions are correct.
* Role 32 and user `…00fc` are free.
* Fee types are created only in `masters()` and the ad-hoc test.
* The ETL reset change is needed.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Blocker | T-AF-002's `voidInOne` cancels a receipt in its own transaction, so it now raises `journal_reversal_guard`. | List the change and update the expectation. |
| R2 | Blocker | `schema.prisma` is not mentioned. | Add `Account`, `JournalEntry`, `JournalLine` and `FeeType.accountId`. |
| R3 | Major | The balance test method is left open. | As owner, disable `receipt_total_commit` inside the transaction, insert total 11 with a line of 10, commit, and expect `journal_balance_guard`. |
| R4 | Major | The early check's query is missing. | Moot: step 8 Z8-1 removes the check. |
| R5 | Minor | `account` state leaks between tests. | Reactivate accounts in `reset()`. List the journal tables in the truncate. |
| R6 | Minor | The fixture lists are not named. | Name them, and export `LV`. |
| R7 | Minor | The fee type route and page wiring are missing. | Name them. |
| R8 | Minor | No home-link helper. | Add `ledgerCentres(session)`. |
| R9 | Nit | The placement of the `receiptDb` mappings and the message convention are unstated. | Place the mappings before the generic 23514 branch, with `constraint "<name>"`. |
| R10 | Nit | The narration and credit order are undefined. | Use `Receipt {no}`, with credits by account code, then CGST, SGST, IGST. |
| R11 | Nit | The direct-call test has no expected code. | Expect 42501. |
| R12 | Nit | The `GUARD_KEY` pair is missing. | Give the `[key, message]` pair. |
| R13 | Nit | The 92-day cap is ambiguous. | Use `to - from <= 91`. |
| R14 | Nit | The home of the mapping condition is unclear. | Make it a rollout checklist item, and update the gate comment. |
| R15 | Nit | The `created_at` default is missing. | Add `default now()`. |
