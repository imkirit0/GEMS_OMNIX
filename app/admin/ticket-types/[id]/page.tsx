import { notFound } from "next/navigation";
import { Forbidden } from "@/server/action";
import { ADMIN_MESSAGES } from "@/server/admin-http";
import { pageRead } from "@/server/page-read";
import { listRoles, listUsers } from "@/server/rbac";
import { getType, listTypes } from "@/server/tickets/setup";

// One form per part; the save route dispatches on the hidden op field. User and role pickers need rbac.view.
export default async function TicketType({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  const { type, list, users, roles } = await pageRead(async (s) => ({
    type: await getType(s, Number(id)), list: await listTypes(s),
    // the pickers need rbac.view; without it the page still works for details and the switch
    users: await listUsers(s).catch((e: unknown) => (e instanceof Forbidden ? null : Promise.reject(e))),
    roles: await listRoles(s).catch((e: unknown) => (e instanceof Forbidden ? [] : Promise.reject(e))),
  }));
  const save = `/admin/ticket-types/${type.id}/save`;
  const approver = (l: { user_id: string | null; role_id: number | null }) => (l.user_id ? `user:${l.user_id}` : `role:${l.role_id}`);
  const subjects = [...roles.map((r) => ({ v: `role:${r.id}`, label: `Role: ${r.name}` })),
    ...(users ?? []).filter((u) => u.status === "ACTIVE").map((u) => ({ v: `user:${u.id}`, label: `User: ${u.displayName} (${u.login})` }))];
  return (
    <main>
      <p><a href="/admin/ticket-types">All ticket types</a></p>
      <h1>{type.code}: {type.name}</h1>
      {saved && <p role="status">Saved.</p>}
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["invalid"]}</p>}
      <p>Numbers look like {type.numberPrefix}/{type.code}/23642 · {type.active ? "Switched on" : "Switched off"}</p>

      <h2>Details</h2>
      <form method="post" action={save}>
        <input type="hidden" name="op" value="details" />
        <label>Name <input name="name" required defaultValue={type.name} /></label>
        <label>Category <select name="categoryId" defaultValue={type.categoryId}>
          {list.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Priority <select name="priority" defaultValue={type.priority}><option>LOW</option><option>MEDIUM</option><option>HIGH</option></select></label>
        <label><input type="checkbox" name="documentRequired" value="1" defaultChecked={type.documentRequired} /> Document required</label>
        <label>Handler (only while switched off with no open tickets) <input name="handlerKey" required defaultValue={type.handlerKey} list="handlers" /></label>
        <datalist id="handlers">{list.handlers.map((h) => <option key={h} value={h} />)}</datalist>
        <button type="submit">Save details</button>
      </form>

      {users === null && <p role="alert">To choose approvers and viewers you also need the rbac.view permission.</p>}
      <h2>Approval levels</h2>
      <form method="post" action={save}>
        <input type="hidden" name="op" value="levels" />
        {[1, 2, 3, 4].map((n) => (
          <label key={n} style={{ display: "block" }}>Level {n} <select name={`level${n}`} defaultValue={type.levels[n - 1] ? approver(type.levels[n - 1]!) : ""}>
            <option value="">(none)</option>{subjects.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select></label>
        ))}
        <button type="submit">Save levels</button>
      </form>

      <h2>Viewers (read only)</h2>
      <form method="post" action={save}>
        <input type="hidden" name="op" value="viewers" />
        <select name="viewer" multiple size={8} defaultValue={type.viewers.map(approver)}>
          {subjects.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}</select>
        <button type="submit">Save viewers</button>
      </form>

      <h2>Switch</h2>
      <form method="post" action={save}>
        <input type="hidden" name="op" value="active" />
        <input type="hidden" name="active" value={type.active ? "0" : "1"} />
        <button type="submit">{type.active ? "Switch off (stops new raises and final approvals)" : "Switch on"}</button>
      </form>
    </main>
  );
}
