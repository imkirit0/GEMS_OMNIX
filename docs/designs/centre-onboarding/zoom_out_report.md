# EGM Stage 5: Zoom-out report (centre onboarding)

- **Target:** `centre-onboarding.md` (commit `a384097`; steps 5–7 ran in parallel, merged in the design's "Contracts (steps 5–7)").
- **Reviewer:** `egm-zoom-out` (fresh context).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major (1 OWNER), 4 Nit** (Z1–Z8).

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| Z1 | Major, OWNER | Sign-in is already blocked for centre-only staff of inactive centres (0004 `account_usable`) | Option A (keep; correct DD-3), taken under the standing instruction |
| Z2 | Major | `insert … returning` on `centre` fails its select policy | `nextval` first; no RETURNING |
| Z3 | Major | Moving areas between regions was beyond DD-4 | Rename only |
| Z4 | Nit | OR-ed policies loosen 0017's column rule | Column-group trigger (with D3) |
| Z5 | Nit | `getCentreRecord` duplicates `getCentre` | `getCentre` extended |
| Z6 | Nit | Field names only loses the area change | Before and after values |
| Z7 | Nit | New phone rule | `detailField` normaliser |
| Z8 | Nit | Lifecycle fields without a consumer | Kept under DD-1 |

**Status: resolved (2026-10-29).**
