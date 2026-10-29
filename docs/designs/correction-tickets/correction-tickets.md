# Student correction tickets (Stage 3, third piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-3 and accepted DD-4…DD-9 on 2026-10-29; build approval follows the EGM review (steps 5–9). Step 5: [`zoom_out_report.md`](zoom_out_report.md) (DD-10…DD-13); step 6: [`comprehension_report.md`](comprehension_report.md) (DD-14, DD-15).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

A learner's identity (given name, family name, date of birth, gender, mobile, email) changes only through a correction ticket (admission-screens DD-5, learner-details DD-10), and none exists yet. This piece registers **six ticket handlers**, one per identity field (R-095: FNC, LNC, GDR, EMC, …). A centre raises a ticket naming the learner by Admission No and the new value, with proof when the type requires it; head office approves through the existing engine; the final approval calls `changeIdentity()` in the same transaction.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Ticket engine | Types, levels, raise/act/reassign, documents, audit, the handler contract | `docs/designs/ticket-engine/ticket-engine.md`, `src/server/tickets/` |
| Handler | `{ key, fields, parse, prepare?, validate, revalidate?, apply, review?, describe?, invalidMessages?, staleMessages }`, registered in `HANDLERS` (the four `?` hooks are new here) | `src/server/tickets/handlers.ts` |
| PRO | The Public Relations Office of head office, the owner of student decisions | audit 04 |
| `changeIdentity()` | The one place identity fields change; binds the change to a centre where the person is admitted; returns before/after | `src/server/people.ts` |
| Likely duplicate | A person with the same match key admitted at a centre in the caller's scope | person-core DD-1 |
| R-, D-, T-, NP- ids | Requirements, decisions, tests, numbering policies | `docs/audit/` |

## The Problem

1.  **Identity typos cannot be fixed.** The fields are ticket-only and no ticket type can change them.
2.  **Corrections are sensitive.** A changed name or date of birth affects certificates and duplicate detection; head office must approve, with proof (SRC, R-095: "Centre states old/new value + proof; HO approves; record rewritten by the system").
3.  **The record may change while a ticket waits.** Two corrections of one field, or a correction racing another, must not silently overwrite each other.

## Goals

*   **G1: Six correction types can be configured and raised:** a centre user with `ticket.raise` names an admitted learner by Admission No and the new value [T-COR-001].
*   **G2: The old value is taken from the record at raise and shown to the approver;** at the final approval the change is refused as stale if the field changed meanwhile [T-COR-002].
*   **G3: The final approval rewrites the field through `changeIdentity()`** in the approval's transaction; the match key follows [T-COR-003].
*   **G4: The approver sees likely duplicates of the corrected identity before approving;** they do not block (DD-3) [T-COR-004].

## Non-Goals

*   **Course change (CC) and course status change (CSC):** fees (D-STU-2, a production gate) and registrations; later.
*   **Detail corrections:** contact and family details are edited directly (learner-details DD-10).
*   **Merging persons** (D-STU-5).
*   **Legacy codes whose meaning the sources do not give** (GPC, FPC, GNC, MNC, NC, SMS): mapped to these six types, or added, once PRO confirms them (Open Questions).
*   **Migrating legacy correction tickets** (the 2,412 pending legacy tickets belong to the ticket-workflows stage).

## Technical Plan (Architecture)

Z- and C- ids are the findings of [`zoom_out_report.md`](zoom_out_report.md) (step 5) and [`comprehension_report.md`](comprehension_report.md) (step 6).

### Engine Contract (DD-4, DD-5, DD-6, DD-12; C3, C5, C10, C15)

`src/server/tickets/errors.ts` (new, no imports) takes `TicketError`, `TicketReason`, `TicketNotFound`, `TicketDuplicate` and `ApplyFailed`; `handlers.ts` re-exports them, so existing imports do not change and `identity-handlers.ts` never imports `handlers.ts` at runtime (C10).

```ts
export type TicketField =
  | { name: string; label: string; kind: "text" | "number" | "date" }
  | { name: string; label: string; kind: "select"; options: [string, string][] }; // rendered <select name="p.<name>" required>

export type TicketHandler<P, R = P> = {
  key: string;
  fields: TicketField[];
  parse(payload: Record<string, string>): R;                                  // sync; throws TicketError("invalid", key)
  prepare?(tx: Tx, t: { centreId: number; payload: R; source?: P }): Promise<P>; // new: resolves and enriches; its result is stored
  validate(tx: Tx, t: { centreId: number; payload: P }): Promise<void>;
  revalidate?(tx: Tx, t: TicketRow<P>): Promise<void>;
  apply(tx: Tx, t: TicketRow<P>): Promise<{ before: unknown; after: unknown }>;
  review?(tx: Tx, t: { centreId: number; payload: P }): Promise<string[]>;      // new: lines shown to those who may act
  describe?(payload: P): [string, string][];                                  // new: the request as label/value rows
  invalidMessages?: Record<string, string>;                                   // new: user texts for TicketError("invalid", key)
  staleMessages: Record<string, string>;
};
```

*   **`raise()`** (in its `scopedAction`, the raiser's session, `ticket.raise` already authorised): `lockHandler` → `parse` → `prepare` (given `source` = the rejected ticket's payload on a re-raise) → `validate` → documents → re-raise ownership → levels → number → insert with `JSON.stringify` of the prepared payload. Without `prepare`, `parse`'s result is stored as today (`R = P`).
*   **`getTicket()`** also selects `ty.handler_key`; when `canAct` and the handler has `review`, it calls `review(tx, { centreId, payload })` in the same read (the viewer's session) and returns `reviewLines: string[]` (else `[]`); a `review` that throws is caught and shown as one line "Duplicate check unavailable", so the page never breaks. The ticket page renders `HANDLERS[handlerKey]?.describe?.(payload)` as a table, else the JSON as today.
*   **Invalid messages (C4):** `adminPost()` appends `&detail=<message>` for `invalid` as it does for `stale`. `raiseOptions()` adds `invalidMessages` (from `HANDLERS[handler_key]`) to each type. The raise page, for `error=ticket.invalid`, shows `fieldsOf.invalidMessages?.[q.detail]` where `fieldsOf` is the type found by `q.type`, or by the source ticket on a re-raise; an unknown detail shows the generic text. The text never comes from the URL.
*   The raise form renders `select` fields as `<select name="p.<name>" required>` with the given options.

### Handlers (`src/server/tickets/identity-handlers.ts`)

One factory over `IdentityKey = "givenName" | "familyName" | "dateOfBirth" | "gender" | "mobile" | "email"`; it imports `errors.ts`, `people.ts` and only types from `handlers.ts`, and exports `IDENTITY_HANDLERS`, which `handlers.ts` registers at the top level (DD-1).

| Key | Field | New-value input | May be cleared | Legacy code |
|---|---|---|---|---|
| `identity.givenName` | given name | text "New given name" | no | FNC |
| `identity.familyName` | family name | text "New family name" | yes | LNC |
| `identity.dateOfBirth` | date of birth | date "New date of birth" | no | to confirm |
| `identity.gender` | gender | select "New gender": `[["MALE","Male"],["FEMALE","Female"],["OTHER","Other"]]` (the first is preselected, Z8) | no | GDR |
| `identity.mobile` | mobile | text "New mobile" | yes | to confirm |
| `identity.email` | email | text "New email" | yes | EMC |

```ts
type R = { admissionNo: string; newValue: string | null };
type P = { admissionNo: string; personId: string; field: IdentityKey; oldValue: string | null; newValue: string | null };
// stored, e.g. {"admissionNo":"GTEC262743888","personId":"…","field":"givenName","oldValue":"Anu","newValue":"Anuja"}
```

*   **`fields`:** `p.admissionNo` (text "Admission No") and `p.newValue` (above).
*   **`parse(p)`** (C1, C2): `admissionNo` trimmed; empty → `TicketError("invalid", "admissionNo.required")`; over 40 characters → `"admission.unknown"`. `newValue` trimmed; empty → `null` for the clearable fields, else `"newValue.required"`; a non-empty value goes through `identityField(field, v)`, and a `PersonError` becomes `"newValue.format"`.
*   **`prepare(tx, { centreId, payload, source })`** (C11, C12, DD-13, DD-15):
    1.  `select app.has_permission('student.view', ${centreId}::int) as ok`; false → `"admission.unknown"`. (Admission and person RLS admit any role at the centre, so this check is what enforces DD-13.)
    2.  `select person_id from app.admission where admission_no = ${admissionNo} and centre_id = ${centreId}` (exact match, as stored); none → `"admission.unknown"`.
    3.  On a re-raise, the person must equal `source.personId`; else `"reraise.person"` ("A re-raise must be for the same learner; raise a new ticket instead.").
    4.  One static read of the six identity columns as text (`given_name, family_name, gender::text, date_of_birth::text, mobile, email`; plain here, `for update` in `revalidate`); `oldValue = row[field]`; `newValue === oldValue` (null equals null) → `"newValue.same"`.
    5.  Returns `P`.
*   **`validate`:** nothing (prepare did it).
*   **`revalidate(tx, t)`** (Z1, C11): the same static read `… for update` on the person row (two approvals on one learner queue; `changeIdentity()` re-takes the lock in the same transaction); `row[field] !== t.payload.oldValue` → `TicketError("stale", "changed")`.
*   **`review(tx, { payload })`** (DD-10, C9): for the name, date-of-birth and mobile handlers only. Builds the corrected identity (the current row with `newValue` put in). If it has no match key (date of birth or mobile missing), the line "Duplicate check not possible: date of birth or mobile missing". Otherwise `findMatches(tx, identity, "ticket.approve")` minus the person itself, as "Possible duplicate: <given> <family>, born <dob>" (no mobile), or "No likely duplicates at centres you approve for".
*   **`describe(p)`** (C14): `[["Admission No", p.admissionNo], ["Field", <label>], ["Old value", <shown>], ["New value", <shown>]]`, labels from a fixed map, `null` shown as "(empty)", gender through the select labels.
*   **`apply(tx, t)`:** `changeIdentity(tx, t.centreId, t.payload.personId, { [field]: t.payload.newValue })`; returns `{ before: { fields: [field] }, after: { fields: [field] } }` (DD-7). A `PersonError` here becomes the engine's `ApplyFailed` (audited FAILED, generic error).
*   **`invalidMessages`:** `admissionNo.required` "Enter the Admission No.", `admission.unknown` "No admission with that number at this centre.", `newValue.required` "Enter the new value.", `newValue.format` "The new value is not in the right format.", `newValue.same` "That is already the learner's value.", `reraise.person` (above).
*   **`staleMessages`:** `{ changed: "The learner's record changed after this ticket was raised. Reject it, so the centre can re-raise it with the current value." }` (C8).

### Order of Checks

*   **At raise:** `lockHandler` (inactive) → `parse` → `prepare` (student.view, admission, re-raise person, same value) → `validate` → document required → re-raise ownership → levels → number → insert.
*   **At the final approval:** ticket lock → status and version (conflict) → `ticket_may_act` → `lockHandler` (inactive) → `revalidate` (person lock, stale) → `apply` (`changeIdentity`: re-normalise, `assertAdmittedAt`, person lock).
*   **After a stale refusal** (C8): `act()` rolls back and the ticket stays open at its level with the stale message; the approver rejects it with remarks; the raiser re-raises it once (engine DD-9), `prepare` reads the current value afresh and the learner must be the same (DD-15), or raises a new ticket.

### Registration and the Proof Gate (DD-11, DD-14; Z3, C6, C7, C19)

*   `HANDLERS` registers `IDENTITY_HANDLERS` in every environment. This ends "`HANDLERS` is empty in production" and ticket-engine DD-7: the ticket screens become production screens, unstyled; the comments in `handlers.ts` and `engine.ts` are updated.
*   **`TICKET_POLICY.documentsLive: false`** in `src/server/tickets/policy.ts`. It is set to `true` only when ADR-002 is signed **and** the engine's DD-16 go-live items (the unattached-upload deletion job and the per-user upload limit) are built (DD-14). The gate reads `process.env["VERCEL_ENV"]` at call time and an injectable flag (`documentsLive()` reading the policy, replaceable in tests), so both outcomes are tested.
*   **The gate:** `setTypeActive(active = true)` refuses a type with `document_required` when `VERCEL_ENV === "production"` and `!documentsLive()`: `refuse("ticket.setup.storage", …)`; `updateType()` refuses setting `documentRequired = true` on an active type under the same condition (C6). `ADMIN_MESSAGES["ticket.setup.storage"]` = "A type that needs documents cannot be switched on until document storage is approved (ADR-002) and its safeguards are in place." Preview deployments are not gated: they hold no real learners.
*   Ticket types are created by a `ticket.type.manage` holder in `/admin/ticket-types` as today (code FNC, LNC, …; approvers per level; "document required").

### Personal Data

*   The ticket payload holds the old and new values (the approver needs them), visible to whoever may view the ticket.
*   The final approval's audit row carries the field name only (DD-7).

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-COR-001 | A type per handler; raise with a valid Admission No; an unknown one; another centre's; by a raiser without `student.view`; an empty required value; an invalid date; the same value; an empty value for a clearable field | Stored payload as above; otherwise `TicketError("invalid", key)` with the listed key (no `student.view` → `admission.unknown`); the raise page (route) shows the key's text; the clearable field stores `null` |
| T-COR-002 | Two corrections of one field, approved in turn and concurrently; a re-raise after rejection with the same learner and with another | The second is stale in both cases; re-raise: fresh `oldValue`; another learner → `reraise.person` |
| T-COR-003 | Approve a given-name correction | `given_name` and `match_key` changed in the approval's transaction; the audit row names the field only |
| T-COR-004 | A correction that makes the learner match another person, approver with `ticket.approve` but not `student.view`; one with no match key; one with none | The duplicate line; "not possible"; "no likely duplicates"; approval works in all three |
| T-COR-005 | A document-required correction type with `VERCEL_ENV=production`: `documentsLive` false and true; ticking "document required" on an active type; a type without proof | Refused (`ticket.setup.storage`) / allowed; refused; allowed |
| T-TKT-* | The existing ticket tests | Pass unchanged (the test handler has no `prepare`, `review` or `describe`) |

## Decisions

1.  **DD-1: One ticket handler per identity field** (six), matching the legacy codes (design owner, 2026-10-29).
2.  **DD-2: Proof is set per ticket type** with the engine's existing "document required" switch (design owner, 2026-10-29).
3.  **DD-3: Likely duplicates are shown to the approver, not blocking** (design owner, 2026-10-29).
4.  **DD-4: The engine gains an optional `prepare` step** so a handler can store resolved data (person id, old value) in the payload at raise.
5.  **DD-5: Ticket fields gain a `select` kind** (gender).
6.  **DD-6: The engine gains an optional `review` hook** shown to those who may act, and an optional `describe` for the payload.
7.  **DD-7: The final approval's audit row names the corrected field, not the values** (as learner-details DD-14); the values stay in the ticket payload.
8.  **DD-8: The learner is named by Admission No at the ticket's centre.**
9.  **DD-9: A correction is refused as stale if the field changed after the ticket was raised;** the raiser raises a new ticket.
10. **DD-10: The duplicate warning covers centres where the approver holds `ticket.approve`,** and says so when it finds none (design owner, 2026-10-29, Z2).
11. **DD-11: A proof-requiring correction type stays off in production until ADR-002 is signed;** the ticket screens become production screens (design owner, 2026-10-29, Z3).
12. **DD-12: The raise page shows the handler's specific reason** from a fixed list (design owner, 2026-10-29, Z4).
13. **DD-13: Raising a correction needs `student.view` at the centre;** without it, the answer is the same as for an unknown Admission No (design owner, 2026-10-29, Z9).
14. **DD-14: Proof-requiring correction types go live in production only when ADR-002 is signed and the engine's DD-16 safeguards (unattached-upload cleanup, per-user upload limit) are built** (design owner, 2026-10-29, C19).
15. **DD-15: A re-raise must be for the same learner;** another learner needs a new ticket (design owner, 2026-10-29, C8).

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
| A learner is admitted at two centres; one centre corrects the name | The other centre sees the change | Accepted: identity belongs to the person; approved by head office | none |
| Old and new values in the ticket payload | Personal data in the ticket table | Accepted (the approver needs them); not in the audit log (DD-7) | none |

## Detailed Implementation Plan

Outline; the file-by-file plan is written against the code during EGM step 9:

| Phase | Items |
|---|---|
| C1 Documents | T-COR-001…004 in audit 09; matrix links on R-095 |
| C2 Engine | `errors.ts`; `prepare`, `review`, `describe`, `invalidMessages`, `select` fields; `adminPost` invalid detail; the proof gate in `setTypeActive` and `updateType`; comments updated; existing ticket tests still pass |
| C3 Handlers | `identity-handlers.ts`, registration; tests |
| C4 Pages and evidence | raise-form select; ticket page review lines and described payload; smoke; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
