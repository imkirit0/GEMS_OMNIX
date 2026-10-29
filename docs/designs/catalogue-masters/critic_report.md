# EGM Stage 7: Critic report (catalogue masters)

- **Target:** `docs/designs/catalogue-masters/catalogue-masters.md` (commit `da5abe6`, after steps 5–6).
- **Reviewer:** `egm-design` (fresh context, adversarial). It read the design, the brief and the step 5 and 6 reports, then checked them against:
  - server code: `catalogue.ts`, `people.ts`, `admin-http.ts`, `rbac.ts`, `action.ts`, `db.ts`, `page-read.ts`, `centres.ts`, `safe-route.ts`
  - migrations 0001, 0002, 0012, 0016 and `scripts/etl/setup.sql`
  - the course pages
  - the catalogue, course-master, foundation, sec and audit tests, and the fixtures
  - the security smoke
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 2 Major, 8 Nit** (D1–D10); no OWNER items. Verdict: approve with changes; the security core holds.
- **Held up:**
  - 0017 opens only `centre_class_id`: no cascades, no triggers, and no other role gains a write.
  - `select … for update` applies both policies.
  - No existence oracle: non-managers are refused before any lookup, and managers see every centre.
  - The scalar-subquery lock, and no lock cycle with `admit()`.
  - Audit, step-up and DENIED rows; `target_centre_id` null is correct.
  - Slugs leak nothing; year dates come back as ISO strings.
  - Every claim about the tests the design changes.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major | The centres page skips the `org.centre.view` gate the centre list applies | Manager or `org.centre.view` filter; tests for a no-permission role |
| D2 | Major | `for update` on the centre blocks admission inserts there while they hold the global counter | `for no key update` |
| D3 | Nit | An absent toggle field means "deactivate" | Only `"1"`/`"0"` accepted on the new routes |
| D4 | Nit | `?error=__proto__` crashes the error component | `Object.hasOwn` lookups |
| D5 | Nit | `safeRoute` not mentioned | Stated for all three routes |
| D6 | Nit | Deactivating a class stops its centres selling | Risks row |
| D7 | Nit | No centre has a class at cutover | Risks row; enforcement off until every active centre has one |
| D8 | Nit | Two label maps | One `MASTER_FIELD_LABELS` |
| D9 | Nit | DENIED audit and clearing by route untested | Added |
| D10 | Nit | Year codes and dates not cross-checked | Accepted (catalogue DD-6) |

## Resolution

**Status: resolved (2026-10-29).** All ten applied; no owner decision needed.
