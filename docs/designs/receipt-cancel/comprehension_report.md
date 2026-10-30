# Receipt cancellation: EGM step 6 comprehension report

**Reviewed:** commit 6a6de00, 2026-10-30, alongside steps 5 and 7.

**Verdict:** buildable once revised. There are 2 majors and 8 nits. Role 31 and user `…00fb` are free.

| ID | Severity | Finding | Resolution |
|---|---|---|---|
| C1 | Major | The design names the wrong test as the one that changes. The 42501 case for `set total` stays as it is. What breaks is the owner `update` case in the "kept for good" loop. | Rewrite that line of the design. |
| C2 | Major | A sensitive permission makes TOTP mandatory for whoever holds it (0005, 0013). The design never says so. | State it, and define what "sensitive" means here. |
| C3 | Nit | The `receipt_no_delete` function is not named. | Name it: `app.ticket_immutable()`. |
| C4 | Nit | The design does not say why it skips `adminWrite`. | Say why: its `db()` hides which guard refused. |
| C5 | Nit | The kind of not-found error is unclear. `RbacError` notfound redirects; it does not give a 404. | Name the error class and what the route returns. |
| C6 | Nit | The audit needs `receipt_no` and `total`, but the design does not read them. | Read them in the same query. |
| C7 | Nit | The reason check must allow null on ACTIVE rows. | Write out the full check. |
| C8 | Nit | The `?cancelled=1` text, the labels constant and the duplicated CANCELLED suffix are unspecified. | Specify them. |
| C9 | Nit | `tests/audit-catalogue.ts` is not mentioned, and "triggers off" is not defined. | Name the file and the replica method. |
| C10 | Nit | The fixture lists that must change are not named. | Name them. |
