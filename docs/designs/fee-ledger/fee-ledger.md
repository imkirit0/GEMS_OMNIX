# Fee ledger, posted at receipt and at cancellation (Stage 4, F1; WF4; R-040, R-042 part, R-044.01)

*   **Author:** gtm
*   **Status:** Proposed. This version is revised after EGM steps 5–7, which ran in parallel ([`zoom_out_report.md`](zoom_out_report.md), [`comprehension_report.md`](comprehension_report.md), [`critic_report.md`](critic_report.md)), and resolves every finding below. DD-1…DD-10 are recommended options taken under the owner's standing instruction (2026-10-30: "keep working … agree on the recommended option … finish everything").
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs:
*   [`input-brief.md`](input-brief.md);
*   audit 07 F1, F2, F6 and F13;
*   [`fee-receipts.md`](../fee-receipts/fee-receipts.md) (DD-5's fifth go-live condition is the ledger);
*   [`receipt-cancel.md`](../receipt-cancel/receipt-cancel.md) (DD-6);
*   [`adhoc-fees.md`](../adhoc-fees/adhoc-fees.md).

--------------------------------------------------------------------------------

## Overview

Every receipt gets one balanced journal, and every cancellation gets one reversing journal. The **database** writes both, in the same transaction, through two security-definer **trigger functions**. Nothing else can call them, and the app has no write grant on journals. A user with `ledger.view` reads the journals as a Day Book.

## Goals

*   **G1: one journal per receipt, at commit (D-FIN-1 cash basis; D-FIN-2).** It runs after the receipt's total check has passed. The journal is dated `received_on`, carries the receipt's currency, and is referenced by `receipt_no`. Its lines are:
    *   **debit:** the mode's account (Cash in hand for CASH, Bank (clearing) for any other mode), for the receipt total;
    *   **credit:** each mapped account (an INCOME or LIABILITY account, DD-7), with the sum of its lines' `taxable` amounts, but only if that sum is above 0;
    *   **credit:** CGST, SGST and IGST, each with its sum if above 0.

    The posting function asserts that Σ debit = total = Σ credit, and that there is at least one line. A receipt whose fee type has no account is refused. The app checks this before writing; the database checks again at commit [T-FL-001].
*   **G2: one reversal per cancellation.** It mirrors the original entry's own lines, with debit and credit swapped, so a later re-mapping or bank split cannot change it (D3). It is dated on the IST date of `cancelled_at` and links to the original through `reversal_of`. A receipt cancelled in the same transaction that created it is refused by name: it has no posted entry yet [T-FL-001].
*   **G3: the database proves the ledger [T-FL-002]:**
    *   journals exist only through the trigger functions: gems_app has no insert grant, and the functions are triggers, not callable;
    *   every entry balances;
    *   there is one RECEIPT entry per receipt and at most one CANCEL entry;
    *   nothing changes or disappears;
    *   RLS restricts reads to `ledger.view` at the journal's centre;
    *   the definer owner bypasses RLS (asserted by T-RLS-005).
*   **G4: the Day Book (R-044.01) [T-FL-003, smoke].** A holder of `ledger.view` at a centre lists that centre's lines for a date range of at most 92 days. Each line shows date, reference, source (Receipt or Reversal), account, debit, credit and narration. Totals are given per currency.

## Non-Goals (DD-9)

*   **Ledger masters and reports:** an accounts master page (R-042), bank accounts and contra entries (R-035), journal and voucher prefixes (R-041), other A/c reports (R-044).
*   **Periods and other entry kinds:** periods and their close (F12), opening balances, migrated or imported receipts (D-FIN-7).
*   **The hash chain (D-FIN-8).** See Risks.
*   **Receipts with no journal.** None exist in production: collection has been off since F3 and nothing is on Supabase. So the migration posts nothing back, and a receipt with no RECEIPT entry cannot be cancelled (`journal_reversal_guard`).

## Technical Plan

### Migration `0030_fee_ledger`

**`app.account`.** Every column is NOT NULL unless marked.

| Column | Type | Rule |
|---|---|---|
| `id` | serial | |
| `code` | text | unique |
| `name` | text | |
| `kind` | text | `ASSET`, `LIABILITY`, `INCOME` or `EXPENSE` (check) |
| `system_key` | text, nullable | unique |
| `active` | boolean | default true |

*   **RLS:** ENABLE and FORCE, with a select policy `using (true)`.
*   **Grant:** `select` to gems_app. There is no write grant: the migration owns the chart.

**Chart seed (C5).** SPEC p. 15 codes are kept. Heads without a code get a `G…` code (PMC). Down Payment's second code 3954 is recorded in the name as "(legacy 3954)".

| Code | Name | Kind | system_key |
|---|---|---|---|
| 3908 | Registration Fee | INCOME | |
| 3909 | Course Fee | INCOME | |
| 3919 | Voucher Fee | INCOME | |
| 3920 | Academic Kit | INCOME | |
| 3921 | Welcome Kit Cost | INCOME | |
| 3922 | Down Payment (legacy 3954) | INCOME | |
| 3923 | Exam Fee | INCOME | |
| 3955 | Exam Processing Fee | INCOME | |
| 6871 | Additional Registration Fee | INCOME | |
| G101 | Mahotsavam Entry Fee | INCOME | |
| G102 | Material Fee | INCOME | |
| G103 | MSU Certification Fee | INCOME | |
| G104 | Online Fee | INCOME | |
| G105 | Re-exam Processing Fee | INCOME | |
| G106 | Re-examination Fee | INCOME | |
| G107 | Round Off | INCOME | (unused, DD-8) |
| 3724 | Caution Deposit | LIABILITY | (D-FIN-6: a liability) |
| 3910 | CGST | LIABILITY | CGST |
| 3911 | SGST | LIABILITY | SGST |
| 4385 | IGST | LIABILITY | IGST |
| G201 | Excess Fee | LIABILITY | |
| G202 | Excess Miscellaneous Fee | LIABILITY | |
| G203 | Fee Transfer | LIABILITY | |
| 3903 | Admission Fee Receivable | ASSET | |
| G301 | Receivables | ASSET | |
| G302 | CGST Receivable | ASSET | |
| G303 | SGST Receivable | ASSET | |
| G304 | IGST Receivable | ASSET | |
| G001 | Cash in hand | ASSET | CASH |
| G002 | Bank (clearing) | ASSET | BANK |
| BNK | Bank Charges | EXPENSE | |
| P001 | Purchase | EXPENSE | |

**`fee_type.account_id` (C6).**
*   It is an int, nullable, with an FK to `account` (restrict).
*   **Guard `fee_type_account_guard`** (invoker; fires on insert, and on update of `account_id`). A null value passes. A non-null value must be an active account of kind INCOME or LIABILITY.
*   **Grants:** `insert (account_id)` and `update (account_id)` on `fee_type`.
*   **`src/server/fees.ts`:**
    *   `createFeeType` takes an optional `accountId`.
    *   `updateFeeType` takes `accountId` (a number to map, `null` to unmap).
    *   The app checks the value first: `"accountId: an active income or liability account"`.
    *   `GUARD_KEY` gains `fee_type_account_guard` → key `fee.account`.
    *   `listFeeTypes` returns `accountId` and `accountCode`.
    *   Mapping changes are audited as fee-type fields.

**`app.journal_entry`.** Every column is NOT NULL except `reversal_of`.

| Column | Type | Rule |
|---|---|---|
| `id` | bigserial | |
| `centre_id` | int | |
| `entry_date` | date | |
| `fy` | text | check `fy = app.financial_year(entry_date)`; not called "period", which F12 needs (D10) |
| `currency` | char(3) | from the receipt (D6, C7) |
| `source` | text | `RECEIPT` or `RECEIPT_CANCEL` |
| `receipt_id` | bigint | FK `(receipt_id, centre_id)` → `receipt(id, centre_id)` |
| `reversal_of` | bigint, nullable | FK to `journal_entry`; check `(source = 'RECEIPT_CANCEL') = (reversal_of is not null)` |
| `reference` | text | |
| `narration` | text | |
| `created_at` | timestamptz | |

Constraints and indexes: unique `(id, centre_id)` (C3, Z5); unique `(receipt_id, source)`; index `(centre_id, entry_date)` (D12).

**`app.journal_line`.** Every column is NOT NULL.

| Column | Type | Rule |
|---|---|---|
| `id` | bigserial | |
| `entry_id` | bigint | FK `(entry_id, centre_id)` → `journal_entry(id, centre_id)` |
| `centre_id` | int | |
| `account_id` | int | FK to `account` |
| `debit` | numeric(14,2) | ≥ 0 |
| `credit` | numeric(14,2) | ≥ 0 |

A check requires exactly one of `debit` and `credit` to be above 0. Index on `entry_id`.

**Posting (D1, Z1, C2, D4, Z2).** There are two functions. Both are `security definer` with `set search_path = pg_catalog, app, pg_temp`, every name is schema-qualified, and both have `revoke all … from public`. Because they return `trigger`, they cannot be called directly. T-RLS-005 adds both to its inventory and asserts the search path (D8).

*   **`app.receipt_post_journal()`**
    *   Trigger: constraint trigger **`receipt_zpost`**, `after insert on app.receipt`, `deferrable initially deferred`, for each row. The name sorts after `receipt_total_commit`, so the total check fires first at commit (Z2, C1).
    *   It reads the receipt, then:
        *   requires `status = 'ACTIVE'` and no existing RECEIPT entry;
        *   reads the lines with each due's fee type's account (and the account's `active` flag and kind);
        *   refuses with `journal_account_guard` (23514) if any account is null, inactive, or not INCOME/LIABILITY;
        *   inserts the entry, then the debit line first, then the credit lines (D12).
    *   It asserts Σ debit = `total` = Σ credit and at least 1 line. Otherwise it raises `journal_balance_guard`.
*   **`app.receipt_post_reversal()`**
    *   Trigger: `receipt_post_cancel`, `after update of status on app.receipt`, for each row, `when (old.status = 'ACTIVE' and new.status = 'CANCELLED')`.
    *   It finds the RECEIPT entry. If none exists, it raises `journal_reversal_guard`. This also covers a cancel made in the same transaction as the receipt.
    *   It inserts the reversal: date = IST date of `new.cancelled_at`, the same currency, `reversal_of` = the original entry, reference = `receipt_no`, narration `Reversal of {receipt_no}`. The cancel reason is not put in the narration (D12).
    *   It copies the original lines with debit and credit swapped, then asserts the sums.
    *   The entry date is chosen in this one place. F12 adds its open-period rule here, and a later-period reversal is a credit-note question for Accounts (D10).
*   **Mode to account.** One branch decides it: CASH → `system_key = 'CASH'`, otherwise `BANK`. R-035 swaps in the receipt's bank account here (D14).
*   **Owner.** Both functions are owned by the migration role, which T-RLS-005 asserts is superuser or BYPASSRLS. That is why the FORCE-RLS journal tables accept their inserts, and why their reads of receipts and dues do not depend on the caller (D2).

**Immutability.** `journal_entry` and `journal_line` each get `_no_update_delete` and `_no_truncate` triggers that execute `app.ticket_immutable()`.

**RLS.** Both journal tables have ENABLE and FORCE, with these policies:
*   select: `centre_id = any ((select app.scoped_centre_ids('ledger.view'))::int[])` (D12);
*   insert, update, delete: `false`.

gems_app gets `select` only.

**Permission.** `('ledger.view', 'View the ledger (day book) of a centre', false)`, granted to `system_admin`.

**ETL reset (C11).** `scripts/etl/reset.sql` lifts `journal_line_no_truncate` and `journal_entry_no_truncate` (and re-enables them), and truncates `app.journal_line, app.journal_entry` in the same statement as the receipts.

### Server

*   **`receipts.ts`**
    *   **Early account check (D5).** After the open dues and the extras are read, and before the number is allocated, `collectFee` checks two sets of fee types: those of the PLAN dues the amount will touch, and those of the extras. Each must have an active INCOME or LIABILITY account. Otherwise it throws `fee.receipt.noaccount`: "A fee type on this receipt has no ledger account; ask head office."
    *   **`receiptDb`** maps `journal_account_guard` to `fee.receipt.noaccount`, and `journal_reversal_guard` to `fee.receipt.mismatch`.
*   **`src/server/ledger.ts`**
    *   `dayBook(session, centreId, from, to)`. It authorizes `ledger.view` at the centre (Forbidden otherwise). It requires ISO dates, `from ≤ to`, and a span of at most 92 days (`"to: within 92 days of from"`).
    *   Rows: `{ entryDate, reference, source, accountCode, accountName, debit, credit, narration, currency }`, ordered by entry date, entry id, line id.
    *   Totals: `{ currency, debit, credit }[]`, computed in SQL.
    *   `listAccounts(session)`: the active INCOME and LIABILITY accounts, for the fee-type form.
*   **Collection gate.** With the ledger in place, fee-receipts DD-5's fifth condition is met. The others still apply. The rollout adds one condition: **every active fee type is mapped to an account** (Z6).

### Pages

*   **`/ledger/day-book?centre=&from=&to=`**
    *   A form takes the centre (from the user's `ledger.view` centres) and a date range. The defaults are today in IST.
    *   It shows a table with a Receipt or Reversal column, and per-currency totals.
    *   A centre outside scope gives 404. Bad dates show the field error.
*   **Fee type pages.** The fee type list and form gain an "Account" select.
*   **Home page.** It links "Day book" for holders of `ledger.view` anywhere.

### Tests (`tests/fee-ledger.test.ts`)

**Fixtures (C9).**
*   Permission row `ledger.view`.
*   Role 32 `ledger_viewer` with `(32, 'ledger.view')`.
*   User `…00fc` at centre A with token `tok-ledA`.
*   `tests/fee-seed.ts` `masters()` maps Course Fee to 3909 and Registration to 3908. The ad-hoc and receipts tests map their extra types (C6, C8).

| ID | Goal | What it does |
|---|---|---|
| T-FL-001 | G1, G2 | **Postings:** a STATE cash receipt posts Dr CASH total / Cr 3908 and 3909 taxable / Cr CGST and SGST. An INTERSTATE UPI receipt posts Dr BANK / Cr IGST. A receipt with extras credits each extra's account. A USD receipt posts in USD with no tax lines. A cancel posts the mirror, dated today, with `reversal_of`. **Re-mapping:** after a fee type is re-mapped, a cancel still mirrors the original lines. **Refusals:** an unmapped fee type is refused early as `fee.receipt.noaccount` and uses no number. A same-transaction cancel (as owner) gives `journal_reversal_guard`. **Totals:** the ledger balances per entry and overall. |
| T-FL-002 | G3 | **Writes:** as gems_app, insert, update and delete on journals give 42501, and a direct call of the trigger functions is refused. As owner, update, delete and truncate are refused. **Balance (C10):** an owner-installed deferred test trigger on `receipt_allocation` adds an unbalancing line under `session_replication_role = replica` before `receipt_zpost` runs, so the receipt is refused with `journal_balance_guard`. Or, if it is simpler, a test receipt is given an inactive account mapping between collection and commit, giving `journal_account_guard`. The build picks the one that runs. **Access:** RLS hides lines from a user without `ledger.view`. **Fee-type mapping:** an EXPENSE account, an inactive account, or an unknown account is refused. **Definers:** T-RLS-005 inventory and search path. |
| T-FL-003 | G4 | **`dayBook`:** rows, sources, per-currency totals, the 92-day cap, a bad centre (Forbidden), other centres hidden. **Mapping:** fee setup maps an account, and it is audited. |

**Existing tests that change:**
*   T-RLS-002 lists `account`, `journal_entry` and `journal_line` (`account` has no `centre_id`, so only the two journal tables appear).
*   T-RLS-005 lists both trigger functions.
*   T-FS-001 covers the `accountId` message.
*   T-FR, T-RC and T-AF map their fee types.
*   T-FR-002 is unchanged, because the total check still fires first.

**Smoke.** The Day Book gives 404 without `ledger.view`. It renders for a holder whose centre has no lines.

## Decisions (recommended options)

1.  **DD-1:** The database posts through two definer trigger functions. Neither can be called, and the app has no grant on journals.
2.  **DD-2:** The chart is seeded from SPEC p. 15 (the table above). Codes for heads without one are PMC.
3.  **DD-3 (PMC):** CASH posts to Cash in hand. Every other mode posts to Bank (clearing) until R-035. Cheques are recognised at receipt; a dishonour is a separate source (D14).
4.  **DD-4:** The receipt journal is G1. The reversal mirrors the original lines (G2).
5.  **DD-5:** `ledger.view` is centre-scoped and gives the Day Book only.
6.  **DD-6 (PMC):** The Day Book range is at most 92 days.
7.  **DD-7 (PMC):** A fee type may map to an INCOME or LIABILITY account. Deposits and fees collected for others are liabilities (D-FIN-6). Accounts confirm the mapping list.
8.  **DD-8:** There is no Round Off line. Each receipt line carries its own residual, so every journal balances exactly.
9.  **DD-9:** Out of scope: see Non-Goals.
10. **DD-10:** Journals carry the receipt's currency, and Day Book totals are per currency, until D-CUR-1 decides on foreign-currency accounting.

## Risks and Limits

*   **Owner trigger bypass.** An owner can still disable triggers until D-FIN-8 exists. The chain needs a per-centre chain head, locked in the posting functions, plus a canonical serialisation of each entry and its lines. The ETL reset that clears journals must then also reset the chain, and must be impossible in production (Z7, D13).
*   **Balance check placement.** F1's balance is checked inside the posting functions, not by a separate deferred trigger on `journal_line` (D9). Only these functions write lines, and an owner's direct write already bypasses everything.
*   **`receipt_id` is required.** Contra, opening and closing entries will need it to become nullable, with a matching check. That is a one-line change when they come (Z3).
*   **Placeholder codes.** "Bank (clearing)" and the `G…` codes are placeholders for Accounts (PMC).

## Revision after EGM steps 8 and 9 (approved)

This revision resolves [`zoom_out_step8_report.md`](zoom_out_step8_report.md) and [`readiness_report.md`](readiness_report.md), and supersedes the text above wherever they differ. The build is approved as the recommended option under the owner's standing instruction. This is not an owner signature.

1.  **No early account check (Z8-1; R4 moot).** `collectFee` does not pre-check accounts. `journal_account_guard` refuses the receipt at commit, which rolls back the number, and `receiptDb` (outer wrapper) maps it to `fee.receipt.noaccount`. The "Early account check" in Server is withdrawn.
2.  **Trimmed seed (Z8-2).** The migration seeds only the INCOME and LIABILITY heads from the table above, plus `G001 Cash in hand (CASH)` and `G002 Bank (clearing) (BANK)`. 3903, G301–G304, BNK, P001 and G107 Round Off arrive with R-042, R-035 and the reports.
3.  **Balance test (Z8-3, R3).** T-FL-002 runs as the owner in one transaction:
    1.  Set `set_config('app.session_id', 'tok-feeR')` and bump the FEEREC series.
    2.  Run `alter table app.receipt disable trigger receipt_total_commit`.
    3.  Insert a receipt with total 11.00 and one 10.00 line.
    4.  Commit, and expect `journal_balance_guard`.

    The failed commit rolls back the ALTER, and `fileParallelism` is false. Every entry the suite creates is also checked to balance (T-FL-001). The commit-time `journal_account_guard` gets its own case: an unmapped fee type.
4.  **No `fy` column (Z8-4).** The Day Book filters by date, and F12 adds periods.
5.  **One rule, one check (Z8-5).** The unique key `(receipt_id, source)` replaces the "no existing RECEIPT entry" check. The reversal copy is not re-asserted, because the original entry was proven balanced.
6.  **Guard messages (Z8-6, R9).** Every new guard message carries `constraint "<name>"` (the 0027 convention). The `receiptDb` branches for `journal_account_guard` → `fee.receipt.noaccount` and `journal_reversal_guard` → `fee.receipt.mismatch` go before the generic 23514 branch.
7.  **T-AF-002 `voidInOne` (R1).** A cancel in the receipt's own transaction now raises `journal_reversal_guard` (G2) before the deferred paid check. The test expects that, and says so.
8.  **Prisma (R2).** `schema.prisma` gains:
    *   `Account` (`code @unique`, `systemKey @unique`);
    *   `JournalEntry`, with a `reversalOf` self-relation, `@@unique([id, centreId])`, `@@unique([receiptId, source])`, `@@index([centreId, entryDate])` and `currency @db.Char(3)`;
    *   `JournalLine`, with `Decimal(14,2)` amounts and `@@index([entryId])`;
    *   `FeeType.accountId Int?`, with its relation.

    Every FK is Restrict/Restrict. The migration head comes from `migrate diff`.
9.  **Fixtures (R5, R6).** `reset()` lists `app.journal_line, app.journal_entry` in its truncate, and runs `update app.account set active = true`. These lists gain rows:

    | List | Row |
    |---|---|
    | permission | `ledger.view` |
    | role | `(32, 'ledger_viewer', 'Ledger viewer')` |
    | role_permission | `(32, 'ledger.view')` |
    | app_user | `LV = { a: "…00fc" }` |
    | role_assignment | CENTRE 1 |
    | session | `tok-ledA` |

10. **Fee type wiring (R7, R12).**
    *   `app/admin/fees/types/save/route.ts` reads `accountId` (empty → `null`).
    *   `app/admin/fees/types/page.tsx` loads `listAccounts` (session only).
    *   `updateFeeType` accepts `accountId: number | null`.
    *   `GUARD_KEY` gains `fee_type_account_guard: ["fee.account", "this account cannot take fees"]`.
    *   The app's field check gives `"accountId: an active income or liability account"`.
11. **Home link (R8).** `ledgerCentres(session)` in `ledger.ts` returns the `ledger.view` centres. It feeds the Day Book picker and the home link.
12. **Order (R10).** The RECEIPT narration is `Receipt {receipt_no}`. Lines are written in this order: the debit line, then the credits by account code, then CGST, SGST and IGST.
13. **Direct call (R11).** Calling a trigger function directly gives 42501.
14. **Range (R13).** `to - from <= 91`, so at most 92 days counting both ends.
15. **Rollout (R14).** "Every active fee type is mapped" is a rollout checklist item. The gate comment in `dues.ts` says so.
16. **`created_at` (R15).** `default now()`.
