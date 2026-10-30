# Fee ledger, posted at receipt and at cancellation (Stage 4, F1; WF4; R-040, R-042 part, R-044.01)

*   **Author:** gtm
*   **Status:** Proposed. DD-1…DD-8 are recommended options under the owner's standing instruction (2026-10-30: "keep working … agree on the recommended option … finish everything").
*   **Date:** 2026-10-30

Evidence classes follow `docs/audit/00-README.md`. Inputs: [`input-brief.md`](input-brief.md); audit 07 F1, F2 and F6; `docs/designs/fee-receipts/fee-receipts.md`; `docs/designs/receipt-cancel/receipt-cancel.md`; `docs/designs/adhoc-fees/adhoc-fees.md`.

--------------------------------------------------------------------------------

## Overview

Every receipt gets one balanced journal, and every cancellation gets one reversing journal. The **database** writes both, inside the same transaction, through one security-definer posting function. The app cannot write, change or delete a journal. A head office or centre user with `ledger.view` reads the journals as a Day Book.

## Goals

*   **G1: one balanced journal per receipt (D-FIN-1 cash basis; D-FIN-2).** When the receipt's transaction commits, the database posts one journal, dated `received_on`, referenced by `receipt_no`:
    *   Dr the mode's account: Cash in hand for CASH, otherwise Bank (clearing). The amount is `total`.
    *   Cr each income account with Σ `taxable` of its lines. The account comes from the line's due's fee type.
    *   Cr CGST, SGST and IGST with their sums, each only when above 0.

    Σ debit = Σ credit > 0. A receipt whose fee type has no account is refused [T-FL-001].
*   **G2: one reversal per cancellation (F6; receipt-cancel DD-6).** When a receipt is cancelled, the database posts its mirror image in the same transaction. The reversal is dated on the IST date of `cancelled_at`, links to the original journal (`reversal_of`), and swaps every debit and credit [T-FL-001].
*   **G3: the database proves the ledger** [T-FL-002]:
    *   journals and lines exist only through the posting function, because gems_app has no insert grant;
    *   every journal balances;
    *   one RECEIPT journal per receipt, and at most one CANCEL journal per receipt;
    *   nothing changes or disappears;
    *   RLS: lines are read with `ledger.view` at their centre.
*   **G4: the Day Book (R-044.01).** A holder of `ledger.view` at a centre lists that centre's journal lines for a date range (at most 92 days). Each line shows date, reference, account, debit, credit and narration, with totals that match [T-FL-003, smoke].

## Non-Goals (DD-7)

*   An accounts master page (R-042); new accounts come by migration for now.
*   Bank accounts and deposits (R-035), contra entries, and journal or voucher prefixes (R-041).
*   Other A/c reports (R-044).
*   Periods and close (F12), opening balances, and posting of migrated or imported receipts (D-FIN-7, paused).
*   The hash-chained finance audit (D-FIN-8).

## Technical Plan

### Migration `0030_fee_ledger`

**`app.account`**

| Column | Rule |
|---|---|
| `id` | serial |
| `code` | text, unique, for example `3909` |
| `name` | text |
| `kind` | `ASSET`, `LIABILITY`, `INCOME` or `EXPENSE` (check) |
| `system_key` | text, unique, nullable: `CASH`, `BANK`, `CGST`, `SGST`, `IGST` |
| `active` | boolean |

The migration seeds the SPEC p. 15 heads with their codes. Where a head has no SPEC code, it gets a code prefixed `G`, which is PMC. The migration also adds Cash in hand (`CASH`, ASSET) and Bank (clearing) (`BANK`, ASSET). CGST (3910), SGST (3911) and IGST (4385) carry their system keys.

RLS: select `using (true)`. There is no write grant: the migration owns the chart.

**`fee_type.account_id`** is an int, nullable, with an FK to `account` (restrict).
*   A guard on `fee_type` insert and update rejects any account that is not an active INCOME account (`fee_type_account_guard`).
*   `fee.ts` adds `accountId` to create and update. Changes are audited as fee type fields, and the column grant on `fee_type` gains `account_id`.

**`app.journal_entry`**

| Column | Rule |
|---|---|
| `id` | bigserial |
| `centre_id` | int |
| `entry_date` | date |
| `period` | text; equals `app.financial_year(entry_date)`, checked |
| `source` | `RECEIPT` or `RECEIPT_CANCEL`, checked |
| `receipt_id` | bigint; FK `(receipt_id, centre_id)` → `receipt(id, centre_id)` |
| `reversal_of` | bigint, nullable; FK to `journal_entry`; checked: `(source = 'RECEIPT_CANCEL') = (reversal_of is not null)` |
| `reference` | text: the receipt number |
| `narration` | text |
| `created_at` | timestamptz |

Unique key `(receipt_id, source)`.

**`app.journal_line`**

| Column | Rule |
|---|---|
| `id` | bigserial |
| `entry_id` | bigint; FK `(entry_id, centre_id)` → `journal_entry(id, centre_id)` |
| `centre_id` | int |
| `account_id` | int; FK to `account` |
| `debit`, `credit` | numeric(14,2), each ≥ 0; checked: exactly one of them is above 0 |

Index on `(centre_id, entry_id)`.

**Posting function `app.post_receipt_journal(p_receipt bigint, p_cancel boolean) returns void`.**
*   It is `security definer`, with a pinned `search_path`, owned by the migration owner (T-RLS-005 adds it to the inventory).
*   It reads the receipt and its lines, joined through the due to the fee type's `account_id`.
*   If any line's fee type has no account, it raises `journal_account_guard` (23514).
*   It inserts the entry and its lines as follows:

    | Case | Lines | Date | Narration | Link |
    |---|---|---|---|---|
    | Receipt | Dr mode account / Cr income per account, Cr tax per kind | `received_on` | `Receipt {receipt_no} ({mode})` | — |
    | Cancel | The receipt's lines with debit and credit swapped | `(cancelled_at at time zone 'Asia/Kolkata')::date` | `Cancellation of {receipt_no}: {cancel_reason}` | `reversal_of` = the receipt's RECEIPT entry |

*   It then checks `Σ debit = Σ credit > 0` for the new entry. If not, it raises `journal_balance_guard`.

**Triggers on `receipt`.**
*   `receipt_post` is a constraint trigger: `after insert`, `deferrable initially deferred`. It calls `post_receipt_journal(new.id, false)`. It sorts before `receipt_total_commit` by name, and both run at commit. If the total check fails, the whole transaction rolls back, journal included.
*   `receipt_post_cancel` runs `after update of status`, `when (old.status = 'ACTIVE' and new.status = 'CANCELLED')`. It calls `post_receipt_journal(new.id, true)`.

**Immutability.** Both journal tables get `no_update_delete` and `no_truncate` triggers that call `app.ticket_immutable()`. The ETL reset clears them before receipts, with the triggers lifted (as dues).

**RLS on both tables.** ENABLE and FORCE. The policies:
*   select: `centre_id = any (scoped_centre_ids('ledger.view'))`;
*   insert, update and delete: `false`.

The definer function bypasses RLS as owner. gems_app gets `select` only. `journal_entry` has a `centre_id`, so T-RLS-002 lists both tables.

**Permission.** `('ledger.view', 'View the ledger (day book) of a centre', false)`, plus the `system_admin` grant.

### Server

**`fees.ts`.** `createFeeType` and `updateFeeType` accept `accountId` (`"accountId: an active income account"`). `listFeeTypes` returns `accountId` and `accountCode`.

**`src/server/ledger.ts`.**

```ts
export async function dayBook(session, centreId: number, from: string, to: string): Promise<{ rows: DayBookRow[]; totals: { debit: string; credit: string } }>
export function listAccounts(session): Promise<AccountRow[]>   // for the fee type form
```

*   `dayBook` authorizes `ledger.view` at the centre; otherwise it raises Forbidden (a 404 on the page).
*   Dates must be ISO, `from ≤ to`, and at most 92 days apart (PMC).
*   Rows are ordered by `entry_date, entry id, line id`. Totals are computed in SQL.

**`receipts.ts`.** `receiptDb` maps `journal_account_guard` to `fee.receipt.noaccount`: "A fee type on this receipt has no ledger account; ask head office."

**F3 DD-5.** The ledger condition is met. The other conditions still apply.

### Pages

*   **`/ledger/day-book?centre=&from=&to=`.**
    *   A form takes the centre (those in the user's `ledger.view` scope), and from and to dates (default: today, IST).
    *   It shows a table of rows with totals.
    *   A bad centre or bad parameters give a 404 or an empty result, as on other pages.
*   **The fee type page** gains an "Account" select.
*   **The home page** links "Day book" when the user holds `ledger.view` at any centre.

### Tests (`tests/fee-ledger.test.ts`)

**Fixtures:**
*   role 32 `ledger_viewer` (`ledger.view`) and user `…00fc` at centre A, with token `tok-ledA`;
*   the `seedFeePlan` and ad-hoc test fee types map to income accounts. `seedMasters` sets `accountId`.

| ID | Goal | What it does |
|---|---|---|
| T-FL-001 | G1, G2 | **A taxed STATE receipt** gives one entry: Dr CASH total; Cr Registration and Course Fee accounts their taxable sums; Cr CGST and SGST. **INTERSTATE** credits IGST. **A UPI receipt** debits BANK. **Ad-hoc lines** credit their own account. **A cancellation** posts the exact mirror, dated today, with `reversal_of`. **Refusals:** a receipt whose fee type has no account is refused with `fee.receipt.noaccount` and uses no number. **Balances:** the ledger balances per entry and overall. |
| T-FL-002 | G3 | **As gems_app:** inserting, updating or deleting journals is refused (42501). **As the owner:** update, delete and truncate are refused. **Posting twice** is refused (unique). **An unbalanced entry** written by the function (through a mutation of the test data) is refused by name. **RLS:** a user without `ledger.view` sees no lines. **Fee type mapping:** a non-INCOME or inactive account is refused. |
| T-FL-003 | G4 | **`dayBook`:** rows and totals for a range, the range cap, a bad centre (Forbidden), and another centre's lines not shown. **Fee setup** maps an account (audited). |

**Changes to existing tests:**
*   T-RLS-002 lists `journal_entry` and `journal_line`.
*   T-RLS-005 adds `post_receipt_journal`.
*   T-AUD-009 is unchanged: the fee type actions are the same.
*   `seedMasters` maps accounts.
*   T-FS-001 checks the new field's message.

**Smoke:** the Day Book is a 404 without `ledger.view`, and the page renders for a holder.

## Decisions (recommended options)

1.  **DD-1:** The database posts through one definer function, at commit or at cancellation. The app never writes journals.
2.  **DD-2:** The chart is seeded from SPEC p. 15, with system keys for cash, bank and taxes. Each fee type maps to one active income account. An unmapped fee type refuses the receipt.
3.  **DD-3 (PMC):** CASH posts to Cash in hand; every other mode to Bank (clearing), until bank accounts exist (R-035).
4.  **DD-4:** The receipt journal (G1) and the reversal (G2). The reversal is dated on the IST cancellation date (receipt-cancel DD-6).
5.  **DD-5:** `ledger.view` is centre-scoped and gives the Day Book only.
6.  **DD-6 (PMC):** The Day Book range is at most 92 days.
7.  **DD-7:** Out of scope: see Non-Goals.
8.  **DD-8:** No Round Off line. Each receipt line already carries its own residual (fee-receipts DD-3), so every journal balances exactly.

## Risks and Limits

*   An owner can still disable triggers until D-FIN-8 (the hash chain) exists.
*   "Bank (clearing)" mixes every non-cash mode until bank accounts exist. Accounts must accept this (PMC).
*   The chart codes for heads the SPEC lists without a code are placeholders (PMC).
