# Fee structure: EGM step 7 design critic report

Commit bf9fa16 was reviewed on 2026-10-30, in parallel with steps 5 and 6.

**Verdict: revise; not ready to build.** There are 2 blockers, 7 major findings and 5 nits. How each one was resolved is recorded in the commit that revised the design.

**What F2, F3 and F5 need from this model:**
* one fixed meaning for an amount (GST inclusive or exclusive);
* an effective-dated rate and SAC code, or copies taken at receipt;
* a currency;
* due dates that do not change after publishing;
* stable plan ids.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Blocker | A line insert can race a publish. The guard reads the plan status without a lock, so a line can land on a PUBLISHED plan. | The guard locks the plan `for share` and re-reads it after the wait. No `plan_id` update. Add a two-session test. |
| D2 | Blocker | A plan's meaning can change after publishing: `gst_inclusive`, the rate, the SAC code and caption due dates stay mutable. | Fix the inclusive rule per plan or line. Freeze `due_on` once a published line references it. F2 copies the values. |
| D3 | Major | The GST rate has no history (D-FIN-2: tax is computed at receipt). The slab list is outdated, and `numeric(5,2)` contradicts the `numeric(7,4)` in 07 §4. | Use an effective-dated rate, or F3 copies the rate and SAC onto each allocation. Keep the rate list as a PMC lookup, not a CHECK. |
| D4 | Major | Nothing carries a currency (D-CUR-1). | `currency` on the plan. Resolve only when the currency matches. F3 applies GST only for `gst_enabled` centres. |
| D5 | Major | The version unique key over nullable columns never blocks duplicates. | Partial unique indexes and `num_nonnulls(...) = 1`. |
| D6 | Major | Publish has no single home: is it a SQL definer function or TypeScript? | Choose one and keep the guards role-agnostic. |
| D7 | Major | The publish lock order does not serialise a first publish, an out-of-order v2/v3, or `max + 1`. | Advisory lock per key in both create and publish. Refuse an older version. Map 23505. |
| D8 | Major | Cascade delete versus the line guard. | No cascade: delete the lines explicitly, then the plan. |
| D9 | Major | The select policy is not centre-scoped, so overrides are visible network-wide. | Scope the policy, or record cross-centre visibility as a decision. |
| D10 | Nit | Missing keys: `unique (id, academic_year)` and the `fee_type` FK. | Add them, plus `published_*` not null when PUBLISHED. |
| D11 | Nit | SAC/HSN meaning: the 4–8 digit check accepts goods and services alike. | Name the column `hsn_sac`, or check the service form `^99[0-9]{4}$`. |
| D12 | Nit | No check that the course is offered for the plan; 0016 uses `course_id`. | Validate the offering and use `course_id`. |
| D13 | Nit | Owner and ETL limits are not stated. | No grants for `gems_etl`. Accept that the owner can `DISABLE TRIGGER`. |
| D14 | Nit | Resolution semantics are not stated. | An override replaces the whole plan. Existing dues are not repriced. |
