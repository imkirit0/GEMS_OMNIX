# Fee dues: EGM step 9 implementation readiness report

**Reviewed:** commit af6bd89, 2026-10-30.

**Verdict:** ready with fixes.

**Confirmed against the code:**
* Functions: `resolvePlan` (fees.ts:354), `scopedAction`, `authorize` and `RbacError`, as well as `adminPost`, `ADMIN_MESSAGES` (admin-http.ts) and `getPerson` (people.ts:165).
* Migrations:
  * the guard style and grants of 0025;
  * the unique key `fee_plan_line_plan_id_fee_type_id_caption_id_key` (0025:95);
  * `ticket_immutable`, `scoped_centre_ids`, `has_permission` and `session_user_id`.
* Schema: the `RegistrationStatus` values `ACTIVE`, `DROP`, `LEAVE` and `TRANSFER`; `admission.academic_year`; `centre.centre_class_id`.
* Other: the cascade into registration (0011:86); role 29 and user `…00f7` are free; T-RLS-002 picks the table up automatically; `inr()`.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Major | `adminPost` turns every `RbacError` into `?error=`, so the route can never return a 404. | The pre-flight throws `PersonError("notfound")`. `adminPost` gains a `PersonError` notfound → 404 branch, next to the `TicketNotFound` branch. |
| R2 | Major | RLS on registration uses `visible_centre_ids()`. A `centre_admin` would find the registration, then get Forbidden instead of 404, and `duesForPerson` would show it. | Add `r.centre_id = any (app.scoped_centre_ids('student.view'))` to both queries. |
| R3 | Major | Prisma needs a back-relation on `FeePlanLine` for the composite foreign key, and the `@default`s are not stated. | Add `FeePlanLine.dues`, then the `line` relation on `FeeDue`, then `createdAt @default(now())`. |
| R4 | Minor | The `seedFeePlan()` contract is undefined. | Use two helpers. `seedMasters()` returns `{ catId, course, reg, i1, i2 }`. `seedFeePlan()` publishes the plan and returns `{ planId, lines, total }`. |
| R5 | Minor | The fixture edits are not listed. | List them: the permission, role 29, its grants, `FD`, the assignment, `tok-feeD`, and the truncate list. |
| R6 | Minor | The SQL that reads the line and the caption is missing, along with the case where no row is found. | Write out the query. When no row is found, raise `fee_due_match_guard` with errcode 23514. |
| R7 | Nit | `planId` is defined inconsistently, and nothing consumes it. | Drop it. |
| R8 | Nit | The page placement is undefined (registrations are `<tr>` rows), and the route file and `safeRoute` are not stated. | Add a full-width row per registration. Put the route in `app/students/[personId]/dues/route.ts` as `POST = safeRoute(handle)`. |
