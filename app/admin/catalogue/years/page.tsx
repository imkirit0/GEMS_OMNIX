import { listAcademicYears } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";
import { AdminErrors, MASTER_FIELD_LABELS } from "../admin-errors";

// Academic years (R-028; DD-3: dates and open/closed only): everyone reads; managers create, re-date, open and close.
export default async function Years({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { error, detail, saved } = await searchParams;
  const { years, canManage } = await pageRead((s) => listAcademicYears(s));
  const save = "/admin/catalogue/years/save";
  return (
    <main>
      <p><a href="/admin/catalogue">Catalogue</a></p>
      <h1>Academic years</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={MASTER_FIELD_LABELS} />
      {canManage && (
        <form method="post" action={save}>
          <input type="hidden" name="op" value="create" />
          <label>Year <input name="code" required placeholder="2029-30" pattern="\d{4}-\d{2}" /></label>{" "}
          <label>Start date <input type="date" name="startsOn" required /></label>{" "}
          <label>End date <input type="date" name="endsOn" required /></label>{" "}
          <button type="submit">Add</button>
        </form>
      )}
      <table>
        <thead><tr><th>Code</th><th>Start date</th><th>End date</th><th>Status</th>{canManage && <th>Change</th>}</tr></thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.code}>
              <td>{y.code}</td><td>{y.startsOn}</td><td>{y.endsOn}</td><td>{y.open ? "Open" : "Closed"}</td>
              {canManage && (
                <td>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="update" /><input type="hidden" name="code" value={y.code} />
                    <input type="date" name="startsOn" required defaultValue={y.startsOn} aria-label={`Start of ${y.code}`} />{" "}
                    <input type="date" name="endsOn" required defaultValue={y.endsOn} aria-label={`End of ${y.code}`} />{" "}
                    <button type="submit">Save dates</button>
                  </form>
                  <form method="post" action={save}>
                    <input type="hidden" name="op" value="open" /><input type="hidden" name="code" value={y.code} />
                    <input type="hidden" name="open" value={y.open ? "0" : "1"} />
                    <input name="reason" required placeholder="Reason" aria-label={`Reason for ${y.code}`} />{" "}
                    <button type="submit">{y.open ? "Close" : "Open"}</button>
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
