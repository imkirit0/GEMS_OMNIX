import { pageRead } from "@/server/page-read";
import { approvalQueue } from "@/server/tickets/engine";

// Tickets the viewer can act on now, oldest first (T-TKT-003): the same rule act() applies.
export default async function Approvals({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const { rows, next } = await pageRead((s) => approvalQueue(s, cursor || undefined));
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/tickets">All tickets</a></p>
      <h1>My approvals</h1>
      <table>
        <thead><tr><th>Number</th><th>Type</th><th>Centre</th><th>Priority</th><th>Level</th><th>Raised</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td><a href={`/tickets/${t.id}`}>{t.number}</a></td><td>{t.typeName}</td><td>{t.centreCode}</td><td>{t.priority}</td>
              <td>{t.currentLevel} of {t.levelCount}</td><td>{t.createdAt.toISOString().slice(0, 10)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>Nothing waiting for you.</p>}
      {next && <p><a href={`/tickets/approvals?cursor=${next}`}>Next page</a></p>}
    </main>
  );
}
