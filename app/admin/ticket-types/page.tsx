import { ADMIN_MESSAGES } from "@/server/admin-http";
import { pageRead } from "@/server/page-read";
import { listTypes } from "@/server/tickets/setup";

export default async function TicketTypes({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { types, categories, handlers } = await pageRead(listTypes); // needs ticket.type.manage, else 404
  const { error } = await searchParams;
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/tickets">Tickets</a></p>
      <h1>Ticket types</h1>
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["invalid"]}</p>}
      {handlers.length === 0 && <p>No handler is registered, so no type can be switched on yet (each domain module brings its own).</p>}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Handler</th><th>Active</th></tr></thead>
        <tbody>{types.map((t) => (
          <tr key={t.id}><td><a href={`/admin/ticket-types/${t.id}`}>{t.code}</a></td><td>{t.name}</td><td>{t.category}</td>
            <td>{t.handlerKey}</td><td>{t.active ? "Yes" : "No"}</td></tr>))}
        </tbody>
      </table>

      <h2>New category</h2>
      <form method="post" action="/admin/ticket-types/create">
        <input type="hidden" name="op" value="category" />
        <label>Name <input name="name" required /></label>
        <label>Main category <select name="parentId" defaultValue="">
          <option value="">(this is a main category)</option>
          {categories.filter((c) => c.parentId === null).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <button type="submit">Create category</button>
      </form>

      {categories.length > 0 && (
        <>
          <h2>New type (created switched off)</h2>
          <form method="post" action="/admin/ticket-types/create">
            <input type="hidden" name="op" value="type" />
            <label>Code <input name="code" required pattern="[A-Z0-9]{1,10}" /></label>
            <label>Name <input name="name" required /></label>
            <label>Number prefix <input name="numberPrefix" required pattern="[A-Z0-9-]{1,12}" placeholder="TK-26" /></label>
            <label>Category <select name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Priority <select name="priority" defaultValue="MEDIUM"><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
            <label><input type="checkbox" name="documentRequired" value="1" /> Document required</label>
            <label>Handler <input name="handlerKey" required list="handlers" /></label>
            <datalist id="handlers">{handlers.map((h) => <option key={h} value={h} />)}</datalist>
            <button type="submit">Create type</button>
          </form>
        </>
      )}
    </main>
  );
}
