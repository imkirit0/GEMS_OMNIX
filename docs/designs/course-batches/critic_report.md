# Course batches: EGM step 7 design critic report

Commit f91bd21 was reviewed on 2026-10-30, alongside steps 5 and 6.

**Verdict: revise before implementation.** The review found 1 blocker, 5 major issues and 6 nits. The design-revision commit records how each was resolved.

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| D1 | Blocker | The deferred capacity trigger is not safe under concurrency. Under READ COMMITTED, two direct writers that skip the app's lock can both pass and overfill the batch. | Lock the batch row inside the trigger (`for no key update`) before counting. |
| D2 | Major | The trigger ignores a status change back to ACTIVE, and a `centre_id` change. | Fire on `update of batch_id, status, centre_id`. Add a `when` clause so that admit inserts cost nothing. |
| D3 | Major | "Active batch only" and "ACTIVE registrations only" are enforced in the app alone, which contradicts "no SQL bypass". | The trigger refuses both, with a named 23514. |
| D4 | Major | A restrictive policy on `registration` blocks every future update, including updates by the owner under FORCE. | Use a guard trigger like 0020's `centre_write_guard`, applied to `gems_app` only. |
| D5 | Major | A batch locked `for update` conflicts with the FK key-share lock. | Use `for no key update`. Lock the batch first, then the registrations by id. |
| D6 | Major | Read permissions are inconsistent: a manager without `student.view` can place learners but cannot list them. | Choose one rule and align G3, the pages and the tests. |
| D7 | Nit | A cascade of `centre_id` from the admission fails while a batch is set. | Document it as a risk. `no action` is enough. |
| D8 | Nit | Deferral moves the error to COMMIT, and the trigger counts once per row. | Use an immediate, statement-level trigger with a transition table. |
| D9 | Nit | An invoker-rights count is filtered by the caller's RLS. | State this, or use a definer with a fixed `search_path`. |
| D10 | Nit | The removal audit has no target. | Use the centre or the old batch as the target. |
| D11 | Nit | 404 parity for the place page's parameters is undefined. | Every unknown or out-of-scope parameter gives a 404. |
| D12 | Nit | The future legacy import may hold over-capacity batches. | Add to Risks. |
