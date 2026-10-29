"use client";
// Search and list (admission-screens DD-6, DD-13). The first render shows the newest admissions; a search posts.
import { useActionState } from "react";
import type { SearchState } from "@/server/admission-form";
import type { AdmissionRow } from "@/server/people";
import { searchAction } from "./actions";

export default function Search({ rows, centres }: { rows: AdmissionRow[]; centres: { id: number; code: string }[] }) {
  const [state, action, pending] = useActionState(searchAction, { q: "", centreId: "" } as SearchState);
  const shown = state.rows ?? rows;
  return (
    <>
      <form action={action}>
        <label>Admission No, Register No, name or mobile <input name="q" defaultValue={state.q} /></label>{" "}
        <label>Centre <select name="centreId" defaultValue={state.centreId}>
          <option value="">All</option>
          {centres.map((c) => <option key={c.id} value={c.id}>{c.code}</option>)}
        </select></label>{" "}
        <button type="submit" disabled={pending}>Search</button>
      </form>
      {state.rateLimited && <p role="alert">Too many searches. Wait a minute and try again.</p>}
      <table>
        <thead><tr><th>Admission No</th><th>Name</th><th>Centre</th><th>Year</th><th>Admitted on</th></tr></thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.admissionId}>
              <td><a href={`/students/${r.personId}`}>{r.admissionNo}</a></td>
              <td>{r.givenName} {r.familyName ?? ""}</td><td>{r.centreCode}</td><td>{r.academicYear}</td><td>{r.admittedOn}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length === 0 && <p>No admissions to show.</p>}
    </>
  );
}
