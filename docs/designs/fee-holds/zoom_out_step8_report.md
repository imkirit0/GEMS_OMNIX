# Fee holds: EGM step 8 intermediate zoom-out report

**Reviewed:** commit c70ace7, 2026-10-30.

**Verdict:** approve with small changes. Z1/D2 and C5 are only partly resolved. Four parts are kept as justified: setting the id under the lock, the view columns, the `held` refusal, and the paid-due rule.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z8-1 | Major | Both guards still work out "held" for themselves, so it is defined in three places. | Both guards read `fee_due_balance`. |
| Z8-2 | Nit | The view repeats the `held` subquery and the `owed` expression. | Use a lateral join or a subquery so each is written once. |
| Z8-3 | Nit | The `held`/`over` rule is more complex than needed. | Use one rule: when the amount is above the collectable total, refuse with `held` if any owed due is held, otherwise `over`. |
| Z8-4 | Nit | The app takes a lock that exists only for the audit read. | Drop it. Read `owed` after the insert. |
| Z8-5 | Nit | The history errors have no keys. | Name them, and state how the page shows them. |
