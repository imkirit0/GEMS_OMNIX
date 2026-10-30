# Approvals workbench: EGM step 5 zoom-out report

**Reviewed:** commit a84c2f8, 2026-10-30, in parallel with steps 6 and 7.

**Verdict:** approve with changes; no blockers. The design-revision commit records how each finding is resolved.

**Answers to the four review questions:**
* Keep `bulkAct` in the engine: the error classes are the engine's own, and the function can be tested without HTTP.
* `queueCards` is distinct from `ticketSummary`.
* `parseFilter` can be reused if the page restricts the keys it passes.
* The actable set is the minimal fix.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| Z1 | Major | `manageWhere` hard-codes `VISIBLE`, so AND-ing in the actable set would compute both sets. | Change it to `manageWhere(p, base = VISIBLE)` and pass `ACTABLE`. |
| Z2 | Major | The rows carry no `version`, but the hidden field needs one. | Add the version to `approvalQueue`'s select. |
| Z3 | Major | Centre options come from one page of rows. | Build them from the actable set (`queueCards` by centre). |
| Z4 | Nit | Raw GET values would carry extra keys such as `status`, `number` and `priority`. | The page picks only type, centre, from, to and cursor. |
| Z5 | Nit | The cursor guard would be copied. | Use one helper. |
| Z6 | Nit | The visible-centre check is redundant beside the approve scope. | Keep it, to mirror `ticket_may_act`. |
| Z7 | Nit | Item validation repeats what `act()` already checks. | Check up front only the cap, the action and the remarks; per-item errors go into the counts. |
| Z8 | Nit | The rethrown errors are listed one by one. | Rethrow anything that is not a counted class. |
| Z9 | Nit | `ticketId` paired with `v:<id>` posts every row's version. | Use a checkbox value `<id>:<version>`, read with `getAll("item")`. |
