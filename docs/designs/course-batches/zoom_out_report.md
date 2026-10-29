# Course batches: EGM step 5 zoom-out report

Reviewed: commit f91bd21, 2026-10-30, in parallel with steps 6 and 7. Verdict: **approve with changes**. There are no blockers, 7 major findings and 5 nits. How each one was resolved is recorded in the design revision commit.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | The deferred constraint trigger raises at COMMIT, after the callback has finished, so the user gets a 500 instead of a field error. It also does not stop two direct writers racing. Its branch on batch updates repeats a check the app already makes. | Use one immediate trigger that locks the batch row itself. Drop the batch-update branch. |
| Z2 | Major | The restrictive policy departs from the 0020 pattern, blocks every future update, and leaves inserts with a `batch_id` open. | Use a 0020-style `registration_batch_guard`, BEFORE INSERT OR UPDATE, for gems_app. |
| Z3 | Major | The read gates disagree. The batches page accepts view or manage; the place page accepts view only. | Use one gate, `student.view`, and give role 26 that permission. Use the initplan policy shape. |
| Z4 | Major | `createBatch` cannot pass a target id to its audit row. | Take `nextval` in a pre-flight step. |
| Z5 | Major | The fixture `tok-uA` has no `student.view`. | Use `tok-stuA` as the viewer. |
| Z6 | Major | Without `adminWrite` there is no error mapping, so 23505, 23514 and 42501 would surface raw. | Add one `batchDb` handler. |
| Z7 | Major | The design does not say what happens at an inactive centre. | Refuse writes there, matching the trading gate, or record that they are allowed. |
| Z8 | Nit | Keep the composite FK and the index. | Keep both. |
| Z9 | Nit | Keep the two pages. | Keep both. |
| Z10 | Nit | "The 0002 loop shape" misdescribes the policies, and the delete policy exists only for T-RLS-002. | Describe them accurately. |
| Z11 | Nit | The 1-100 name rule is new, not reused. | Say so (PMC). |
| Z12 | Nit | The exact audit JSON is premature for the design. | Keep it light. |
