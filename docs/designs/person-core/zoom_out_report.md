# EGM Stage 5: Zoom-Out report (person core)

- **Target:** `docs/designs/person-core/person-core.md`, full file (321 lines, commit `cb040d1`)
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`.
  - Also read: the brief, `numbering.ts`, `action.ts`, migrations 0001/0002/0007/0009, and every use of `ticket_number_series`.
- **Date:** 2026-10-28
- **Result:** **1 Blocker, 4 Major, 5 Nit** (Z1–Z10).

The reviewer found the shape right and minimal. It reuses `allocate()`, `scopedAction()`, the RLS loop and `scoped_centre_ids`, and scopes persons through admissions with no new privileged function. Generalising the ticket counter was judged the correct choice. DD-1 and DD-3 were not challenged; DD-2 is challenged by Z1.

## Findings and proposed resolution

| ID | Sev | Finding | Proposed resolution |
|---|---|---|---|
| Z1 | **Blocker** | Admission No clashes between centres. The series is per centre and year but the prefix is year only (`GTEC2627`), while `admission_no` is unique network-wide, so centre B's first admission equals centre A's. Line 97 ("per centre and year") contradicts line 272 (year only). The legacy single "current 43,887" suggests one network-wide run | **OWNER:** make Admission No one **network-wide series per academic year**: `allocateGlobal(tx, "ADMISSION", academicYear)`, formatted `GTEC2627` + sequence. This removes the per-centre `number_series` rows, their fixture seeding and the "missing series" test. Add a two-centre same-year test to T-PER-003. Changes DD-2 |
| Z2 | Major | A centre-to-centre move cannot be "the same person". The new centre cannot see the person (no admission there yet; DD-1), so it can neither pass `existingId` nor find them as a duplicate. Moves would recreate DR-05 duplicates | **OWNER:** only an **HO (ALL-scope) user** admits an existing person at a new centre. HO sees everyone, so no new code is needed. A centre user creates a new person, caught later by the merge process. Fix the "moves" line; add a T-PER-001 case |
| Z3 | Major | The upsert silently starts `REGISTER` at 1. A forgotten NP-8 seed would issue Register Nos 1, 2, 3… beside legacy 2,000,001+. This is inconsistent with fail-loud elsewhere | Seed `('REGISTER', 'ALL', start − 1)` in 0011, with the start value PMC (NP-8). `allocateGlobal(…, { mustExist: true })` for REGISTER and ADMISSION fails loudly on a missing row; TICKET keeps the upsert |
| Z4 | Major | Academic year is free text. `2026-27`, `2026-2027` and `26-27` would open three series and break the prefix. R-028 / D-YEAR-3 are not mentioned | A check `^\d{4}-\d{2}$` (the second part being the next year), validated in `admit`. List the Academic Year Master (R-028, D-YEAR-3) under Non-Goals |
| Z5 | Major | A trigger enforces what a native constraint does | Composite foreign key `registration(admission_id, centre_id) → admission(id, centre_id)`, with unique `(id, centre_id)` on admission (mirrored in Prisma). Drop `registration_guard()` |
| Z6 | Nit | "generated column" (Technical Plan) vs "trigger" (item 3) | Technical Plan says "a derived, indexed key kept in the database"; the mechanism is stated in item 4 |
| Z7 | Nit | `updateIdentity` (direct HO edit) has no Stage 2 consumer; G5 is proven through `changeIdentity(tx, …)` | **OWNER:** drop `updateIdentity`, `student.identity.edit`, role 18 and the `person.identity.update` audit action until a Stage 3 HO screen needs them |
| Z8 | Nit | `ticket-engine.md` still names `ticket_number_series` / `allocateTicketNumber` | Add it to Q1 with a superseded note |
| Z9 | Nit | `register_no` type not stated | `text` (NP-2/NP-7 may add a prefix later; Admission No is already text) |
| Z10 | Nit | The grants text implies the database forces writes through `changeIdentity` | Reword: a column-level grant; only `changeIdentity` writes them by convention. The sequence remark moves to item 4 |

## Resolution

**Status: resolved (2026-10-28).**

**Owner decisions:**
- **Z1:** Admission No network-wide per academic year; DD-2 updated.
- **Z2:** only HO links an existing person at a new centre (new DD-4).
- **Z7:** no direct HO edit in Stage 2 (new DD-5).

**Applied with them:**
- **Z3:** the `REGISTER` row is seeded in 0011; ADMISSION and REGISTER rows use `mustExist`.
- **Z4:** an academic-year format check; R-028 / D-YEAR-3 listed under Non-Goals.
- **Z5:** a composite foreign key replaces the trigger.
- **Z6:** wording.
- **Z8:** item 2a, a superseded note in `ticket-engine.md`.
- **Z9:** `register_no` is text.
- **Z10:** the grants wording.

**New tests** in item 8: two centres in the same year, the HO move, a missing row failing loudly, and an academic-year format.
