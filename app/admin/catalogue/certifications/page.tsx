import { listCertifications } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";
import { AdminErrors, MASTER_FIELD_LABELS } from "../admin-errors";

const TYPES = [["VOUCHER", "Voucher"], ["LICENCE", "Licence"]] as const;

// The certification master (R-092; certifications DD-1): everyone reads; catalogue.manage changes it (step-up, audited).
export default async function Certifications({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { error, detail, saved } = await searchParams;
  const { rows, canManage } = await pageRead((s) => listCertifications(s));
  const save = "/admin/catalogue/certifications/save";
  return (
    <main>
      <p><a href="/admin/catalogue">Catalogue</a></p>
      <h1>Certifications</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={MASTER_FIELD_LABELS} />
      {canManage && (
        <form method="post" action={save}>
          <input type="hidden" name="op" value="create" />
          <label>Code <input name="code" required maxLength={30} /></label>{" "}
          <label>Name <input name="name" required maxLength={200} /></label>{" "}
          <label>Type <select name="type">{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label style={{ display: "block" }}>Description <textarea name="description" maxLength={1000} rows={2} /></label>
          <button type="submit">Add</button>
        </form>
      )}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Status</th>{canManage && <th>Change</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td><td>{r.name}{r.description ? <><br /><small>{r.description}</small></> : null}</td>
              <td>{r.type === "VOUCHER" ? "Voucher" : "Licence"}</td><td>{r.active ? "Active" : "Inactive"}</td>
              {canManage && (
                <td>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="update" /><input type="hidden" name="id" value={r.id} />
                    <input name="name" required maxLength={200} defaultValue={r.name} aria-label={`Name of ${r.code}`} />{" "}
                    <select name="type" defaultValue={r.type} aria-label={`Type of ${r.code}`}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>{" "}
                    <textarea name="description" maxLength={1000} rows={1} defaultValue={r.description ?? ""} aria-label={`Description of ${r.code}`} />{" "}
                    <button type="submit">Save</button>
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
      {rows.length === 0 && <p>No certifications yet.</p>}
    </main>
  );
}
