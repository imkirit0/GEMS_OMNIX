# Course batches and time slots (Stage 3, ninth piece, WF-X19)

*   **Author:** gtm
*   **Status:** Approved for build on 2026-10-30 after the EGM review (steps 5–9), under the owner's standing instruction of 2026-10-29. DD-1…DD-5 are recommended options taken under the same instruction. Reports: [`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md) (steps 5–7 in parallel), [`intermediate_zoom_out_report.md`](intermediate_zoom_out_report.md), [`implementation_readiness_report.md`](implementation_readiness_report.md) (R1–R14 applied at build).
*   **Date:** 2026-10-30

**Terms:**
*   Evidence classes follow `docs/audit/00-README.md`: SRC is the source spec; PMC is a proposed default that stays a parameter until its owner signs.
*   Limits, fixed lists and the 1–100 name rule are PMC.
*   Input: [`input-brief.md`](input-brief.md).

--------------------------------------------------------------------------------

## Overview

A centre keeps a list of batches. Each batch has a code, a name, a time of day, a capacity and an active flag. Staff place the learners' ACTIVE course registrations into batches (R-155, SRC).

Today a registration has no batch, and no app path updates a registration: `gems_app` has select and insert only (`0011_person_core/migration.sql:166`).

This piece adds:
*   the batch master;
*   one nullable column, `registration.batch_id`, guarded by one trigger;
*   two pages: Batches and Place learners.

## Goals

*   **G1:** at an active centre, a holder of `batch.manage` and `student.view` creates, edits, activates and deactivates that centre's batches. Each change is audited with values [T-CB-001].
*   **G2:** the same holder places ACTIVE registrations of that centre into an active batch, moves them, and removes them. Every change is audited [T-CB-002].
*   **G3:** the placement rules hold in the database for every writer, including direct SQL and concurrent writers:
    *   only `batch.manage` sets or changes a `batch_id`;
    *   only into an active batch of the same centre;
    *   only for an ACTIVE registration;
    *   no placement beyond capacity.

    Reading batches needs `student.view` at the centre (RLS). For placements the app enforces the same rule; registration rows keep their existing `visible_centre_ids` select policy [T-CB-001, T-CB-002].
*   **G4:** pages and routes check the origin and return field errors. A malformed, unknown or out-of-scope centre, batch or course parameter gives a 404 [T-CB-003].

## Non-Goals

*   "Custom Batch" and "Custom Time Slot" (meaning unclear; PRO to confirm), weekdays and timetables (DD-4).
*   Faculty assign (R-152.02), attendance (R-152.03) and batch reports (Stage 7).
*   Showing the batch on the learner page (later, with attendance).
*   The legacy batch import (paused).
*   A database check on *lowering* capacity: the app checks it under the batch lock (Risks).

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
  constraint batch_centre_id_code_key unique (centre_id, code),
  constraint batch_id_centre_id_key unique (id, centre_id)
);
alter table app.registration add column batch_id int;
alter table app.registration add constraint registration_batch_fkey
  foreign key (batch_id, centre_id) references app.batch (id, centre_id) on delete restrict;
create index registration_batch_id_idx on app.registration (batch_id);
```

**Named checks:**
*   `batch_code_check`: `code ~ '^[!-~]+( [!-~]+)*$' and code = upper(code) and length(code) <= 30`, as in 0019 and 0020.
*   `batch_name_check`: `name = btrim(name) and char_length(name) between 1 and 100`.
*   `batch_time_check`: `ends_at > starts_at and date_trunc('minute', starts_at) = starts_at and date_trunc('minute', ends_at) = ends_at`.
*   `batch_capacity_check`: `capacity between 1 and 500`.

**The composite foreign key** keeps a batch at its registration's own centre. A null `batch_id` is not checked (MATCH SIMPLE).

**`registration_batch_guard`** is one trigger: a plpgsql function with invoker rights, `set search_path = pg_catalog, app`, BEFORE INSERT OR UPDATE OF `batch_id, status, centre_id`, FOR EACH ROW, immediate. Its body:
1.  **Permission.** It applies when `current_user = 'gems_app'` and `new.batch_id is distinct from` the old value (on insert, the old value is null). It needs `app.has_permission('batch.manage', new.centre_id)`; otherwise it raises 42501 `batch needs batch.manage`.
    *   This follows 0020's `centre_write_guard`.
    *   The owner and `gems_etl` are unaffected.
    *   It closes the insert path too: `admit()` never sets `batch_id`.
2.  **Rules.** These apply to every role:
    *   When `batch_id` changes to a non-null value on a registration whose `new.status <> 'ACTIVE'`, it raises `23514` with constraint `batch_registration_guard` (I1).
    *   The remaining checks run when `new.batch_id is not null and new.status = 'ACTIVE'`, and either `batch_id` changed or the row is newly counted (status became ACTIVE, or the centre changed).
    *   It locks the batch: `select active, capacity from app.batch where id = new.batch_id for no key update`.
    *   `if not found or not active`: `raise exception 'batch inactive' using errcode = '23514', constraint = 'batch_active_guard'` (I2: fails closed).
    *   It counts `registration where batch_id = new.batch_id and status = 'ACTIVE' and id <> new.id`. If the count is ≥ capacity: `raise … using errcode = '23514', constraint = 'batch_capacity_guard'`.
3.  **Why this is concurrency-safe.** The function stays VOLATILE (the default), which this argument depends on. The batch row lock serialises writers, both the app and direct SQL. After the lock, the count statement takes a fresh snapshot under READ COMMITTED, so it sees the earlier writer's committed rows (D1).
4.  **Why the count is complete under invoker rights.** A caller can only write a row at a centre it can see, and a registration's batch is at the same centre (D9).

**RLS on `batch`:** its own per-command policies, in the codebase's initplan shape.
*   `select`: `centre_id = any ((select app.scoped_centre_ids('student.view'))::int[])`.
*   `insert` and `update`: `centre_id = any ((select app.scoped_centre_ids('batch.manage'))::int[])`, in both `using` and `with check`.
*   `delete`: `using (false)`. It exists only so T-RLS-002 sees four commands; there is no delete grant.
*   ENABLE and FORCE.

**Registration:** `grant update (batch_id) on app.registration to gems_app`.
*   The existing permissive `scope_update` limits a write to visible centres.
*   The guard limits it to `batch.manage`.
*   No restrictive policy (Z2, D4).

**Permission:** `('batch.manage', 'Create batches and place learners in them', false)`, plus the `system_admin` grant. Migration 0013 holds that every permission migration grants its new permission to `system_admin` (`admin-http.test.ts`).

**Grants:**
*   `select, insert (id, centre_id, code, name, starts_at, ends_at, capacity), update (name, starts_at, ends_at, capacity, active) on app.batch`;
*   `usage on sequence app.batch_id_seq`.

### Server (`src/server/batches.ts`)

**How writes run:**
*   Writes use `scopedAction` with `permission: "batch.manage"` and the centre. There is no step-up: this is routine centre work, as with enquiries.
*   Inside the callback, every write first calls `authorize(tx, "student.view", centreId)`, so placing always implies reading (Z3, D6, C3). A refusal is audited as DENIED, naming `student.view`.
*   Each callback then runs the trading gate: an INACTIVE centre gives `centreId: centre is not active` (Z7).

**When validation runs:**
*   Field rules run before any database access.
*   Checks on the merged row run after the row lock (C18).
*   An empty change set gives "nothing to change" before the database (C19).

**Errors** are `RbacError("invalid", "<field>: <rule>")`, built with catalogue's `bad`, `code` and `reasonOf`.

**`batchDb`** wraps every callback. It is private to `batches.ts` and copies the `centreDb` pattern (C5, Z6):
*   23505 on `batch_centre_id_code_key` becomes `RbacError("duplicate", …, "batch.duplicate")`;
*   23514 on `batch_capacity_guard` becomes `batchId: full`;
*   23514 on `batch_active_guard` becomes `batchId: inactive or unknown`;
*   23514 on `batch_registration_guard` becomes `registrationIds: not active here`;
*   any other 23514 becomes `RbacError("invalid", "invalid value")`;
*   42501 becomes `Forbidden`;
*   23503 on `registration_batch_fkey` becomes `batchId: inactive or unknown`.

```ts
type BatchRow = { id: number; code: string; name: string; startsAt: string; endsAt: string; capacity: number; active: boolean; placed: number };
type PlacementRow = { registrationId: string; registerNo: string; admissionNo: string; givenName: string; familyName: string | null;
  batchId: number | null; batchCode: string | null };
type BatchInput = { centreId: number; code: string; name: string; startsAt: string; endsAt: string; capacity: number };
type BatchChanges = Partial<Pick<BatchInput, "name" | "startsAt" | "endsAt" | "capacity">>;

batchCentres(session): Promise<{ id: number; code: string; name: string; active: boolean; canManage: boolean }[]>; // centres with student.view
listBatches(session, centreId): Promise<BatchRow[]>;                                   // Forbidden without student.view there; canManage comes from batchCentres (I5)
createBatch(session, input: BatchInput): Promise<{ id: number }>;                        // batch.create
updateBatch(session, centreId, id, changes: BatchChanges): Promise<void>;               // batch.update
setBatchActive(session, centreId, id, active: boolean, reason: string): Promise<void>;  // batch.activate / batch.deactivate
placementCourses(session, centreId): Promise<{ code: string; name: string }[]>;         // courses with ACTIVE registrations there
listPlacements(session, centreId, courseCode, batchId?: number):
  Promise<{ rows: PlacementRow[]; truncated: boolean }>;                                // Forbidden without student.view there
placeLearners(session, centreId, batchId: number | null, registrationIds: string[]): Promise<{ changed: number }>; // batch.place
```

**Times** are read as `to_char(starts_at, 'HH24:MI')`, and the same for `ends_at` (C16).

**`listPlacements`:**
*   It returns `registration` rows with `status = 'ACTIVE'`, `centre_id` and `course_code` matching, and optionally `batch_id` matching. They are joined to `admission` (`admission_no`) and `person` (names), plus a left join to `batch`.
*   Rows are ordered by `register_no`, limited to 500 (PMC); `truncated` is true when more exist.
*   An unknown course code returns no rows.

**Field rules, in this order:**

| Field | Rule | Message |
|---|---|---|
| `centreId` | A safe integer ≥ 1 | `centreId: unknown` |
| `code` (create only) | Catalogue `code()` | The catalogue code messages |
| `name` | btrim, 1–100 (a new rule, PMC) | `name: 1-100 characters` |
| `startsAt`, `endsAt` | `^([01]\d\|2[0-3]):[0-5]\d$` | `<field>: HH:MM` |
| Time order (merged row) | `endsAt` after `startsAt` | `endsAt: after startsAt` |
| `capacity` | Integer 1–500 (PMC) | `capacity: 1-500` |
| Capacity (merged row, under lock) | Not below the ACTIVE learners placed | `capacity: below the learners placed` |
| `batchId` (place) | null, or a safe integer ≥ 1; a target at another centre or inactive is refused by the guard and the FK (mapped by `batchDb`) | `batchId: inactive or unknown` |
| `registrationIds` | 1–200 distinct UUIDs | `registrationIds: 1-200 distinct ids` |
| Each registration (under lock) | At this centre and ACTIVE | `registrationIds: not active here` |
| Capacity (place) | Placed + newcomers ≤ capacity, checked by the guard trigger only (I4: one copy of the rule) | `batchId: full` |

**Writes:**
*   **`createBatch`:** `nextval('app.batch_id_seq')` runs first in a pre-flight `withScope`, so the id can be the audit target (C4, Z4). It then inserts with the explicit id and returns `{ id }`.
*   **`updateBatch`:** locks the batch `for no key update` where `id` and `centre_id` match; otherwise `notfound`. It then merges the changes, runs the merged checks, and gives "nothing to change" when nothing changed.
*   **`setBatchActive`:**
    *   Two literal calls, `batch.activate` and `batch.deactivate`.
    *   It needs a reason, and refuses "already active" or "already inactive".
    *   Placed learners stay in a deactivated batch; it only stops new placements.
*   **`placeLearners`:**
    *   It locks the target batch `for no key update` first, when a target is given, then the registrations `for no key update` in id order (D5). `admit()` takes no batch or registration locks, so there is no cycle.
    *   The source batch's state is not checked, so learners can be moved out of an inactive batch (C8).
    *   Rows already in the target, or with no batch when removing, are skipped. If every row is skipped: "nothing to change".
    *   It runs one `update … set batch_id = $1 where id = any(…)`. The trigger re-checks the rules.

**Audit (C6, D10).** Values only; register numbers but no names:

| Action | targetType / targetId | before | after | reason |
|---|---|---|---|---|
| `batch.create` | `batch` / id | — | `{ code, name, startsAt, endsAt, capacity, active: true }` | — |
| `batch.update` | `batch` / id | changed fields | changed fields | — |
| `batch.activate`, `batch.deactivate` | `batch` / id | `{ active }` | `{ active }` | required |
| `batch.place` | `batch` / target id, or `centre` / centre id when removing | `{ <registerNo>: oldCode \| null }` | `{ batch: code \| null, registerNos: [...] }` (sorted) | — |

### Pages and routes

Every page parses its parameters itself and calls `notFound()` (C12, D11) when:
*   a parameter is malformed;
*   the centre is not in `batchCentres`;
*   a `batch` is not one of that centre's batches;
*   a `course` is not one of `placementCourses`.

| Route | What |
|---|---|
| `/batches` | The centre picker, from `batchCentres`. A 404 when the list is empty. One centre goes straight to it. |
| `/batches?centre=<id>` | That centre's batches. Managers also get an add form, a per-row edit form, and Activate/Deactivate with a reason. An inactive centre shows "This centre is not active." and no forms (DD-5; learners stay in its batches). |
| `/batches/place?centre=<id>[&course=<code>[&batch=<id>]]` | The course picker (`placementCourses`). With `course`, the list; `batch` **filters** the list to that batch (C10). Managers get tick boxes, a target select (the active batches, or "No batch") and Save. |
| `POST /batches/save` | `adminPost`; back `/batches?centre=<centreId>`; success `…&saved=1` ("Saved."). |
| `POST /batches/place/save` | `adminPost`; back and success are the place page with `centre`, `course` and `batch` as posted; success adds `saved=1` ("Saved."). |

**Fields posted to `/batches/save` (C13):**
*   `op=create`: `centreId, code, name, startsAt, endsAt, capacity`.
*   `op=update`: `centreId, id, name, startsAt, endsAt, capacity`.
*   `op=active`: `centreId, id, active` (`flag()`: "1" or "0"), `reason`.

**Fields posted to `/batches/place/save`:** `centreId, course, filterBatch, batchId` (`""` is null), and `registrationId` repeated.

**Conversions:** `Number()` for ids and capacity; times are posted as strings.

**Other route behaviour:**
*   An unknown `op` gives `op: unknown`.
*   `ADMIN_MESSAGES` gains `batch.duplicate` ("That centre already has a batch with that code.").
*   The home page links Batches when `batchCentres` is not empty.

### Tests (`tests/course-batches.test.ts`)

**Fixtures (C1, C2, Z5):**
*   The permission row `('batch.manage', 'Create batches and place learners in them', false)`.
*   Role `(26, 'batch_manager', 'Batch manager')`, which holds `batch.manage` and `student.view`.
*   Users `bmA` (CENTRE 1) and `bmR1` (REGION 1), with tokens `tok-bmA` and `tok-bmR1`.
*   The viewer is `tok-stuA` (role 17, centre A). `tok-uA` has no `student.view`, so it is refused.

| ID | Goal | What it does | Expected |
|---|---|---|---|
| T-CB-001 | G1, G3 | Create, edit, (de)activate; each message in order; the code is unique per centre (the same code at centre B is fine); capacity below placed; refusals at an inactive centre; who may (bmA not at B; stuA reads but cannot write; uA nothing; bmR1 at A2); RLS and its four commands; direct inserts against the named checks | Audit values; messages; 42501 or 0 rows; 23514 by name |
| T-CB-002 | G2, G3 | Place, move, remove (also out of an inactive batch); refuse an inactive target, another centre, a non-ACTIVE registration, a full batch; nothing to change. By SQL as gems_app: a stuA update of `batch_id` is refused (42501); a bmA update into a full or inactive batch gives 23514 by name; a `student.admit` insert with a `batch_id` is refused; a status changed back to ACTIVE over capacity is refused; two concurrent sessions cannot overfill | As listed |
| T-CB-003 | G4 | Routes for each op; a foreign Origin gives 403; field `detail`; unknown op; the place route with repeated ids | As listed |

**Existing tests that change:**
*   T-RLS-002 adds `batch` to its table list.
*   T-RLS-005: unchanged (the guard has invoker rights).
*   T-AUD-009 scans `src/server/batches.ts` for `"(batch\.[a-z0-9_.]+)"`. The audit catalogue gains `batch.create`, `batch.update`, `batch.activate`, `batch.deactivate` and `batch.place`.
*   `reset.sql` truncates `app.batch`.

**Real-server smoke:**
*   `/batches?centre=<B>` gives 404 for A's viewer;
*   the place page lists a seeded registration;
*   a foreign-origin save gives 403.

## Decisions

1.  **DD-1:** a batch belongs to one centre, with its code unique within that centre. Its time slot is a start and an end time, plus a capacity and an active flag. It is not tied to a course (the SRC form).
2.  **DD-2:** `batch.manage` is centre-scoped and not sensitive. Reading and writing both need `student.view` at the centre. Role 26 holds both.
3.  **DD-3:** only an ACTIVE registration goes into an active batch of its own centre. Capacity is never exceeded, a registration has at most one batch, and every change is audited. All of this is enforced in the database.
4.  **DD-4:** custom batches, custom time slots and weekdays are out of scope.
5.  **DD-5 (Z7):** no batch writes at an inactive centre, as with the trading gate (centre onboarding DD-3).

All five are recommended options taken under the standing instruction.

## Alternatives Considered

*   **A batch tied to a course.** Rejected: the SPEC form has no course. Placement filters by course instead.
*   **A link table `batch_member`.** Rejected: a registration has at most one batch, so a column with a composite key keeps it at the same centre by construction.
*   **A restrictive update policy on `registration`.** Rejected (Z2, D4). It would block future column updates and the owner's writes under FORCE, and it leaves inserts open. A guard trigger, as in 0020, covers both paths.
*   **A deferred constraint trigger.** Rejected (Z1, D1, D8). It raises at COMMIT, outside the callback's error mapping, and is not race-safe without the lock.

## Risks and Limits

*   **Lowering capacity is checked only in the app**, under the batch lock. Direct SQL by a manager could lower it below the placed count. That leaves the batch over-full but harmless: no new placement passes.
*   **A centre transfer** that cascades `registration.centre_id` fails with 23503 while `batch_id` is set. The transfer must clear the batch first (D7).
*   **A future legacy batch import** must fit the named checks and the capacity rule, or record its exceptions (D12). Under invoker rights, the guard's lock needs UPDATE on `app.batch` for that role (I3).
*   **At a centre deactivated later, learners cannot be moved or removed** until it is active again (DD-5, I7: accepted).
*   **A writer that disables triggers** (`session_replication_role = replica`, owner only) skips the guard. This is out of scope.
*   **A deadlock** (40P01) from raw SQL is not retried by `withScope`. The fixed lock order (batch, then registrations by id) avoids one.
*   **A registration that leaves ACTIVE keeps its `batch_id`** and stops counting. If it becomes ACTIVE again, the guard re-checks capacity.
