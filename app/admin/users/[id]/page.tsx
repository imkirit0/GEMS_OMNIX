import { notFound } from "next/navigation";
import { ADMIN_MESSAGES } from "@/server/admin-http";
import { pageRead } from "@/server/page-read";
import { getUser, listRoles, scopeOptions } from "@/server/rbac";

export default async function UserDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; created?: string }> }) {
  const { id } = await params;
  const { error, created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [user, roles, scopes] = await pageRead((s) => Promise.all([getUser(s, id), listRoles(s), scopeOptions(s)]));
  if (!user) notFound();
  const self = `/admin/users/${user.id}`;
  return (
    <main>
      <p><a href="/admin/users">All users</a></p>
      <h1>{user.displayName} ({user.login})</h1>
      {created && <p role="status">User created. Assign a role, then issue a set-up link.</p>}
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["invalid"]}</p>}
      <p>Status: {user.status} · Two-step verification required: {user.requiresTotp ? "Yes" : "No"}</p>
      <form method="post" action={`${self}/status`}>
        <input type="hidden" name="status" value={user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"} />
        <label>Reason (recorded in the audit log) <input name="reason" required maxLength={500} /></label>
        <button type="submit">{user.status === "ACTIVE" ? "Disable user (signs them out)" : "Enable user"}</button>
      </form>
      <form method="post" action={`${self}/setup-link`}>
        <button type="submit">Issue one-time set-up link</button>
      </form>

      <h2>Roles</h2>
      <table>
        <thead><tr><th>Role</th><th>Scope</th><th></th></tr></thead>
        <tbody>
          {user.assignments.map((a) => (
            <tr key={a.id}>
              <td>{a.roleName}</td><td>{a.scope}</td>
              <td>
                <form method="post" action={`/admin/assignments/${a.id}/remove?back=${encodeURIComponent(self)}`}>
                  <button type="submit">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Add a role</h2>
      <form method="post" action={`${self}/assign`}>
        <label>Role <select name="roleId" required>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>Scope
          <select name="scopeKind" defaultValue="CENTRE">
            <option value="CENTRE">One centre</option><option value="AREA">An area</option>
            <option value="REGION">A region</option><option value="ALL">All centres</option>
          </select>
        </label>
        <label>Centre <select name="centreId"><option value="">-</option>{scopes.centres.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
        <label>Area <select name="areaId"><option value="">-</option>{scopes.areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <label>Region <select name="regionId"><option value="">-</option>{scopes.regions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        <button type="submit">Add</button>
      </form>
      <p><small>Only the field matching the scope is used. Changing roles signs the user out. You can only grant a role where you hold all of its permissions.</small></p>
    </main>
  );
}
