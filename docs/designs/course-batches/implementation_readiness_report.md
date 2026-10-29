# Course batches: EGM step 9 implementation readiness report

Reviewed commit 829ff83, 2026-10-30. **Verdict: ready to build once R1–R6 are applied in the plan; no redesign.** All reused patterns exist as described.

No existing test lists registration grants, triggers or policies. T-RLS-005 does not change (the guard has invoker rights). The ETL is safe:
* `etl/run.ts:228` inserts named columns;
* the reset truncates the referencing side;
* K6 needs a validated FK, so the FK is not `NOT VALID`.

## Findings (all applied at build)

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Blocker | `@prisma/adapter-pg` drops `error.constraint` on 23514 (`adapter-pg/dist/index.mjs:532-539`). `centreDb` reads the name from the message text. | The guard raises messages containing `constraint "<name>"`, and keeps `constraint =` for SQL tests. |
| R2 | Major | Prisma's default referential actions differ from the SQL, so the drift gate would fail. | Both FKs `ON DELETE RESTRICT ON UPDATE RESTRICT`, with matching Prisma attributes. |
| R3 | Major | The design DDL is not in the generated form. | Write `schema.prisma` first, generate the head of 0021 with `migrate diff --script` against 0020, then hand-write the rest. |
| R4 | Major | `for no key update` fails on the nullable side of a left join. | `... for no key update of r`. |
| R5 | Major | The target-batch lock does not filter by centre, and the missing-row case is not handled. | `where id = $b and centre_id = $c`; missing or inactive gives `batchId: inactive or unknown`. The guard and FK stay as the backstop. |
| R6 | Major | The page 404s are not covered by vitest. | Smoke checks. |
| R7 | Major | "Place implies read" cannot be tested. | Role 27, holding `batch.manage` only, gets Forbidden and a DENIED row naming `student.view`. |
| R8 | Nit | `adminPost` fields keep only the last repeated value. | Use `data.getAll("registrationId")`, and build `back` from the fields. |
| R9 | Nit | No recipe for the concurrency test. | Two `gems_app` clients, with commit ordering. |
| R10 | Nit | No test places several rows past capacity in one statement. | Capacity 2, place 3: `batchId: full`, 0 rows. |
| R11 | Nit | No labels for the error line. | Add `BATCH_FIELD_LABELS`. |
| R12 | Nit | The 1–100 name rule duplicates `geoName`. | Export `geoName` and reuse it. |
| R13 | Nit | DD-5 does not cover the place page. | Hide its forms at an inactive centre too. |
| R14 | Nit | T-AUD-009 parses `action:` lines. | Put `action:` before `permission:` on one line. |

## Build plan

**B1 docs:**
* audit 09 gains the T-CB rows before T-FEE.
* `matrix-03-academics-general1.tsv:14`: the R-155 tests cell lists T-CB-001…003.
* Regenerate the CSV and FRD.

**B2 data and server:**
* `schema.prisma`: Batch, `Centre.batches`, `Registration.batchId` and its relation (`map: "registration_batch_fkey"`), plus `@@index([batchId])`.
* Migration 0021:
  * the generated head;
  * the named checks;
  * RLS (initplan shape; delete `false`);
  * the guard (R1 messages, explicit `tg_op`);
  * the permission and the `system_admin` grant;
  * the grants.
* `batches.ts`:
  * `batchDb`;
  * `batchCentres` copying `enquiryOptions`;
  * reads via `withScope` plus `authorize`;
  * writes via `scopedAction` plus `authorize`, the trading gate and `batchDb`.
* `ADMIN_MESSAGES` gains `batch.duplicate`.
* Fixtures:
  * truncate `batch`;
  * the permission;
  * role 26 with `batch.manage` and `student.view`;
  * `BM` users and the `tok-bmA` and `tok-bmR1` sessions.
* Existing tests:
  * T-RLS-002 list;
  * T-AUD-009 scan;
  * the audit catalogue.
* New `tests/course-batches.test.ts`.

**B3 pages:**
* `app/batches/page.tsx`, `app/batches/place/page.tsx`;
* the save routes;
* the labels;
* the home link;
* T-CB-003.

**B4:** smoke checks (B 404, malformed or unknown parameters 404, the place list without forms, the home link, foreign origin 403) and mutation checks.

## Mutation checks planned (48)

| Area | Count | Rows | What they mutate |
|---|---|---|---|
| Migration 0021 | 27 | 1–27 | Checks, uniques, FK, every guard part including VOLATILE and invoker rights, the R1 message format, policies, FORCE, grants, `system_admin` |
| `batches.ts` | 16 | 28–43 | `student.view`, the trading gate, rule order, time rules, below-placed, nothing to change, already active, reason, the 23505 map, lock filters, skipping placed rows, the audit, the status filter, read `authorize` |
| Audit catalogue | 1 | 44 | A catalogue entry |
| Routes | 3 | 45–47 | Repeated ids, `""` mapped to null, unknown op |
| Page check | 1 | 48 | The `batchCentres` 404 |
