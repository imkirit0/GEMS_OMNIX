import { ADMIN_MESSAGES } from "@/server/admin-http";
import { pageRead } from "@/server/page-read";
import { approvalQueue, queueCards } from "@/server/tickets/engine";

type Search = Record<string, string | string[] | undefined>;
const FILTERS = ["type", "centre", "from", "to"] as const;
const COUNTS = ["done", "conflict", "forbidden", "invalid", "failed"] as const;

// The approvals workbench (R-094.04, R-144; docs/designs/approvals-workbench): what the user may act on now, oldest first
// (T-TKT-003, the same rule act() applies), its cards, filters, and bulk approve or reject through act() per ticket.
export default async function Approvals({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const f = Object.fromEntries(FILTERS.map((k) => [k, q[k]])); // only the queue's keys (Z4)
  const [{ rows, next }, cards] = await pageRead((s) => Promise.all([approvalQueue(s, { ...f, cursor: q["cursor"] }), queueCards(s, f)]));
  const v = (k: string) => (typeof q[k] === "string" ? q[k] as string : "");
  const link = (extra: Record<string, string>) => {
    const p = new URLSearchParams(FILTERS.flatMap((k) => (v(k) ? [[k, v(k)]] : [])));
    for (const [k, val] of Object.entries(extra)) { if (val) p.set(k, val); else p.delete(k); }
    return `/tickets/approvals${p.size ? `?${p}` : ""}`;
  };
  const sel = (name: string, label: string, list: { v: string; label: string }[]) => (
    <label>{label} <select name={name} defaultValue={v(name)}><option value="">Any</option>
      {list.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      {v(name) && !list.some((o) => o.v === v(name)) && <option value={v(name)}>{v(name)}</option>}</select></label>
  );
  // the result line only when every count is a small integer (D9: display only)
  const counts = COUNTS.every((k) => typeof q[k] === "string" && /^\d{1,3}$/.test(q[k] as string));
  const error = v("error");
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/tickets">All tickets</a></p>
      <h1>My approvals</h1>
      {counts && (
        <p role="status">Done: {q["done"]}. Not done: changed since you opened it {q["conflict"]}, not allowed {q["forbidden"]}, invalid {q["invalid"]},
          failed {q["failed"]}.</p>
      )}
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["ticket.invalid"]}</p>}
      <ul aria-label="Queues">
        <li><a href={link({ type: "" })}>Total: {cards.total}</a></li>
        {cards.byType.map((t) => <li key={t.typeId}><a href={link({ type: String(t.typeId) })}>{t.code} {t.name}: {t.count}</a></li>)}
      </ul>
      <form method="get">
        {sel("type", "Type", cards.byType.map((t) => ({ v: String(t.typeId), label: `${t.code} ${t.name}` })))}{" "}
        {sel("centre", "Centre", cards.byCentre.map((c) => ({ v: String(c.centreId), label: `${c.code} ${c.name}` })))}{" "}
        <label>Raised from <input name="from" type="date" defaultValue={v("from")} /></label>{" "}
        <label>Raised to <input name="to" type="date" defaultValue={v("to")} /></label>{" "}
        <button type="submit">Filter</button>
      </form>
      <form method="post" action="/tickets/approvals/bulk">
        {FILTERS.map((k) => v(k) && <input key={k} type="hidden" name={k} value={v(k)} />)}
        <table>
          <thead><tr><th>Pick</th><th>Number</th><th>Type</th><th>Centre</th><th>Priority</th><th>Level</th><th>Raised</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td><input type="checkbox" name="item" value={`${t.id}:${t.version}`} aria-label={`Pick ${t.number}`} /></td>
                <td><a href={`/tickets/${t.id}`}>{t.number}</a></td><td>{t.typeName}</td><td>{t.centreCode}</td><td>{t.priority}</td>
                <td>{t.currentLevel} of {t.levelCount}</td><td>{t.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p>Nothing waiting for you.</p>}
        {rows.length > 0 && (
          <p>
            <label style={{ display: "block" }}>Remarks (required to reject) <textarea name="remarks" rows={2} maxLength={1000} /></label>
            <button type="submit" name="action" value="approve">Approve selected</button>{" "}
            <button type="submit" name="action" value="reject">Reject selected</button>
          </p>
        )}
      </form>
      {next && <p><a href={`${link({})}${link({}).includes("?") ? "&" : "?"}cursor=${next}`}>Next page</a></p>}
    </main>
  );
}
