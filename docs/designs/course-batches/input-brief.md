# Course batches and time slots (ninth Stage 3 piece, WF-X19): input brief for `egm-draft`

Prepared 2026-10-30 from the SPEC (pp. 31–32), the WF PDF (p. 6) and the built code. Roadmap order (owner: "go in order"): Stage 3 is WF1, WF2, WF3, WF7, WF-X4, X13, X14, X16, X19 (audit 10).

Evidence classes: SRC, INF, PRO, PMC. Nothing here is approved.

## 1. Why this piece now (INF; recommended option under the owner's standing instruction of 2026-10-29)
- **WF7 (course change) waits.** The course change ticket moves fees between registrations. D-STU-2 is a production gate ("paid amounts reversed and reallocated"), and fees are Stage 4 behind G-FIN. Building it now means rebuilding it with fees. The identity corrections of WF7 are built (E-039).
- **WF-X4, X13, X14, X16:**
  - The enquiry funnel (E-042) covers R-081, R-084 and R-085.
  - User, role and credential administration exist (WF-X13, WF-X14).
  - R-214 and R-215 (CRM ticket and profile) are REC with "fields not described".
  - R-080 (front-office masters) has "usage unchecked".
- **WF-X19 (R-155) is fully specified (SRC).** It needs no fees, and the academic pieces of Stage 7 build on it: faculty assign (R-152.02) and attendance marking (R-152.03) both pick a batch. WF3 says that after activation "the centre … creates batches and faculty, then enquiries and admissions begin".

## 2. What it is (SRC)
- **R-155 Create Course Batch** (SPEC p. 31): Centre, Batch Name, Batch Code, Time Slot, Maximum Number, Custom Batch. The list shows Sl.No, Batch Name, Batch Code, Time Slot and Action.
- **R-155 Timeslot Updation** (SPEC p. 32):
  - Filters: Centre, Course Name, Batch, Custom Time Slot, then Search.
  - The table shows #, Student Name, Admission No, Reg No, Batch Name and Time Slot, with Update and Reports.
  - That is, a centre places its learners' course registrations into batches.
- **Legacy:** batches are IMPORTED (matrix). Migration is paused (owner, 2026-10-29).

## 3. What exists (SRC, code)
- `app.registration` (person-core, 0011): one per admitted course.
  - Columns: `centre_id`, `course_code`, `register_no`, `status` (ACTIVE, DROP, LEAVE, TRANSFER), join and end dates.
  - RLS uses the 0002 loop by `centre_id`. `gems_app` has select and insert only, so no app path updates a registration today.
- Admissions and learners: `/students` and `/students/[personId]` (`student.view`, `student.admit`).
- Centres, courses and centre classes, each with its own permissions.

## 4. Decisions taken under the owner's standing instruction (2026-10-29)
These are recommended options, recorded as such, not as owner signatures. Business rules among them stay PMC.

- **DD-1: a batch belongs to one centre.**
  - Fields: a code unique within the centre, a name, a time slot (start and end time of day), a capacity ("Maximum Number"), and active.
  - A batch is not tied to a course, as in the SPEC form. Batches are deactivated, never deleted.
- **DD-2: a new centre-scoped permission, `batch.manage`.**
  - It creates, edits and (de)activates batches.
  - It places registrations at that centre into a batch, moves them and removes them.
  - Anyone with `student.view` at the centre may read its batches and the batch of each registration.
- **DD-3: placing learners.**
  - Only ACTIVE registrations, only into an active batch of the same centre.
  - The batch's capacity is never exceeded.
  - Each change is audited.
  - A registration has at most one batch.
- **DD-4: out of scope:**
  - "Custom Batch" and "Custom Time Slot" (meaning unclear; PRO to confirm);
  - weekdays and timetables;
  - faculty assign, attendance and reports (Stage 7);
  - the legacy import (paused).
