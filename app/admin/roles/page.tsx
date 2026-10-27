import { ADMIN_MESSAGES } from "@/server/admin-http";
import { pageRead } from "@/server/page-read";
import { listRoles } from "@/server/rbac";

export default async function Roles({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const roles = await pageRead(listRoles);
  const { error } = await searchParams;
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/admin/users">Users</a></p>
      <h1>Roles</h1>
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["invalid"]}</p>}
      <table>
        <thead><tr><th>Name</th><th>Key</th><th>Permissions</th><th>Users</th></tr></thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id}>
              <td><a href={`/admin/roles/${r.id}`}>{r.name}</a></td><td>{r.key}</td>
              <td>{r.permissions.join(", ") || "None"}</td><td>{r.holders}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>New role</h2>
      <form method="post" action="/admin/roles/create">
        <label>Key <input name="key" required pattern="[a-z0-9_.-]+" /></label>
        <label>Name <input name="name" required /></label>
        <button type="submit">Create</button>
      </form>
    </main>
  );
}
