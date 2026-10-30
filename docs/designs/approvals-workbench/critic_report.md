# Approvals workbench: EGM step 7 design critic report

Reviewed commit a84c2f8 on 2026-10-30, in parallel with steps 5 and 6.

**Verdict: approve with changes.** There are no blockers. The design-revision commit records how each finding is resolved.

**The SQL is equivalent to `ticket_may_act`.** Checked:
* the permission check, since `centre_id` is never null;
* the role branch;
* a null session;
* the assigned-user logic;
* the join to the current level;
* the order and cursor.

**What else holds:**
* The route needs no step-up: `act()` uses `scopedAction`.
* A version supplied by the client is only a staleness token. It cannot widen access.
* Resubmitting the same tickets is safe: they come back as conflicts.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Major | Repeated `ticketId` fields collapse in the fields map. | Read them with `getAll`. Add a route test posting 3 ids. |
| D2 | Major | "Cheap per ticket" and the cap of 50 were never measured. Each `act()` makes 2–3 transactions. | Measure 50 tickets against a budget; set the cap from the result. |
| D3 | Major | A batch that stops partway loses its counts, and a resubmit then shows "conflict". | Rethrow anything unclassified. Document that resubmitting is safe, and test it. |
| D4 | Nit | `ScopeError` can happen in `act()`. | Correct the text. |
| D5 | Major | Conflicts and invalid tickets leave no audit row, so the counts are their only trace. | State this. Test the audit outcomes; use the shared `request_id` as the batch link. |
| D6 | Minor | `Number("")` is 0, so an empty version reads as a valid one. | Require `^\d{1,9}$`, otherwise the whole batch is invalid. |
| D7 | Minor | T-AW-001 misses branches: assigned to someone else, a role approver's permission from another role or centre, tickets that are not OPEN. | Add these. Compare without `distinct`. |
| D8 | Minor | The filter selects trap the user once a filter is set. | Count each select without its own filter. Next-page links must carry the filters. |
| D9 | Nit | The counts shown come from the URL. | Accept: they are display only. |
