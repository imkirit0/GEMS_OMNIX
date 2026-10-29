import { listCentreClasses } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";
import { AdminErrors, MASTER_FIELD_LABELS } from "../admin-errors";

// Class per centre (catalogue-masters DD-2): the centres the user may view with their class; managers change it.
export default async function CentreClasses({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { error, detail, saved } = await searchParams;
  const { centres, classes, canManage } = await pageRead((s) => listCentreClasses(s));
  const byId = new Map(classes.map((k) => [k.id, k]));
  const label = (id: number | null) => {
    const k = id === null ? undefined : byId.get(id);
    return k ? `${k.code} ${k.name}${k.active ? "" : " (inactive)"}` : "—";
  };
  return (
    <main>
      <p><a href="/admin/catalogue">Catalogue</a></p>
      <h1>Class per centre</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={MASTER_FIELD_LABELS} />
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Class</th>{canManage && <th>Change</th>}</tr></thead>
        <tbody>
          {centres.map((c) => (
            <tr key={c.id}>
              <td>{c.code}</td><td>{c.name}</td><td>{label(c.classId)}</td>
              {canManage && (
                <td>
                  <form method="post" action="/admin/catalogue/centres/save">
                    <input type="hidden" name="op" value="class" /><input type="hidden" name="centreId" value={c.id} />
                    <select name="classId" defaultValue={c.classId ?? ""} aria-label={`Class of ${c.code}`}>
                      <option value="">(none)</option>
                      {classes.filter((k) => k.active || k.id === c.classId).map((k) => <option key={k.id} value={k.id}>{label(k.id)}</option>)}
                    </select>{" "}
                    <input name="reason" required placeholder="Reason" aria-label={`Reason for ${c.code}`} />{" "}
                    <button type="submit">Save</button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {centres.length === 0 && <p>No centres.</p>}
    </main>
  );
}
