# EGM Stage 8: Intermediate zoom-out report (centre onboarding)

- **Target:** `centre-onboarding.md` (commit `6d6883d`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 3 Major, 3 Minor, 3 Nit** (I1–I9); no OWNER items. Verdict: still the simplest design; the only new mechanism, the column-group trigger, has no simpler alternative.

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Major | Duplicate mapping after `adminWrite`'s `db()` cannot see the constraint | Mapped inside the callback (the `personDb` pattern) |
| I2 | Major | No fixture holds `org.centre.manage` | Role 25 with `tok-coM` (ALL) and `tok-coR1` (REGION 1) |
| I3 | Major | About a dozen base statements contradicted the contracts | Technical Plan replaced by one merged text; G1 updated |
| I4 | Minor | `detailField` cannot validate `phone` | Shared `phoneDigits(field, v)` in `details.ts` |
| I5 | Minor | Trigger comparison and its consequences unstated | `old` against `new` minus the class; security invoker; 42501 becomes DENIED |
| I6 | Minor | "As 0012 did" overstated | "Following 0012's precedent" |
| I7 | Nit | `listCentres.classCode` unused | Dropped |
| I8 | Nit | `setval` off by one on an empty table | `coalesce(max, 0) + 1, false` |
| I9 | Nit | Stale test comment and title | Reworded |

**Status: resolved (2026-10-29).**
