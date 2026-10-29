import { countryOptions, EMPLOYMENT_STATUSES, QUALIFICATIONS, type DetailKey } from "@/server/details";
import { pageRead } from "@/server/page-read";
import { getPerson } from "@/server/people";

const LABELS: [DetailKey, string][] = [["currentAddress", "Current address"], ["currentPlace", "Current place"],
  ["currentPincode", "Current pincode"], ["permanentAddress", "Permanent address"], ["permanentPlace", "Permanent place"],
  ["permanentPincode", "Permanent pincode"], ["nationality", "Nationality"], ["bloodGroup", "Blood group"],
  ["employmentStatus", "Employment status"], ["qualification", "Qualification"], ["fatherName", "Father's name"],
  ["fatherOccupation", "Father's occupation"], ["fatherPhone", "Father's phone"], ["motherName", "Mother's name"],
  ["motherOccupation", "Mother's occupation"], ["motherPhone", "Mother's phone"], ["guardianName", "Guardian's name"],
  ["guardianRelation", "Guardian's relation"], ["guardianPhone", "Guardian's phone"], ["guardianOccupation", "Guardian's occupation"]];

// A learner as the viewer may see them: identity, details, then each admission in their student.view scope.
// Malformed, missing or out-of-scope ids: the same 404 (T-SEC-001). Identity is corrected by ticket only (admission-screens
// DD-5); contact and family details are edited directly by a student.admit holder where the learner is admitted (learner-details DD-10).
export default async function Student({ params }: { params: Promise<{ personId: string }> }) {
  const { personId } = await params;
  const { person: p, admissions, details, editCentreId } = await pageRead((s) => getPerson(s, personId));
  const countries = new Map(countryOptions());
  const shown = (k: DetailKey, v: string) =>
    k === "nationality" ? countries.get(v) ?? v : k === "employmentStatus" ? EMPLOYMENT_STATUSES[v] ?? v : k === "qualification" ? QUALIFICATIONS[v] ?? v : v;
  return (
    <main>
      <p><a href="/students">All students</a> · <a href="/students/new">Admit a learner</a></p>
      <h1>{p.givenName} {p.familyName ?? ""}</h1>
      <p>Gender {p.gender ?? "not given"} · Born {p.dateOfBirth ?? "not given"} · Mobile {p.mobile ?? "not given"} · Email {p.email ?? "not given"}</p>
      <section>
        <h2>Contact and family</h2>
        {details ? (
          <dl>
            {LABELS.filter(([k]) => details[k] != null).map(([k, label]) => (
              <div key={k}><dt>{label}</dt><dd style={{ whiteSpace: "pre-line" }}>{shown(k, details[k]!)}</dd></div>
            ))}
          </dl>
        ) : <p>No details recorded.</p>}
        {editCentreId !== null && <p><a href={`/students/${p.id}/details`}>Edit details</a></p>}
      </section>
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
