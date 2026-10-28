# EGM Stage 8: Intermediate Zoom-Out report

- **Target:** `docs/designs/ticket-engine/ticket-engine.md`, full file (1,494 lines, commit `146cf95`)
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Prior reports read: `zoom_out_report.md`, `comprehension_report.md`, `critic_report.md`.
- **Date:** 2026-10-28
- **Verdict:** changes requested (minor). **0 Blocker, 3 Major, 5 Nit** (Z1 to Z8). No resolved Stage 5 item was reopened.

The core design is still lean and coherent: one row lock plus a version check, levels copied at raise, `scopedAction()`, one set of SQL eligibility functions, a one-table counter, and no new dependency. Most of the Stage 6 and 7 additions were judged proportionate. The findings below are where those fixes added machinery Stage 2 does not need, or contradicted each other.

## Major

**Z1. The upload route is live in production in Stage 2, which undercuts DD-4. The DD-16 cap only exists to limit that path.**
- **Problem:**
  - `requestUpload` checks only `ticket.raise` for the centre, and the pages and routes are always deployed. So in Stage 2 production, any `ticket.raise` holder can put files in the bucket that nothing ever attaches or deletes.
  - The cap also invents its own counting, where `app.recent_export_count` and `RateLimited` (`src/server/exports.ts`) already do this job.
- **Suggested fix:**
  - `requestUpload` takes `typeId` and refuses with `inactive` unless the type is active and `document_required`. With no live type in Stage 2, every upload is refused, so DD-4 holds.
  - Move the per-user cap into the DD-16 go-live gate, and drop `maxPendingUploads`, its test and its Errors-table entry from Stage 2.
  - If the cap is kept, reuse the `recent_export_count`/`RateLimited` (429) pattern.

**Z2. The raise order contradicts the guard trigger.**
- **Problem:**
  - Raise step 3 allocates the number after inserting the ticket. But `number` is unique and cannot change, and the insert must have `version` 1, so the number has to exist at insert time.
  - The ordering only shortens the counter lock, which is premature at about 16,500 tickets over the system's life.
- **Suggested fix:** allocate the number just before the ticket insert. Delete the "allocates last" sentences in Raise step 3, Numbering and Alternative K.

**Z3. `app.ticket_stranded` is a fifth definer function that Stage 2 does not need.**
- **Problem:**
  - Reassign itself (DD-13) is small and worth keeping. The notice is not: it needs a set query over every user's assignments, adds new security surface and adds a T-RLS-005 entry.
  - Its only use is a hint on the detail page, and no live ticket can be stranded in Stage 2.
- **Suggested fix:**
  - Drop `ticket_stranded`. Show the reassign form on every OPEN ticket to `ticket.type.manage` holders.
  - Test that reassign rescues a ticket whose named approver is disabled.
  - Put a stranded-tickets list in Future Improvements, with Stage 5 SLA escalation.

## Nit

- **Z4.** `ticket_may_act` has three different signatures. Use one everywhere. Simpler still: hard-code both policy flags inside the SQL function, since they are code constants anyway, at the cost of needing a migration to turn one off.
- **Z5.** `toFields` and the re-raise pre-fill are UI convenience ahead of need. Defer them to the first domain module; in Stage 2 a re-raise opens a blank form with type and centre fixed. *Changes part of DD-9, so this is the owner's choice.*
- **Z6.** `test_ticket_counter` has a `centre_id`, which forces RLS policies and a by-name exclusion in T-RLS-002. Key it on `key` alone.
- **Z7.** The file limits appear in four places, and the Supabase endpoint shapes in two. Make `TICKET_POLICY` the one source, have the others point to it, and keep the endpoint shapes only in Storage.
- **Z8.** Some Technical Plan text is at implementation level: the cursor encoding, headers, magic bytes and form plumbing. No change for Stage 2; these are the first parts to move if the plan is trimmed later.

## Checked and not raised

Re-raise, idempotent raise, distinct approvers, `for share`, the `onFailure` hook, the DD-15 service-key check, the generic `fields` form and reassign itself. None of these is over-built for G1–G10.

## Elephant assessment

All eight findings hold on inspection:
- **Z2** is a real internal contradiction that I introduced while applying D12. The critic proposed allocating before the insert, and I wrote "last".
- **Z1** and **Z3** reduce scope.
- **Z1, Z3 and Z5** each narrow a rule the owner accepted (DD-16, DD-13, DD-9), so they need the owner's agreement.

## Resolution

**Status: resolved (2026-10-28).** The owner chose "Apply all, then Stage 9". All eight were applied:

| Finding | Resolution |
|---|---|
| Z1 | `requestUpload` takes `typeId` and refuses with `inactive` unless the type is active and `document_required`, so every upload is refused in Stage 2. `maxPendingUploads` and its test were removed. The per-user limit joins the deletion job as a go-live gate, reusing `recent_export_count`/`RateLimited`. **DD-16 narrowed.** |
| Z2 | The number is allocated before the ticket insert; the "allocates last" sentences were removed. |
| Z3 | `ticket_stranded` was dropped. The reassign form is offered on every OPEN ticket to `ticket.type.manage` holders, and a stranded-ticket list is now a Stage 5 Future Improvement. **DD-13 narrowed.** |
| Z4 | `ticket_may_act(ticket)` takes one argument, with self-approval and distinct approvers built into the SQL. `blockSelfApproval`/`distinctApprovers` were removed from `TICKET_POLICY`. Turning either rule off now needs a migration (Q4 updated). |
| Z5 | The re-raise form opens blank with type and centre fixed; pre-fill waits for the first domain module. `toFields` was removed. **DD-9 narrowed.** |
| Z6 | `test_ticket_counter` is keyed on `key` only, with no RLS and no T-RLS-002 special case. |
| Z7 | `TICKET_POLICY` is the one source for the limits. Storage and `storage-setup.mjs` point to it, and item 9 points to the Storage call list. |
| Z8 | No change, as the reviewer advised. |
