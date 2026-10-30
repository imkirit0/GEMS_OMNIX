import { countryOptions, EMPLOYMENT_STATUSES, QUALIFICATIONS, type DetailKey } from "@/server/details";
import { pageRead } from "@/server/page-read";
import { getPerson } from "@/server/people";
import { duesForPerson } from "@/server/dues";
import { inr } from "@/lib/money";
import { AdminErrors } from "../../admin/catalogue/admin-errors";

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
// Each registration shows its fee dues, or "Create dues" for a fee.dues holder (fee-dues G3).
export default async function Student({ params, searchParams }: { params: Promise<{ personId: string }>;
  searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { personId } = await params;
  const { error, detail, saved } = await searchParams;
  const [{ person: p, admissions, details, editCentreId }, fees] = await pageRead((s) => Promise.all([getPerson(s, personId), duesForPerson(s, personId)]));
  const feesOf = new Map(fees.map((f) => [f.registrationId, f]));
  const countries = new Map(countryOptions());
  const shown = (k: DetailKey, v: string) =>
    k === "nationality" ? countries.get(v) ?? v : k === "employmentStatus" ? EMPLOYMENT_STATUSES[v] ?? v : k === "qualification" ? QUALIFICATIONS[v] ?? v : v;
  return (
    <main>
      <p><a href="/students">All students</a> · <a href="/students/new">Admit a learner</a></p>
      <h1>{p.givenName} {p.familyName ?? ""}</h1>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={{ registrationId: "Course registration", centreId: "Centre" }} />
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
              {a.registrations.map((r) => {
                const f = feesOf.get(r.id);
                return [
                  <tr key={r.id}>
                    <td>{r.courseCode} {r.courseName}</td><td>{r.registerNo}</td><td>{r.status}</td><td>{r.joinDate}</td><td>{r.endDate ?? ""}</td>
                  </tr>,
                  f && (f.dues.length > 0 || f.canCreate) ? (
                    <tr key={`${r.id}-fees`}>
                      <td colSpan={5}>
                        <strong>Fees</strong>
                        {f.dues.length > 0 ? (
                          <table>
                            <thead><tr><th>Fee type</th><th>Instalment</th><th>Due date</th><th>Amount</th></tr></thead>
                            <tbody>
                              {f.dues.map((d) => <tr key={d.id}><td>{d.feeTypeName}</td><td>{d.captionName}</td><td>{d.dueOn}</td><td>{inr(d.gross)}</td></tr>)}
                              <tr><td colSpan={3}>Total</td><td>{inr(f.total!)}</td></tr>
                            </tbody>
                          </table>
                        ) : f.noPlan ? <p>No fee plan for this course yet.</p> : (
                          <form method="post" action={`/students/${p.id}/dues`}>
                            <input type="hidden" name="registrationId" value={r.id} />
                            <button type="submit">Create dues</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
