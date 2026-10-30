import { pageRead } from "@/server/page-read";
import { listPlans, planOptions } from "@/server/fees";
import { inr } from "@/lib/money";
import { AdminErrors } from "../../catalogue/admin-errors";
import { FEE_FIELD_LABELS } from "../labels";

// Fee plans (R-059): published plans for everyone, drafts for fee.setup; a class plan or a per-centre override.
export default async function Plans({ searchParams }: { searchParams: Promise<{ year?: string; error?: string; detail?: string; saved?: string }> }) {
  const { year, error, detail, saved } = await searchParams;
  const y = year && /^\d{4}-\d{2}$/.test(year) ? year : undefined;
  const [{ rows, canManage }, opts] = await pageRead((s) => Promise.all([listPlans(s, { year: y }), planOptions(s)]));
  const sel = (name: string, label: string, list: { id: number; code: string; name: string }[], required = false) => (
    <label>{label} <select name={name} defaultValue="" required={required}><option value="">{required ? "Choose…" : "—"}</option>
      {list.map((o) => <option key={o.id} value={o.id}>{o.code} {o.name}</option>)}</select></label>
  );
  return (
    <main>
      <p><a href="/admin/fees">Fees</a></p>
      <h1>Fee plans</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={FEE_FIELD_LABELS} />
      {canManage && (
        <form method="post" action="/admin/fees/plans/create">
          <h2>New plan</h2>
          <label>Academic year <select name="academicYear" required defaultValue=""><option value="">Choose…</option>
            {opts.years.map((o) => <option key={o.code} value={o.code}>{o.code}</option>)}</select></label>{" "}
          {sel("courseId", "Course", opts.courses, true)}{" "}
          {sel("centreClassId", "For a centre class", opts.classes)}{" "}
          {sel("centreId", "or for one centre", opts.centres)}{" "}
          <button type="submit">Create</button>
        </form>
      )}
      <table>
        <thead><tr><th>Year</th><th>Course</th><th>For</th><th>Version</th><th>Status</th><th>Lines</th><th>Total</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>{p.academicYear}</td><td><a href={`/admin/fees/plans/${p.id}`}>{p.courseCode}</a></td>
              <td>{p.classCode ? `Class ${p.classCode}` : `Centre ${p.centreCode}`}</td><td>{p.version}</td>
              <td>{p.status === "PUBLISHED" ? "Published" : "Draft"}</td><td>{p.lines}</td><td>{inr(p.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No fee plans yet.</p>}
    </main>
  );
}
