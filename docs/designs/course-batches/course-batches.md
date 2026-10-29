# Course batches and time slots (Stage 3, ninth piece, WF-X19)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-4 are recommended options taken under the owner's standing instruction of 2026-10-29. EGM review (steps 5–9) next.
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Limits and fixed lists are PMC. Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

A centre keeps a list of batches. Each batch has a code, a name, a time of day, a capacity and an active flag. Staff then place the learners' course registrations into batches (R-155, SRC).

Today a registration has no batch. No app path updates a registration: `gems_app` has select and insert only.

This piece adds:
*   the batch master;
*   one nullable column, `registration.batch_id`;
*   two pages: Batches, and Place learners.

Faculty, attendance and reports (Stage 7) build on it.

## Goals

*   **G1:** a holder of `batch.manage` at a centre creates, edits, activates and deactivates that centre's batches, audited with values [T-CB-001].
*   **G2:** the same holder places ACTIVE registrations of that centre into an active batch, moves them, and removes them. Capacity is never exceeded, and every change is audited [T-CB-002].
*   **G3:** anyone with `student.view` at the centre reads its batches and placements. Nobody else does, and nobody can bypass the rules by SQL [T-CB-001, T-CB-002].
*   **G4:** pages and routes, with same origin, field errors, and a 404 for unknown or out-of-scope centres [T-CB-003].

## Non-Goals

*   "Custom Batch" and "Custom Time Slot" (meaning unclear, PRO to confirm), weekdays, timetables (DD-4).
*   Faculty assign (R-152.02), attendance (R-152.03), batch reports (Stage 7).
*   Showing the batch on the learner page (later, with attendance).
*   The legacy batch import (paused, owner 2026-10-29).

## Technical Plan (Architecture)

### Data model (migration `0021_course_batches`)

```sql
create table app.batch (
  id serial primary key,
  centre_id int not null references app.centre (id) on delete restrict,
  code text not null, name text not null,
  starts_at time not null, ends_at time not null,
  capacity int not null, active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (centre_id, code), unique (id, centre_id)
);
alter table app.registration add column batch_id int;
alter table app.registration add constraint registration_batch_fkey
  foreign key (batch_id, centre_id) references app.batch (id, centre_id) on delete restrict on update restrict;
create index registration_batch_id_idx on app.registration (batch_id);
```

*   **Named checks:**
    *   `batch_code_check`: the catalogue code rule, upper case, at most 30 characters.
    *   `batch_name_check`: btrim, 1–100 characters.
    *   `batch_time_check`: `ends_at > starts_at`.
    *   `batch_capacity_check`: 1–500 (PMC).
*   **The composite key** keeps a registration's batch at the registration's own centre. A null `batch_id` is not checked (MATCH SIMPLE).
*   **Capacity in the database:** a constraint trigger `batch_capacity_guard` runs on registration insert and on update of `batch_id`. It is deferrable and initially deferred.
    *   It refuses (23514, `batch_capacity_guard`) when the batch's ACTIVE registrations exceed its capacity.
    *   It does the same on batch update when capacity drops below the count.
    *   The app checks first, under a row lock, with a field message. The trigger stops any path that skips the app.
*   **RLS on `batch`:** the 0002 loop shape (`centre_id`), so T-RLS-002 holds.
    *   `select`: `app.has_permission('student.view', centre_id) or app.has_permission('batch.manage', centre_id)`.
    *   `insert` and `update`: `batch.manage` at the row's centre, in `using` and `with check`.
    *   `delete`: `using (false)`, with no delete grant.
*   **Registration updates:** `grant update (batch_id) on app.registration to gems_app`.
    *   The existing permissive `scope_update` admits any visible centre.
    *   A new **restrictive** update policy `batch_update` requires `batch.manage` at the row's centre, in `using` and `with check`.
    *   `batch_id` is the only column the app may update, so the restrictive policy limits exactly that write.
*   **Permission:** `('batch.manage', 'Create batches and place learners in them', false)`, granted to `system_admin` (the 0013 rule).
*   **Grants:**
    *   `select, insert (centre_id, code, name, starts_at, ends_at, capacity), update (name, starts_at, ends_at, capacity, active) on app.batch`;
    *   `usage on sequence app.batch_id_seq`.

### Server (`src/server/batches.ts`)

Every write goes through `scopedAction` with `permission: "batch.manage"` and the centre. There is no step-up: this is routine centre work, as with enquiries. Validation runs before any database access. Errors are `RbacError("invalid", "<field>: <rule>")`, reusing catalogue's `bad`, `code`, `reasonOf`.

```ts
type BatchInput = { centreId: number; code: string; name: string; startsAt: string; endsAt: string; capacity: number };
type BatchChanges = Partial<Pick<BatchInput, "name" | "startsAt" | "endsAt" | "capacity">>;
listBatches(session, centreId): Promise<{ rows: BatchRow[]; canManage: boolean }>;      // Forbidden without view or manage there
createBatch(session, input: BatchInput): Promise<{ id: number }>;                        // batch.create
updateBatch(session, centreId, id, changes: BatchChanges): Promise<void>;               // batch.update
setBatchActive(session, centreId, id, active, reason): Promise<void>;                   // batch.activate / batch.deactivate
listPlacements(session, centreId, courseCode, batchId?): Promise<PlacementRow[]>;       // ACTIVE registrations of a course there
placeLearners(session, centreId, batchId: number | null, registrationIds: string[]): Promise<{ changed: number }>; // batch.place
```

**Field rules, in this order:**

| Field | Rule | Message |
|---|---|---|
| `centreId` | A safe integer | `centreId: unknown` |
| `code` (create only) | Catalogue `code()` | The catalogue code messages |
| `name` | btrim, 1–100 | `name: 1-100 characters` |
| `startsAt`, `endsAt` | `HH:MM`, 00:00–23:59 | `<field>: HH:MM` |
| Time order (merged row) | `endsAt` after `startsAt` | `endsAt: after startsAt` |
| `capacity` | Integer 1–500 (PMC) | `capacity: 1-500` |
| Capacity (merged row) | Not below the learners placed | `capacity: below the learners placed` |
| `registrationIds` | 1–200 distinct UUIDs | `registrationIds: 1-200 distinct ids` |

**Writes:**

*   **`createBatch`:** `insert … returning id`. The select policy lets a manager see the row. A 23505 on `batch_centre_id_code_key` becomes `RbacError("duplicate", …, "batch.duplicate")` inside the callback, as `centreDb` does.
*   **`updateBatch`:**
    *   Locks the batch `for update` where `id` and `centre_id` match; otherwise `notfound`.
    *   Merges the changes and validates time order and capacity against the count of placed ACTIVE registrations.
    *   No change gives "nothing to change".
    *   The audit is `{ before, after }` of the changed fields.
*   **`setBatchActive`:** two literal calls (`batch.activate`, `batch.deactivate`), a reason, "already active" or "already inactive". Placed learners stay in a deactivated batch. It only stops new placements.
*   **`placeLearners`:**
    *   Locks the target batch `for update` (it must be active, at this centre). Then it locks the registrations `for no key update`, in id order.
    *   Each registration must be at this centre and ACTIVE: `registrationIds: not active here`.
    *   Rows already in the target are skipped. If none changes: "nothing to change".
    *   Capacity counts the target's ACTIVE registrations plus the newcomers: `batchId: full (<n> of <capacity>)`.
    *   `batchId: null` removes the batch from the rows.
    *   The audit target is the batch (or `registration` when removing), with `after: { batch: code | null, registerNos: [...] }` sorted, and `before: { [registerNo]: oldCode | null }`.
*   **Reads:**
    *   `listBatches` returns `id, code, name, startsAt, endsAt, capacity, active, placed`, where `placed` counts ACTIVE registrations in the batch.
    *   `listPlacements` returns `registrationId, registerNo, admissionNo, givenName, familyName, batchId, batchCode`. It is gated on `student.view` at the centre (Forbidden otherwise) and limited to 500 rows (PMC).

### Pages and routes

| Route | What |
|---|---|
| `/batches` | Centre picker: centres where the user holds `student.view` or `batch.manage`. A 404 with no such centre. |
| `/batches?centre=<id>` | That centre's batches. Managers also get the add form, a per-row edit form, and Activate/Deactivate with a reason. |
| `/batches/place?centre=<id>&course=<code>[&batch=<id>]` | The ACTIVE registrations of a course there, each with its batch. Managers get tick boxes and a target select (active batches, or "No batch"). |
| `POST /batches/save` | `adminPost`; `op` is `create`, `update` or `active`. Success goes to `/batches?centre=<id>&saved=1`. |
| `POST /batches/place/save` | `adminPost`; `batchId` (`""` means none) and `registrationId` repeated. Back and success go to the place page with its filters. |

*   A centre id outside the user's view gives the same 404 as a missing one.
*   An unknown `op` gives `op: unknown`.
*   `ADMIN_MESSAGES` gains `batch.duplicate` ("That centre already has a batch with that code.").
*   The home page links Batches when the user may read any batch.

### Tests (`tests/course-batches.test.ts`)

Fixtures add `batch.manage` to role 26 `batch_manager`, with users `tok-bmA` (centre A) and `tok-bmR1` (REGION 1).

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CB-001 | G1, G3 | Create, edit and (de)activate; each message in order; duplicate code per centre (the same code at another centre is fine); capacity below placed; who may (A manager not at B; `tok-uA` with view only reads; nobody else, also by SQL); RLS commands; named checks by direct insert | Audit values; messages; 42501 or 0 rows; 23514 by name |
| T-CB-002 | G2, G3 | Place, move and remove; inactive batch, other centre, non-ACTIVE registration refused; full batch refused with the count; the capacity trigger refuses an owner insert over capacity; a viewer cannot update `batch_id` by SQL (restrictive policy); a manager cannot update another column of a registration | As listed |
| T-CB-003 | G4 | Routes for each op; foreign Origin 403; field `detail`; unknown op; place route with repeated ids | As listed |

**Existing tests that change:**
*   T-RLS-002 adds `batch` to the table list.
*   T-AUD-009 scans `src/server/batches.ts` for `"(batch\.[a-z0-9_.]+)"`, and the catalogue gains the five actions.
*   `reset.sql` truncates `app.batch`.

**Real-server smoke:** `/batches?centre=<B>` is 404 for the viewer of A; the place page lists a seeded registration; a foreign-origin save gives 403.

## Decisions

1.  **DD-1:** a batch belongs to one centre; code unique within it; time slot as start and end time; capacity; active. Not tied to a course (SRC form). Recommended option, standing instruction.
2.  **DD-2:** `batch.manage`, centre-scoped and not sensitive. Readers need `student.view` at the centre. Recommended option, standing instruction.
3.  **DD-3:** only ACTIVE registrations go into an active batch of their own centre; capacity is never exceeded; at most one batch per registration; audited. Recommended option, standing instruction.
4.  **DD-4:** custom batches, time slots and weekdays are out of scope. Recommended option, standing instruction.

## Alternatives Considered

*   **A batch tied to a course.** Rejected: the SPEC form has no course, and centres run mixed-course batches. Placement filters by course instead.
*   **A link table `batch_member`.** Rejected: at most one batch per registration, so a column with a composite key is simpler and keeps the centre equal by construction.
*   **Capacity in the app only.** Rejected: a database guard costs one trigger and closes direct paths.

## Risks and Limits

*   The capacity trigger counts per statement at commit. Two concurrent placements serialise on the batch row lock taken by the app first.
*   The restrictive update policy on `registration` must be widened when a later piece (course change) updates other columns.
*   Learners whose registration leaves ACTIVE keep their `batch_id`. They no longer count towards capacity.
