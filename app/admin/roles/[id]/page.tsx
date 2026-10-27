import { notFound } from "next/navigation";
import { ADMIN_MESSAGES } from "@/server/admin-http";
import { adminRead } from "@/server/admin-page";
import { listPermissions, listRoles } from "@/server/rbac";

export default async function RoleDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const [roles, permissions] = await adminRead((s) => Promise.all([listRoles(s), listPermissions(s)]));
  const role = roles.find((r) => String(r.id) === id);
  if (!role) notFound();
  return (
    <main>
      <p><a href="/admin/roles">All roles</a></p>
      <h1>{role.name}</h1>
      {saved && <p role="status">Saved. Users holding this role have been signed out.</p>}
      {error && <p role="alert">{ADMIN_MESSAGES[error] ?? ADMIN_MESSAGES["invalid"]}</p>}
      <p>{role.holders} user(s) hold this role.</p>
      <form method="post" action={`/admin/roles/${role.id}/permissions`}>
        <fieldset>
          <legend>Permissions</legend>
          {permissions.map((p) => (
            <label key={p.key} style={{ display: "block" }}>
              <input type="checkbox" name="permission" value={p.key} defaultChecked={role.permissions.includes(p.key)} />
              {" "}{p.key}: {p.description}{p.sensitive ? " (sensitive: holders must use two-step verification)" : ""}
            </label>
          ))}
        </fieldset>
        <button type="submit">Save permissions</button>
      </form>
      <p><small>You can only add or remove permissions you hold for all centres.</small></p>
    </main>
  );
}
