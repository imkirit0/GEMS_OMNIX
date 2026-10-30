import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { dayBook, ledgerCentres } from "@/server/ledger";
import { istToday } from "@/server/person-rules";
import { RbacError } from "@/server/rbac";
import { inr } from "@/lib/money";

const ID = /^\d{1,9}$/;

// Day Book (R-044.01; docs/designs/fee-ledger G4): a centre's journal lines for up to 92 days, with totals per currency.
// No ledger.view anywhere, or a centre outside it: the same 404.
export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ centre?: string; from?: string; to?: string }> }) {
  const q = await searchParams;
  const centres = await pageRead((s) => ledgerCentres(s));
  if (centres.length === 0) notFound();
  const today = istToday();
  const centre = q.centre === undefined ? centres[0] : ID.test(q.centre) ? centres.find((c) => c.id === Number(q.centre)) : undefined;
  if (!centre) notFound();
  const from = q.from || today, to = q.to || today;
  const book = await pageRead((s) => dayBook(s, centre.id, from, to).catch((e: unknown) =>
    e instanceof RbacError && e.reason === "invalid" ? e.message : Promise.reject(e)));
  return (
    <main>
      <p><a href="/">Home</a></p>
      <h1>Day book</h1>
      <form method="get">
        <label>Centre <select name="centre" defaultValue={centre.id}>{centres.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>{" "}
        <label>From <input name="from" type="date" defaultValue={from} /></label>{" "}
        <label>To <input name="to" type="date" defaultValue={to} /></label>{" "}
        <button type="submit">Show</button>
      </form>
      {typeof book === "string" ? <p role="alert">Check the dates: {book.replace(/^\w+: /, "")}.</p> : (
        <>
          <table>
            <thead><tr><th>Date</th><th>Reference</th><th>Source</th><th>Ledger</th><th>Debit</th><th>Credit</th><th>Narration</th></tr></thead>
            <tbody>
              {book.rows.map((r, i) => (
                <tr key={i}><td>{r.entryDate}</td><td>{r.reference}</td><td>{r.source}</td><td>{r.accountCode} {r.accountName}</td>
                  <td>{r.debit !== "0.00" ? inr(r.debit) : ""}</td><td>{r.credit !== "0.00" ? inr(r.credit) : ""}</td><td>{r.narration}</td></tr>
              ))}
              {book.totals.map((t) => (
                <tr key={t.currency}><td colSpan={4}>Total {t.currency}</td><td>{inr(t.debit)}</td><td>{inr(t.credit)}</td><td></td></tr>
              ))}
            </tbody>
          </table>
          {book.rows.length === 0 && <p>No entries in this range.</p>}
        </>
      )}
    </main>
  );
}
