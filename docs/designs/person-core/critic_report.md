# EGM Stage 7: Critic report (person core)

- **Target:** `docs/designs/person-core/person-core.md` (395 lines, commit `769320a`), FeatureRange 1..240.
- **Reviewers** (fresh context, in parallel): `egm-design` (feature-spec standard; also read `action.ts`, `db.ts`, `numbering.ts`, `tickets/handlers.ts`, `engine.ts`, migrations 0002, 0007, 0009), `egm-structural`, `egm-style`.
- **Date:** 2026-10-28
- **Result:** **1 Blocker, 21 Major, 16 Nit** (D1–D13, S1–S10, W1–W15). D8 and S1 are the same finding.

## Design (D)

| ID | Sev | Finding | Proposed resolution |
|---|---|---|---|
| D1 | Major | C1 let the `ADMISSION` series self-create for **any** year. A call before cutover issues `GTEC26271…`, which legacy has already issued; a late admission for an earlier year restarts that year at 1. `admission_no` uniqueness only catches it when the legacy rows are loaded | **OWNER.** A year's row self-creates only when the previous year's row exists ("chained years"). Before cutover no row exists, so `admit` fails loudly; the cutover script seeds the year in progress (and any earlier year that still takes late admissions); from then on each new year opens itself at 1. Tests seed a year in fixtures |
| D2 | Major | `changeIdentity` does not tie the person to the ticket's centre. An HO approver sees every person, so a ticket raised at centre B could rename a centre-A learner | `changeIdentity(tx, centreId, personId, changes, reason)`: `PersonError("notfound")` unless the person has an admission at `centreId`. Correction handlers make the same check in `validate`, in the raiser's transaction. New T-PER-005 case |
| D3 | Major | DD-4 says only HO links an existing person at a new centre, but the mechanism lets any user who can see the person (RLS = any role at a centre) do it, e.g. a regional admin | **OWNER.** Enforce DD-4: when the person has no admission at `centreId`, `admit` requires `student.admit` at ALL scope. Test with a regional user |
| D4 | Major | After a move the old centre's registrations stay ACTIVE, so per-centre "active learners" double-count | **OWNER.** Record as a known limit: Stage 2 has no users and no move screen; ending the old registrations (TRANSFER) is the Stage 3 transfer ticket's job. The HO-move test asserts the old registrations are untouched |
| D5 | Major | `findMatches` is a plain read: two concurrent or double-submitted admits of the same new learner both pass | `admit` takes `pg_advisory_xact_lock(hashtext(match_key))` before `findMatches` when the key is not null, so same-key admits serialise and the second sees the first. Null-key duplicates are accepted (Risks). A client idempotency key is an optional field Stage 3 can add without breaking callers |
| D6 | Major | `lower(given \|\| family)` is null when `family_name` is null (DD-6 allows that), so single-name learners never match; swapped name order never matches either | Name part = the letters of `given` and `family` (each `coalesce`d to `''`), split into words, sorted and joined. New T-PER-002 cases: null `family_name`; swapped order |
| D7 | Major | Renaming `ticket_number_series` breaks the running ticket code until the new app is deployed: not an expand migration | **OWNER.** State the constraint: migration 0011 and the app deploy together. No production system exists yet, so there is no skew window today; the rename is listed under Risks |
| D8 | Major | No Risks & Limits section (= S1) | Add `## Risks and limits` (see S1) |
| D9 | Nit | `admit` authorises on `student.admit` but `findMatches` scopes on `student.view`; a role with only admit never sees a match | `findMatches(tx, identity, permission)`; `admit` passes `student.admit` |
| D10 | Nit | An overridden duplicate warning is not recorded | `person.admit` audit detail carries `dismissedCandidates` when `confirmNew` was used |
| D11 | Nit | Person RLS (any role at an admitting centre) is wider than `student.view` | Accept and say so (Risks): narrowing it would hide the person from a ticket approver without `student.view`, which `changeIdentity` needs |
| D12 | Nit | Alternatives omit Postgres sequences | Add one line: sequences leave gaps and do not roll back; NP-8 (gapless?) is unsigned, and a rolled-back admission must release its number |
| D13 | Nit | `admittedOn` is not checked against `academicYear` | Deliberately independent until the Academic Year Master (D-YEAR-3) defines year boundaries; say so |

## Structure (S)

| ID | Sev | Finding | Proposed resolution |
|---|---|---|---|
| S1 | **Blocker** | No Risks & Mitigations section; risks are scattered asides | `## Risks and limits` after Alternatives: a table Risk / Impact / Mitigation or acceptance / Test. Collects D1, D2, D4, D5, D7, D11, the hot counter rows, PII in the append-only audit log (DPDP erasure, D-SEC-4), the 43,513 vs 56,336 count, and the convention-only write path |
| S2 | Major | Decisions are an H3 inside the Technical Plan and restated two or three times; they carry review-finding provenance | `## Decisions` as its own section, one authoritative statement each; elsewhere cite DD-n. Provenance stays in the review reports |
| S3 | Major | No Open Questions section; unsigned decisions are scattered | `## Open questions`: ID / Owner / What it affects here / Default used now |
| S4 | Major | The Problem section restates the solution | Delete the "Proposed solution" block; Overview and Technical Plan already say it |
| S5 | Major | The feature spec points at plan items ("item 4"); the match-key rule lives only there | State the match-key rule in Data model; plan references become "(Implementation Plan, item N)" |
| S6 | Major | G6 is verified by P8, which is a non-goal | G6 becomes CI-verifiable: no migration-only columns, and a bulk insert gets `match_key` from the database (T-PER-002). T-MIG-004 at P8 is downstream confirmation |
| S7 | Nit | Unclear whether T-NUM-007/010 change | They are unchanged and keep passing against `allocateGlobal` (they test `number_series`) |
| S8 | Nit | The rename is stated twice | Once, in Numbers |
| S9 | Nit | Rejection reasons D, G, H cite the owner rather than a reason | Substantive reason first, then DD-n; same Cons formatting |
| S10 | Nit | Goal tags on some headings only; empty Terms cell | No goal tags in headings; fill the cells |

## Style (W)

| ID | Sev | Finding | Proposed resolution |
|---|---|---|---|
| W1 | Major | Undefined labels: RLS, Z-n/C-n, DD-n before definition, ticket-engine path, `allocateGlobal`, `mustExist`, cutover script | Terms rows for each; finding IDs leave the design (S2) |
| W2 | Major | "HO" means users, a place and an organisation | "Head office"; "an HO user" for the access sense |
| W3 | Major | "Scope" means numbering scope once, centre visibility elsewhere | Reword the numbering sentence |
| W4 | Major | Hidden actors ("is flagged", "the row creates itself", "an approved dedupe map") | Name the actor (`admit()`, `allocateGlobal`, the D-MIG-4 owner) |
| W5 | Major | Unclear which allocator exists today | Say: today `allocateTicketNumber` over `ticket_number_series`; this design generalises it |
| W6 | Major | Match-key rule ambiguous | Exact rule in Data model (with D6) |
| W7 | Major | Overloaded table cells and Status line | One-sentence Notes cells, rationale in bullets below; short Status |
| W8 | Major | "fails loudly" names no error | `SeriesMissing` from `allocateGlobal` |
| W9–W15 | Nit | Figurative wording, unclear pronouns, inconsistent terms ("persons"/"people", "the legacy"), stacked parentheses, multi-term Terms rows, inline return shape, symbols and fragments | Apply as suggested |

## Resolution

**Status: resolved (2026-10-28).** The owner chose the recommended option on each decision: D1 chained years (new DD-7), D3 enforce DD-4 with ALL-scope `student.admit`, D4 record as a limit, D7 keep the rename and state the deploy constraint. All 38 findings applied; the design gained `## Decisions`, `## Open questions` and `## Risks and limits`, Alternative H (sequences), and the plan items, tests and mutation checks that follow from D1–D6.
