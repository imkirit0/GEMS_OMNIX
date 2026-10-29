# EGM Stage 9: Implementation readiness report (certifications)

- **Target:** `docs/designs/certifications/certifications.md` (commit `ecfa6fa`, after steps 5–8).
- **Reviewer:** `egm-implementation-readiness` (fresh context, codebase check).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 2 Major, 8 Nit** (R1–R10); no OWNER items. Verdict: ready once R1 (only the function moves; `details.ts` already has the regexes) and R2 (`::int` on `hiddenCentres`) are in the plan.

## Resolution

**Status: resolved (2026-10-29).** All applied as the design's step-9 notes; R8 accepted. Build approved under the owner's standing instruction of 2026-10-29.

## Findings

| ID | Severity | Finding (evidence) | Fix |
|---|---|---|---|
| R1 | Major | Design §"Shared text rule" says `ownText` and `CONTROL`, `CONTROL_MULTILINE`, `LONE_SURROGATE` "move unchanged" to `details.ts`. But `details.ts:41` already declares `const CONTROL` and `details.ts:43` `const LONE_SURROGATE`, so moving them gives duplicate declarations and `tsc` fails. `details.ts:42` `CONTROL_IN_ADDRESS` is the same regex as `enquiry.ts:47` `CONTROL_MULTILINE`. | Move only the function, as `export function ownText` placed after `detailField`. It uses the existing `CONTROL`, `LONE_SURROGATE` and `CONTROL_IN_ADDRESS` (multiline). Delete `enquiry.ts:46-58` and change `enquiry.ts:8` to `import { detailField, ownText } from "./details";`. The behaviour stays the same byte for byte. |
| R2 | Major | `getCourse.hiddenCentres` is "counted from course_centre". A raw `count(*)` comes back from `$queryRaw` as a `BigInt`, so T-CC-003's `hiddenCentres: 1` would fail against `1n`. The repo convention is `::int` (`people.ts:232`). | Plan text: `((select count(*) from app.course_centre x where x.course_id = course.id) - (select count(*) from app.course_centre x join app.centre ce on ce.id = x.centre_id where x.course_id = course.id))::int as "hiddenCentres"`. |
| R3 | Nit | `course_centre_update` "uses the same expression" but doesn't say whether that means USING, WITH CHECK, or both. | Use both (exact text in K2). |
| R4 | Nit | Three places still state the old rule. The `docs/audit/09-…md:167` row for T-CM-003 says "none for a centre without a class", which DD-3 no longer makes true in general. `people.ts:327` and `course-offer.ts:10` carry the old DD-7 comment. | K1: amend the 09 row. K2: update both comments and add the DD-7 note in `docs/designs/course-master/course-master.md`. |
| R5 | Nit | The smoke check "course page lists a special-case centre" names no data, user or marker. | Insert by SQL `insert into app.course_centre values ($smkc, $ids.A)`. Then `viewer`'s course page body must include `Only named centres may sell it` and `SMK-A`. `viewer` can already see SMK-A (`smoke-security.mjs:160`). |
| R6 | Nit | "Whole row" for the certification audits has no column list. | Audit `id, code, name, type, description, active`, with no `created_at`, as `Master` does (`catalogue.ts:26,87`). |
| R7 | Nit | Matrix R-090.01 (`matrix-03-academics-general1.tsv:30`) says "Region/Area/Centre Classes". Region and area are a recorded Non-Goal. | Leave the description as it is. Add the test IDs only. |
| R8 | Nit | `lockCourse` takes `for update` (`catalogue.ts:233`). That conflicts with the FOR KEY SHARE lock a concurrent registration insert takes through `registration_course_code_fkey`, so an admission waits for the short link transaction. `setCourseClasses` already behaves this way. | Accept as is. No change. |
| R9 | Nit | `updateCertification` with every field `undefined`. | It falls through to the comparison and gives "nothing to change". Compare normalised values: trimmed `name`, `type`, and `ownText` output for `description`. |
| R10 | Nit | The T-CC-003 setup is written by name only. | Fixture ids are DCA=1, TALLY=2, PYTHON=3, DTP=4, CCNA=5 and A=1, A2=2, B=3 (`tests/fixtures.ts:85-86,165-166`). SQL: `update app.centre set centre_class_id=1 where id=1; insert into app.course_centre_class values (1,1),(2,1); insert into app.course_centre values (1,2),(3,1),(5,3)`. |

## Build plan (each phase ends with `bash scripts/ci.sh` exit 0)

### K1 Documents

1. **`docs/audit/09-test-strategy-and-acceptance-criteria.md`**
   - Add rows T-CC-001…004 after T-CM-006 (line 170), using the design's Tests table wording.
   - Amend the T-CM-003 row (line 167) to: "…only courses linked to the centre's active class, none for a centre without a class, for courses with no named centres (named centres: T-CC-003)…".
2. **`docs/audit/data/matrix-03-academics-general1.tsv`**, test-ID column (14th) only:
   - R-092 (line 32): `T-SEC-007` → `T-SEC-007,T-CC-001,T-CC-004`.
   - R-090 (line 29): append `,T-CC-002,T-CC-004`.
   - R-090.01 (line 30): `T-E2E-002` → `T-E2E-002,T-CC-003,T-CC-004`.
3. **`docs/designs/course-master/course-master.md`**: add an "Amended by certifications DD-3" note to DD-7.
4. Run `python -I docs/audit/tools/build_matrix.py docs/audit` and `python -I docs/requirements/tools/build_frd.py .`, then commit the regenerated CSV and FRD. `build_matrix.py:39` needs the T-IDs to exist in 09 first, hence the order above.

### K2 Server

**1. `prisma/schema.prisma`**

Add to `Course` (after `classes`, line 718):
```
  certifications    CourseCertification[]
  centres           CourseCentre[]
```

Add to `Centre` (after `registrations`, line 66):
```
  specialCourses  CourseCentre[]
```

After `CourseCentreClass` (line 737):
```prisma
// R-092 certification master (docs/designs/certifications); checks, RLS and grants in 0019
model Certification {
  id          Int                   @id @default(autoincrement())
  code        String                @unique
  name        String
  type        String
  description String?
  active      Boolean               @default(true)
  createdAt   DateTime              @default(now()) @map("created_at") @db.Timestamptz
  courses     CourseCertification[]

  @@map("certification")
  @@schema("app")
}

// R-090: a course's mandatory and optional certifications (certifications DD-2)
model CourseCertification {
  courseId        Int           @map("course_id")
  certificationId Int           @map("certification_id")
  mandatory       Boolean
  course          Course        @relation(fields: [courseId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  certification   Certification @relation(fields: [certificationId], references: [id], onDelete: Restrict, onUpdate: Restrict)

  @@id([courseId, certificationId])
  @@map("course_certification")
  @@schema("app")
}

// R-090.01: the named centres that alone may sell a course (certifications DD-3)
model CourseCentre {
  courseId Int    @map("course_id")
  centreId Int    @map("centre_id")
  course   Course @relation(fields: [courseId], references: [id], onDelete: Restrict, onUpdate: Restrict)
  centre   Centre @relation(fields: [centreId], references: [id], onDelete: Restrict, onUpdate: Restrict)

  @@id([courseId, centreId])
  @@map("course_centre")
  @@schema("app")
}
```

**2. `prisma/migrations/0019_certifications/migration.sql`**, in this order. Generate the DDL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` against a database at 0018, as 0016 R4 did.

1. Header comment, in the 0016 style.
2. `CREATE TABLE "app"."certification"`: `id SERIAL`, `code TEXT NOT NULL`, `name TEXT NOT NULL`, `type TEXT NOT NULL`, `description TEXT`, `active BOOLEAN NOT NULL DEFAULT true`, `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`, `certification_pkey`.
3. `CREATE TABLE "app"."course_certification"`: `course_id`, `certification_id`, `mandatory BOOLEAN NOT NULL`, primary key `(course_id, certification_id)`.
4. `CREATE TABLE "app"."course_centre"`: `course_id`, `centre_id`, primary key `(course_id, centre_id)`.
5. `CREATE UNIQUE INDEX "certification_code_key"`.
6. The 4 foreign keys, `ON DELETE RESTRICT ON UPDATE RESTRICT`, named `<table>_<col>_fkey`.
7. Checks:
   - `certification_code_check` with the 0012 text;
   - `certification_name_check check (name = btrim(name) and char_length(name) between 1 and 200)`;
   - `certification_type_check check (type in ('VOUCHER','LICENCE'))`;
   - a `do $$` block that declares `ws` and `ctl_address`, copied byte for byte from `0018:176,178` (the `ws` literal holds Unicode spaces, so copy it, don't retype it). It runs `execute format('alter table app.certification add constraint certification_description_check check (description !~ %L and description !~ %L and description !~ %L and char_length(description) between 1 and 1000)', '^'||ws, ws||'$', ctl_address)`.
8. RLS on `certification`: enable, force, and `setup_select`, `setup_insert`, `setup_update` exactly as `0012:121-125`.
9. RLS on `course_certification`: enable, force, `setup_select`, `setup_insert`, `setup_delete`, as `0016:59-65`.
10. RLS on `course_centre`: enable, force, then:
    - `-- D5: catalogue data, readable by every session; centre names stay gated by app.centre's own RLS`
    - `create policy course_centre_select … for select using (true)`;
    - `course_centre_insert` with check `((select app.has_permission('catalogue.manage', null)))`;
    - `course_centre_update` with **both** `using` and `with check` set to that expression (R3);
    - `course_centre_delete` with `using` set to it.
11. Grants:
    - `grant select, insert on app.certification`;
    - `grant update (name, type, description, active) on app.certification`;
    - `grant select, insert, delete on app.course_certification, app.course_centre`;
    - `grant usage on sequence app.certification_id_seq`;
    - all to `gems_app`.

**3. `src/server/details.ts` and `src/server/enquiry.ts`**: R1 as stated in the findings.

**4. `src/server/catalogue.ts`**

- Import `ownText` from `./details`. Add:
  ```ts
  function description(v: unknown) { try { return ownText("description", v, 1000, true); } catch (e) { if (e instanceof PersonError) throw bad(e.message); throw e; } }
  ```
  Add `const CERT_TYPES: readonly string[] = ["VOUCHER","LICENCE"]`, `MAX_CERTS = 100`, `MAX_CENTRES = 500`, and `CERT_COLS = Prisma.sql\`id, code, name, type, description, active\``.
- Add `listCertifications`, `createCertification`, `updateCertification` (with `lockCert … for update`), `setCertificationActive` (two literal `adminWrite` calls with `targetType: "certification"`), `setCourseCertifications` and `setCourseCentres`, following the design steps exactly.
- The two literal action names are `"catalogue.course.certifications"` and `"catalogue.course.centres"`.
- `getCourse`: add `certifications`, `centres`, `specialCase` and `hiddenCentres` (R2) and the two picklists. The picklists are queried only when `canManage`, otherwise `[]`.
- `CourseListRow` gets `& { specialCase: boolean }`, and the select adds the design's `exists(...) as "specialCase"`.

**5. `src/server/course-offer.ts`**: the design's type and filter. Remove the line-10 comment and update the header to cite DD-3.

**6. `src/server/people.ts`**

- Replace the query at `:328-333` with:
  ```ts
  select co.code from app.course co where co.code = any (${codes}::text[]) and case when exists (select 1 from app.course_centre x where x.course_id = co.id) then exists (select 1 from app.course_centre x where x.course_id = co.id and x.centre_id = ${input.centreId}) else exists (select 1 from app.course_centre_class cc join app.centre_class k on k.id = cc.centre_class_id and k.active join app.centre ce on ce.centre_class_id = k.id where cc.course_id = co.id and ce.id = ${input.centreId}) end
  ```
- Update the comment at `:327`.
- Replace `admitOptions` `:212-216` with the design's no-group-by select. `classCodes` comes from `array(...)` and `centreIds` from `case … else null end`.

**7. Tests**

- `tests/fixtures.ts:80`: add `app.certification` to the truncate.
- `tests/foundation.test.ts:51`: the list becomes `["admission","centre","course_centre","enquiry",…]`, with the D5 comment.
- `tests/audit-catalogue.ts:22`: add the 2 actions.
- New `tests/certifications.test.ts` with T-CC-001, 002 and 003, in the `course-master.test.ts` harness, with `afterEach` resetting `enforceAvailability`.
- Existing tests that do **not** change: `course-master.test.ts` (T-CM-001/002/003/005; `:159`, `:170` [2,8] and `:177-178` still hold), `admission-screens.test.ts` (T-ADM-001 checks centres only), `enquiry.test.ts` and `catalogue-masters.test.ts:85-89`.

### K3 Pages

1. `app/admin/catalogue/admin-errors.tsx:6-7`: `MASTER_FIELD_LABELS` gains `type: "Type", description: "Description"`.
2. `app/admin/catalogue/courses/course-form.tsx:15`: `COURSE_FIELD_LABELS` gains `certifications: "Certifications", centres: "Special-case centres"`.
3. New `app/admin/catalogue/certifications/page.tsx`, modelled on `masters/[slug]/page.tsx`. It has a type `<select>` and a description `<textarea maxLength={1000}>`; non-managers get no forms.
4. New `app/admin/catalogue/certifications/save/route.ts`, modelled on the masters route. It uses the design's op mapping and `flag` from `../../masters/slugs`.
5. `app/admin/catalogue/courses/[id]/save/route.ts`:
   ```ts
   case "certifications": await setCourseCertifications(session, courseId, data.getAll("certificationId").map((v) => ({ certificationId: Number(v), mandatory: f[`mandatory:${v}`] === "1" })))
   case "centres": await setCourseCentres(session, courseId, data.getAll("centreId").map(Number))
   ```
6. `app/admin/catalogue/courses/[id]/page.tsx`: two manager forms, plus the non-manager `<dt>` rows ("Certifications"; "Only named centres may sell it", the centre codes, and "and N centres outside your scope").
7. `app/admin/catalogue/page.tsx:13`: add the `<li>` link for Certifications.
8. `app/admin/catalogue/courses/page.tsx`: mark `specialCase` rows.
9. Tests: T-CC-004 in `tests/certifications.test.ts`, using the T-CM-004 `post()` helper.

### K4 Evidence

1. `scripts/smoke-security.mjs`, after line 172:
   - `get("/admin/catalogue/certifications", viewer)` returns 200 and the body has no `method="post"`;
   - a foreign-origin POST to `/admin/catalogue/certifications/save` with `catTok` returns 403;
   - the R5 check.
2. Run the mutation table below. Each mutation must turn its test red; record that.
3. Add the E-entry (E-043) to `docs/audit/12-evidence-and-verification-log.md` and `docs/STATUS.md`.

## Mutation checks

| # | Mutation | File | Test that must fail |
|---|---|---|---|
| 1 | `course_centre_select using (true)` → `using (false)` | 0019 | T-CC-003 (`admitOptions` / `specialCase`) |
| 2 | Drop `course_centre_insert` with check (→ `true`) | 0019 | T-CC-003 non-manager SQL insert expects 42501 |
| 3 | `course_centre_delete` using → `true` | 0019 | T-CC-003 non-manager delete expects 0 rows |
| 4 | Remove `force row level security` on `course_centre` | 0019 | T-RLS-002, T-CC-003 |
| 5 | Remove `course_centre_update` | 0019 | T-RLS-002 (UPDATE needed) |
| 6 | `course_certification setup_insert` → `true` | 0019 | T-CC-002 SQL 42501 |
| 7 | `certification setup_update` using → `true` | 0019 | T-CC-001 non-manager SQL |
| 8 | Drop each named check in turn (code, name, type, description) | 0019 | T-CC-001 23514 + constraint name |
| 9 | Add `code` to the certification update grant | 0019 | T-CC-001 (SQL `update code` expects 42501; add this assertion) |
| 10 | `admit()`: drop the `case`, keep only the class branch | people.ts | T-CC-003 (DCA@A2 accepted, DCA@A refused) |
| 11 | `admit()`: named branch drops `and x.centre_id = …` | people.ts | T-CC-003 (CCNA refused at A/A2) |
| 12 | `centreIds`: drop the `scoped_centre_ids('student.admit')` filter | people.ts | T-CC-003 (CCNA: [] not [3]) |
| 13 | `centreIds`: `else null` → `else '{}'` | people.ts | T-CC-003 (DTP/TALLY null) |
| 14 | `offeredCourses`: `!== null` → `.length > 0` | course-offer.ts | T-CC-003 agreement (CCNA@A would be offered) |
| 15 | `offeredCourses`: drop `k !== null &&` | course-offer.ts | type error / T-CM-003 |
| 16 | `setCourseCertifications`: drop the `active for share` filter | catalogue.ts | T-CC-002 inactive newly added refused |
| 17 | Apply the inactive check to already-linked ids too | catalogue.ts | T-CC-002 kept (flag flipped) |
| 18 | Remove the duplicate-id check (either setter) | catalogue.ts | T-CC-002 / T-CC-003 duplicate |
| 19 | Cap 100 → 101, or 500 → 501 | catalogue.ts | T-CC-002 over-100 (add an over-500 case to T-CC-003) |
| 20 | Accept a non-boolean `mandatory` | catalogue.ts | T-CC-002 invalid shapes |
| 21 | "Nothing to change" ignores flags | catalogue.ts | T-CC-002 flip a flag |
| 22 | Unsorted audit codes | catalogue.ts | T-CC-002 / T-CC-003 audit |
| 23 | `setCourseCentres`: skip the unknown-centre check | catalogue.ts | T-CC-003 unknown (FK error message differs) |
| 24 | `getCourse.centres`: drop the `app.centre` join (codes from ids) | catalogue.ts | T-CC-003 sa DCA `centres: []` |
| 25 | `hiddenCentres` without `::int` | catalogue.ts | T-CC-003 `hiddenCentres: 1` |
| 26 | Picklists not gated on `canManage` | catalogue.ts | T-CC-003 picklists `[]` for sa |
| 27 | `createCertification` outside `unique()` | catalogue.ts | T-CC-001 `catalogue.duplicate` |
| 28 | Validation order swapped (type before name) | catalogue.ts | T-CC-001 message order |
| 29 | `description` wrapper rethrows the PersonError | catalogue.ts | T-CC-004 field `detail` (500 instead of a redirect) |
| 30 | `ownText` multiline → single-line regex | details.ts | T-CC-001 (LF accepted), T-ENQ remark/note |
| 31 | `setCertificationActive` computed action name | catalogue.ts | T-AUD-009 |
| 32 | The route maps `mandatory` as `!!f[…]` | courses/[id]/save/route.ts | T-CC-004 (`mandatory:<id>=0` must be false; add this) |
| 33 | Unknown `op` falls through without throwing | certifications/save/route.ts | T-CC-004 unknown op |
| 34 | Remove `adminPost` (no `sameOrigin`) | certifications/save/route.ts | T-CC-004 403; smoke foreign create |
| 35 | Render the forms when `!canManage` | certifications/page.tsx | smoke no `method="post"` |
| 36 | Remove `app.certification` from `reset()` | fixtures.ts | T-CC-001 id-dependent assertions on the second test |

Mutations 9, 19 (the over-500 half) and 32 need one assertion each that the design's test table doesn't list. Add them in K2/K3.
