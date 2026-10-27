import { ADMIN_MESSAGES } from "@/server/admin-http";
import { adminRead } from "@/server/admin-page";
import { listUsers } from "@/server/rbac";

export default async function Users({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const users = await adminRead(listUsers);
  const { error } = await searchParams;
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/admin/roles">Roles</a></p>
      <h1>Users</h1>
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["invalid"]}</p>}
      <table>
        <thead><tr><th>Login</th><th>Name</th><th>Status</th><th>Two-step required</th><th>Roles</th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td><a href={`/admin/users/${u.id}`}>{u.login}</a></td>
              <td>{u.displayName}</td>
              <td>{u.status}</td>
              <td>{u.requiresTotp ? "Yes" : "No"}</td>
              <td>{u.roles.join("; ") || "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>New user</h2>
      <form method="post" action="/admin/users/create">
        <label>Login <input name="login" required pattern="[A-Za-z0-9._-]+" /></label>
        <label>Display name <input name="displayName" required /></label>
        <button type="submit">Create</button>
      </form>
      <p><small>New users get no password. Issue a one-time set-up link from their page.</small></p>
    </main>
  );
}
