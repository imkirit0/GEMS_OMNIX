# Approvals workbench: EGM step 8 intermediate zoom-out report

Commit 0f01113 was reviewed on 2026-10-30.

**Verdict:** approve with changes; there are no blockers. All 30 findings from steps 5–7 are resolved in substance, and nothing was added beyond what they asked for. The facts were checked against the code and hold:
* `parseFilter` takes keys from an allowlist;
* `manageWhere` hard-codes its base set, so the refactor is needed;
* `decodeCursor` throws;
* `TicketReason` has five values;
* the audit outcomes;
* one request id per route (`safeRoute`);
* `failApply` raises `ApplyFailed`.

| ID | Severity | Finding | Recommendation | Applied |
|---|---|---|---|---|
| I1 | Major | The "invalid" bucket is unreachable with the current test handler. | Add a test-local handler that throws `invalid`. | Yes |
| I2 | Major | A ticket the user cannot view fails as `TicketNotFound` with no audit row; only a viewable ticket gives DENIED. | Use a viewable ticket the user may not act on (one they raised), and add a case for an unviewable one. | Yes |
| I3 | Major | Only the queue is timed, not the cards. | Time `Promise.all([queue, cards])`. | Yes |
| I4 | Nit | `total` needs no query of its own. | Derive it from `byType`. | Yes |
| I5 | Nit | `stale` and `inactive` leave no audit row either. | Say so. | Yes |
| I6 | Nit | `document` is not mapped. | Map it: it cannot occur, and is rethrown if it does. | Yes |
| I7 | Nit | Without a request context, `request_id` is null and the check passes vacuously. | Run the case inside `withRequestContext`. | Yes |
| I8 | Nit | A stray heading. | Delete it. | Yes |
| I9 | Nit | `adminPost` adds `detail` to `invalid` errors. | Say so. | Yes |
