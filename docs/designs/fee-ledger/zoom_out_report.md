# Fee ledger: EGM step 5 zoom-out report

**Reviewed:** commit f318175, 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** pass with changes. The scope is right. Posting in the database is the simpler choice, because the database already stamps every input. Nothing blocks D-FIN-8, F12, R-035, F5 or reports.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | The posting function can be called directly. gems_app could post a reversal for an ACTIVE receipt. | Make the definer the trigger function itself, or revoke execute and check the status. Test it. |
| Z2 | Major | `receipt_post` sorts before `receipt_total_commit`, so a wrong total shows up as a balance error. | Rename the posting trigger so it sorts after the total check. |
| Z3 | Nit | `receipt_id` NOT NULL will not fit contra and opening entries. | Note it under Risks. |
| Z4 | Nit | `period` means financial year here, but monthly periods later. | Call it the FY. |
| Z5 | Nit | The composite FK needs a unique `(id, centre_id)` on `journal_entry`. | List it. |
| Z6 | Nit | Existing fee types have no account, so collection is refused until each is mapped. | Add a rollout line. |
| Z7 | Nit | The ETL reset of journals must also reset the chain once D-FIN-8 exists. | Note it. |
