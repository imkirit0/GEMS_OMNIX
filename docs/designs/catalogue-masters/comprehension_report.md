# EGM Stage 6: Comprehension report (catalogue masters)

- **Target:** `docs/designs/catalogue-masters/catalogue-masters.md` (commit `06ad34e`, after step 5).
- **Reviewer:** `egm-comprehension` (fresh context, naive implementer). Read the design, brief and step 5 report; in the code `catalogue.ts`, `admin-http.ts`, `rbac.ts`, `action.ts`, `page-read.ts`, migrations 0001, 0002, 0012, the course pages and routes, `app/page.tsx`, the catalogue, course-master, foundation, fixtures, audit and sec tests, `scripts/smoke-security.mjs`.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 4 Major, 9 Nit** (C1–C13); no OWNER items. Verdict: ready once the contract gaps are written down; DD-1…DD-10 consistent with each other and the code (DD-7 and course-master DD-15 fit).
- **Clear:** migration 0017's grant and policy; the validation order of `setCentreClass`; the read shapes and ordering; the T-CAT-003 and T-RLS-002 changes; DD-10; the rights per DD-4; clearing a class needs no schema change.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| C1 | Major | Where the audit's class codes come from; a `left join … for update` fails in Postgres | Lock with a scalar subquery; `liveRef` returns the code |
| C2 | Major | Route `op` → function mapping, encodings, unknown `op`, redirects | Mapping table and rules |
| C3 | Major | Slug map; 404 vs Origin order | `SLUGS`; 404 before `adminPost` |
| C4 | Major | Test file, fixtures, tokens, audit shape, the T-AUD-009 literal | Test setup written out |
| C5 | Nit | A bad centre id reported as `id` | `id("centreId", …)`, label "Centre" |
| C6 | Nit | Year date format | `::text` ISO strings |
| C7 | Nit | Kind checked before the session | Stated |
| C8 | Nit | Page rendering | Columns, words, the per-row select, non-manager view, index |
| C9 | Nit | Prefix-less refusals | Generic line, accepted |
| C10 | Nit | T-SEC-007's title becomes untrue | Title updated |
| C11 | Nit | `target_centre_id` null | Stated: network-wide action |
| C12 | Nit | Smoke markers | No `method="post"`; GET unknown slug 404 |
| C13 | Nit | `AdminErrors` layout | File, props, exports fixed |

## Resolution

**Status: resolved (2026-10-29).** All thirteen applied as the Technical Plan's "Contracts (step 6)"; no owner decision needed.
