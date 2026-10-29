import { notFound, redirect } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { batchCentres, listBatches } from "@/server/batches";
import { AdminErrors } from "../admin/catalogue/admin-errors";
import { BATCH_FIELD_LABELS, ID } from "./labels";

// Batches of a centre (R-155): student.view reads; batch.manage adds, edits and (de)activates at an active centre (DD-5).
// A malformed or out-of-scope centre is the same 404 as a missing one.
export default async function Batches({ searchParams }: { searchParams: Promise<{ centre?: string; error?: string; detail?: string; saved?: string }> }) {
  const { centre, error, detail, saved } = await searchParams;
  const centres = await pageRead((s) => batchCentres(s));
  if (centres.length === 0) notFound();
  if (centre === undefined) {
    if (centres.length === 1) redirect(`/batches?centre=${centres[0]!.id}`);
    return (
      <main>
        <p><a href="/">Home</a></p>
        <h1>Batches</h1>
        <ul>{centres.map((c) => <li key={c.id}><a href={`/batches?centre=${c.id}`}>{c.code} {c.name}</a></li>)}</ul>
      </main>
    );
  }
  const c = ID.test(centre) ? centres.find((x) => x.id === Number(centre)) : undefined;
  if (!c) notFound();
  const rows = await pageRead((s) => listBatches(s, c.id));
  const manage = c.canManage && c.active;
  const save = "/batches/save";
  const hidden = (op: string, id?: number) => (<><input type="hidden" name="op" value={op} /><input type="hidden" name="centreId" value={c.id} />
    {id !== undefined && <input type="hidden" name="id" value={id} />}</>);
  return (
    <main>
      <p><a href="/">Home</a>{centres.length > 1 && <> · <a href="/batches">All centres</a></>} · <a href={`/batches/place?centre=${c.id}`}>Place learners</a></p>
      <h1>Batches: {c.code} {c.name}</h1>
      {saved && <p role="status">Saved.</p>}
      {!c.active && <p role="status">This centre is not active.</p>}
      <AdminErrors error={error} detail={detail} labels={BATCH_FIELD_LABELS} />
      {manage && (
        <form method="post" action={save}>
          {hidden("create")}
          <label>Code <input name="code" required maxLength={30} /></label>{" "}
          <label>Name <input name="name" required maxLength={100} /></label>{" "}
          <label>From <input name="startsAt" type="time" required /></label>{" "}
          <label>To <input name="endsAt" type="time" required /></label>{" "}
          <label>Capacity <input name="capacity" type="number" min={1} max={500} required /></label>{" "}
          <button type="submit">Add</button>
        </form>
      )}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Time</th><th>Placed</th><th>Status</th>{manage && <th>Change</th>}</tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>{b.code}</td><td>{b.name}</td><td>{b.startsAt}–{b.endsAt}</td><td>{b.placed} of {b.capacity}</td>
              <td>{b.active ? "Active" : "Inactive"}</td>
              {manage && (
                <td>
                  <form method="post" action={save}>
                    {hidden("update", b.id)}
                    <input name="name" required maxLength={100} defaultValue={b.name} aria-label={`Name of ${b.code}`} />{" "}
                    <input name="startsAt" type="time" required defaultValue={b.startsAt} aria-label={`Start of ${b.code}`} />{" "}
                    <input name="endsAt" type="time" required defaultValue={b.endsAt} aria-label={`End of ${b.code}`} />{" "}
                    <input name="capacity" type="number" min={1} max={500} required defaultValue={b.capacity} aria-label={`Capacity of ${b.code}`} />{" "}
                    <button type="submit">Save</button>
                  </form>
                  <form method="post" action={save}>
                    {hidden("active", b.id)}<input type="hidden" name="active" value={b.active ? "0" : "1"} />
                    <input name="reason" required placeholder="Reason" aria-label={`Reason for ${b.code}`} />{" "}
                    <button type="submit">{b.active ? "Deactivate" : "Activate"}</button>
                  </form>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p>No batches yet.</p>}
    </main>
  );
}
