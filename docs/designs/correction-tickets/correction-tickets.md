# Student correction tickets (Stage 3, third piece)

*   **Author:** gtm
*   **Status:** Proposed. The design owner decided DD-1…DD-3 and accepted DD-4…DD-9 on 2026-10-29; build approval follows the EGM review (steps 5–9).
*   **Date:** 2026-10-29

Evidence classes follow `docs/audit/00-README.md`: SRC, INF, PRO, PMC. Statements in the Technical Plan without a class are PRO. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

A learner's identity (given name, family name, date of birth, gender, mobile, email) changes only through a correction ticket (admission-screens DD-5, learner-details DD-10), and none exists yet. This piece registers **six ticket handlers**, one per identity field (R-095: FNC, LNC, GDR, EMC, …). A centre raises a ticket naming the learner by Admission No and the new value, with proof when the type requires it; head office approves through the existing engine; the final approval calls `changeIdentity()` in the same transaction.

### Terms and References

| Term | Meaning | Where |
|---|---|---|
| Ticket engine | Types, levels, raise/act/reassign, documents, audit, the handler contract | `docs/designs/ticket-engine/ticket-engine.md`, `src/server/tickets/` |
| Handler | `{ key, fields, parse, validate, revalidate?, apply, staleMessages }`, registered in `HANDLERS` | `src/server/tickets/handlers.ts` |
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

### Handlers (`src/server/tickets/identity-handlers.ts`)

One factory, six handlers (DD-1):

| Key | Field | Input kind | Legacy code (SRC where stated) |
|---|---|---|---|
| `identity.givenName` | `givenName` | text | FNC (first name) |
| `identity.familyName` | `familyName` | text (empty clears) | LNC (last name) |
| `identity.dateOfBirth` | `dateOfBirth` | date | to confirm |
| `identity.gender` | `gender` | select (DD-5) | GDR |
| `identity.mobile` | `mobile` | text (empty clears) | to confirm (SMS?) |
| `identity.email` | `email` | text (empty clears) | EMC |

Each handler:

*   **`fields`:** `admissionNo` (text) and `newValue` (the kind above).
*   **`parse(p)`:** trims `admissionNo` (1–40 characters, else `TicketError("invalid", "admissionNo: required")`); normalises `newValue` with `identityField(field, v)` (an empty value is `null`, allowed only for the optional fields), mapping `PersonError` to `TicketError("invalid", <field rule>)`.
*   **`prepare(tx, { centreId, payload })`** (engine extension, DD-4): finds the admission `where admission_no = $1 and centre_id = $centreId` (else `TicketError("invalid", "no admission with that number at this centre")`), reads the person's current value, refuses `newValue === oldValue` (`"that is already the value"`), and returns the stored payload `{ admissionNo, personId, field, oldValue, newValue }`.
*   **`validate`:** nothing more (prepare did it).
*   **`revalidate(tx, t)`:** re-reads the current value (`select … for update` through `changeIdentity`'s lock is later; here a plain read under the engine's ticket lock); different from `t.payload.oldValue` → `TicketError("stale", "changed")` (G2).
*   **`review(tx, t)`** (engine extension, DD-6): for the name, date-of-birth and mobile handlers, the persons other than `t.payload.personId` whose match key equals the key of the corrected identity, in the caller's `student.view` scope, as lines "Possible duplicate: <given> <family>, born <dob>" (no mobile); empty otherwise.
*   **`apply(tx, t)`:** `changeIdentity(tx, t.centreId, t.payload.personId, { [field]: t.payload.newValue })`, returns `{ before: { fields: [field] }, after: { fields: [field] } }` (DD-7: no values in the audit row).
*   **`staleMessages`:** `{ changed: "The learner's record changed after this ticket was raised; raise a new ticket." }`.

### Engine Extensions (DD-4, DD-5, DD-6)

*   **`prepare?(tx, { centreId, payload }): Promise<P>`** on `TicketHandler`: called by `raise()` after `parse()` and before `validate()`; its result is the payload stored on the ticket. Handlers without it keep today's behaviour.
*   **`TicketField.kind` gains `"select"`** with `options: [value, label][]`; the raise form renders a `<select>`.
*   **`review?(tx, t): Promise<string[]>`** on `TicketHandler`: `getTicket()` calls it when the viewer `canAct`, and the ticket page shows the lines above the action form. The engine's other behaviour is unchanged.
*   **The ticket page** shows a handler's payload through an optional `describe?(payload): [label, value][]` instead of raw JSON (for these handlers: Admission No, field, old value, new value).

### Registration and Configuration

*   `HANDLERS` registers the six handlers in every environment (today it is empty in production). Ticket types are created by a `ticket.type.manage` holder in `/admin/ticket-types` as today: code (FNC, LNC, …), approvers per level, and the "document required" switch per type (DD-2).
*   No migration: the ticket tables, the person core and the audit catalogue already cover this (`ticket.raise`, `ticket.approve`, …).

### Personal Data

*   The ticket payload holds the old and new values (the approver needs them); it is visible to whoever may view the ticket (the engine's rules).
*   The audit row of the final approval carries the field name only (DD-7), as learner-details DD-14 does for details.

### Tests

| ID | What it does | Expected |
|---|---|---|
| T-COR-001 | Configure a type per handler; raise with a valid Admission No, an unknown one, another centre's, an empty required value, an invalid date, the same value | Raised with the stored payload; field errors otherwise |
| T-COR-002 | Raise two corrections of one field; approve the first; then the second | The second refused as stale at its final approval |
| T-COR-003 | Approve a given-name correction | `person.given_name` and `match_key` changed in the approval's transaction; the audit row names the field only |
| T-COR-004 | Raise a correction that makes the learner match another person | The approver's ticket page lists the possible duplicate; approval still works |

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
| C2 Engine | `prepare`, `review`, `describe`, `select` fields; existing ticket tests still pass |
| C3 Handlers | `identity-handlers.ts`, registration; tests |
| C4 Pages and evidence | raise-form select; ticket page review lines and described payload; smoke; mutation checks; E-entry |

*Drafted with EGM (draft step followed manually)*
