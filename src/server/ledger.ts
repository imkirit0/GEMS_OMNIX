// Fee ledger reads (docs/designs/fee-ledger, Stage 4 F1): the Day Book of a centre (R-044.01). Journals are written only by
// the database's posting trigger functions at receipt and cancellation (0030); this module only reads, under ledger.view.
import { authorize } from "./action";
import { withScope } from "./db";
import { bad } from "./catalogue";
import { isoDate } from "./person-rules";

export type DayBookRow = { entryDate: string; reference: string; source: string; accountCode: string; accountName: string;
  debit: string; credit: string; narration: string; currency: string };
export type DayBook = { rows: DayBookRow[]; totals: { currency: string; debit: string; credit: string }[] };

/** At most 92 days, counting both ends (DD-6, PMC). */
const MAX_SPAN_DAYS = 91;

/** The centres whose ledger the caller may read (Day Book picker, home link). */
export const ledgerCentres = (session: string | undefined) => withScope(session, (tx) =>
  tx.$queryRaw<{ id: number; code: string; name: string }[]>`
    select c.id, c.code, c.name from app.centre c where c.id = any (app.scoped_centre_ids('ledger.view')) order by c.code`);

/** A centre's journal lines for a date range, with totals per currency (G4). */
export async function dayBook(session: string | undefined, centreId: number, from: string, to: string): Promise<DayBook> {
  let f: string, t: string;
  try { f = isoDate("from", from); } catch { throw bad("from: a date"); }
  try { t = isoDate("to", to); } catch { throw bad("to: a date"); }
  if (t < f) throw bad("to: not before from");
  return withScope(session, async (tx) => {
    await authorize(tx, "ledger.view", centreId);
    const [span] = await tx.$queryRaw<{ ok: boolean }[]>`select ${t}::date - ${f}::date <= ${MAX_SPAN_DAYS} as ok`;
    if (!span!.ok) throw bad("to: within 92 days of from");
    const rows = await tx.$queryRaw<DayBookRow[]>`
      select e.entry_date::text as "entryDate", e.reference, case e.source when 'RECEIPT' then 'Receipt' else 'Reversal' end as source,
        a.code as "accountCode", a.name as "accountName", l.debit::text as debit, l.credit::text as credit, e.narration, e.currency::text as currency
      from app.journal_entry e join app.journal_line l on l.entry_id = e.id join app.account a on a.id = l.account_id
      where e.centre_id = ${centreId} and e.entry_date between ${f}::date and ${t}::date
      order by e.entry_date, e.id, l.id`;
    const totals = await tx.$queryRaw<DayBook["totals"]>`
      select e.currency::text as currency, sum(l.debit)::text as debit, sum(l.credit)::text as credit
      from app.journal_entry e join app.journal_line l on l.entry_id = e.id
      where e.centre_id = ${centreId} and e.entry_date between ${f}::date and ${t}::date
      group by e.currency order by e.currency`;
    return { rows, totals };
  });
}
