# EGM Stage 6: Comprehension report (centre onboarding)

- **Target:** `centre-onboarding.md` (commit `a384097`; in parallel with steps 5 and 7).
- **Reviewer:** `egm-comprehension` (fresh context, naive implementer).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 8 Major (1 OWNER), 7 Minor, 2 Nit** (C1–C17).

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Major, OWNER | Sign-in already blocked | As Z1 |
| C2 | Major | RETURNING fails RLS | As Z2 |
| C3 | Major | Gate position and message mapping | Exact placement and form messages |
| C4 | Major | Enquiry picker not filtered | `manage` and ACTIVE |
| C5 | Major | Clearing a phone undefined | Kept once set; type changed |
| C6 | Major | One GST message for two cases; check order | Per-field messages; order stated |
| C7 | Major | `insert(status)` bypasses the checklist | Dropped from the grant |
| C8 | Major | Duplicate keys and texts | By constraint name; texts |
| C9 | Minor | Area has no active flag; name rules | `unknown`; 1–100 |
| C10 | Minor | Pre-check form | `string_agg` and raise |
| C11 | Minor | 0018 constants; email length | Redeclared; message |
| C12 | Minor | Area move widens scope | Removed |
| C13 | Minor | Route shapes | Stated |
| C14 | Minor | T-AUD-009 regex | Stated |
| C15 | Minor | T-SEC-007 split | Stated |
| C16 | Nit | Gate race | Accepted (catalogue DD-13) |
| C17 | Nit | No centre code check | Added with pre-check |

**Status: resolved (2026-10-29).**
