import { pageRead } from "@/server/page-read";
import { listTickets } from "@/server/tickets/engine";

type Search = { status?: string; priority?: string; type?: string; centre?: string; cursor?: string };
const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

export default async function Tickets({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const { rows, next } = await pageRead((s) => listTickets(s, {
    status: q.status || undefined, priority: q.priority || undefined, typeId: num(q.type), centreId: num(q.centre), cursor: q.cursor || undefined,
  }));
  const keep = new URLSearchParams(Object.entries(q).filter(([k, v]) => k !== "cursor" && v) as [string, string][]);
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/tickets/new">Raise a ticket</a> · <a href="/tickets/approvals">My approvals</a></p>
      <h1>Tickets</h1>
      <form method="get">
        <label>Status <select name="status" defaultValue={q.status ?? ""}>
          <option value="">Any</option><option>OPEN</option><option>APPROVED</option><option>REJECTED</option></select></label>
        <label>Priority <select name="priority" defaultValue={q.priority ?? ""}>
          <option value="">Any</option><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
        <label>Type id <input name="type" inputMode="numeric" defaultValue={q.type ?? ""} size={4} /></label>
        <label>Centre id <input name="centre" inputMode="numeric" defaultValue={q.centre ?? ""} size={4} /></label>
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead><tr><th>Number</th><th>Type</th><th>Centre</th><th>Priority</th><th>Status</th><th>Level</th><th>Raised</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td><a href={`/tickets/${t.id}`}>{t.number}</a></td><td>{t.typeName}</td><td>{t.centreCode}</td><td>{t.priority}</td>
              <td>{t.status}</td><td>{t.currentLevel} of {t.levelCount}</td><td>{t.createdAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No tickets.</p>}
      {next && <p><a href={`/tickets?${keep.toString()}${keep.size ? "&" : ""}cursor=${next}`}>Next page</a></p>}
    </main>
  );
}
