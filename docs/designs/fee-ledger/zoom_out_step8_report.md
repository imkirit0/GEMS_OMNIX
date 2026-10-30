# Fee ledger: EGM step 8 intermediate zoom-out report

**Reviewed:** commit f92640b, 2026-10-30.

**Verdict:** pass with changes. Every finding is resolved except C10. Keep the journal currency and the reversal that copies lines.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z8-1 | Major | The early account check in `collectFee` repeats the commit-time guard and the oldest-first window. | Delete it, and rely on `journal_account_guard`, mapped at commit. |
| Z8-2 | Nit | About 9 seed rows can never post in F1. | Seed only the INCOME and LIABILITY heads plus the 5 system accounts. |
| Z8-3 | Major | C10 is unresolved. Option A cannot work, and option B tests a different guard. | Keep the balance check as defence in depth. The proof is T-FL-001's "every entry balances" query. |
| Z8-4 | Nit | `fy` is not needed. | Drop it, or make it a generated column. |
| Z8-5 | Nit | The no-existing-entry check and the re-assert after the copy duplicate other checks. | Rely on the unique key. Drop the re-assert. |
| Z8-6 | Nit | The guard messages must carry `constraint "<name>"`. | State this. |
