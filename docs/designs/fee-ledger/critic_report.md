# Fee ledger: EGM step 7 design critic report

Reviewed: commit f318175, 2026-10-30, in parallel with steps 5 and 6.

**Verdict:** revise. There are 2 blockers and 7 majors. The structure is sound: the ledger is cash basis, journals are built from immutable stamped lines, every journal balances without a Round Off line, and posting happens inside the receipt's own transaction.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Blocker | The posting function can be called directly. PUBLIC can execute it, it is not revoked, and the function does not check the receipt's status. | Use definer trigger functions (`returns trigger`), or revoke execute and assert the receipt's state. |
| D2 | Blocker | FORCE RLS binds the owner unless the owner has superuser or BYPASSRLS. The reads currently pass by luck under the caller's scope. | State and test the owner's attribute. T-RLS-005 already asserts that every definer's owner bypasses RLS. |
| D3 | Major | A reversal recomputed from today's mapping is not a true mirror. | Build the reversal from the original entry's lines, swapped. Assert that the sums match. |
| D4 | Major | Trigger order: the post runs before the total check. If a receipt is cancelled in the same transaction that created it, the cancel posts before the receipt's own entry exists. | Rename the posting trigger so it sorts after the check. Assert the debit equals the total and there is at least one line. Refuse the same-transaction cancel by name, or defer it. |
| D5 | Major | At rollout every fee type is unmapped. Receipts made before 0030 have no entry to reverse. The unmapped-account refusal only arrives at commit. | Seed the mappings or note the rollout step. Backfill journals for existing receipts, or define their cancel. Check the mapping early. |
| D6 | Major | Journals have no currency, so non-INR receipts mix with INR. | Add `currency`, or refuse non-INR until D-CUR-1 is decided. |
| D7 | Major | Deposit and agency heads are liabilities, not income. | Allow mapping to `INCOME` or `LIABILITY` (PMC). Filter out zero income lines. |
| D8 | Major | The search path should include `pg_temp` last. | Use `pg_catalog, app, pg_temp` and qualify every name. |
| D9 | Nit | F1 is bound only inside the function. | Add a deferred balance trigger on `journal_line`. |
| D10 | Major | Later-period reversals. The name `period` is easy to confuse with F12 accounting periods. | Rename it `fy`. Choose the entry date in one place. Flag credit notes to Accounts. |
| D11 | Nit | `account.active` is not rechecked when posting. | Recheck it at post time. |
| D12 | Nit | Day Book: there is no index on `(centre_id, entry_date)`; a reversal looks the same as a receipt; the narration includes the cancel reason; the `(select …)` wrapper is missing. | Add the index, show the source, leave the reason out of the narration, and use the wrapper. |
| D13 | Nit | Hash chain: it needs a total order and a canonical form of each entry, and the ETL reset breaks it. | Plan a per-centre chain head. Make the reset impossible in production. |
| D14 | Nit | Banks: cheques are recognised at receipt, and a dishonour is a separate source. | Keep the mode-to-account choice in one branch. Mark cheques and dishonours as PMC. |
