import { notFound, redirect } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { currentUser } from "@/server/auth/session";
import { listCalls } from "@/server/call-log";
import { enquiryCounsellors, enquiryOptions } from "@/server/enquiry";
import { AdminErrors } from "../admin/catalogue/admin-errors";
import { CALL_FIELD_LABELS, CALL_TYPES, ID } from "./labels";

type Params = { centre?: string; from?: string; to?: string; type?: string; due?: string; error?: string; detail?: string; saved?: string };

// Phone call log (R-084): enquiry.view reads a centre's calls; enquiry.manage logs them at an active centre (DD-2).
// Filters are dates and type only: no personal data in URLs. A malformed or out-of-scope centre is a 404 (D9).
export default async function Calls({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const { centres } = await pageRead((s) => enquiryOptions(s));
  if (p.centre === undefined) {
    if (centres.length === 1) redirect(`/calls?centre=${centres[0]!.id}`);
    return (
      <main>
        <p><a href="/">Home</a></p>
        <h1>Calls</h1>
        <ul>{centres.map((c) => <li key={c.id}><a href={`/calls?centre=${c.id}`}>{c.code} {c.name}</a></li>)}</ul>
      </main>
    );
  }
  const c = ID.test(p.centre) ? centres.find((x) => x.id === Number(p.centre)) : undefined;
  if (!c) notFound();
  const log = c.manage && c.active;
  const [list, callers, me] = await pageRead((s) => Promise.all([
    listCalls(s, c.id, { from: p.from, to: p.to, callType: p.type, dueBy: p.due }),
    log ? enquiryCounsellors(s, c.id) : Promise.resolve([]),
    currentUser(),
  ]));
  const field = { display: "block" } as const;
  return (
    <main>
      <p><a href="/">Home</a> · <a href="/enquiries">Enquiries</a>{log && <> · <a href="/enquiries/new">New enquiry</a></>}</p>
      <h1>Calls: {c.code} {c.name}</h1>
      {p.saved && <p role="status">Saved.</p>}
      {!c.active && <p role="status">This centre is not active.</p>}
      <AdminErrors error={p.error} detail={p.detail} labels={CALL_FIELD_LABELS} />
      {log && (
        <form method="post" action="/calls/save">
          <h2>Log a call</h2>
          <input type="hidden" name="centreId" value={c.id} />
          <label style={field}>Phone <input name="phone" required inputMode="tel" /></label>
          <label style={field}>Name <input name="name" maxLength={100} /></label>
          <label style={field}>Date <input name="calledOn" type="date" /></label>
          <label style={field}>Call type <select name="callType" required defaultValue="CALL_IN">
            {Object.entries(CALL_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label style={field}>Duration (minutes) <input name="durationMin" type="number" min={0} max={600} /></label>
          <label style={field}>Description <textarea name="description" maxLength={1000} rows={2} /></label>
          <label style={field}>Note <textarea name="note" maxLength={1000} rows={2} /></label>
          <label style={field}>Next follow-up <input name="nextFollowUpOn" type="date" /></label>
          <label style={field}>Tele-caller <select name="teleCaller" defaultValue={callers.some((u) => u.id === me?.userId) ? me!.userId : ""}>
            <option value="">None</option>
            {callers.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></label>
          <button type="submit">Save</button>
        </form>
      )}
      <form method="get">
        <h2>Calls</h2>
        <input type="hidden" name="centre" value={c.id} />
        <label>From <input name="from" type="date" defaultValue={p.from ?? ""} /></label>{" "}
        <label>To <input name="to" type="date" defaultValue={p.to ?? ""} /></label>{" "}
        <label>Type <select name="type" defaultValue={p.type ?? ""}><option value="">All</option>
          {Object.entries(CALL_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>{" "}
        <label>Follow-up due by <input name="due" type="date" defaultValue={p.due ?? ""} /></label>{" "}
        <button type="submit">Show</button>
      </form>
      <table>
        <thead><tr><th>Date</th><th>Phone</th><th>Name</th><th>Type</th><th>Minutes</th><th>Next follow-up</th><th>Description</th></tr></thead>
        <tbody>
          {list.rows.map((r) => (
            <tr key={r.id}>
              <td>{r.calledOn}</td><td>{r.phone}</td><td>{r.name ?? ""}</td><td>{CALL_TYPES[r.callType]}</td><td>{r.durationMin ?? ""}</td>
              <td>{r.nextFollowUpOn ?? ""}</td><td style={{ whiteSpace: "pre-line" }}>{r.description ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.rows.length === 0 && <p>No calls to show.</p>}
      {list.truncated && <p>Only the latest 200 are shown; narrow the dates to see older calls.</p>}
    </main>
  );
}
