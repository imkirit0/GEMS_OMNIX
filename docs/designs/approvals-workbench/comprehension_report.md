# Approvals workbench: EGM step 6 comprehension report

Reviewed: commit a84c2f8 (2026-10-30), in parallel with steps 5 and 7.

**Verdict: needs revision.** The review found 2 blockers, 9 majors and 3 nits. The design revision records how each one is resolved.

The 0024 SQL matches `ticket_may_act`:
* `scoped_centre_ids('ticket.approve')` is the check that `has_permission` makes.
* `rc` gives the same result as calling `user_centre_ids` once per level.

| ID | Severity | Finding | Proposed resolution |
|---|---|---|---|
| C1 | Blocker | `adminPost` builds its fields with `Object.fromEntries`, so only the last repeated `ticketId` survives. | Read the ids with `data.getAll`. |
| C2 | Blocker | `Number("")` is 0, so a missing version passes as a valid integer and is counted as a conflict. | Validate the raw string with `^\d{1,9}$`; a bad version fails the whole batch as invalid. |
| C3 | Major | The rule "other TicketError → invalid" also catches `stale` and `inactive`. | Map all five reasons to buckets explicitly. |
| C4 | Major | There is no default rule. `ScopeError` can occur (`locate` → `withScope`), contrary to the design. A mid-batch rethrow leaves the earlier approvals committed. | Anything unclassified is rethrown; state what a resubmit then does. |
| C5 | Major | `parseFilter` and `manageWhere` are not exported. `parseFilter` accepts more keys, and `manageWhere` hard-codes the visible set. | Specify the refactor and the allowed keys. |
| C6 | Major | The centres come from one filtered page of rows. | Add `byCentre` from the actable set. |
| C7 | Major | A card's type filter hides the other cards, and the source of Total is not stated. | Decide both. |
| C8 | Major | G4's "404 for bad input" contradicts the empty results and error redirects. | Fix G4. |
| C9 | Major | The redirects drop the filters, and the back path has no counts. | Carry the filters through. |
| C10 | Nit | The error classes are in `errors.ts`. | Cite `errors.ts`. |
| C11 | Nit | The tests do not cover the invalid, failed and rethrow branches, or the audit outcomes. | Add one case for each. |
| C12 | Nit | The page's `searchParams` types are not stated. | State them. |
