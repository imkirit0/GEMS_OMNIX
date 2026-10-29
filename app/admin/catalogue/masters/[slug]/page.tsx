import { notFound } from "next/navigation";
import { listMasters } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";
import { AdminErrors, MASTER_FIELD_LABELS } from "../../admin-errors";
import { slugOf } from "../slugs";

// One page for the three code/name masters (DD-8): everyone reads; managers create, rename and (de)activate.
export default async function Master({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { slug } = await params;
  const { error, detail, saved } = await searchParams;
  const m = slugOf(slug);
  if (!m) notFound(); // before the read (R16)
  const { rows, canManage } = await pageRead((s) => listMasters(s, m.kind));
  const save = `/admin/catalogue/masters/${slug}/save`;
  return (
    <main>
      <p><a href="/admin/catalogue">Catalogue</a></p>
      <h1>{m.title}</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={MASTER_FIELD_LABELS} />
      {canManage && (
        <form method="post" action={save}>
          <input type="hidden" name="op" value="create" />
          <label>Code <input name="code" required maxLength={30} /></label>{" "}
          <label>Name <input name="name" required maxLength={200} /></label>{" "}
          <button type="submit">Add</button>
        </form>
      )}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Status</th>{canManage && <th>Change</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td><td>{r.name}</td><td>{r.active ? "Active" : "Inactive"}</td>
              {canManage && (
                <td>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="update" /><input type="hidden" name="id" value={r.id} />
                    <input name="name" required maxLength={200} defaultValue={r.name} aria-label={`Name of ${r.code}`} />{" "}
                    <button type="submit">Rename</button>
                  </form>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="active" /><input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="active" value={r.active ? "0" : "1"} />
                    <input name="reason" required placeholder="Reason" aria-label={`Reason for ${r.code}`} />{" "}
                    <button type="submit">{r.active ? "Deactivate" : "Activate"}</button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
