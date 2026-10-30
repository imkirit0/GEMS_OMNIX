import { pageRead } from "@/server/page-read";
import { listTickets, ticketFilterOptions, ticketSummary } from "@/server/tickets/engine";

type Search = Record<string, string | string[] | undefined>;
const FILTERS = ["status", "priority", "type", "region", "area", "centre", "from", "to", "number"] as const;

// The ticket management view (R-094.03, R-094.05; docs/designs/ticket-management): KPI tiles, a summary by type and the
// list, all under one filter set and within the tickets the user may view. Raw GET values go to the engine, which
// validates them once; an invalid one matches nothing (G3).
export default async function Tickets({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const f = Object.fromEntries(FILTERS.map((k) => [k, q[k]]));
  const [{ rows, next }, summary, options] = await pageRead((s) => Promise.all([
    listTickets(s, { ...f, cursor: q["cursor"] }), ticketSummary(s, f), ticketFilterOptions(s)]));
  const keep = new URLSearchParams(FILTERS.flatMap((k) => (typeof q[k] === "string" && q[k] ? [[k, q[k] as string]] : [])));
  const v = (k: string) => (typeof q[k] === "string" ? q[k] as string : "");
  // a selected value that is not among the options is still applied and shown by its raw value (R11)
  const sel = (name: string, label: string, list: { v: string; label: string }[]) => (
    <label>{label} <select name={name} defaultValue={v(name)}><option value="">Any</option>
      {list.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      {v(name) && !list.some((o) => o.v === v(name)) && <option value={v(name)}>{v(name)}</option>}</select></label>
  );
  const k = summary.kpi;
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/tickets/new">Raise a ticket</a> · <a href="/tickets/approvals">My approvals</a></p>
      <h1>Tickets</h1>
      <ul aria-label="Totals">
        <li>Total: {k.total}</li><li>Open: {k.open}</li><li>Approved: {k.approved}</li><li>Rejected: {k.rejected}</li><li>Forwarded: {k.forwarded}</li>
      </ul>
      <form method="get">
        {sel("status", "Status", ["OPEN", "APPROVED", "REJECTED"].map((s) => ({ v: s, label: s })))}{" "}
        {sel("priority", "Priority", ["LOW", "MEDIUM", "HIGH"].map((s) => ({ v: s, label: s })))}{" "}
        {sel("type", "Type", options.types.map((t) => ({ v: String(t.id), label: `${t.code} ${t.name}` })))}{" "}
        {sel("region", "Region", options.regions.map((r) => ({ v: String(r.id), label: r.code })))}{" "}
        {sel("area", "Area", options.areas.map((a) => ({ v: String(a.id), label: a.label })))}{" "}
        {sel("centre", "Centre", options.centres.map((c) => ({ v: String(c.id), label: `${c.code} ${c.name}` })))}{" "}
        <label>Raised from <input name="from" type="date" defaultValue={v("from")} /></label>{" "}
        <label>Raised to <input name="to" type="date" defaultValue={v("to")} /></label>{" "}
        <label>Number <input name="number" maxLength={40} defaultValue={v("number")} /></label>{" "}
        <button type="submit">Filter</button>
      </form>
      <h2>By type</h2>
      <table>
        <thead><tr><th>Type</th><th>Open</th><th>Approved</th><th>Rejected</th><th>Forwarded</th><th>Total</th></tr></thead>
        <tbody>
          {summary.byType.map((t) => (
            <tr key={t.typeId}><td>{t.code} {t.name}</td><td>{t.open}</td><td>{t.approved}</td><td>{t.rejected}</td><td>{t.forwarded}</td><td>{t.total}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>List</h2>
      <table>
        <thead><tr><th>Number</th><th>Type</th><th>Centre</th><th>Area</th><th>Region</th><th>Priority</th><th>Status</th><th>Level</th><th>Raised</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td><a href={`/tickets/${t.id}`}>{t.number}</a></td><td>{t.typeName}</td><td>{t.centreCode}</td><td>{t.areaName}</td><td>{t.regionCode}</td>
              <td>{t.priority}</td><td>{t.status}</td><td>{t.currentLevel} of {t.levelCount}</td><td>{t.createdAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No tickets.</p>}
      {next && <p><a href={`/tickets?${keep.toString()}${keep.size ? "&" : ""}cursor=${next}`}>Next page</a></p>}
    </main>
  );
}
