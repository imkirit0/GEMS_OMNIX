import { pageRead } from "@/server/page-read";
import { listAdmissions } from "@/server/people";
import Search from "./search";

// Admissions at centres in the viewer's student.view scope (R-001, R-229). No such scope: 404.
// The page takes no URL parameters: search terms travel only in the search action's POST body (DD-13).
export default async function Students() {
  const rows = await pageRead((s) => listAdmissions(s));
  const centres = [...new Map(rows.map((r) => [r.centreId, { id: r.centreId, code: r.centreCode }])).values()]
    .sort((a, b) => a.code.localeCompare(b.code));
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/students/new">Admit a learner</a></p>
      <h1>Students</h1>
      <Search rows={rows} centres={centres} />
    </main>
  );
}
