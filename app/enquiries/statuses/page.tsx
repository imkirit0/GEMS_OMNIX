import { AdminErrors } from "../../admin/catalogue/admin-errors";
import { listEnquiryStatuses } from "@/server/enquiry";
import { pageRead } from "@/server/page-read";

const LABELS: Record<string, string> = { code: "Code", name: "Name", kind: "Kind", colour: "Colour", sortOrder: "Order", reason: "Reason", active: "Status" };

// The enquiry status master (DD-4, DD-6): readable by enquiry users; enquiry.setup changes it (step-up, audited).
export default async function Statuses({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { error, detail, saved } = await searchParams;
  const { rows, canManage } = await pageRead((s) => listEnquiryStatuses(s));
  const save = "/enquiries/statuses/save";
  return (
    <main>
      <p><a href="/enquiries">All enquiries</a></p>
      <h1>Enquiry statuses</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={LABELS} />
      {canManage && (
        <form method="post" action={save}>
          <input type="hidden" name="op" value="create" />
          <label>Code <input name="code" required maxLength={30} /></label>{" "}
          <label>Name <input name="name" required maxLength={200} /></label>{" "}
          <label>Kind <select name="kind"><option value="OPEN">Open</option><option value="LOST">Lost</option><option value="JUNK">Junk</option></select></label>{" "}
          <label>Colour <input type="color" name="colour" defaultValue="#1e88e5" /></label>{" "}
          <label>Order <input name="sortOrder" inputMode="numeric" size={4} required defaultValue="100" /></label>{" "}
          <button type="submit">Add</button>
        </form>
      )}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Kind</th><th>Order</th><th>Status</th>{canManage && <th>Change</th>}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.code}</td><td><span style={{ color: r.colour }}>{r.name}</span></td><td>{r.kind}</td><td>{r.sortOrder}</td>
              <td>{r.active ? "Active" : "Inactive"}</td>
              {canManage && (
                <td>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="update" /><input type="hidden" name="id" value={r.id} />
                    <input name="name" required maxLength={200} defaultValue={r.name} aria-label={`Name of ${r.code}`} />{" "}
                    <input type="color" name="colour" defaultValue={r.colour} aria-label={`Colour of ${r.code}`} />{" "}
                    <input name="sortOrder" inputMode="numeric" size={4} required defaultValue={r.sortOrder} aria-label={`Order of ${r.code}`} />{" "}
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
    </main>
  );
}
