# Student correction tickets (third Stage 3 piece): input brief for `egm-draft`

Prepared 2026-10-29 from the audit pack and the built code, as **input** for an EGM draft session. This is not a design: the design doc is written section by section with the design owner and then reviewed by `egm-review`.

Evidence classes: SRC = stated in a source, INF = inferred, PRO = proposed, PMC = pending manager confirmation. Nothing here is approved.

## 1. What it is (SRC, INF)
- **R-095 (SRC, SPEC p37; WF pp. 13–14):** student correction tickets FNC, LNC, MNC, GPC, FPC, SMS, GDR, EMC, GNC, NC (plus CSC, CC): "Centre states old/new value + proof; HO approves; record rewritten by the system". Centre raises, PRO approves.
- **Why now (INF):** identity fields (given/family name, date of birth, gender, mobile, email) are ticket-only by design (admission-screens DD-5, learner-details DD-10), and there is no correction ticket yet, so a typo in a learner's identity cannot be fixed at all.
- **What exists:** the ticket engine (Stage 2, E-023…E-028: types, levels, approvals, documents, audit, a handler contract) with no domain handler registered in production; `changeIdentity(tx, centreId, personId, changes)` in `src/server/people.ts`, written for exactly this ("in Stage 2 only a correction handler's apply(), in the approver's transaction").

## 2. Requirements in scope (traceability matrix)
| Req | What | Stage | Evidence | In this piece? (PRO, to settle) |
|---|---|---|---|---|
| R-095 | Correction tickets: name (first, last, middle?), DOB?, gender (GDR), email (EMC), mobile/SMS (SMS?), and others | S3 | SRC (codes); the meaning of several codes (GPC, FPC, GNC, MNC) is not spelled out in the sources | The identity fields only |
| R-095 CSC, CC | Course status change, course change | S3 | SRC | No: CC touches fees (D-STU-2, a production gate); CSC with registrations later |
| R-094.01 | Ticket types: document upload mandatory/optional, levels, approvers | S2 | SRC | Reused as built; types configured by `ticket.type.manage` |
| R-096 | Course mode approval | S5 | SRC | No |

## 3. What exists today (built)
- **Ticket engine:** `raise`, `act` (approve, reject, forward), `reassign`, re-raise (DD-9), documents (direct upload to private storage, ADR-002 Proposed), audit (`ticket.*`), screens (`/tickets/*`, `/admin/ticket-types`); a handler is `{ key, fields, parse, validate, revalidate?, apply, staleMessages }` (`src/server/tickets/handlers.ts`); `HANDLERS` is empty in production.
- **Raise form:** the type's `fields` render as text/number/date inputs named `p.<name>`; no select or person picker.
- **Person core:** `changeIdentity()` validates through `identityField()`, binds the change to a centre where the person is admitted (`assertAdmittedAt`), locks the person row and returns before/after; the match-key trigger recomputes the key.

## 4. Open decisions (audit 04; all PMC, none approved)
| ID | Decision | Proposed default | Owner |
|---|---|---|---|
| D-STU-1 | Fields editable freely vs via ticket | Identity via ticket (learner-details DD-10) | PRO |
| D-TKT-1 | Approvers and levels per type | Migrate current configuration | Ops/PRO |
| D-TKT-2 | Rejected: reopen or new ticket | Re-raise once (ticket-engine DD-9) | Ops |
| D-TKT-4 | Self-approval ⛔ prod-gate | Prohibited (DD-14) | Ops |
| D-STU-5 | Merging duplicate persons | Later, reviewed process | Admissions/PRO |

## 5. Questions the design should answer explicitly
1. **Which fields and how many ticket types:** one handler per field (FNC, LNC, GDR, EMC…, matching the legacy codes) or one "identity correction" handler with a field choice; which legacy codes map to which identity field.
2. **How the raiser picks the learner:** by Admission No or Register No typed in a field (the raise form has text inputs only), validated at raise to an admission at the ticket's centre.
3. **Old value:** captured at raise from the record (not typed), shown to the approver, and re-checked at the final approval (stale if it changed meanwhile).
4. **Proof documents:** mandatory per type (R-094.01 "Document Upload: Mandatory, Optional").
5. **Duplicates:** what happens when a corrected name/DOB/mobile now matches another person (match key): allowed, warned, or refused (D-STU-5).
6. **Who sees the result:** the change is audited by the engine (`ticket.approve` with before/after); the learner page shows the corrected identity.
7. **Personal data:** old and new identity values in the ticket payload and audit rows (cf. learner-details DD-14).
