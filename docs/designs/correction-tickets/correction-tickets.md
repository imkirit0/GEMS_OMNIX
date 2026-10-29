# Student correction tickets (Stage 3, third piece)

*   **Author:** gtm
*   **Status:** Approved for build by the design owner on 2026-10-29, after the EGM review (steps 5–9). The design owner decided DD-1…DD-3 and accepted DD-4…DD-9 on 2026-10-29. Step 5: [`zoom_out_report.md`](zoom_out_report.md) (DD-10…DD-13); step 6: [`comprehension_report.md`](comprehension_report.md) (DD-14, DD-15); step 7: [`critic_report.md`](critic_report.md) (DD-16…DD-19); step 8: [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (no new decisions).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

A learner's identity (given name, family name, date of birth, gender, mobile, email) changes only through a correction ticket (admission-screens DD-5, learner-details DD-10), and none exists yet. This piece registers **six ticket handlers**, one per identity field (R-095: FNC, LNC, GDR, EMC, …). A centre raises a ticket naming the learner by Admission No and the new value, with proof when the type requires it; head office approves through the existing engine; the final approval calls `changeIdentity()` in the same transaction.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Ticket engine | Types, levels, raise/act/reassign, documents, audit, the handler contract | `docs/designs/ticket-engine/ticket-engine.md`, `src/server/tickets/` |
| Handler | `{ key, fields, parse, prepare?, validate, revalidate?, apply, review?, describe?, invalidMessages?, valuesPermission?, staleMessages }`, registered in `HANDLERS`; `prepare`, `review`, `describe`, `invalidMessages` and `valuesPermission` are new here | `src/server/tickets/handlers.ts` |
| PRO | The Public Relations Office of head office, the owner of student decisions | audit 04 |
| `changeIdentity()` | The one place identity fields change; binds the change to a centre where the person is admitted; returns before/after | `src/server/people.ts` |
| Likely duplicate | A person with the same match key admitted at a centre in the caller's scope | person-core DD-1 |
| R-, D-, T-, NP- ids | Requirements, decisions, tests, numbering policies | `docs/audit/` |

## The Problem

1.  **Identity typos cannot be fixed.** The fields are ticket-only and no ticket type can change them.
2.  **Corrections are sensitive.** A changed name or date of birth affects certificates and duplicate detection; head office must approve, with proof (SRC, R-095: "Centre states old/new value + proof; HO approves; record rewritten by the system").
3.  **The record may change while a ticket waits.** Two corrections of one field, or a correction racing another, must not silently overwrite each other.

## Goals

*   **G1: Six correction types can be configured and raised:** a centre user with `ticket.raise` and `student.view` names an admitted learner by Admission No and the new value [T-COR-001]. Met in tests; in production once the go-live gates open (DD-18, DD-14) (I13).
*   **G2: The old value is taken from the record at raise and shown to the approver;** at the final approval the change is refused as stale if the field changed meanwhile [T-COR-002].
*   **G3: The final approval rewrites the field through `changeIdentity()`** in the approval's transaction; the match key follows [T-COR-003].
*   **G4: The approver sees likely duplicates of the corrected identity before approving;** they do not block (DD-3) [T-COR-004].

## Non-Goals

*   **Course change (CC) and course status change (CSC):** fees (D-STU-2, a production gate) and registrations; later.
*   **Detail corrections:** contact and family details are edited directly (learner-details DD-10).
*   **Merging persons** (D-STU-5).
*   **Legacy codes whose meaning the sources do not give** (GPC, FPC, GNC, MNC, NC, SMS): mapped to these six types, or added, once PRO confirms them (Open Questions).
*   **Migrating legacy correction tickets** (the 2,412 pending legacy tickets belong to the ticket-workflows stage): pending legacy corrections have no `personId` or `oldValue`, so they are raised again as new tickets or imported closed (D14).
*   **Persons merged later (D-STU-5):** a merge must reject or move open corrections of the merged-away person (D14).
*   **Multi-field corrections** (e.g. a whole-name code): a new payload shape gets a new handler key (D14).

## Technical Plan (Architecture)

Z-, C-, D- and I- ids are the findings of [`zoom_out_report.md`](zoom_out_report.md) (step 5), [`comprehension_report.md`](comprehension_report.md) (step 6), [`critic_report.md`](critic_report.md) (step 7) and [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md) (step 8).

### Engine Contract (DD-4, DD-5, DD-6, DD-12)

`src/server/tickets/errors.ts` (new, no imports) takes `TicketError`, `TicketReason`, `TicketNotFound`, `TicketDuplicate` and `ApplyFailed`; `handlers.ts` re-exports them, and `test-handler.ts` and `identity-handlers.ts` import `errors.ts`, so no handler module imports `handlers.ts` at runtime (C10, D12).

```ts
export type TicketField =
  | { name: string; label: string; kind: "text" | "number" | "date" }
  | { name: string; label: string; kind: "select"; options: [string, string][] }; // <select name="p.<name>" required>

export type TicketHandler<P, R = P> = {
  key: string;
  fields: TicketField[];
  parse(payload: Record<string, string>): R;                                    // sync; throws TicketError("invalid", key)
  prepare?(tx: Tx, t: { centreId: number; payload: R; source?: P }): Promise<P>; // NEW: resolves and enriches; its result is stored
  validate(tx: Tx, t: { centreId: number; payload: P }): Promise<void>;
  revalidate?(tx: Tx, t: TicketRow<P>): Promise<void>;
  apply(tx: Tx, t: TicketRow<P>): Promise<{ before: unknown; after: unknown }>;
  review?(tx: Tx, t: { centreId: number; payload: P }): Promise<{ lines: string[]; matches: string[] }>; // NEW
  describe?(payload: P): [string, string][];                                    // NEW: the request as label/value rows
  invalidMessages?: Record<string, string>;                                     // NEW: user texts for TicketError("invalid", key)
  valuesPermission?: string;                                                    // NEW: needed to see the payload (I3)
  staleMessages: Record<string, string>;
};
```

*   **`raise()`** (in its `scopedAction`, the raiser's session, `ticket.raise` authorised): `lockHandler` → on a re-raise, `select status, raised_by, payload from app.ticket where id = reraiseOf for update` and the REJECTED and raiser checks (before any domain answer, D1) → `parse` → `prepare` (with `source` = that payload) → `validate` → document required → levels → number → insert of the prepared payload. Without `prepare`, `parse`'s result is stored as today.
*   **Payload visibility (DD-16, I3):** `getTicket()` returns `payload: null` unless `canAct`, or the handler has no `valuesPermission`, or `app.has_permission(valuesPermission, centreId)`; the page then shows "Request hidden". Otherwise it renders `describe(payload)` as a table (a throwing `describe` falls back to the JSON, D9), or the JSON. One rule in one place.
*   **Review (DD-17, I4):** `ticketReview(session, id)` (new, `engine.ts`) is a `scopedAction({ action: "ticket.review.duplicates", permission: "ticket.approve", centreId, targetType: "ticket", targetId })` called by the ticket page only when `canAct` and the handler has `review`, in the pattern of `documentLink()`. It returns `lines` and audits `{ matches }` (person ids, possibly empty) with every review. An error other than a lost connection, `ScopeError` or `Forbidden` is logged and becomes the single line "Review unavailable" (D2, D13); the ticket read is a separate transaction, so the page still renders.
*   **Invalid messages (DD-12, I8):** `adminPost()` appends `&detail=<message>` for `invalid` as it does for `stale`; the raise page looks the key up as the ticket page looks up stale texts, `Object.values(HANDLERS).map((h) => h.invalidMessages?.[detail]).find(Boolean)`, else the generic text. The text never comes from the URL.

### Go-Live Gates (DD-14, DD-18; D5, D6, I2)

*   `src/server/tickets/policy.ts` gains a mutable `TICKET_GATES = { numberingSigned: false, documentsLive: false }` (not `as const`, so tests set the fields; a manual local run edits the constant) and one function `gateRefusal({ documentRequired }): "ticket.setup.numbering" | "ticket.setup.storage" | null`. It applies to **every** ticket type, in every environment (it never reads `VERCEL_ENV`), because ticket-engine Q2 (numbering) and DD-16 (documents) apply to any type:
    *   `numberingSigned` becomes true when the numbering policy NP is signed and the counter is seeded (no collision with legacy numbers, DD-18);
    *   `documentsLive` becomes true when ADR-002 is signed **and** the engine's DD-16 safeguards (unattached-upload deletion job, per-user upload limit) are built (DD-14).
*   **Called from:** `setTypeActive(active = true)` (refusal key as `refuse(key, …)`); `updateType()` when it would set `documentRequired = true` on an active type (`ticket.setup.storage`); `requestUpload()` (storage part only, `TicketError("inactive")`): the guard that protects the data, whatever state a type is in.
*   `ADMIN_MESSAGES["ticket.setup.numbering"]` = "Ticket types cannot be switched on until the ticket numbering policy is signed and its counter is set."; `ADMIN_MESSAGES["ticket.setup.storage"]` = "A type that needs documents cannot be switched on until document storage is approved (ADR-002) and its safeguards are in place."
*   The existing ticket tests set both gates to `true` in `beforeAll` (they create active types and call `setTypeActive`).

### Handlers (`src/server/tickets/identity-handlers.ts`)

One factory over `IdentityKey = (typeof IDENTITY_KEYS)[number]` (`person-rules.ts`), importing `errors.ts`, `people.ts` and `person-rules.ts` (and only types from `handlers.ts`); it exports `IDENTITY_HANDLERS`, registered by `handlers.ts` at the top level in every environment (DD-1). This ends "`HANDLERS` is empty in production" and ticket-engine DD-7: the ticket screens become production screens, unstyled, usable once the gates open; the comments in `handlers.ts` and `engine.ts` are updated.

| Key | Field | New-value input | May be cleared | Legacy code |
|---|---|---|---|---|
| `identity.givenName` | given name | text "New given name" | no | FNC |
| `identity.familyName` | family name | text "New family name" | yes | LNC |
| `identity.dateOfBirth` | date of birth | date "New date of birth" | no | to confirm |
| `identity.gender` | gender | select "New gender": `[["MALE","Male"],["FEMALE","Female"],["OTHER","Other"]]` (first preselected, Z8) | no | GDR |
| `identity.mobile` | mobile | text "New mobile" | yes | to confirm |
| `identity.email` | email | text "New email" | yes | EMC |

```ts
type R = { admissionNo: string; newValue: string | null };
type P = { admissionNo: string; personId: string; field: IdentityKey; oldValue: string | null; newValue: string | null };
// stored, e.g. {"admissionNo":"GTEC262743888","personId":"…","field":"givenName","oldValue":"Anu","newValue":"Anuja"}
```

*   **`fields`:** `p.admissionNo` (text "Admission No") and `p.newValue`. **`valuesPermission: "student.view"`.**
*   **`parse(p)`:** `admissionNo` trimmed; empty → `"admissionNo.required"`; over 40 characters → `"admission.unknown"`. `newValue` trimmed; empty → `null` for the clearable fields, else `"newValue.required"`; a non-empty value through `identityField(field, v)`, a `PersonError` → `"newValue.format"`.
*   **`prepare(tx, { centreId, payload, source })`:**
    1.  `select app.has_permission('student.view', ${centreId}::int) as ok`; false → `"admission.unknown"` (admission and person RLS admit any role at the centre, so this check enforces DD-13).
    2.  `select person_id from app.admission where admission_no = ${admissionNo} and centre_id = ${centreId}` (exact, as stored); none → `"admission.unknown"`.
    3.  On a re-raise: `typeof source?.personId === "string"` and equal to the found person, else `"reraise.person"` (DD-15, D9).
    4.  `readIdentity(tx, personId)`: one static read of the six identity columns as text (`given_name, family_name, gender::text, date_of_birth::text, mobile, email`), plain here, `for update` in `revalidate`; `oldValue = row[field]`; `newValue === oldValue` (null equals null) → `"newValue.same"`.
*   **`revalidate(tx, t)`:** `readIdentity(…, for update)` on the person row (Z1); `row[field] !== t.payload.oldValue` → `TicketError("stale", "changed")`; `newValue` re-checked with `identityField` → `TicketError("stale", "format")` (D8).
*   **`corrected(row, field, newValue)`** (one helper, I17): the identity with the new value put in, and its match key via `app.person_match_key` (null when date of birth or mobile is missing).
*   **`review(tx, { payload })`** (name, date-of-birth and mobile handlers only): no match key → `{ lines: ["Duplicate check not possible: date of birth or mobile missing"], matches: [] }`. Otherwise **`approverMatches(tx, key, personId)`** (new, `people.ts`, next to `findMatches`; I5): one row per (matching person, admission at a centre in `scoped_centre_ids('ticket.approve')`), `select a.admission_no, c.code, app.has_permission('student.view', a.centre_id) as named, p.given_name, p.family_name, p.date_of_birth::text …`; lines "Possible duplicate: <Admission No> at <centre>" plus ", <given> <family>, born <dob>" only when `named` (DD-17); none → "No likely duplicates at centres you approve for".
*   **`describe(p)`:** `[["Admission No", …], ["Field", <label>], ["Old value", old ?? "(empty)"], ["New value", new ?? "(empty)"]]`, labels from a fixed map, gender through the select labels.
*   **`apply(tx, t)`:** when the corrected key is not null, `pg_advisory_xact_lock(hashtext(key))` (the lock `admit()` takes, D7); then `changeIdentity(tx, t.centreId, t.payload.personId, { [field]: t.payload.newValue })`; returns `{ before: { fields: [field] }, after: { fields: [field] } }` (DD-7). A `PersonError` here becomes the engine's `ApplyFailed`.
*   **`invalidMessages`:** `admissionNo.required` "Enter the Admission No.", `admission.unknown` "No admission with that number at this centre.", `newValue.required` "Enter the new value.", `newValue.format` "The new value is not in the right format.", `newValue.same` "That is already the learner's value.", `reraise.person` "A re-raise must be for the same learner; raise a new ticket instead."
*   **`staleMessages`:** `changed` "The learner's record changed after this ticket was raised. Reject it, so the centre can re-raise it with the current value."; `format` "The new value no longer meets the rules. Reject it, so the centre can re-raise it."

### Order of Checks (I1)

*   **At raise:** `lockHandler` (inactive) → re-raise source `for update`, REJECTED and raiser (D1) → `parse` → `prepare` (student.view, admission, re-raise person, same value) → `validate` → document required → levels → number → insert.
*   **At the final approval:** ticket lock → status and version (conflict) → `ticket_may_act` → `lockHandler` (inactive) → `revalidate` (person lock, stale `changed` or `format`) → `apply` (advisory lock on the corrected key, then `changeIdentity`: re-normalise, `assertAdmittedAt`, person lock).
*   **After a stale refusal:** `act()` rolls back and the ticket stays open with the stale message; the approver rejects it with remarks; the raiser re-raises it once (engine DD-9, same learner, DD-15) or raises a new ticket.

### Configuration and Personal Data

*   Ticket types are created by a `ticket.type.manage` holder in `/admin/ticket-types` as today (code FNC, LNC, …; approvers per level; "document required").
*   **Head office approves by configuration (D10):** R-095's "HO approves" holds only if each correction type's levels name head-office users or roles held network-wide; a role held at centre scope, or a reassign to a centre approver, would let centre staff approve (setup guidance under D-TKT-1).
*   **Without proof (DD-19):** once numbering is signed, proof-less correction types may go live before ADR-002, a recorded temporary deviation from R-095 for PRO to confirm (matrix note in phase C1).
*   The payload holds the old and new values; it is shown only as above (DD-16) and cannot be changed or deleted (engine guard), which is accepted for these fields. The final approval's audit row names the field only (DD-7). Duplicate lines name other learners only where the approver holds `student.view`; every review is audited (DD-17).

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-COR-001 | A type per handler; raise with a valid Admission No; an unknown one; another centre's; by a raiser without `student.view`; an empty required value; an invalid date; the same value; an empty value for a clearable field | Stored payload; otherwise `TicketError("invalid", key)` with the listed key (no `student.view` → `admission.unknown`); the raise page shows the key's text; the clearable field stores `null` |
| T-COR-002 | Two corrections of one field, approved in turn and concurrently; a re-raise with the same learner, with another, with a source payload of another shape; a re-raise attempt by a non-raiser naming another learner; an OPEN ticket whose `newValue` `identityField` now rejects (inserted directly) | The second is stale both times; re-raise: fresh `oldValue`; another learner or a foreign shape → `reraise.person`; the non-raiser gets the existing "only the raiser" refusal; stale `format` |
| T-COR-003 | Approve a given-name correction; an approval whose `apply` meets a `PersonError` | `given_name` and `match_key` changed in the approval's transaction; the audit row names the field only; `ApplyFailed` audited FAILED |
| T-COR-004 | A correction matching another person, approver with `ticket.approve` but not `student.view`; with `student.view`; no match key; no match; a review whose SQL fails | Admission No and centre only; name and date of birth added; "not possible"; "no likely duplicates"; "Review unavailable" while the page renders; every review writes one `ticket.review.duplicates` row; approval works throughout |
| T-COR-005 | Gates false / true: switching on any type; ticking "document required" on an active type; an upload request | `ticket.setup.numbering` / `ticket.setup.storage` refusals and `TicketError("inactive")`; allowed when set |
| T-COR-006 | A type viewer and a later-level approver without `student.view` open a correction ticket; a throwing `describe` for one with it | "Request hidden"; the JSON |
| T-TKT-* | The existing ticket tests, with both gates set in `beforeAll` | Pass unchanged |

## Decisions

1.  **DD-1: One ticket handler per identity field** (six), matching the legacy codes (design owner, 2026-10-29).
2.  **DD-2: Proof is set per ticket type** with the engine's existing "document required" switch (design owner, 2026-10-29).
3.  **DD-3: Likely duplicates are shown to the approver, not blocking** (design owner, 2026-10-29).
4.  **DD-4: The engine gains an optional `prepare` step** so a handler can store resolved data (person id, old value) in the payload at raise.
5.  **DD-5: Ticket fields gain a `select` kind** (gender).
6.  **DD-6: The engine gains an optional `review` hook** shown to those who may act, and an optional `describe` for the payload.
7.  **DD-7: The final approval's audit row names the corrected field, not the values** (as learner-details DD-14); the values stay in the ticket payload.
8.  **DD-8: The learner is named by Admission No at the ticket's centre.**
9.  **DD-9: A correction is refused as stale if the field changed after the ticket was raised;** the approver rejects it and the raiser re-raises it (DD-15) or raises a new ticket (I7).
10. **DD-10: The duplicate warning covers centres where the approver holds `ticket.approve`,** and says so when it finds none (design owner, 2026-10-29, Z2).
11. **DD-11: ~~A proof-requiring correction type stays off in production until ADR-002 is signed~~:** superseded by DD-14 (I6); the ticket screens become production screens (design owner, 2026-10-29, Z3).
12. **DD-12: The raise page shows the handler's specific reason** from a fixed list (design owner, 2026-10-29, Z4).
13. **DD-13: Raising a correction needs `student.view` at the centre;** without it, the answer is the same as for an unknown Admission No (design owner, 2026-10-29, Z9).
14. **DD-14: A ticket type that requires documents can be switched on only when ADR-002 is signed and the engine's DD-16 safeguards (unattached-upload cleanup, per-user upload limit) are built,** in every environment (tests set the gate) (design owner, 2026-10-29, C19; wording I6).
15. **DD-15: A re-raise must be for the same learner;** another learner needs a new ticket (design owner, 2026-10-29, C8).
16. **DD-16: Old and new values are shown only to those who can act on the ticket or hold `student.view` at its centre** (design owner, 2026-10-29, D3).
17. **DD-17: Duplicate matches are shown by Admission No and centre** (name and date of birth only with `student.view` there), and showing them is audited (design owner, 2026-10-29, D4).
18. **DD-18: Ticket types cannot be switched on until the numbering policy is signed and the counter seeded,** in every environment (tests set the gate) (design owner, 2026-10-29, D5; generalised to all types at step 8, I2).
19. **DD-19: Proof-less corrections before ADR-002 are a recorded, temporary deviation from R-095** for PRO to confirm (design owner, 2026-10-29, D11).

## Open Questions

| ID | Decision owner | What it affects here | Default used now (PMC) |
|---|---|---|---|
| R-095 codes | PRO | GPC, FPC, GNC, MNC, NC, SMS meanings | Not mapped; six handlers only |
| D-TKT-1 | Ops/PRO | Approvers and levels per type | Configured by head office in the ticket-type admin |
| D-STU-5 | Admissions/PRO | Merging duplicates found by a correction | Warned only (DD-3) |
| D-SEC-4 | IT + Legal | Identity values in ticket payloads | Stored in the payload; audit field names only (DD-7) |

## Alternatives Considered

### Alternative A: One Combined Identity Type

*   **Pros:** One configuration; one handler.
*   **Cons:** Every field shares approvers and the proof rule; legacy has separate codes.
*   **Reason for Rejection:** DD-1.

### Alternative B: Store the Old Value Without an Engine Change

*   **Pros:** No engine change.
*   **Cons:** The raiser would type the old value (error-prone, unverifiable), or `validate` would mutate the payload object as a side effect.
*   **Reason for Rejection:** DD-4 states the step explicitly.

### Alternative C: Edit Identity Directly With a Stronger Permission

*   **Pros:** No ticket.
*   **Cons:** Contradicts R-095 ("HO approves") and D-ADM-3's default.
*   **Reason for Rejection:** Requirement.

## Risks and Limits

| Risk | Impact | Mitigation or acceptance | Test |
|---|---|---|---|
| A correction makes two persons look like one | A duplicate person remains | Shown to the approver (DD-3); merging is D-STU-5 | T-COR-004 |
| A correction type's level is configured with a centre-scoped role | Centre staff approve identity changes, against R-095 | Setup guidance under D-TKT-1 (D10) | none |
| A learner is admitted at two centres; one centre corrects the name | The other centre sees the change | Accepted: identity belongs to the person; approved by head office | none |
| Old and new values in the ticket payload | Personal data in the ticket table, never erasable (engine guard) | Shown only to those who act or hold `student.view` (DD-16); not in the audit log (DD-7); accepted under D-SEC-4 | T-COR-006 |
| Proof-less corrections before ADR-002 | Departs from R-095 | Recorded deviation for PRO (DD-19) | none |
| The whole feature waits for the numbering policy | No correction possible in production until NP is signed | Accepted (DD-18); the gate is one constant | T-COR-005 |

## Detailed Implementation Plan

The file-by-file plan (phases C1–C4, each ending with `bash scripts/ci.sh` exit 0) and the 24 mutation checks are in [`implementation_readiness_report.md`](implementation_readiness_report.md) (EGM step 9). Contract notes from that step, binding for the build:

*   **Review failure (R1):** `ticketReview` catches **outside** its `scopedAction`; its `onFailure` writes `ticket.review.duplicates` FAILED (`{ error: <name> }`) in a fresh transaction, except for a lost connection or `ScopeError`; the outer catch rethrows lost connection, `ScopeError` and `Forbidden`, and turns anything else into the line "Review unavailable". Inside, `ticket_may_act(t.id)` is checked first (R15).
*   **`getTicket` (R3):** selects `ty.handler_key as "handlerKey"` and returns `payload: unknown | null`, `described: [string, string][] | null` (null when hidden, absent or throwing; caught there) and `hasReview: boolean`; the page renders "Request hidden", the table, or the JSON.
*   **`revalidate` (R4):** a missing person row → `TicketError("stale", "changed")`; in `prepare` → `"admission.unknown"`.
*   **Gates (R5, R6):** `setTypeActive` checks `gateRefusal` after its existing handler and levels check; numbering before storage; `updateType` refuses when `before.active && u.documentRequired && !before.document_required && !TICKET_GATES.documentsLive`; `requestUpload` puts `!TICKET_GATES.documentsLive` first in its `inactive` condition. A manual Supabase run opens `documentsLive` locally before `next build` and never commits it; a test asserts the committed values are both `false`.
*   **Handlers (R9–R17):** `parse` stores the normalised value; `readIdentity` aliases columns to camelCase; `validate` is an empty function; `IdentityKey` is declared in `identity-handlers.ts` (`person-rules.ts` stays untouched, it is hashed with the ETL rules); `changeIdentity(..., { [field]: v } as IdentityChanges)`; `approverMatches` excludes the person itself; `apply` re-reads the identity for the corrected key; each handler uses its own field constant, `payload.field` is for display only.
*   **Tests (R2, R8):** a `test.review` handler with `select 1/0` for the failing review; an OPEN identity ticket for a person admitted only at another centre for `ApplyFailed`; page text is checked in `scripts/smoke-security.mjs`, route redirects and `getTicket` fields in vitest. The advisory lock in `apply` (D7) has no test (recorded).

*Drafted with EGM (draft step followed manually)*
