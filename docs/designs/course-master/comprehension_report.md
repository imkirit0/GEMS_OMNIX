# EGM Stage 6: Comprehension report (course master)

- **Target:** `docs/designs/course-master/course-master.md` (commit `2950039`, after step 5).
- **Reviewer:** `egm-comprehension` (fresh context, naive reader). Read the design, `catalogue.ts`, the `people.ts` admit sections, `rbac.ts`, `admin-http.ts`, `tickets/setup.ts`, `app/admin/ticket-types/**`, `app/page.tsx`, `page-read.ts`, migrations 0002, 0009, 0012, `schema.prisma`, `tests/catalogue.test.ts`, `tests/foundation.test.ts`, `tests/audit-catalogue.ts`, `etl/rules/registration.ts`, `etl/run.ts`, `scripts/etl/setup.sql` (the catalogue-skeleton design by grep only). A first run was stopped by the owner before reporting; this is the second run.
- **Date:** 2026-10-29
- **Result:** **2 Blocker, 11 Major, 6 Nit** (C1–C19); OWNER on C3, C9, C10, C15. Verdict: data model and decisions clear; the share's privacy mechanism contradicted itself, and the function contracts were missing.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Blocker | The share "read back as `keltron_share::float8`" contradicts its own revoked column grant (42501 → 404) | Read only through `app.course_keltron_share(id)::float8` |
| C2 | Blocker | Definer function unspecified; the repo's usual `stable` would return null in the create audit | Full SQL, `volatile`, grants, T-RLS-005 position; create audit takes the share from the input |
| C3 | Major, OWNER | Effect of the column grant on existing queries; `gems_etl` reads the share | Queries checked and listed; Prisma model API banned for `course`; **owner: migration role may read it (DD-14)** |
| C4 | Major | `CourseDetails` untyped | Exact type; create takes `Partial`, absent = default; third decimal refused |
| C5 | Major | Absent vs null; Keltron rule on partial updates | absent unchanged, null clears; rules on the merged row |
| C6 | Major | Messages not listed | Field → message table |
| C7 | Major | Form mapping missing | Mapping rules stated |
| C8 | Major | Duration rules and summary undefined | Counts independent of type; summary format given |
| C9 | Major, OWNER | Availability SQL, order, inactive classes | SQL stated, before the duplicate lookup; **owner: only active classes allow sales (DD-15)** |
| C10 | Major, OWNER | `admitOptions` changes | `active and visible`; **owner: filter by availability when on (DD-16)** |
| C11 | Major | "As `listTypes`" contradicts the code (it authorises); unknown id → 500 | Plain reads; `canManage`; unknown id → `Forbidden` (404) |
| C12 | Major | Page routes and non-manager view incomplete | Route table; read-only for non-managers; code read-only |
| C13 | Major | The `detail` change in `adminPost` underspecified and global | Prefix regex, labels in the course form module, generic text moved |
| C14 | Nit | "Every column" vs `created_at` | Except `created_at` |
| C15 | Nit, OWNER | The share in audit rows | **Owner: kept (DD-17)** |
| C16 | Nit | `setCourseClasses` audit shape and duplicate message | Stated |
| C17 | Nit | No per-permission helper for the home link | `canManageCatalogue()` |
| C18 | Nit | Test-ID drift | T-CM-001…006 mapped to goals |
| C19 | Nit | List filter semantics | Stated |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: C3 → DD-14, C9 → DD-15, C10 → DD-16, C15 → DD-17. All 19 applied; the Technical Plan was rewritten with the contracts.
