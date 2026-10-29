import { durationSummary, listCourses } from "@/server/catalogue";
import { pageRead } from "@/server/page-read";

// The course list (R-090; course-master design). Every signed-in user may read it; GET filters, no share.
export default async function Courses({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const p = await searchParams;
  const n = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const f = { categoryId: n(p["categoryId"]), divisionId: n(p["divisionId"]),
    active: p["active"] === "1" ? true : p["active"] === "0" ? false : undefined, q: p["q"] ?? "" };
  const l = await pageRead((s) => listCourses(s, f));
  const code = (list: { id: number; code: string }[], id: number) => list.find((x) => x.id === id)?.code ?? "—";
  return (
    <main>
      <p><a href="/">Home</a></p>
      <h1>Courses</h1>
      {l.canManage && <p><a href="/admin/catalogue/courses/new">New course</a></p>}
      <form method="get">
        <label>Category <select name="categoryId" defaultValue={p["categoryId"] ?? ""}><option value="">All</option>
          {l.categories.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>{" "}
        <label>Division <select name="divisionId" defaultValue={p["divisionId"] ?? ""}><option value="">All</option>
          {l.divisions.map((d) => <option key={d.id} value={d.id}>{d.code} {d.name}</option>)}</select></label>{" "}
        <label>Status <select name="active" defaultValue={p["active"] ?? ""}><option value="">All</option>
          <option value="1">Active</option><option value="0">Inactive</option></select></label>{" "}
        <label>Search <input name="q" defaultValue={f.q} /></label>{" "}
        <button type="submit">Filter</button>
      </form>
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Display name</th><th>Category</th><th>Division</th><th>Duration</th>
          <th>Centre classes</th><th>Offered</th><th>Status</th></tr></thead>
        <tbody>
          {l.courses.map((c) => (
            <tr key={c.id}>
              <td><a href={`/admin/catalogue/courses/${c.id}`}>{c.code}</a></td><td>{c.name}</td><td>{c.displayName ?? ""}</td>
              <td>{code(l.categories, c.categoryId)}</td><td>{code(l.divisions, c.divisionId)}</td><td>{durationSummary(c)}</td>
              <td>{c.classes.join(", ")}</td><td>{c.visible ? "Yes" : "No"}</td><td>{c.active ? "Active" : "Inactive"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {l.courses.length === 0 && <p>No courses.</p>}
    </main>
  );
}
