"use client";
// The enquiry list (enquiry design G4): GET filters come in as props, the search term only in the POST body (Z5),
// and bulk changes act on the ticked enquiries of the filtered centre (DD-12).
import { useActionState } from "react";
import type { EnquiryRow } from "@/server/enquiry";
import type { EnquirySearchState, RecordFormState } from "@/server/enquiry-form";
import { bulkEnquiriesAction, searchEnquiriesAction } from "./actions";

type Props = { rows: EnquiryRow[]; filter: Record<string, string>; statuses: { id: number; name: string; kind: string }[];
  people: { id: string; displayName: string }[]; canBulk: boolean };

export default function EnquiryList({ rows, filter, statuses, people, canBulk }: Props) {
  const [search, searchAction, searching] = useActionState(searchEnquiriesAction, { q: "" } as EnquirySearchState);
  const [bulk, bulkAction, saving] = useActionState(bulkEnquiriesAction, { fieldErrors: {} } as RecordFormState);
  const shown = search.rows ?? rows;
  return (
    <>
      <form action={searchAction}>
        {Object.entries(filter).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <label>Enquiry No, mobile or name <input name="q" defaultValue={search.q} /></label>{" "}
        <button type="submit" disabled={searching}>Search</button>
      </form>
      {search.rateLimited && <p role="alert">Too many searches. Wait a minute and try again.</p>}
      <form action={bulkAction}>
        <input type="hidden" name="centreId" value={filter["centreId"] ?? ""} />
        <table>
          <thead><tr>{canBulk && <th>Pick</th>}<th>No</th><th>Name</th><th>Centre</th><th>Enquired</th><th>Status</th><th>Counsellor</th><th>Next follow-up</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                {canBulk && <td><input type="checkbox" name="id" value={r.id} aria-label={`Pick enquiry ${r.id}`} /></td>}
                <td><a href={`/enquiries/${r.id}`}>{r.id}</a></td><td>{r.givenName} {r.familyName ?? ""}</td><td>{r.centreCode}</td>
                <td>{r.enquiredOn}</td><td><span style={{ color: r.statusColour }}>{r.statusName}</span></td>
                <td>{r.counsellorName ?? "—"}</td><td>{r.nextFollowUpOn ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p>No enquiries to show.</p>}
        {canBulk && shown.length > 0 && (
          <fieldset>
            <legend>Change the ticked enquiries (up to 100, one centre)</legend>
            <label><input type="radio" name="op" value="status" defaultChecked /> Status</label>{" "}
            <select name="statusId" aria-label="New status">{statuses.filter((s) => s.kind !== "ENROLLED").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{" "}
            <label>Note <input name="note" maxLength={2000} /></label>
            <br />
            <label><input type="radio" name="op" value="counsellor" /> Counsellor</label>{" "}
            <select name="userId" aria-label="New counsellor"><option value="">(none)</option>{people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}</select>
            <br />
            <button type="submit" disabled={saving}>Apply</button>
          </fieldset>
        )}
        {bulk.formError && <p role="alert">{bulk.formError}</p>}
        {Object.entries(bulk.fieldErrors).map(([k, m]) => <p key={k} role="alert">{k}: {m}</p>)}
      </form>
    </>
  );
}
