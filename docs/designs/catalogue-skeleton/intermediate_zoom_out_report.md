# EGM Stage 8: Intermediate zoom-out report (catalogue skeleton)

- **Target:** `docs/designs/catalogue-skeleton/catalogue-skeleton.md`, full file (424 lines, commit `172281a`).
- **Reviewer:** `egm-zoom-out` (fresh context), standard `zoom-out-standard.md`. Also read the three earlier reports, `people.ts`, `rbac.ts`, `tickets/setup.ts`, 0009's lock and setup policies, the ETL runner and rules, fixtures, `bootstrap-admin.mjs`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 2 Major, 3 Nit** (Z8–Z12); 2 OWNER (Z8, Z9).

The reviewer found the growth since Stage 5 to be contract detail the comprehension review asked for, and the patterns reused correctly; one fix added a mechanism with no observable benefit, and one fix missed existing databases.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z8 | Major, OWNER | `app.catalogue_admit_lock` (critic D2) prevents nothing observable: an in-flight admission completing after a close equals one committing just before it, which the design already accepts | **Owner: removed (DD-13).** Plain reads in `admit()`; accepted risk row; function, grant, inventory entry, concurrency test and mutation dropped |
| Z9 | Major, OWNER | DD-12 only helped databases bootstrapped later; existing ones could never get a `catalogue.manage` holder | **Owner: migration 0012 also grants it to the existing `system_admin` role;** the gap for `ticket.type.manage` and `student.admit` recorded as a follow-up |
| Z10 | Nit | "Caller receives the stored code" but creates returned only `{ id }` | Creates return `{ id, code }` |
| Z11 | Nit | `db()` does not read constraint names | Wording |
| Z12 | Nit | Agreement test larger than the guarantee | Two conditions |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: Z8 → DD-13 (no admission lock), Z9 → migration grant to `system_admin`. All five applied.
