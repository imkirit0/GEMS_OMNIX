# EGM Stage 7: Critic report (catalogue skeleton)

- **Target:** `docs/designs/catalogue-skeleton/catalogue-skeleton.md` (360 lines, commit `3fa1d84`), FeatureRange 1..286.
- **Reviewers** (fresh context, in parallel): `egm-design` (also read 0005_rbac, `bootstrap-admin.mjs`, `ci.sh`, the ETL canonical/types/reset/setup files, foundation and audit tests), `egm-structural`, `egm-style`.
- **Date:** 2026-10-28
- **Result:** **0 Blocker, 13 Major, 22 Nit** (D1–D11, S1–S11, W1–W13); D1 marked OWNER.

## Design (D)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major, OWNER | No one can ever be granted `catalogue.manage` through the app (an RBAC admin grants only what they hold); the risk row's mitigation could not work | **DD-12 (smallest working option, flagged):** `bootstrap-admin.mjs` gives the first administrator `catalogue.manage`, who creates the catalogue role |
| D2 | Major | `admit()` read `open`/`active` unlocked; a concurrent close slipped in | `app.catalogue_admit_lock()` definer function with key-share locks (0009 pattern); T-RLS-005 inventory; concurrency test and mutation |
| D3 | Major | `normCode()` and the check disagreed (control characters; `ß`→`SS`; Unicode trim) | `normCode()` returns non-ASCII input unchanged and trims ASCII only; `CODE_RULE` field error; agreement defined in three conditions with new samples |
| D4 | Major | The database half of access was never tested | Direct `withScope` statements as `T.uA` and `ca` in T-CAT-003 |
| D5 | Nit | Prisma defaults to `ON UPDATE CASCADE` | `onUpdate: Restrict` on the new relations |
| D6 | Nit | Object lookup accepts `constructor` | `Object.hasOwn`; test case |
| D7 | Nit | Wrong reason given for `sensitive = true` | TOTP mandatory, as `ticket.type.manage` |
| D8 | Nit | Half-date updates unvalidated; category/division read unlocked | Merged dates validated; `for share` read |
| D9 | Nit | `normCode` threw on a non-string | Non-strings give `""` |
| D10 | Nit | No code length limit | At most 30, in check and validation |
| D11 | Nit | Existing migration environments lack the grant; empty catalogue passes a dry run | Stated; empty-catalogue preflight refusal |

## Structure (S)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| S1 | Major | G2 contradicted DD-11 and the Risks | G2 split into database (existence) and `admit()` (live) parts |
| S2 | Nit | G1 implied normalised year codes | Wording |
| S3 | Nit | Open questions table inconsistent | D-YEAR-3 in Non-Goals; D-ORG-6 row; X5 marked as a discrepancy; owner named |
| S4 | Nit | PMC unused; status line listed only DD-1…4 | Column labelled PMC; status line points to all decisions |
| S5 | Nit | T-xxx, P8, runner step undefined; G-FIN prefix | Terms rows |
| S6 | Nit | Exclusions hidden in the Technical Plan | Moved to Non-Goals |
| S7 | Nit | Inconsistent table cells | Uniform action names, before/after wording, test column |
| S8 | Nit | Bold pseudo-headings | H4 headings |
| S9 | Nit | Circular rejection reasons | Reasons stated |
| S10 | Nit | Risk relied on an excluded migration | Rewritten (DD-12) |
| S11 | Nit | Dense paragraph; inconsistent path | List; full path |

## Style (W)

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| W1 | Major | "code" for data and source code | "application code" where meant |
| W2 | Major | "Master" used broadly | Master = the three code-and-name tables; "course record", "centre record", `academic_year` |
| W3 | Major | "Catalogue" undefined | Terms row (the five tables) |
| W4 | Major | "Open a year" two meanings | "Create a year" vs "close/reopen" |
| W5 | Major | "Step" senses; undefined runner step | Runner step named; contract migration; EGM review step only |
| W6 | Major | Undefined labels | Terms rows (DQR, P8, class-revision ticket, merge maps, contract migration, AY/FY, action, error codes) |
| W8 | Major | Overloaded Functions cells | Explicit shapes, split columns |
| W9 | Major | Overloaded sentences | Split into lists |
| W7, W10–W13 | Nit | Synonyms, pronouns, hidden actors, vague wording, evidence classes | Applied |

## Resolution

**Status: resolved (2026-10-28).** All 35 applied under the owner's standing instruction "apply all fixes when the reviews are done"; none reverses an owner decision. D1 was resolved with the smallest working option (DD-12, the bootstrap administrator holds `catalogue.manage`), flagged to the design owner.
