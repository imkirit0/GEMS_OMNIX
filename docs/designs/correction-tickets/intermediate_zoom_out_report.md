# EGM Stage 8: Intermediate zoom-out report (correction tickets)

- **Target:** `docs/designs/correction-tickets/correction-tickets.md` (commit `9283a9d`, after steps 5–7).
- **Reviewer:** `egm-zoom-out` (fresh context). Read the design, the three reports, `src/server/tickets/*`, `admin-http.ts`, `action.ts`, `people.ts`, `app/tickets/[id]`, `app/tickets/new`, migration 0009, `tests/audit-catalogue.ts`, `tests/tickets.test.ts`, ticket-engine DD-7 and DD-16.
- **Date:** 2026-10-29
- **Result:** **0 Blocker, 6 Major, 11 Nit** (I1–I17); OWNER only on I15 (optional, not taken up). Verdict: the core is still the simplest design; the gates, value hiding and the duplicate audit grew during review and are simplified; two stale passages contradicted D1 and D6.
- **Held up:** one factory, `changeIdentity()` reused, no migration; `prepare` and `review` justified; the re-raise checks split cleanly between engine (status, raiser) and handler (same person); the final-approval order matches the engine.

## Findings and resolution

| ID | Sev | Finding | Resolution |
|---|---|---|---|
| I1 | Major | Order of Checks still had the pre-D1 order | Rewritten with the re-raise checks first |
| I2 | Major | Two flags, three refusal sites, prefix-based domain knowledge in the engine; engine Q2 and DD-16 apply to any type | One `gateRefusal()` for every type; existing tests set the gates in `beforeAll` |
| I3 | Major | Value hiding split across three places with disagreeing signatures | `valuesPermission` on the handler; `getTicket` returns `payload: null` otherwise; `describe(payload)` only |
| I4 | Major | Who writes the duplicate audit row, and how | `ticketReview` is a `scopedAction` (as `documentLink`); every review audited |
| I5 | Major | DD-17's lines cannot come from `findMatches` | `approverMatches()` query stated, per admission, with the `named` flag |
| I6 | Major | DD-11 and DD-14 still said "in production" | DD-11 marked superseded; DD-14 and DD-18 "in every environment" |
| I7 | Nit | DD-9 said "a new ticket" only | Re-raise or new ticket |
| I8 | Nit | `invalidMessages` plumbed differently from `staleMessages` | The same handler scan as the ticket page |
| I9 | Nit | The `source` shape check separate from prepare's step | Merged into step 3 |
| I10 | Nit | `IdentityKey` redefined | From `IDENTITY_KEYS`; `person-rules.ts` imported |
| I11 | Nit | Tests and plan disagreed; missing D9 and `ApplyFailed` cases | Tests table rewritten; C1 lists 001…006 |
| I12 | Nit | Risks gaps | Rows for DD-19, payload erasure, the NP wait |
| I13 | Nit | G1 unreachable in production until NP | Stated in G1 |
| I14 | Nit | How a local run sets a gate | Tests set the fields; a manual run edits the constant |
| I15 | Nit, OWNER | `describe` cosmetic once I3 applied | Kept (DD-6 as accepted) |
| I16 | Nit | Terms wording; "raised again through prepare" | Fixed |
| I17 | Nit | Advisory lock for a null key; corrected identity built twice | No lock when null; one `corrected()` helper; lock in Order of Checks |

## Resolution

**Status: resolved (2026-10-29).** No owner decision reopened; DD-18 now covers every ticket type (engine Q2 already required that), DD-11 is superseded by DD-14. All seventeen applied, the Technical Plan rewritten as one text.
