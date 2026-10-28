# EGM Stage 6: Comprehension Test report (person core)

- **Target:** `docs/designs/person-core/person-core.md` (330 lines, commit `8932edf`). Ranges: FeatureRange 1..195, DetailedRange 196..330.
- **Reviewer:** `egm-comprehension` (fresh context), standard `re-implementation-standard.md`. Also checked `numbering.ts` and migrations 0002 and 0009.
- **Date:** 2026-10-28
- **Result:** **3 Blocker, 11 Major, 7 Nit** (C1–C21). Several stem from the Stage 5 edits.

## Findings and proposed resolution

| ID | Sev | Finding | Proposed resolution |
|---|---|---|---|
| C1 | **Blocker** | Each year's `ADMISSION` row "is created when that year is opened", but nothing in Stage 2 opens a year; with `mustExist`, every `admit()` fails. No start value is given for Admission No | **ADMISSION self-creates per year** (the upsert): admission numbers reset per academic year (R-029, SRC), so a new year starting at 1 is correct. Only the in-progress legacy year (`2026-27`, current 43,887) needs a cutover seed (NP-8). `mustExist` stays for REGISTER only |
| C2 | **Blocker** | The rename to `global_number_series` lands in Q2, but the code using the old name changes only in Q3, so CI is red at the end of Q2. `tests/fixtures.ts` appears in both item 5 and item 7a | Move item 7a (`numbering.ts`, `engine.ts`, `tickets.test.ts`) into **Q2** with the rename; the fixtures change lives only in item 5 |
| C3 | **Blocker** | `courses[]` element type undefined; nullability and initial status unstated | `courses: { courseCode: string; joinDate: date; endDate?: date }[]`. `join_date` not null, `end_date` nullable. Status starts ACTIVE and is not caller-set. `admittedOn` is independent of `joinDate` |
| C4 | Major | Item 2 records "Admission No per centre and year" in the decision register, contradicting DD-2 | Fix to "network-wide per academic year" |
| C5 | Major | The table says `match_key (generated)`, but item 3 uses a trigger | The table says "derived (set by trigger, item 4)" |
| C6 | Major | The `match_key` algorithm cannot be reproduced exactly | Exact rule in item 4 (see resolution). `findMatches` computes the candidate's key with the same SQL function |
| C7 | Major | Required person fields are not stated | **Stage 2 requires `given_name` only.** The rest is nullable and validated when present. The mobile is stored normalised to 10 digits. Stage 3's form decides what is mandatory |
| C8 | Major | The identity field set is unlisted; `reason` is unused; who audits is unclear | Identity fields: given_name, family_name, gender, date_of_birth, mobile, email. `changeIdentity` returns `{ before, after, reason }` for the caller to audit. Only ticket handlers call it in Stage 2, and the ticket engine audits there; any future non-ticket caller must audit itself |
| C9 | Major | Whose session `changeIdentity` sees is unclear | The `tx` is the approver's transaction (ticket engine Act step 5). The approver can see the person, because the ticket's centre is in their scope and the person has an admission there |
| C10 | Major | `getPerson` return shape and permission are missing; `findMatches` scope is vague; `visible_centre_ids` vs `scoped_centre_ids` is unexplained | `getPerson` requires `student.view`. It returns the person plus admissions and registrations at centres in `scoped_centre_ids('student.view')`, with the shape given. `findMatches` uses the same set. The difference between the two functions goes in the terms table |
| C11 | Major | `admit` error cases are undefined | An invisible `existingId` gives `PersonError("notfound")`. A centre out of scope gives `Forbidden` and a DENIED row (`scopedAction`). Validation failures, including empty `courses`, give `PersonError("invalid", "<field>: <rule>")`. `PossibleDuplicate` is thrown inside the action, rolling back with no audit row. No match check runs for `existingId` |
| C12 | Major | "404" is promised, but Stage 2 has no routes | Stage 2 throws `PersonError("notfound")`. The 404 mapping comes with the Stage 3 routes (`pageRead`, as for `TicketNotFound`). T-PER-004 asserts that the error for another centre's record equals the error for a missing one |
| C13 | Major | No glossary: acronyms, register codes, review IDs and mechanisms are undefined | Add a "Terms and references" table with paths, as in the ticket-engine design; link `zoom_out_report.md`; state the D-STU-4 default |
| C14 | Major | Goals G2/G5 list no tests; T-NUM-007/010 status unclear | Each goal names its T-PER test. T-NUM-007/010 stay unchanged (they test the allocator) |
| C15 | Nit | `confirmNew` missing from the Technical Plan signature | Add it |
| C16 | Nit | Composite FK listed as hand-written but "generated"; list numbering "2a" | Move it to the generated part; renumber |
| C17 | Nit | Role id 17 and "ALL scope" unexplained | Explain both in item 5 |
| C18 | Nit | "the `action:` slice" is vague | Reference `tests/audit.test.ts` T-AUD-009 |
| C19 | Nit | "every section approved" vs "nothing is approved" | One sentence: accepted in session, not approved for build |
| C20 | Nit | The REGISTER seed value is hard-coded, but legacy keeps issuing numbers until cutover | **0011 does not seed REGISTER.** The cutover script seeds it from the legacy value read at that time (NP-8). Until then a missing row fails loudly, as Z3 wanted. Tests seed it in fixtures |
| C21 | Nit | T-PER tests linked only to R-029 | Also link R-150 (T-PER-001, 002, 004) and R-095 (T-PER-005) |

## Resolution

**Status: resolved (2026-10-28).** The owner chose "Apply all": all 21 applied, with C1 (the admission series self-creates per year), C7 (only `given_name` required, now DD-6) and C20 (REGISTER seeded at cutover, not in 0011) as proposed. The design was rewritten in place with a Terms and references table.
