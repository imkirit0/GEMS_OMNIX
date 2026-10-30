# Schemes and concessions: EGM step 5 zoom-out report

**Reviewed:** commit 6713404, 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** revise before approval. The scope is right as one piece (build it in slices S1 and S2). Little is over-built. Reports are not blocked.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Blocker | AMOUNT "per due" multiplies across instalments: a 1,000 rule on four instalments gives 4,000. | Decide in DD-2. Either a total per fee type, spread oldest first and capped, or per due on purpose. Add a test with several instalments. |
| Z2 | Major | The uniqueness and immutability shape leaves the D-SCH-2/D-FEE-2 ticket and WF7 at a dead end. | Record the reversal shape now: an append-only reversal row; "one unreversed assignment" enforced by guard and lock; concessions unique on `(assignment_id, due_id)`. |
| Z3 | Major | The legacy import of 242 schemes and the concession applications cannot pass the guards (expired schemes, no approver, amounts other than computed). | Name the import path (`source = 'IMPORT'`) and the mapping now. |
| Z4 | Major | Maker-checker is not proven by the database: any `scheme.manage` holder could go LIVE by SQL. | The guard requires `scheme.approve` for LIVE and RETIRED. |
| Z5 | Nit | Legacy rules are keyed by centre and AY. | Check before freezing the key. The import splits schemes if needed. |
| Z6 | Nit | A drafting fragment remains in the fixtures line. | Use `…0100`. |
