# EGM Stage 9: Implementation readiness report (catalogue masters)

- **Target:** `docs/designs/catalogue-masters/catalogue-masters.md` (commit `7af4837`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check). It read the design and every file the design changes or depends on:
  - server code: `catalogue.ts`, `people.ts`, `centres.ts`, `admin-http.ts`, `rbac.ts`, `action.ts`, `safe-route.ts`, `page-read.ts`, `auth/http.ts`
  - schema and migrations: `schema.prisma`, migrations 0002, 0007, 0012, 0016
  - pages: the course pages, `app/page.tsx`
  - tests: the catalogue, course-master, fixtures, foundation, sec, audit and admin-http tests
  - scripts: the security smoke, `ci.sh`, the matrix and FRD generators
  - documents: audit 09, matrix-02, the two superseded designs
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 6 Major, 11 Nit** (R1–R17); no OWNER items. Verdict: ready to build once the Majors are in the design.
- **Confirmed against the code:**
  - `for no key update` as `gems_app` needs the one granted column and the update policy, both present.
  - The admission and registration foreign keys take only `for key share` on the centre.
  - `scoped_centre_ids` is executable by `gems_app`.
  - The fixtures match every visibility claim.
  - T-RLS-002, T-SEC-007 and T-CAT-003 are affected exactly as stated.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| R1 | Major | Toggle contract contradicted itself (`=== "1"` vs "anything else invalid") | `flag(field, v)` helper; calls rewritten |
| R2 | Major | Route calls fail typecheck under `noUncheckedIndexedAccess` | `f["x"] ?? ""` for string parameters |
| R3 | Major | "Only writable centre column" untested | Column-privilege assertion in T-MS-002 |
| R4 | Major | The lock (kind and presence) untested | Key-share race and concurrent-commit cases |
| R5 | Major | The `Object.hasOwn` guard untested | Render test with `__proto__` |
| R6 | Major | ALL-scope-only untested | A centre-scoped `catalogue.manage` holder refused, by the app and by SQL; `target_centre_id` null |
| R7 | Nit | Order by code vs id indistinguishable | Inactive division `ADV` |
| R8 | Nit | Year dates and `open` not asserted | Full first row |
| R9 | Nit | Kept-class list exactness, invalid ids, `target_centre_id` | Added |
| R10 | Nit | Route cases loose | Prototype slug, foreign-Origin unknown slug, `open=x`, unknown `op`, missing Origin, `request_id` |
| R11 | Nit | Where `SLUGS` and `flag()` live | `app/admin/catalogue/masters/slugs.ts` |
| R12 | Nit | Classes SQL | Given |
| R13 | Nit | DD-10 text unasserted | Asserted |
| R14 | Nit | Smoke underspecified | Pages, markers, routes named |
| R15 | Nit | More stale statements; no runbook for the go-live check | Added to the superseded notes; the query in Risks and STATUS |
| R16 | Nit | GET unknown slug in vitest | Left to the smoke; `notFound()` before `pageRead` stated |
| R17 | Nit | Matrix test links unspecified | Given per row |

## Resolution

**Status: resolved (2026-10-29).** All seventeen applied to the design as contract notes. The plan below is the build plan.

## File-by-file plan (each phase ends with `bash scripts/ci.sh` exit 0)

**P1 Documents**
1. `docs/audit/09-test-strategy-and-acceptance-criteria.md`: after line 170, add the section `### T-MS: catalogue masters pages (docs/designs/catalogue-masters/catalogue-masters.md)` with rows T-MS-001 (reads), T-MS-002 (class per centre and its database gate) and T-MS-003 (routes and errors).
2. `docs/audit/data/matrix-02-masters-accounts.tsv`: lines 12, 74, 75 and 76, column 14, per R17.
3. Run `python -I docs/audit/tools/build_matrix.py docs/audit` (expect 0 errors and no T-MS warnings) and `python -I docs/requirements/tools/build_frd.py .`. Commit `02-requirements-traceability-matrix.csv` and `FRD-GEMS-OMNIX.md`, because ci.sh:21 and :26 run `git diff --exit-code` on them.
4. `docs/designs/catalogue-skeleton/catalogue-skeleton.md` (DD-7 at line 263, plus lines 69, 183 and 278) and `docs/designs/course-master/course-master.md` (lines 20 and 43): add "Superseded by catalogue-masters DD-2 (setCentreClass)".
5. The design itself: apply R1–R17, and set the status to approved when the owner approves.

**P2 Server**
1. New `prisma/migrations/0017_centre_class_write/migration.sql`: a header comment, `grant update (centre_class_id) on app.centre to gems_app;`, and the `create policy setup_update on app.centre for update using ((select app.has_permission('catalogue.manage', null))) with check ((select app.has_permission('catalogue.manage', null)));`. Make no schema change, so the drift gate stays clean.
2. `prisma/schema.prisma:53`: update the comment only.
3. `src/server/catalogue.ts`:
   - `liveRef` (line 91): select `code` and return `r.code`.
   - After `setMasterActive`, add `listMasters`, which calls `table(kind)` first and then `withScope`, selects `id, code, name, active` ordered by code, and uses `canManage(tx)` (line 325).
   - After the years section, add `listAcademicYears` (`starts_on::text`, `ends_on::text`, `order by code desc`).
   - Add `listCentreClasses` (filter at design:71, classes SQL per R12).
   - Add `setCentreClass`, laid out as design:73–84. The `action: "catalogue.centre.class"` must sit on the same line as `permission:` so audit.test.ts:182 finds it. Give the meta no `centreId`.
4. `src/server/admin-http.ts:65`: change the text to "A record with that code already exists.".
5. `tests/audit-catalogue.ts:22`: add `"catalogue.centre.class"`.
6. `tests/catalogue.test.ts:166`: remove the `update app.centre …` statement.
7. `tests/foundation.test.ts:55`: change the comment.
8. `tests/sec.test.ts:51`: change the title.
9. New `tests/catalogue-masters.test.ts`. Copy the harness from course-master.test.ts:14–38: `CA`, `thrown`, `msg`, `sql`, `as`, `audit`, `afterEach` resetting `CATALOGUE_GATES`, and `afterAll` closing `auth()`. Add T-MS-001 (with R7 and R8) and T-MS-002 (with R3, R4, R6 and R9). It must contain the literal `"catalogue.centre.class"`, which the audit gate in this phase requires.

**P3 Pages**
1. New `app/admin/catalogue/admin-errors.tsx`: `AdminErrors` and `MASTER_FIELD_LABELS`, both using `Object.hasOwn`.
2. `app/admin/catalogue/courses/course-form.tsx`: delete `CourseErrors` (lines 19–24) and the now-unused `ADMIN_MESSAGES` import. Keep `COURSE_FIELD_LABELS`.
3. `courses/[id]/page.tsx` (lines 4 and 20) and `courses/new/page.tsx` (lines 4 and 15): use `<AdminErrors error detail labels={COURSE_FIELD_LABELS} />`.
4. New `app/admin/catalogue/masters/slugs.ts`: `SLUGS` and `flag()` (R1, R11).
5. New `app/admin/catalogue/page.tsx`: the index. It awaits `pageRead(canManageCatalogue)` and renders six links.
6. New `app/admin/catalogue/masters/[slug]/page.tsx`: `notFound()` before `pageRead`; table and forms per design:92.
7. New `app/admin/catalogue/masters/[slug]/save/route.ts`: `handle(req, { params })`, 404 on a bad slug before `adminPost`, `export const POST = safeRoute(handle)`.
8. New `app/admin/catalogue/years/page.tsx` and `years/save/route.ts`.
9. New `app/admin/catalogue/centres/page.tsx` and `centres/save/route.ts`.
10. `app/page.tsx:22`: `<a href="/admin/catalogue">Catalogue</a>`.
11. `tests/catalogue-masters.test.ts`: add T-MS-003 (R5, R10, R13), using the `post` and `where` helpers from course-master.test.ts:183–187.

**P4 Evidence**
1. `scripts/smoke-security.mjs`: add the checks in R14 after line 157.
2. `evidence/mutation-catalogue-masters-<date>.txt`: run the table in section 4.
3. `evidence/ci-catalogue-masters-<date>.txt`: the fresh-clone CI log.
4. `docs/audit/12-evidence-and-verification-log.md`: add E-041 in the format of E-040, with SHA-256 hashes.
5. `docs/STATUS.md`: update, including the go-live query from R15.
6. The design: set the status to Built.

## Mutation checks

| # | Mutation | File | Test that must fail |
|---|---|---|---|
| 1 | Drop the `grant update (centre_class_id)` | 0017 | T-MS-002 set (the lock gives 42501 → Forbidden) |
| 2 | `grant update on app.centre` (every column) | 0017 | T-SEC-007 (`set status` is no longer 42501) |
| 3 | `grant update (centre_class_id, name)` | 0017 | T-MS-002 column-privilege assertion (R3) |
| 4 | Drop the `setup_update` policy | 0017 | T-MS-002 set (the locked select returns no row → notfound) |
| 5 | Policy `using (true)` | 0017 | T-MS-002 direct SQL as uA (1 row instead of 0) |
| 6 | Policy `has_permission('catalogue.manage', id)` | 0017 | T-MS-002 centre-scoped holder, direct SQL (R6) |
| 7 | Policy `with check (true)` only | 0017 | Equivalent (USING already filters the rows); record as not killable |
| 8 | Add a column to `app.centre` in 0017 | 0017 | ci drift gate (`migrate diff --exit-code`) |
| 9 | `table(kind)` moved inside `withScope` | catalogue.ts | T-MS-001 unknown kind without a session |
| 10 | `listMasters` with `where active` | catalogue.ts | T-MS-001 divisions include the inactive one |
| 11 | `listMasters` `order by id` | catalogue.ts | T-MS-001 `[ADV, GEN]` (R7) |
| 12 | Years `order by code` ascending | catalogue.ts | T-MS-001 years newest first |
| 13 | Years dates without `::text` | catalogue.ts | T-MS-001 full-row match (R8) |
| 14 | `canManage` hard-coded true or false | catalogue.ts | T-MS-001 true/false for `tok-catA` / `T.uA` |
| 15 | Drop the `org.centre.view` gate | catalogue.ts | T-MS-002 visibility (`tok-tkViewer` sees KL2-25) |
| 16 | Drop the `has_permission('catalogue.manage') or` | catalogue.ts | T-MS-002 visibility (the manager sees 0 centres) |
| 17 | Classes `where active` only | catalogue.ts | T-MS-002 kept class (A++ missing) |
| 18 | Classes with no filter | catalogue.ts | T-MS-002 exact classes (OLD present, R9) |
| 19 | Remove `id("centreId")` | catalogue.ts | T-MS-002 `centreId: invalid` (R9) |
| 20 | Remove `id("classId")` | catalogue.ts | T-MS-002 `classId: invalid` (R9) |
| 21 | Remove `reasonOf` | catalogue.ts | T-MS-002 `reason: required` |
| 22 | No-row branch → no throw | catalogue.ts | T-MS-002 unknown centre → notfound |
| 23 | Remove the same-class check | catalogue.ts | T-MS-002 "nothing to change" |
| 24 | Skip `liveRef` for a new class | catalogue.ts | T-MS-002 inactive class (accepted) and unknown class (23503 text) |
| 25 | `liveRef` without `and active` | catalogue.ts | T-MS-002 inactive class; T-CAT-003 `categoryId: inactive or unknown` |
| 26 | `for no key update` → `for update` | catalogue.ts | T-MS-002 key-share race (R4a) |
| 27 | Lock removed | catalogue.ts | T-MS-002 audit `before` A++ after concurrent commit (R4b) |
| 28 | Lock written as a left join | catalogue.ts | T-MS-002 set (Postgres refuses the lock on the nullable side) |
| 29 | Audit stores ids instead of codes, or `null` mapped to `""` | catalogue.ts | T-MS-002 audit equality |
| 30 | `centreId: i` in the meta | catalogue.ts | T-MS-002 centre-scoped holder Forbidden, and `target_centre_id` null (R6, R9) |
| 31 | `targetType` / `targetId` wrong | catalogue.ts | T-MS-002 audit match |
| 32 | Action renamed, or missing from the catalogue | catalogue.ts / audit-catalogue.ts | T-AUD-009 coverage gate |
| 33 | Duplicate message text reverted | admin-http.ts | T-MS-003 message assertion (R13) |
| 34 | Slug check with `in` instead of `Object.hasOwn` | slugs.ts / route | T-MS-003 POST `constructor` → 404 |
| 35 | Slug check moved after `adminPost` | masters save route | T-MS-003 foreign-Origin unknown slug → 404 (R10) |
| 36 | `flag()` accepts any value | slugs.ts | T-MS-003 `active=x` → `detail=active`, `open=x` → `detail=open` |
| 37 | `classId=""` not mapped to null | centres route | T-MS-003 clear |
| 38 | Unknown op falls through to success | any route | T-MS-003 `op=nope` → `error=invalid` |
| 39 | `adminPost` bypassed (no `sameOrigin`) | any route | T-MS-003 foreign and missing Origin → 403 |
| 40 | `safeRoute` wrapper removed | any route | T-MS-003 `request_id` non-null (R10) |
| 41 | `AdminErrors` uses `[]` lookup instead of `Object.hasOwn` | admin-errors.tsx | T-MS-003 render with `__proto__` (R5) |
| 42 | `CourseErrors` kept or still imported | course pages | `tsc` / build (removed export) |
| 43 | Forms rendered for non-managers | masters/years/centres pages | Real-server smoke: no `method="post"` |
| 44 | GET unknown slug not `notFound()` | masters page | Real-server smoke: `/masters/nope` and `/masters/constructor` → 404 |
| 45 | Real-server foreign-Origin POST accepted | centres route | Real-server smoke → 403 |
| 46 | Home link not changed | app/page.tsx | None. Accept, or add a smoke check that the `catTok` home contains `href="/admin/catalogue"` |

Not killable or accepted: #7 (an equivalent mutation), and removing `for share` in `liveRef` (a race; the course-master precedent leaves it untested).
