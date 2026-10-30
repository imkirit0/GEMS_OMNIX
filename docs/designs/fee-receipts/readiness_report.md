# Fee receipts: EGM step 9 implementation readiness report

**Reviewed:** commit f35a8c9, 2026-10-30.

**Verdict:** ready with fixes.

**Confirmed:**
* Database: `security_invoker` views are supported (PG 17.11 locally, 17.6 on Supabase). The activation insert passes the `number_series` RLS check, and the insert grant is missing today. `ticket_immutable` exists.
* Schema: the centre GST columns and the fee type's `gst_rate` and `hsn_sac` exist.
* Server code: the PersonError 404 exists, and so does the `field: rule` parsing. `scopedAction` writes DENIED only for `Forbidden`, and writes OK for any normal return.
* Tests: role 30 and user `…00f8` are free. T-RLS-002 picks up both tables, but its list has to be edited. The RLS-005 inventory is unchanged.

| ID | Severity | Finding | Fix |
|---|---|---|---|
| R1 | Major | The fixtures seed FEEREC only for `PERIOD`, and `reset()` runs before every test. From 2028-29, every collection would give `noseries`. `seriesCurrent` is fixed to `PERIOD`. | Seed the current FY's row in `beforeEach`. Give `seriesCurrent` a `period` argument. |
| R2 | Major | `lockKey` is private to `dues.ts`, and `FEE_GATES` creates an import cycle. | Export `lockKey`. Put `FEE_GATES` in `dues.ts` (or a gates file) and re-export it. |
| R3 | Major | It is unverified that commit-time errors reach `receiptDb` with the expected error shape. | Have `receiptDb` read `meta?.driverAdapterError?.cause ?? cause`. Add a test with a deferred trigger that raises at commit. |
| R4 | Major | Activation cannot tell a legacy centre from a new one. A legacy centre that is inactive at cutover would restart at 1. | The NP-8 seed covers every centre with legacy receipts, active or not. |
| R5 | Minor | `receiptDb` outside `scopedAction` means no DENIED row is written for a 42501. | Apply it inside and outside. |
| R6 | Minor | The replay's OK audit row targets the reserved id. | Put the original `receiptId` in the replay detail. |
| R7 | Minor | The backstop replay branch cannot be reached. | Map it to `mismatch`. |
| R8 | Minor | `fee.receipt.create` is missing from `tests/audit-catalogue.ts`. | Add it. |
| R9 | Minor | The type of `created_at` is unstated. The `= now()` check needs microseconds. | Use `@db.Timestamptz`. |
| R10 | Nit | The owner stamp expression is unclear. | Give the expression, and set `app.session_id` in the test. |
| R11 | Nit | Small gaps: currency before the tax check, `due_on` comes from a join, the previous-period expression, `gap_rule`, outstanding when null, the amount cast. | State each one. |
| R12 | Nit | The labels live inline at `page.tsx:34`. | Say so. |
