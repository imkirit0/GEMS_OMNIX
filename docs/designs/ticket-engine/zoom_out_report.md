# EGM Stage 5: Initial Zoom Out Review

*   **Target:** `docs/designs/ticket-engine/ticket-engine.md` (lines 1–836, commit `177be24`)
*   **Reviewer:** `egm-zoom-out` (fresh context). Persona: `agents/zoom_out.md`. Standard: `zoom-out-standard.md`.
*   **Context supplied:** `input-brief.md`, `src/server/{action,db,numbering,rbac,admin-http}.ts`, `proxy.ts`, migrations 0002 and 0005, `tests/audit-catalogue.ts`. The reviewer also read `auth/policy.ts`, `exports.ts`, `page-read.ts`, `safe-route.ts`, migrations 0007 and 0008, `tests/sql/audit-fault.sql` and `README.md` (empty).
*   **Date:** 2026-10-27

**Verdict: changes requested.** 1 Blocker, 4 Major, 7 Nit.

**Checked by the author (Elephant) before filing:**
*   B1 holds. The prefix comes from `ticket_type`, the series is per centre, and `ticket.number` is unique. So the second centre's first ticket gets the same number and fails.
*   M1 holds. Migration 0002 line 130 grants `gems_app` only `select, update` on `number_series`.
*   M3's reuse target exists: `app.target_centre_ids` is in migration 0005, line 41.

The reviewer passed the context check. The objective, the motivation, the failure modes, the stage boundaries and the links to tests are all clear. It found the core architecture lean: one row lock plus a version check, levels copied at raise, existing platform pieces reused, and no new dependency.

## Blocker

### B1. Ticket numbers collide across centres

*   **Where:** Q2 (155–163), the `ticket` row (265, `number (unique)`), Numbering (415–424), plan item 10 (692–697).
*   **Problem:** The series is per centre (`centre_id, 'TKT', period`). The format `{prefix}/{typecode}/{seq}` has no centre in it, and the prefix comes from the type. So centres A and B both produce `TK-26/CMC/000001`, and the unique constraint rejects the second one. The design contradicts itself. Its own evidence (line 156) is that legacy uses one network-wide counter.
*   **Fix:** Decide now, before the build:
    *   (a) One network-wide series. This matches the legacy evidence. Extend `number_series` or add a small network-wide series table, and say how its RLS works.
    *   (b) Put the centre code into the format until NP-1 is signed.

    Either way, add a test that raises tickets at two centres.

## Major

### M1. Nothing creates the number-series rows

*   **Where:** Numbering (417–421). Grants: migration 0002, line 130.
*   **Problem:** `allocate()` throws when the row is missing. `gems_app` cannot insert one. Nothing seeds a row for each centre (or network-wide) and each period, or rolls it over at a new financial year. The first raise in a new centre or period fails in production. Tests pass only because fixtures seed the rows.
*   **Fix:** Say who creates the series rows and when. Options: the migration seeds the current period and a job or admin step adds later ones, or a narrow definer function upserts the row. A single network-wide series (B1 option a) cuts this to one row per period.

### M2. Storage is half of Stage 2, but nothing in Stage 2 uses it

This is a risk in owner decisions DD-4 and DD-6. The reviewer flags it but does not re-decide it.

*   **Where:** DD-4 and DD-6 (138–146), Alternative G (499–505), the upload and document tables, Raise steps 1, 2 and 4, the Storage section, and plan items 1, 2, 3, 9, 13, 15, 16, 22 (part), 23 and 24.
*   **Problem:** DD-2 means no ticket type goes live in Stage 2, so no document is ever uploaded in production during Stage 2. Alternative G was rejected because "no type that needs a document can go live". DD-2 already blocks every type, so that reason costs nothing here. Storage adds an ADR, a new decision, a CSP change, an outside service with secrets, a client component, two tests and a manual E2E step. None of it reduces the engine's core risks.
*   **Fix (owner's choice):** Keep `document_required` and a document-count check in the engine. Then either:
    *   (a) move storage into its own short design, landing with the first handler that needs documents, and refuse to activate a type with `document_required` until then; or
    *   (b) keep DD-4 and DD-6 and state that storage is in Stage 2 on purpose, ahead of need, and why (for example, to settle ADR-002 early).

### M3. The "who covers this centre" rule is written in three or four places

*   **Where:** Act step 2 (351–355, TypeScript), the approval queue (386–389, SQL), Forward and the two definer functions (369–376), and list/detail visibility (390–392).
*   **Problem:** The rule for whether an ALL, REGION, AREA or CENTRE assignment covers a centre already lives in SQL (`app.scoped_centre_ids`, `app.target_centre_ids`). The design copies it into TypeScript and into separate SQL for the queue, forwarding and visibility. These are security rules, and copies drift apart. If they drift, a ticket can show in your queue and then refuse your approval, or the reverse. G3, G4, T-TKT-009, 012 and 013 would break without any error.
*   **Fix:** One SQL predicate, for example `app.ticket_user_may_act(user_id, ticket_id)`, built on `target_centre_ids`. Use it in the act check, the queue, the forward check and the candidate list. Do the same with one visibility predicate for list, detail and download. Also limit `ticket_can_act` to centres the caller can already see, so it cannot be used to ask whether a user holds `ticket.approve` anywhere.

### M4. The screens do nothing in Stage 2 production, and the manual E2E check cannot run as written

*   **Where:** Overview (30–31), Screens (426–431), plan items 14–17, Verification E2E (832–834).
*   **Problem:**
    *   Line 30 says queues are Stage 5, but `/tickets/approvals` is built in Stage 2.
    *   With `HANDLERS` empty, no type can be activated, so the pages can never be used for real.
    *   The manual Supabase check needs an active type. The only handler exists in tests, and the design does not say how it gets registered for that check.
*   **Fix:** Either:
    *   (a) Stage 2 ships only the engine, the schema, `setup.ts` and the tests. Pages come with the first domain handler, and the manual check moves with them; or
    *   (b) keep the screens as the manual test harness, and say how the test handler is registered outside production (a dev-only flag that refuses `NODE_ENV=production`).

    Fix line 30 either way.

## Nit

*   **N1. The SHA-256 is not used by anything.** Computing it means downloading every file at raise (lines 144, 330–335). Drop it, or name the need. Use the bucket's own `file_size_limit` and `allowed_mime_types` as a first gate. At raise, read the real size from the object's metadata and fetch only the first few bytes (a Range read) to check the file signature.
*   **N2. `ticket_document` repeats columns from `ticket_upload`** (268–269). Keep it as a link (`ticket_id`, unique `upload_id`, `centre_id`, the checked type and size, `at`). Attached files also keep their `staging/` key forever. Rename the prefix to `uploads/`, or say this is deliberate.
*   **N3. How Act gets the centre is not described.** `scopedAction()` needs `centreId` before it authorizes. Say that a short read under RLS fetches it first: a hidden ticket gives 404, and `centre_id` cannot change.
*   **N4. The `apply_failed` trigger is too broad** (363–365, 656–658). "Anything other than Forbidden" also catches Conflict and StaleRequest. Limit it to errors from `handler.apply`, and consider an optional failure-audit hook in `scopedAction()` instead of separate code in the engine.
*   **N5. adminPost's "forbidden" message is about RBAC** (705–711). Make the shared text generic, or let routes pass their own messages. Add `conflict` to the ticket reasons.
*   **N6. D-TKT-5 repeats NP-1** (583–584). Reference NP-1 instead.
*   **N7. The handler has four methods.** Let the engine fall back to `validate` when `revalidate` is not given (294–300).

## Owner decisions: no further findings

*   **DD-1:** accepted as documented (known limit, with Alternative A as the upgrade). M3 reduces the drift risk of the checks that stay in TypeScript.
*   **DD-3 and DD-5:** consistent with the existing scope model.
*   **DD-2:** sound. It is the reason behind M2 and M4.

## Resolution (author, 2026-10-27)

The owner chose "update doc first". The author made the edits on the owner's instruction.

| Finding | Resolution |
|---|---|
| B1 | Owner: one network-wide counter (**DD-8**). New `ticket_number_series` table and `allocateTicketNumber()`; test for two centres |
| M1 | The counter row is created by an upsert on first use, so no seeding step is needed; test for the first raise in a new period |
| M2 | Owner: keep storage in Stage 2 on purpose. The reason is stated in DD-4 |
| M3 | Four shared SQL read functions (`ticket_may_act`, `ticket_may_receive`, `ticket_forward_candidates`, `ticket_may_view`) built on `target_centre_ids`/`scoped_centre_ids`, each limited to the caller's visible centres; test that the queue and the act check agree |
| M4 | Owner: the screens stay as the manual test harness (**DD-7**). `TICKET_TEST_HANDLER=1` is refused in production; the Overview contradiction is fixed; manual E2E steps spelled out |
| N1 | SHA-256 and full download dropped. Bucket `file_size_limit`/`allowed_mime_types`, plus a Range read of the first 16 bytes (fallback stated) |
| N2 | `ticket_document` reduced to a link; key prefix `uploads/` |
| N3 | Short read of the centre under RLS before `scopedAction()` |
| N4 | `apply_failed` only for errors from `handler.apply`, via a new optional `onFailure` hook in `scopedAction()` |
| N5 | Generic forbidden text; `conflict` message added |
| N6 | D-TKT-5 dropped; the choice is recorded against NP-1 |
| N7 | `revalidate` optional; defaults to `validate` |

## Re-audit (the single allowed re-audit, fresh reviewer, 2026-10-27)

**Verdict: changes requested (minor).** No blocker. B1, M1, M2, M4 and N1–N7 were verified as resolved. M3 was only partly resolved: the queue could still show tickets that the act check refuses. The reviewer recommended applying the remaining fixes directly, without a third review. EGM allows only one re-audit per stage, so the author applied them and recorded them here.

**Checked by the author:**
*   NN2 holds: `AuditOutcome` is `('OK', 'DENIED')` in migration 0001, line 14.
*   NN3 holds: T-RLS-002 checks the exact list of tables that have `centre_id`, and T-RLS-005 checks the exact list of definer functions, both in `tests/foundation.test.ts`.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| NM1 | Major | The queue checked only `ticket_may_act`, but Act also needs `ticket.approve` and the self-approval rule. So a level role holder without the permission, or the raiser, could see a ticket and then be refused. | `ticket_may_act` now includes the `ticket.approve` check. The queue leaves out tickets the user raised, and the detail page offers only actions the engine allows. The test now compares the queue with the result of `act()` for each fixture user, including those two cases. |
| NM2 | Major | The fake-storage guard was keyed on `NODE_ENV=production`, which CI's `next build` and `next start` also set. | Both the fake driver and `TICKET_TEST_HANDLER` now refuse to load on any Vercel deployment (`VERCEL_ENV` set). Test added. |
| NN1 | Nit | A yearly counter reset would repeat numbers, because the format has no period in it. | Stage 2 uses the single key `ALL`. If NP-3 chooses a reset, the period goes into the format in the same change. `numberPeriod` removed. |
| NN2 | Nit | No audit outcome was named for `apply_failed`. | A new `AuditOutcome` value, FAILED, in 0009. Used by the `onFailure` hook. |
| NN3 | Nit | `tests/foundation.test.ts` was missing from the plan, and the RLS policy wording contradicted the 0002 loop. | All four policies come from the 0002 loop, and the grants limit what the app can do. New item 20a updates T-RLS-002 and T-RLS-005. |
| NN4 | Nit | The components diagram was out of date. | It now shows `allocateTicketNumber()` and `ticket_number_series`. |
| NN5 | Nit | `ticket_may_act` took a user parameter it did not need, and "not the actor" was not inside `ticket_may_receive`. | `ticket_may_act(ticket)` uses `session_user_id()`. `ticket_may_receive` now excludes the caller. |
| M2 (leftover) | Nit | Alternative G still argued from the old reason. | It now points to DD-4's stated reason. |
