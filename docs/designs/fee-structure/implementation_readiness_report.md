# Fee structure: EGM step 9 implementation readiness report

Reviewed on 2026-10-30 at HEAD fa37a4d.

**Verdict: not ready as written.** There are 2 blockers and 6 major findings. Each one needs only a short change to the design. The fixes are recorded in the design's "Build notes (step 9)" section.

## Findings

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Blocker | In SQL, `'K' \|\| class \|\| 'C' \|\| centre` is NULL, because one side is always NULL. The advisory lock then takes no lock. | Build the key in TypeScript. Use the same key in create, publish and delete. |
| R2 | Blocker | `schema.prisma` cannot express partial unique indexes, so the drift gate would drop them. | Use plain `@@unique` for the version keys (NULLs count as distinct). Enforce one draft per key in a guard branch. |
| R3 | Major | The grants are incomplete: no sequence `usage`, no `delete` on plans, no column lists. | Write out the grants for each table. |
| R4 | Major | Deactivating a type or caption is not guarded, so the I2 expectation is undefined. | Define both race orders. A deactivation after a publish succeeds. |
| R5 | Major | Role 27 clashes with roles inserted by other test files, and the fixtures lack the `fee.setup` permission. | Use role 28 and user `…00f6`, and add the permission to the fixtures. |
| R6 | Major | Nothing truncates the fee tables between tests. | Add them to the fixtures truncate. |
| R7 | Major | The offering rule is underspecified, and `admit()` enforces it only behind a gate. | Use shared `offeredAtCentre` and `offeredInClass` fragments, which `createPlan` always enforces. |
| R8 | Major | There are no smoke checks. | Add them (see S3). |
| R9 | Nit | `fee.plan.order` cannot be reached. | Drop it. |
| R10 | Nit | `fee_category` has no named checks. | Add code and name checks. |
| R11 | Nit | The rate input format is not specified. | A string matching `^\d{1,3}(\.\d{1,4})?$`, normalised and checked against the list. |
| R12 | Nit | Which fee-type fields are updatable is not stated. | Name, order, `hsn_sac` and rate. The category is fixed. |
| R13 | Nit | Totals and the money formatter are not specified. | `sum()::text` totals; `inr()` in `src/lib/money.ts`; field labels. |
| R14 | Nit | The currency on create is not stated. | Always INR in F1; a new version copies it. |
| R15 | Nit | The caption guard is not scoped. | `before update of due_on … when (distinct)`, written with nested ifs. |

## Plan

1. **S1, documents**
   * Audit 09: add the T-FS rows.
   * `matrix-05`: lines 1, 2, 8, 10 and 37.
   * Regenerate the outputs.
2. **S2, database, server and tests**
   * `schema.prisma` and migration 0025: checks, guards, RLS, permission, grants.
   * The people.ts fragments, the catalogue `MasterKind`, `fees.ts`, and the messages.
   * Fixtures and existing tests; the new test file.
3. **S3, pages, routes and smoke checks**
4. **S4, 38 mutation checks**
