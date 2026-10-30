# Fee structure: EGM step 6 comprehension report

Reviewed commit bf9fa16 on 2026-10-30, in parallel with steps 5 and 7.

**Verdict:** needs revision. The review found 2 blockers, 13 major findings and 1 nit. The design revision commit records how each one is resolved.

These points were confirmed against the code:
* Migration 0025 is the next free number.
* `fee_plan` has a centre column, so T-RLS-002 applies to it.
* `system_admin` exists (migration 0013).

| ID | Severity | Finding | Proposed resolution |
|---|---|---|---|
| C1 | Blocker | Column types, nullability, defaults and FK targets are missing. `fee_plan_line` has no primary key, and the composite FK needs `unique (id, academic_year)` on `fee_plan`. | Write a full column spec for every table. |
| C2 | Blocker | The unique keys are not SQL. A NULL class or centre column defeats a plain unique key. `max + 1` races. The draft policy is not stated. | Use partial unique indexes, or `nulls not distinct`. Lock the key. State the draft policy. |
| C3 | Major | `copyFrom` is undefined: same key? same year? which status? what about inactive masters? | Define it. |
| C4 | Major | The checks in `createPlan` are not listed: course, class, year open, centre. | List each check with its error. |
| C5 | Major | The caption rules are missing: whether the due date must fall within the year, uniqueness, down payment, whether the year can change. | State them. |
| C6 | Major | The design's name limit (1–100) contradicts catalogue `name()` (1–200). The code rule is not named. | Name the helpers or limits to use. |
| C7 | Major | `db()` maps every 23514 to "invalid value", and `unique()` to `catalogue.duplicate`. There are no `fee.*` message keys. | Add the error keys and their texts. |
| C8 | Major | Decimal output gives "0.3" where "0.30" is wanted. Where sums are computed, and the display format, are not stated. | Return amounts as `amount::text`, sum in SQL, and define the display format. |
| C9 | Major | Audit shapes are given for publishing only, and the T-AUD-009 scan entry is missing. | Add an audit table. |
| C10 | Major | It is unclear whether the publish function is invoker or definer. The lock cannot be taken on an id that is not yet known. The source of `published_by` is not given. | Specify all three. |
| C11 | Major | Deleting a draft "together with its lines" conflicts with the line guard. | Delete the lines explicitly, or use a cascade with a guard rule for it. |
| C12 | Major | The RLS SQL is not given. ENABLE and FORCE are not stated. The edit to the T-RLS-002 list is not given. | Give them. |
| C13 | Major | For `resolvePlan`: which session it runs under, what happens when a centre has no class, and what happens when the key has only a draft. | Specify each case. |
| C14 | Major | Pages and routes are undefined. | Add a route table. |
| C15 | Major | Fixtures are not named: role, user, token, truncate list, seed data. | Name them. |
| C16 | Nit | The filter shape is not given. Several dropped legacy items are not listed under Non-Goals. Other small rules are missing. | Clarify each one. |
