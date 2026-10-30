import { pageRead } from "@/server/page-read";
import { listSchemes } from "@/server/schemes";
import { AdminErrors } from "../../catalogue/admin-errors";
import { FEE_FIELD_LABELS } from "../labels";

const STATUS: Record<string, string> = { DRAFT: "Draft", LIVE: "Live", RETIRED: "Retired" };

// Fee schemes (D-SCH-1): live and retired schemes for everyone, drafts for scheme.manage and scheme.approve holders.
export default async function Schemes({ searchParams }: { searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { error, detail, saved } = await searchParams;
  const { rows, manage } = await pageRead((s) => listSchemes(s));
  return (
    <main>
      <p><a href="/admin/fees">Fees</a></p>
      <h1>Fee schemes</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={FEE_FIELD_LABELS} />
      {manage && (
        <form method="post" action="/admin/fees/schemes/create">
          <h2>New scheme</h2>
          <label>Code <input name="code" required maxLength={30} /></label>{" "}
          <label>Name <input name="name" required maxLength={200} /></label>{" "}
          <label>Valid from <input name="validFrom" type="date" required /></label>{" "}
          <label>Valid to <input name="validTo" type="date" required /></label>{" "}
          <button type="submit">Create</button>
        </form>
      )}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Valid</th><th>Status</th><th>Rules</th><th>Courses</th><th>Centres</th></tr></thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}><td><a href={`/admin/fees/schemes/${s.id}`}>{s.code}</a></td><td>{s.name}</td><td>{s.validFrom} to {s.validTo}</td>
              <td>{STATUS[s.status]}</td><td>{s.rules}</td><td>{s.courses}</td><td>{s.centres === 0 ? "All" : s.centres}</td></tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No fee schemes yet.</p>}
    </main>
  );
}
