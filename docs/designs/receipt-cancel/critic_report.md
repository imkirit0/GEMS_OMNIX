# Receipt cancellation: EGM step 7 design critic report

**Reviewed:** commit 6a6de00 on 2026-10-30, in parallel with steps 5 and 6.

**Verdict:** revise. Five findings are Major. The parts that hold:
* Collection waiting on the lock re-reads after commit (READ COMMITTED).
* Cancel and collect cannot deadlock.
* Two concurrent cancels fail cleanly.
* The lock keys match.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Major | A replay of a cancelled receipt's key is reported as a successful payment. `collectFee` does not read `status`. | Refuse with `fee.receipt.cancelled` and start a new collection with a fresh key. Test this. |
| D2 | Major | Only the app checks step-up. Raw SQL can cancel without it. | Make the guard require `session_step_up_fresh` whenever a session exists. Map the refusal to `StepUpRequired`. |
| D3 | Major | An update that affects 0 rows (RLS) is audited as OK. | Require exactly 1 row affected. |
| D4 | Major | The `to_jsonb` freeze locks out future columns. Nothing records which cancellations still need a journal. The later-day path crosses GST periods. | Record that F1 and the ticket piece will replace the guard. Record what F1 needs: `cancelled_at`, the IST date, a reversal per line with GST. The later-day path needs credit-note handling. |
| D5 | Major | "Today" is computed in two places, so it can disagree near midnight. | Compute it in SQL everywhere. |
| D6 | Nit | A resubmitted cancel shows an error even though it took effect. | Treat "already cancelled" as success on the route, and show the banner. |
| D7 | Nit | One guard name covers both a wrong status and a frozen column. | Split them: status and frozen. |
| D8 | Nit | `before` is hard-coded. The audit omits the registration and the lines. Late attempts are not audited. | Read `before`. Add `registrationId` and the lines. Use `onFailure` for late attempts. |
| D9 | Nit | A same-day bounce is rare, and a dishonour may need its own reason. | Note that bounces go mainly to the ticket piece. Consider a reason kind. |
| D10 | Nit | Cancellation is not tied to the collection gate. | Gate it on the same flag. |
