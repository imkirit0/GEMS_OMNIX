# EGM Stage 7: Critic report (enquiry)

- **Target:** `docs/designs/enquiry/enquiry.md` (commit `495bd82`, after steps 5–6).
- **Reviewer:** `egm-design` (fresh context, adversarial). It read every file in scope, plus `scripts/ci.sh` and `schema.prisma`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 6 Major, 12 Nit** (D1–D18); no OWNER items; DD-1…DD-15 stand.
- **Held up:**
  - **Access:**
    - The RLS expressions are sound; UPDATE and the lock need the select policy.
    - Foreign-key checks on `app_user` bypass RLS.
    - The definer functions check the caller and leak nothing beyond the counsellor list.
  - **Concurrency:** admit's lock order adds no deadlock cycle with the ADMISSION counter.
  - **Error paths:**
    - The admit step order gives no oracle.
    - Bulk "one centre" gives the same message for hidden and other-centre ids.
  - **Enrol path:**
    - The Enroll URL carries only the id.
    - A resubmit still reports "saved".
  - **Integrity:** `ticket_immutable` is generic; the composite follow-up FK and the grants are right.
  - **Setup:** `enquiry.setup` triggers TOTP.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major | DD-15 breakable by a race (edit, counsellor or follow-up after Enroll commits) | Ordered row lock first in every write; guard refuses updates of enrolled rows; follow-up insert trigger |
| D2 | Major | Guard refusals in races become 500s; overlapping bulk writes can deadlock | Ordered locks; P0001 mapped to `enquiry: enrolled` |
| D3 | Major | The duplicate warning is an unaudited, unthrottled learner lookup by mobile | FAILED audit row with ids only and a search-limit hit, written in `onFailure` |
| D4 | Major | A plain 10-digit mobile matched the id rule | One OR query |
| D5 | Major | A hand-written partial index would fail the drift gate | Trigger instead of the index |
| D6 | Major | Status master errors unmapped by `adminPost` | `RbacError` messages listed |
| D7 | Nit | Enquiry–admission centre tie only in code | Composite FK |
| D8 | Nit | DENIED row names the wrong permission; unvalidated `enquiryId` | `Forbidden("enquiry.manage denied")` with detail; id format checked |
| D9 | Nit | Computed action names defeat the audit gate | Literal actions; scan list |
| D10 | Nit | Type contradictions; unknown `targetId` on create | Fixed; `nextval` first |
| D11 | Nit | A follow-up without a date wiped the reminder | Changes only when present |
| D12 | Nit | Insert guard allowed LOST/JUNK | OPEN only |
| D13 | Nit | No database checks on normalised contact fields | Named checks |
| D14 | Nit | No indexes | Listed, in `schema.prisma` |
| D15 | Nit | Name lookup per centre | By enquiry ids |
| D16 | Nit | Manage-only roles silently matched 0 rows | Select policy accepts either permission |
| D17 | Nit | Pre-filled course rows without dates block the form | Only preference 1 filled; others listed |
| D18 | Nit | Last active status of a kind; missing parity smoke | Trigger refuses; two smoke checks |

## Resolution

**Status: resolved (2026-10-29).** All eighteen applied as the Technical Plan's "Contracts (step 7)".
