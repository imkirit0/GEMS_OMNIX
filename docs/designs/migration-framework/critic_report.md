# EGM Stage 7: Critic report (migration framework)

- **Target:** `docs/designs/migration-framework/migration-framework.md` (528 lines, commit `9cccca5`), FeatureRange 1..451.
- **Reviewers** (fresh context, in parallel): `egm-design` (feature-spec standard; checked against migrations 0001/0002/0008/0011, `people.ts`, `numbering.ts`, `db.ts`, fixtures, CI, `poc/test/rls.test.js`, C-03, audit 08), `egm-structural`, `egm-style`.
- **Date:** 2026-10-28
- **Result:** **1 Blocker, 23 Major, 29 Nit** (D1–D18, S1–S15, W1–W20). D18 = S1 = W8; S9 = W12.

## Design (D)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | **Blocker** | Table-level insert let `gems_etl` register a rule already approved (and write `key_map.approved_*`) | Column-level insert grants on `migration.rule` and `migration.key_map` without `approved_*`; no update on `migration.rule`; G6 tests expect 42501 |
| D2 | Major | K3 checked one direction only: a lost target batch passed every check | K3 both directions; K4 joins the survivor to the target table; mutation "skip a person batch" |
| D3 | Major | The partial index allowed IMPORTED plus SPLIT rows; K1/K2 could not see duplicates | `btree_gist` exclusion constraint (no mixed dispositions) plus the unique index (only SPLIT repeats); K2 counts rows; a direct duplicate-insert test |
| D4 | Major | The `parent` model could not express admission → centre by code | `parent` is a resolver; a shared code resolves to the earliest centre key |
| D5 | Major | A cutover could PASS with K7/K8/K10/K11 null | A cutover passes only with K1–K11 all true; in Stage 2 a cutover run cannot pass, by design |
| D6 | Major | The code hash covered only the rule file; the approval did not bind the reviewed commit | `hashFiles` (rule, `types.ts`, `canonical.ts`, `people.ts`); the approval statement requires the reviewed commit's hash and must update 1 row |
| D7 | Major, OWNER | Admission Nos of years after the newest seed year would collide after go-live | **Resolved with the safe default under NP-8, extending DD-6:** listed as `laterYearNumbers`; a cutover run is FAILED while the list is non-empty, until the decision owner adds the year to `seedYears`. Flagged to the design owner |
| D8 | Major | The digest was not machine-independent (collation, UTF-16 sort, driver date parsing, ctype, salt) | `collate "C"` everywhere; values read as `::text`; code-point comparator; `lc_ctype` recorded and compared; fingerprints left out of the digest |
| D9 | Major | Per-entity transactions could leave persons without admissions; nothing enforced a clean, exclusive run | One write transaction (targets, key map, exceptions, counters); session advisory lock; preflight refuses a non-empty database |
| D10 | Nit | Outcomes depended on the wall clock | `asOf` option for `admitted_on`, stored in the run; the date-of-birth limit stated in Risks |
| D11 | Nit | No lock-down of `raw` and `migration` | Revokes from `public`, `anon`, `authenticated`; reach check extended |
| D12 | Nit | Unneeded grants | Counter and rule tables insert-only for `gems_etl` |
| D13 | Nit | `input_hash` was needed before raw was loaded | Raw loaded (step 1) before the run row (step 2) |
| D14 | Nit | A refused run left rule rows | Registration rolled back on refusal |
| D15 | Nit | Role attributes not re-asserted; plaintext password in logs | Attributes always re-asserted; plaintext statement accepted as a risk |
| D16 | Nit | Survivor resolution unspecified | `survivor_target_id` = the survivor's own target id, no chain following; a non-IMPORTED survivor fails the run |
| D17 | Nit | K3 scope included pre-existing centres | K3 covers the three inserted tables |
| D18 | Nit | `--legacy-current` flag, but there is no CLI | `legacyCurrent` option |

## Structure (S)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| S1 | Major | A risk row named a CLI flag, and a goal as its test | `legacyCurrent`; test "P8, continuity case" |
| S2 | Major | DD-9 missing from Open questions and Risks | Own Open-questions row; risk row; unparsable numbers block a cutover |
| S3 | Nit | DD-11 carried review history | Removed |
| S4 | Nit | Mixed test-reference forms in Goals | One bracketed form |
| S5 | Nit | The Problem did not motivate G5, G7 | Problems 4 and 6 added |
| S6 | Nit | Foreign ids; G-FIN | Prefix rule in Terms; G-FIN explained |
| S7 | Nit | Which functions are newly exported | Stated |
| S8 | Nit | Reason notation; empty cell; vague cross-reference | Backticks throughout; outcome tables; named links |
| S9 | Nit | "Centre A", "three fixture centres" undefined | Terms row with codes |
| S10 | Nit | "admin" undefined | Schema owner |
| S11 | Nit | D-TZ-1 default | Updated |
| S12 | Nit | No salt-leak risk; wrong test on an accepted risk | Risk row; "n/a (accepted)" |
| S13 | Nit | Evidence classes rarely applied | Untagged Technical Plan statements are PRO |
| S14 | Nit | Heading case, bold labels | Title Case headings; colon inside bold |
| S15 | Nit | Rejection reasons cited instead of reasoning | Each restates the deciding con |

## Style (W)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| W1 | Major | "Stage" in three senses | Stage = roadmap; "EGM review step"; "intermediate tables" |
| W2 | Major | "Owner" for four parties | Design owner, schema owner, rule owner, decision owner |
| W3 | Major | "Migration" for Prisma and data | "Migration" = data migration; "Prisma migration *n*"; the role is the schema owner |
| W4 | Major | "Rule" for mapping rules and constraints | "Mapping rule", "constraint", "check", "principle" |
| W5 | Major | "Earlier" for rows and entities | Ctx comment rewritten; row order scoped |
| W6 | Major | "Usable" undefined for course rows | Defined generically in Terms |
| W7 | Major | Undefined labels | Terms rows for audit versions, DQR/XL, test ids, drift gate, EGM, G-FIN |
| W8 | Major | CLI flag | = D18 |
| W9 | Major | Default seed year described two ways | Fixed value `2026-27` in both places |
| W10 | Major | Overloaded fingerprint sentence, absolute claim | Split into three sentences |
| W11 | Major | Overloaded cells and step 1 | Outcome tables per entity; step 1 as a list |
| W12 | Major | Centre names undefined | = S9 |
| W13 | Major | "Unreachable" jargon | G2 reworded |
| W14–W20 | Nit | Hidden actors, pronouns, "key" senses, one object with many names, status names as verbs, figurative wording, list separators | Applied |

## Resolution

**Status: resolved (2026-10-28).** All 53 applied under the owner's standing instruction "apply all fixes when the reviews are done". D7 was the one OWNER item; it was resolved with the safe default (later-year numbers block a cutover), which extends DD-6 without reversing it, and is flagged to the design owner. The feature part of the design was rewritten in place.
