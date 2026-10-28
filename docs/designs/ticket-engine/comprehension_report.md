# EGM Stage 6: Comprehension Test report

- **Target:** `docs/designs/ticket-engine/ticket-engine.md` (969 lines)
- **Ranges:** FeatureRange 1..634, DetailedRange 635..969 (split at `## Detailed Implementation Plan`)
- **Reviewer:** `egm-comprehension` (Goldfish, fresh context), standard `re-implementation-standard.md`
- **Date:** 2026-10-28
- **Result:** 0 Blocker, 15 Major, 8 Nit (C1 to C23)

The reviewer found the core flow buildable: raise, act, the guard trigger, the numbering upsert and the eligibility functions. The findings below are places where an implementer would have to guess. They do not stop the work. Line numbers refer to the document as reviewed (commit `f0e6093`).

## Blockers

None.

## Major

**C1. `ticket_may_act` signature conflict.** Line 412 (Reads) against the Eligibility table (line 432) and Act step 2 (line 375).
- The queue calls `app.ticket_may_act(id, actor)` with two arguments.
- The table and Act step 2 say it takes only the ticket and has "no user parameter".
- The T-RLS-005 inventory (item 20a) depends on which one is right.

**C2. Audit action selection and fields.** Act steps 4-5 (lines 385-395), item 7 (lines 755-758).
- `scopedAction()` fixes `meta.action` before the transaction starts.
- Whether an approval is final is known only after the row is locked.
- The document does not say how `ticket.approve` and `ticket.approve.final` are chosen: a second read, an `auditDetail` override, or a change to `ActionMeta`.
- The audit action names, `targetType` and `targetId` for Re-raise, Reject and Forward are not stated.
- `before`/`after` for actions other than the final approval are not stated.

**C3. Error model incomplete.** Lines 315, 328, item 6 (719-720), item 12 (817-819), item 16 (852-856), G3 (80).
- `InvalidRequest`/`StaleRequest` (contract) against `TicketError` reasons (item 6): separate classes, or the same thing?
- No mapping from failures to reasons for these cases: `ticket_may_act` false, self-approval, a refused forward target, an inactive type, another user's upload, and blank reject remarks.
- The relation of `notallowed` to the existing `Forbidden`/DENIED audit is not stated.
- The response for an in-scope ticket the user may not act on is not stated. G3 covers only out-of-scope tickets (404).
- The status and body of a JSON upload route error are not stated.

**C4. Re-raise rules missing.** Lines 339-343, 406-407, item 7, item 14.
- Who may re-raise.
- Whether the type and centre must match the rejected ticket.
- Whether the payload and documents are copied.
- Which centre `scopedAction()` authorises against.

**C5. Handler-to-form mapping missing.** Item 14 (line 835), contract (313-319), item 6a (730-732), item 18.
- How a generic page renders payload fields, and how form fields become the payload.
- The `test.counter` payload: how a test tells it to fail in `apply` or `revalidate`, and which counter `key` it uses.
- The hidden field names for upload ids and `seenVersion`.
- The fields of `TicketRow<P>`.

**C6. Numbering parameters and storage.** Line 743, lines 488-492, item 10, DD-8 example (169).
- `numberPad` and `maxLength` have no values.
- Whether `ticket.number` stores the formatted text or the integer, and its column type.
- The `TK-26/CMC/23642` example appears to put a year in the prefix. That conflicts with "no period in the format" (line 482).

**C7. "Levels have no gaps" is not enforceable as a row CHECK.** Line 280 against item 4 (682-684).
- The document does not say where this is enforced: `setTypeLevels`, a trigger, or at activation.

**C8. Setup module lacks type updates.** Item 8 (763-771) against item 17 (861-863).
- The screen edits priority, `document_required`, `handler_key` and the category, but no update function or audit action exists for them.
- Whether levels, viewers or the handler can change while the type is active.

**C9. Viewer rule vague.** Lines 281, 435.
- Whether a role-based viewer needs the role over the ticket's centre (DD-5) or anywhere.
- Whether a past forwardee counts as "was named". If so, this needs `ticket_event.to_user_id`.

**C10. DD-5 cannot reuse `app.scoped_centre_ids` as written.** Lines 150-154, 423-428.
- That function filters by permission, for the session's user only (migration 0002).
- The new SQL must evaluate other users and role holdings. The helper or join it needs is not specified.

**C11. "Stage 5" is ambiguous and the finding IDs are unlinked.** Lines 146, 163, 168, 477, 887.
- "Stage 5" means both the roadmap stage and the EGM review stage.
- The finding IDs M1, M2, M4 and B1 point to `zoom_out_report.md`, which the document never links.

**C12. Storage set-up and protocol unstated.** Lines 447-453, items 9 and 24, lines 964-967.
- Who creates the bucket, and which size and MIME limits it gets.
- The Supabase sign endpoints: auth headers, response shape, and the `expiresIn` body.
- Line 453 says the bucket path is hidden from the browser, but a signed URL contains it.

**C13. Test-harness gating vague.** DD-7 (162-167), Screens (499-501).
- Whether the pages return 404 when `TICKET_TEST_HANDLER` is off, or merely have no handlers.
- Whether `/admin/ticket-types` is always available.

**C14. Deactivated type with OPEN tickets.** Rollout (607-610).
- Whether those tickets can still be approved, rejected or forwarded.
- Whether the final approval checks `active` or only the handler.

**C15. `onFailure` hook semantics.** Item 11a (808-812), Act step 5.
- Whether a DENIED row and a FAILED row can both be written.
- Whether the hook sees P2034 after the retries run out.
- How a `handler.apply` error is told apart from other errors.
- The contents of the FAILED row.

## Nit

- **C16.** Acronyms and IDs are not expanded: SPEC, WF6, SLA, RBAC, RLS, ADR, KPI, POC, NP-x (NP-1 is never described), D-TKT-x, D-COMM-1, D-SEC-4, D-MIG, D-STO-1, FR-094.xx, FR-223, T-SEC-017, T-RLS-002/005, P2/P3/P5. The audit files are cited as "audit 04/09/10/11" with no path. Add a glossary or path links.
- **C17.** The "⛔" in Q4 (line 180) is not explained.
- **C18.** Project terms have no file pointers: drift gate, unsafe-SQL ban, catalogue gate, 404-parity, real-server smoke, step-up/`requireFreshStepUp`, audit redaction, the "loop pattern from 0002", `pageRead()`, `safeRoute`, `Tx`, `withScope`, P2034 and the 5 s timeout (`src/server/db.ts`).
- **C19.** The data model is missing column types, foreign keys and on-delete behaviour, and the initial `version`. It does not say whether `closed_at` is set on REJECTED, or what `ticket_event` holds per action.
- **C20.** Upload checks: the magic bytes are not listed. `content_type` presumably comes from the detected signature, but this is not stated. There is no column for the declared type and no maximum file count.
- **C21.** The `listTickets`/`approvalQueue` filter shape, sort order and pagination are not specified.
- **C22.** The document uses both "employee" and "user". State that both mean `app_user`.
- **C23.** Item 24 edits `.env.local`. Say that this is a local-only step for each developer.

## Resolution

Owner chose "update doc first" and asked Claude to make the edits and propose the decisions (2026-10-28). All 23 findings were addressed in `ticket-engine.md`:

| Finding | Resolution |
|---|---|
| C1 | Queue calls `app.ticket_may_act(id)`, one argument, session user |
| C2 | One audit action `ticket.approve` with `final`/`level` in detail (`ticket.approve.final` dropped); targetType/targetId and before/after table per action; raise id generated up front |
| C3 | Errors table: each failure → `Forbidden` / `TicketError` reason / `ApplyFailed`, form and upload responses, audit row; `notallowed` dropped, `inactive` added; `InvalidRequest`/`StaleRequest` replaced by `TicketError` |
| C4 | **DD-9 (proposed):** re-raise by raiser only, once, same type and centre, payload pre-filled, documents re-attached |
| C5 | Handler `fields`, `p.<name>` inputs, payload as `Record<string,string>`; `TicketRow<P>` fields; `test.counter` payload; form field names |
| C6 | **DD-10 (proposed):** `number` text, pad 0, max 30, prefix fixed text; `TK-26` meaning left unknown |
| C7 | "No gaps" enforced by `setTypeLevels` and at activation, not a row check |
| C8 | **DD-11 (proposed):** `updateType` + `ticket.type.update`; `handler_key` only while inactive |
| C9 | `ticket_may_view` spelled out, including past forward targets and role-over-centre viewers |
| C10 | New internal helper `app.user_centre_ids(user, permission, role)` |
| C11 | "Stage N" = roadmap stage; review called zoom-out review with link to `zoom_out_report.md` |
| C12 | Supabase headers and three call shapes; `scripts/storage-setup.mjs` (item 9a) with limits; signed URLs contain bucket/key, accepted |
| C13 | Pages always deployed; no type activatable without a handler |
| C14 | **DD-12 (proposed):** deactivation blocks raise and final approval; reject/forward/non-final approve continue |
| C15 | `ApplyFailed` wrapper; precedence (Forbidden → DENIED, no hook); hook after retries; FAILED row `{level, error: cause.name}` |
| C16–C18 | "Terms and references" table with meanings and file paths; ⛔ prod-gate explained |
| C19 | Column types, FKs `on delete restrict`, `version` starts at 1, `closed_at` on both closes, `ticket_event` contents |
| C20 | Magic bytes listed; `content_type` from detected signature; `maxFilesPerTicket: 5` (PMC) |
| C21 | Filters, sort order, 50 per page keyset |
| C22 | employee = user = `app.app_user` |
| C23 | `.env.local` is git-ignored, local step |

Also found while fixing: the design called the yearly reset "NP-3", but in `docs/audit/revisions/v1.1-corrections.md` §C-02.1 reset is **NP-2** and NP-3 is the gap rule. Corrected throughout.

DD-9…DD-12 approved by the owner in session on 2026-10-28. Stage 6 re-audit follows.
