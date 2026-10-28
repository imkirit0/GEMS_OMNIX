# EGM Stage 9: Implementation readiness report (person core)

- **Target:** `docs/designs/person-core/person-core.md` (462 lines, commit `c366e68`), DetailedRange 299..462, with the feature part where it makes claims about code.
- **Reviewers** (fresh context, in parallel): `egm-implementation-readiness` (standard `implementation-readiness-standard.md`; could Q1–Q4 be built with CI green?), `egm-codebase-details` (every claim checked against the code).
- **Date:** 2026-10-28
- **Result:** **2 Blocker, 9 Major, 15 Nit** (K1–K12, R1–R14). K1 = R2 and K2 = R3.

Readiness verdict before fixes: Q1 and Q4 buildable; Q2 would leave CI red (R3); Q3 had tests that could not be written (R2, R4, R6) and an allocator reading that breaks every admit (R1). Every fix was local.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| K1 / R2 | **Blocker** | No fixture region covers A and B (A is R1, B is R2) | `sr` at REGION 1 links at A2; `sb` (B) is the out-of-scope user; assertion order stated |
| K3 | **Blocker** | "T-NUM-007/010 test `number_series`" is false: 007 tests `financialYear()`, 010 has no CI test | Corrected; T-NUM-010 implemented in `people.test.ts` (first Register No 2064113, Admission No GTEC262743888) |
| K2 / R3 | Major | Giving `hoAll` role 17 breaks `audit.test.ts:54` (CI red at Q2) | New ALL-scope user `sh`; `hoAll` untouched |
| K4 | Major | D-MIG-4 is master dedupe maps, not person merging | New register row D-STU-5 (person merge) in item 2; D-MIG-4 cited as an input |
| R1 | Major | One-statement `previous` upsert never updates an existing row when the prior year is unseeded, so every 2026-27 admit fails | Exact three-step SQL in item 7a; `SeriesMissing(series, period)` |
| R4 | Major | No way to fail `admit` after allocation, so the rollback test and its mutation can't be written | Pre-insert `register_no` 2064114; a two-course admit fails on the unique key; counters and rows unchanged |
| R5 | Major | Mutation `using (true)` on person survives T-PER-004 | Raw `select`/`update` on `app.person` under `sb` |
| R6 | Major | Year-chain assertions in the listed order fail a correct implementation | Order fixed: 2028-29 and 2025-26 fail first, then 2027-28 opens, then 2028-29 |
| R7 | Major | Permission `description`/`sensitive` unspecified | Descriptions given; `sensitive = false` (no TOTP step-up), PMC under D-SEC-4 |
| K5 | Nit | `and` does not short-circuit before the `::int` casts | `case when … then … else false end` |
| K6 | Nit | `extract` concatenation is not zero-padded | Arithmetic `yyyymmdd` |
| K7 | Nit | `[:alpha:]` splits Indic names at vowel signs | Class keeps U+0300–036F and U+0900–0DFF; Malayalam test; Supabase checked manually |
| K8 | Nit | `pageRead` maps only `Forbidden` and `TicketNotFound` | Stage 3 extends it (shared `NotFound` base preferred) |
| K9 | Nit | `scoped_centre_ids` grant is from 0007 | Cited |
| K10 | Nit | DB errors not mapped | `personDb()` in the style of `ticketDb()` |
| K11 | Nit | D-YEAR-3 is AY vs FY | R-028 cited for the master |
| K12 | Nit | Status omits Stage 8 | Added (and this report) |
| R8 | Nit | Prisma relations, `onDelete`, PK name | Listed; `global_number_series_pkey`; old PK dropped |
| R9 | Nit | Date types and time zone; `getPerson` transaction | `'YYYY-MM-DD'` strings, Asia/Kolkata; `withScope`, unaudited |
| R10 | Nit | `changeIdentity` contract | `Partial<…>` type, `null` clears except `givenName`, before/after hold changed fields |
| R11 | Nit | Audit target and detail | `targetType: "person"`, detail keys named |
| R12 | Nit | "The second" concurrent admit is nondeterministic | `Promise.allSettled`: one fulfils, one `PossibleDuplicate` |
| R13 | Nit | New users lack UUIDs and an export | `…e1`–`e4`, exported `ST` |
| R14 | Nit | Mutation results not in item 10 | Added |

**Status: resolved (2026-10-28).** All 26 applied, per the owner's instruction "apply all fixes when the reviews are done". None reversed an owner decision. The one policy choice, `sensitive = false` for the student permissions, is flagged to the owner.
