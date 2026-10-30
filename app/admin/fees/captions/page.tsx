import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { listCaptions } from "@/server/fees";
import { AdminErrors } from "../../catalogue/admin-errors";
import { FEE_FIELD_LABELS } from "../labels";

// Instalments per academic year (R-057): the due date lies within the year and is frozen once a published plan uses it.
export default async function Captions({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; detail?: string; saved?: string }> }) {
  const { year, error, detail, saved } = await searchParams;
  if (year !== undefined && !/^\d{4}-\d{2}$/.test(year)) notFound();
  const { years, rows, canManage } = await pageRead((s) => listCaptions(s, year));
  if (year !== undefined && !years.some((y) => y.code === year)) notFound();
  const save = "/admin/fees/captions/save";
  return (
    <main>
      <p><a href="/admin/fees">Fees</a></p>
      <h1>Instalments{year ? `: ${year}` : ""}</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={FEE_FIELD_LABELS} />
      <form method="get">
        <label>Academic year <select name="year" defaultValue={year ?? ""} required><option value="">Choose…</option>
          {years.map((y) => <option key={y.code} value={y.code}>{y.code}{y.open ? "" : " (closed)"}</option>)}</select></label>{" "}
        <button type="submit">Show</button>
      </form>
      {year && canManage && (
        <form method="post" action={save}>
          <input type="hidden" name="op" value="create" /><input type="hidden" name="academicYear" value={year} />
          <label>Name <input name="name" required maxLength={200} /></label>{" "}
          <label>Due date <input name="dueOn" type="date" required /></label>{" "}
          <label>Order <input name="sortOrder" type="number" min={0} max={9999} required /></label>{" "}
          <button type="submit">Add</button>
        </form>
      )}
      {year && (
        <table>
          <thead><tr><th>Order</th><th>Name</th><th>Due</th><th>Status</th>{canManage && <th>Change</th>}</tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.sortOrder}</td><td>{c.name}</td><td>{c.dueOn}</td><td>{c.active ? "Active" : "Inactive"}</td>
                {canManage && (
                  <td>
                    <form method="post" action={save}>
                      <input type="hidden" name="op" value="update" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="academicYear" value={year} />
                      <input name="name" required maxLength={200} defaultValue={c.name} aria-label={`Name of ${c.name}`} />{" "}
                      <input name="dueOn" type="date" required defaultValue={c.dueOn} aria-label={`Due date of ${c.name}`} />{" "}
                      <input name="sortOrder" type="number" min={0} max={9999} defaultValue={c.sortOrder} aria-label={`Order of ${c.name}`} />{" "}
                      <button type="submit">Save</button>
                    </form>
                    <form method="post" action={save}>
                      <input type="hidden" name="op" value="active" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="academicYear" value={year} />
                      <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                      <input name="reason" required placeholder="Reason" aria-label={`Reason for ${c.name}`} />{" "}
                      <button type="submit">{c.active ? "Deactivate" : "Activate"}</button>
                    </form>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {year && rows.length === 0 && <p>No instalments for this year yet.</p>}
    </main>
  );
}
