# EGM Stage 7: Critic Review report (with resolution proposals)

- **Target:** `docs/designs/ticket-engine/ticket-engine.md`, FeatureRange lines 1..850 (as of commit `a208a6b`)
- **Reviewers (fresh context, in parallel):**
  - `egm-design`, using `feature-spec-standard.md`: 1 Blocker, 6 Major, 5 Nit
  - `egm-structural`, using `feature-spec-standard.md`: 0 Blocker, 6 Major, 13 Nit
  - `egm-style`: 0 Blocker, 8 Major, 9 Nit
- **Total:** 48 findings, **1 Blocker**, 20 Major, 27 Nit.
- **Date:** 2026-10-28.

This file also serves as the `egm-resolve` goldfish review report. Each finding has a suggestion:

- **FIX:** the critique is valid, and the proposed edit follows.
- **FIX + OWNER:** valid, but the fix is a new rule that needs the owner's approval.
- **DECLINE:** a Nit that is recorded but not fixed, with a reason.

No finding was contested. Every one was checked against the document or the code, and each held.

## Needs the owner's decision (proposed rules)

| ID | Sev | Finding | Proposed rule |
|---|---|---|---|
| D1 | **Blocker** | A ticket becomes stuck for ever when its named approver or forward target leaves or loses `ticket.approve`. `ticket_may_act` is then false for everyone, and copying the levels at raise means editing the type does not help. | **DD-13: admin reassign.** A holder of `ticket.type.manage` (with step-up) may reassign an OPEN ticket's current level to a user who passes `ticket_may_receive`. It writes a FORWARD event with `detail {admin: true}` and the audit action `ticket.reassign`. The detail page shows "No one can act on this ticket" to admins when that is true. A test covers a stranded named approver. Add "approver no longer eligible" to Risks. |
| D4 | Major | One user can approve several levels, either by holding the roles for both or by forwarding to the next-level approver. This makes a multi-level chain meaningless. | **DD-14: distinct approvers** (PMC under D-TKT-4). `TICKET_POLICY.distinctApprovers = true`: `ticket_may_act` is false for anyone who has an APPROVE event on the ticket. Add an Open Question for the Operations sign-off. |
| D6 | Major | `SUPABASE_SERVICE_KEY` (service_role) in the server runtime bypasses RLS through Supabase's Data API. A server compromise would get more than `gems_app` allows. | **DD-15: accept the key, with limits.** Keep the service key, but ADR-002 must record a check (run manually, recorded as evidence) that the Data API does not expose schema `app`. Our tables are in `app`, and Supabase exposes only `public` by default. Record the risk. Alternative noted in ADR-002: storage-only S3 access keys, rejected for now because they need request signing (SigV4) without an SDK. |
| D7 | Major | Uploads that are never attached hold personal data with no retention limit, and nothing caps how many a user can create. | **DD-16:** the cleanup job (Future Improvement) becomes a **go-live gate** for the first type with `document_required`. `requestUpload` refuses a user who has 20 or more unattached uploads from the last hour (`TICKET_POLICY.maxPendingUploads`, PMC), the same pattern as `app.recent_export_count`. |

## Fixes needing no new rule (FIX)

| ID | Sev | Finding | Proposed edit |
|---|---|---|---|
| D2 | Major | Submitting the raise form twice makes two tickets. A second submit with the same documents hits P2002, which no handler maps, so the user gets a 500. | The ticket uuid is rendered into the raise form as a hidden `ticketId`. Insert with `on conflict (id) do nothing`. If the id already exists and the actor raised it, redirect to it. Map P2002 on `ticket_document.upload_id` to `TicketError("document")`. |
| D3 | Major | The guard trigger checks only updates. An insert can create a ticket that is already APPROVED. A move to APPROVED can skip levels. Rows can be inserted into `ticket_level` freely. | The guard also runs on insert: status OPEN, level 1, version 1, `assigned_user_id` and `closed_at` null. APPROVED only when `old.current_level = level_count`. `assigned_user_id` must be null when the level rises. `ticket_level` gets primary key `(ticket_id, level)` and a trigger that allows inserts only while the ticket has no events yet (the raise inserts levels before its RAISE event), with `level <= level_count`. DD-1's claim is reworded to match. |
| D5 | Major | The upload security argument assumes the object cannot be overwritten after it is checked, but that is never pinned. | Send `x-upsert: false` on `upload/sign`. The manual check and ADR-002 verify that a second PUT to the same key is refused. |
| D8 | Nit | Deactivation can race a final approval that is already running. | Read the type with `for share` in the raise and final-approval transactions. |
| D9 | Nit | An update that matches 0 rows is not handled, and the T-SEC claim about the version check is overstated. | "If the update affects 0 rows, throw `conflict`." Reword DD-1: the trigger proves the version rises by exactly 1 and that closed tickets cannot change; exactly-once rests on the row lock plus that rule. |
| D10 | Nit | Free text in `detail=` in the URL lets anyone put a message on the app's own page. | Handlers throw `TicketError("stale", key)` and declare `staleMessages: Record<key, text>`. The URL carries only the key. Unknown keys show the generic text. This replaces the R3 fix. |
| D11 | Nit | The download error rules contradict each other: 404 against `Forbidden`. | Pre-check `ticket_may_view` → 404. Then `scopedAction` with `ticket.document.view` → `Forbidden`, DENIED row, `?error=forbidden`. The table is updated. |
| D12 | Nit | A Postgres sequence was not considered for the counter. | Add an alternative: rejected because a per-period reset (NP-2) and the gapless option (NP-3) both need a transactional counter row. Allocate the number as the last write before the ticket insert. |
| S1 | Major | There is no Risks section; risks are scattered. | Add `## Risks and Mitigations` after Alternatives, as a table with Risk, Impact, Mitigation and Residual/owner. It gathers the DD-1 limit, P2034 duplicate side effects, stranded tickets, self/multi-level approval, unattached uploads, signed URLs, the service key, queue cost and handler swaps. |
| S2 | Major | Additional Resources and Future Improvements are H3s under NFR. | Promote both to `##`. |
| S3 | Major | Q2 calls NP-1 both settled and open, and the numbering rules are repeated in three places. | Q2 lists only unsigned items with their defaults and points to Numbering. DD-8 and DD-10 say "owner decision, PMC until NP owners sign". |
| S4 | Major | CUJ 1 says the file is stored when the user submits. The architecture uploads before submit. | Rewrite CUJ 1 for the two-phase flow. On refusal, "no ticket or document row is created". |
| S5 | Major | DDs repeat mechanics from the Technical Plan, and DD-12 appears four times. | Trim DD-5, DD-6, DD-7, DD-10 and DD-12 to the decision, the reason and a pointer. The mechanics stay in the Technical Plan only. |
| S6 | Major | Alternatives are missing for uploading through our server, the storage backend, and extending `number_series`. A, F and G lead with "the owner chose". | Add alternatives I (proxy upload: blocked by the 4.5 MB body cap), J (other storage, deferred to ADR-002), and K (extend `number_series`, or use a sequence; merged with D12). A, F and G lead with the technical reason. |
| S7 | Nit | The decisions have mixed provenance under one intro. | Two H3s: "Drafting and zoom-out review (2026-10-27)" and "After the comprehension review (2026-10-28)". |
| S8 | Nit | The header date is stale, and "Nothing … is approved" clashes with later text. | Add "Last updated 2026-10-28". Reword to "Owner decisions are *accepted*; nothing is approved for build until the design is approved." |
| S9 = W15 | Nit | The Open Question IDs have gaps. | Add a note that Q1, Q3, Q5 and Q6 were settled while drafting and became DD-1 to DD-6 (Q3 → DD-5). The earlier mapping was not recorded. |
| S10 | Nit | Q4 contains the mechanism. | Cut it to the question, the default, the owner and the gate, plus a pointer to Act step 3. |
| S11 | Nit | Questions don't name their owner or what they block. | Add `Owner · Blocks · Default` to each question. |
| S12 | Nit | The solution summary sits inside The Problem. | Move it to the end of Overview. |
| S13 | Nit | Alternative D says "four failure modes", but The Problem lists five. | Change to "the five problems". |
| S14 | Nit | G8 cites requirement IDs, not tests. | The intro becomes "tests or requirements". |
| S15 | Nit | The raise-form UI flow sits in the handler contract. | Move it to Screens. |
| S17 | Nit | An Errors table row has empty cells. | Fill them with "not used". |
| S18 | Nit | Horizontal rules are placed arbitrarily. | Keep rules only after the header and before the Detailed Implementation Plan. |
| S19 = W17 | Nit | A Rollout continuation line is not indented. | Indent it. |
| W1 | Major | "Approved" has three meanings. | Owner decisions are "accepted". "Approved" is kept for design sign-off and the ticket status. |
| W2 | Major | The acting person is called actor, session's user, caller and user. | Define "actor (the session's user)" once, and use "actor" throughout. |
| W3 | Major | Passive "is accepted" hides who accepted a risk. | Point each such statement to the Risks table row with its owner (DD-15/ADR-002). |
| W4 | Major | Unmeasured claims: "safe", "harmless", "acceptable", "slow". | Reword. The queue gets a PMC threshold: p95 above 1 s → set-returning query. |
| W5 | Major | Act step 5 and Raise step 2 are overloaded. | Split them into sub-bullets. |
| W6 | Major | Some table cells hold whole paragraphs. | `ticket_may_act` and `ticket_may_view` conditions become numbered lists under the table. The `ticket_event` detail rules become a sentence. |
| W7 | Major | Some sentences run past 45 words. | Split them, as the reviewer suggested (Overview scope list, DD-5, Q4 heading). |
| W8 | Major | Unclear pronouns. | Replace each with its noun (lines 167, 497, 538, 253). |
| W9 | Nit | British and American spelling mixed. | British spelling in prose. Code names such as `authorize()` are kept. |
| W10 | Nit | The forwardee has five names, and "raiser" is undefined. | Define "raiser" and "forward target" in the Terms table and use them throughout. |
| W11 | Nit | "Last" and "final" level; "domain change" and "domain effect". | Use "last level" and "domain change". |
| W12 | Nit | Filler words ("merely", "blindly", "straight", "much"). | Remove or replace them. |
| W13 | Nit | "four ways that goes wrong" | "four ways this goes wrong" |
| W14 | Nit | Redundant "short read"; vague "through the URL". | Reword (largely superseded by D10). |
| W16 | Nit | "Outbox" and "compensation logic" are not defined. | Add both to the Terms table. |

## Declined

| ID | Sev | Reason |
|---|---|---|
| S16 | Nit | The Storage endpoint shapes were added to answer comprehension finding C12, and Detailed Plan item 9 points to them. Moving them would bring that gap back for readers of the feature section. |

## Resolution

**Status: resolved (2026-10-28).** The owner chose "Accept all, apply": DD-13 to DD-16 were accepted as proposed, and every FIX item was applied in one batch. S16 was declined, as above. The Overview, Decisions, Open Questions, CUJs, Technical Plan, Alternatives and NFR sections were rewritten in place. A new **Risks and Mitigations** section and **CUJ 5** (stranded ticket) were added, along with **Alternatives I, J and K**. The Detailed Implementation Plan was aligned to match:
- ADR-002 scope
- register entries
- T-TKT-021/022
- the guard triggers
- `reassign`
- `TICKET_POLICY` additions
- the reassign route
- the new tests
- 15 audit actions

One gap found while applying: the "stranded" notice cannot use `ticket_may_act`, which answers only for the actor. A fifth definer function, `app.ticket_stranded(ticket)`, was added for it, readable only by `ticket.type.manage` holders.
