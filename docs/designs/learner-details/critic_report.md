# EGM Stage 7: Critic report (learner details)

- **Target:** `docs/designs/learner-details/learner-details.md` (commit `45f0bab`, after steps 5–6).
- **Reviewer:** `egm-design` (fresh context, adversarial). Read the design, both earlier reports, `people.ts`, `admission-form.ts`, `action.ts`, `db.ts`, `page-read.ts`, `auth/http.ts`, `app/students/**`, migrations 0002, 0008, 0011, 0014, `etl/canonical.ts`, `etl/run.ts`, `etl/rules/*`, `scripts/etl/reset.sql`, `setup.sql`, `tests/fixtures.ts`, `schema.prisma`, `scripts/ci.sh`; grepped `tests/people.test.ts` and `scripts/smoke-security.mjs`. Not read: the admission-screens design document (its patterns were covered through the code).
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 8 Major, 10 Nit** (D1–D18); OWNER on D5, D7, D17. Verdict: sound, no re-architecture.
- **Held up:** re-exported `PersonError` keeps `instanceof`; no circular import; the ETL hash covers what the rules use; edit page, view-only and forged centre share one 404; `withScope` retries are safe; the person-row lock closes the first-edit race.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| D1 | Major | Policies "as person" let any role update and any admitting user insert details for another centre's learner | Insert/update policies on `student.admit` at a centre where the person is admitted; direct-SQL tests |
| D2 | Major | `detailField` rejected `null`, contradicting "null clears" | `v == null` → `null` |
| D3 | Major | A missing input would clear the stored value | Read a key only when posted (`fd.has`) |
| D4 | Major | Selects without an empty option post their first value for a stored null | Empty first option everywhere; IN default on the admit form only; untouched-form test |
| D5 | Major, OWNER | Details typed for an existing learner silently dropped | **Owner: save if none yet (DD-13);** otherwise a form message (a redirect cannot carry a note) |
| D6 | Major | `reset.sql` truncates `person` without the new referencing table: reset and P8 would fail (verified) | Table added to reset, preflight and fixtures |
| D7 | Major, OWNER | Family personal data in the append-only audit log can never be erased | **Owner: field names and keyed fingerprints only (DD-14),** revising DD-9 |
| D8 | Major | NUL, lone surrogates, control characters; an unmapped check violation logs the failing row | Rejected in `detailField`; check violations mapped in `personDb` |
| D9 | Nit | Length and trim semantics differ between JS and Postgres | Code-point length; regex check matching the trim |
| D10 | Nit | `for update` blocks a concurrent new admission | `for no key update` |
| D11 | Nit | How update columns are built | Fixed key→column table from `DETAIL_KEYS` |
| D12 | Nit | `Number("")` is 0; T-LD-002 forged-centre case ambiguous | `/^\d+$/` before `Number`; both variants tested |
| D13 | Nit | `schema.prisma` model missing; Prisma's default `onUpdate: Cascade` | `PersonDetail` model with restrict |
| D14 | Nit | "One last bump" false while `detailField` and the lists are unhashed | They move into the hashed set |
| D15 | Nit | Other centres' auditors do not see the change by centre | Accepted, stated |
| D16 | Nit | Re-render after an error could restore cleared values | Echo all inputs, `""` included; re-render from state only |
| D17 | Nit, OWNER | Required fields push clerks to invent values | **Owner: "Not known" for employment status and qualification (DD-15)** |
| D18 | Nit | Details created at admission have no audited values | Key names in the `person.admit` audit; creation is not an edit |

## Resolution

**Status: resolved (2026-10-29).** Owner decisions: D5 → DD-13, D7 → DD-14 (revises DD-9), D17 → DD-15. All 18 applied.
