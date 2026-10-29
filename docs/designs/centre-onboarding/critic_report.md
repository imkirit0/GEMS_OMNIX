# EGM Stage 7: Critic report (centre onboarding)

- **Target:** `centre-onboarding.md` (commit `a384097`; in parallel with steps 5 and 6).
- **Reviewer:** `egm-design` (fresh context, adversarial).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major (1 OWNER), 4 Minor, 3 Nit** (D1–D11).
- **Held up:**
  - Region and area RLS breaks no reader: the ETL bypasses RLS, the definer functions are owned by a bypass role, and `geo_select` has no TO clause.
  - The T-SEC-007 expectations are right.
  - Class and activation serialise.
  - Duplicates give no existence oracle.
  - The GSTIN regex is sound.
  - The drift gate is fine.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major, OWNER | Sign-in already blocked | As Z1; T-CO-003 asserts lock-out and release |
| D2 | Major | RETURNING fails | As Z2 |
| D3 | Major | Database no longer separates the two permissions' columns | `centre_write_guard` trigger |
| D4 | Major | Area or centre moves silently change scope | No area move; centre `areaId` audited before and after |
| D5 | Minor | Checklist only at activation | GST rule kept while active; class clearing accepted (DD-2) |
| D6 | Minor | `status` in insert grant; region code in update grant | Both dropped |
| D7 | Minor | Sequences behind legacy ids | `setval` in 0020; duplicate by constraint name |
| D8 | Minor | Form pickers not filtered | `admitOptions` and `enquiryOptions` filtered |
| D9 | Nit | Deactivation race with admit | Accepted |
| D10 | Nit | Landline with STD code | `detailField` normaliser |
| D11 | Nit | `areaId` message; stale foundation comment | `unknown`; updated |

**Status: resolved (2026-10-29).**
