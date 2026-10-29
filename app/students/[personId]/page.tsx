import { pageRead } from "@/server/page-read";
import { getPerson } from "@/server/people";

// A learner as the viewer may see them: identity, then each admission in their student.view scope.
// Malformed, missing or out-of-scope ids: the same 404 (T-SEC-001). No edits here (DD-5).
export default async function Student({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const { person: p, admissions } = await pageRead((s) => getPerson(s, personId));
  return (
    <main>
      <p><a href="/students">All students</a> · <a href="/students/new">Admit a learner</a></p>
      <h1>{p.givenName} {p.familyName ?? ""}</h1>
      <p>Gender {p.gender ?? "not given"} · Born {p.dateOfBirth ?? "not given"} · Mobile {p.mobile ?? "not given"} · Email {p.email ?? "not given"}</p>
      {admissions.map((a) => (
        <section key={a.id}>
          <h2>{a.admissionNo}</h2>
          <p>Centre {a.centreCode} · Academic year {a.academicYear} · Admitted on {a.admittedOn}</p>
          <table>
            <thead><tr><th>Course</th><th>Register No</th><th>Status</th><th>Join date</th><th>End date</th></tr></thead>
            <tbody>
              {a.registrations.map((r) => (
                <tr key={r.id}>
                  <td>{r.courseCode} {r.courseName}</td><td>{r.registerNo}</td><td>{r.status}</td><td>{r.joinDate}</td><td>{r.endDate ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
