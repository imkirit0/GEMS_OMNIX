# EGM Stage 6: Comprehension report (enquiry)

- **Target:** `docs/designs/enquiry/enquiry.md` (commit `efb7dc2`, after step 5).
- **Reviewer:** `egm-comprehension` (fresh context, naive implementer). It read the design, the brief and the step 5 report, and checked them against:
  - server code: `people.ts`, `person-rules.ts`, `details.ts`, `admission-form.ts`, `catalogue.ts`, `action.ts`, `rbac.ts`, `rate-limit.ts`, `admin-http.ts`, `page-read.ts`;
  - pages: the student and catalogue pages;
  - migrations 0002, 0009, 0011, 0012, 0013, 0015 and 0017;
  - tests: the fixtures, foundation and audit tests.
- **Date:** 2026-10-29
- **Result:** **3 Blocker, 12 Major (1 OWNER), 5 Nit** (C1–C20). Verdict: not buildable from the text before these contracts. All are resolved.
- **Clear:**
  - The scope, the non-goals and DD-1…DD-14.
  - Enroll reuses `admit()`.
  - The update rules of the guard.
  - The detail-key columns.
  - The POST-only search.
  - All-or-nothing bulk actions.
  - The append-only follow-ups.
  - The shape of the masters registry.
  - `canEnrol`.
  - The test list.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Blocker | RLS text contradicted itself (loop vs permission); UPDATE also needs the select policy | Exact policy expressions; `manage` holders hold `view` |
| C2 | Blocker | No input or return types; field messages undefined | Types and the message list |
| C3 | Blocker | Seeds lacked codes, colours, order | Seed table (14 paths; 2 unknown) |
| C4 | Major | Bulk and single-id writes do not fit one `scopedAction` centre | Read the centre first; bulk ids at one centre |
| C5 | Major | Warnings returned inside the action would be audited OK | `SameMobile` thrown, not audited; warning shape; `confirm` lists shown ids |
| C6 | Major | Guard left inserts open; follow-up centre untied | Guard on insert too; composite FK |
| C7 | Major | `enquiry_may_receive` had no caller check | `enquiry.view` required; grants; T-RLS-005 |
| C8 | Major | `admit()` change underspecified | Order, the lock query, messages, `ADMIT_MESSAGES` |
| C9 | Major | Enroll page undefined | URL rule, 404 cases, pre-fill keys, hidden field |
| C10 | Major, OWNER | Lifecycle of closed and enrolled enquiries undecided | **Owner: DD-15** (enrolled frozen; lost/junk reopenable; create open only) |
| C11 | Major | Tests not set up-able (fixtures truncate permissions) | Fixtures, roles 19–21, users and tokens, audit scan |
| C12 | Major | A bigint id breaks `JSON.stringify` in audit | Ids as text |
| C13 | Major | The list's parameters, row and search undefined | Stated |
| C14 | Major | The step-up flow and slugs for setup | Route via `adminPost`; per-kind `canManage`; slugs |
| C15 | Nit | Sequence and column grants; ENROLLED row guarded only in code | Grants; a status trigger |
| C16 | Nit | "Sensitive" ambiguous (TOTP) | Only `enquiry.setup`; descriptions |
| C17 | Nit | Bookkeeping defaults | Stated |
| C18 | Nit | Preference course rule | Active and visible; check name |
| C19 | Nit | Calendar and home link | Month rule, shape, cap; `canViewEnquiries` |
| C20 | Nit | Drift and truncate | Prisma models; a no-truncate trigger |

## Resolution

**Status: resolved (2026-10-29).** Owner decision C10 is recorded as DD-15. All twenty are applied as the Technical Plan's "Contracts (step 6)".
