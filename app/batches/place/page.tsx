import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { batchCentres, listBatches, listPlacements, placementCourses } from "@/server/batches";
import { AdminErrors } from "../../admin/catalogue/admin-errors";
import { BATCH_FIELD_LABELS, ID } from "../labels";

type Params = { centre?: string; course?: string; batch?: string; error?: string; detail?: string; saved?: string };

// Place learners (R-155 Timeslot Updation): a course's ACTIVE registrations at a centre, each with its batch; batch.manage
// moves them at an active centre (DD-5, R13). An unknown centre, course or batch is the same 404 as a missing page (D11).
export default async function Place({ searchParams }: { searchParams: Promise<Params> }) {
  const p = await searchParams;
  const { centre, error, detail, saved } = p;
  const course = p.course || undefined, batch = p.batch || undefined; // the GET form posts "Any" as ""
  const centres = await pageRead((s) => batchCentres(s));
  const c = centre !== undefined && ID.test(centre) ? centres.find((x) => x.id === Number(centre)) : undefined;
  if (!c) notFound();
  const [courses, batches] = await pageRead((s) => Promise.all([placementCourses(s, c.id), listBatches(s, c.id)]));
  if (course !== undefined && !courses.some((x) => x.code === course)) notFound();
  const filter = batch === undefined ? undefined : ID.test(batch) ? batches.find((b) => b.id === Number(batch)) : undefined;
  if (batch !== undefined && !filter) notFound();
  const list = course === undefined ? null : await pageRead((s) => listPlacements(s, c.id, course, filter?.id));
  const manage = c.canManage && c.active;
  const table = list && (
    <>
      <table>
        <thead><tr>{manage && <th>Pick</th>}<th>Learner</th><th>Admission No</th><th>Reg No</th><th>Batch</th></tr></thead>
        <tbody>
          {list.rows.map((r) => (
            <tr key={r.registrationId}>
              {manage && <td><input type="checkbox" name="registrationId" value={r.registrationId} aria-label={`Pick ${r.registerNo}`} /></td>}
              <td>{r.givenName} {r.familyName ?? ""}</td><td>{r.admissionNo}</td><td>{r.registerNo}</td><td>{r.batchCode ?? "None"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.rows.length === 0 && <p>No active learners on this course.</p>}
      {list.truncated && <p>Only the first 500 are shown; filter by batch to see the rest.</p>}
    </>
  );
  return (
    <main>
      <p><a href={`/batches?centre=${c.id}`}>Batches of {c.code}</a></p>
      <h1>Place learners: {c.code} {c.name}</h1>
      {saved && <p role="status">Saved.</p>}
      {!c.active && <p role="status">This centre is not active.</p>}
      <AdminErrors error={error} detail={detail} labels={BATCH_FIELD_LABELS} />
      <form method="get">
        <input type="hidden" name="centre" value={c.id} />
        <label>Course <select name="course" defaultValue={course ?? ""} required><option value="">Choose…</option>
          {courses.map((x) => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}</select></label>{" "}
        <label>Batch <select name="batch" defaultValue={filter ? String(filter.id) : ""}><option value="">Any</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.code} ({b.startsAt}–{b.endsAt})</option>)}</select></label>{" "}
        <button type="submit">Show</button>
      </form>
      {list && !manage && table}
      {list && manage && (
        <form method="post" action="/batches/place/save">
          <input type="hidden" name="centreId" value={c.id} /><input type="hidden" name="course" value={course} />
          <input type="hidden" name="filterBatch" value={filter ? String(filter.id) : ""} />
          {table}
          {list.rows.length > 0 && (
            <p>
              <label>Move the picked learners to <select name="batchId" defaultValue=""><option value="">No batch</option>
                {batches.filter((b) => b.active).map((b) => <option key={b.id} value={b.id}>{b.code} ({b.placed} of {b.capacity})</option>)}</select></label>{" "}
              <button type="submit">Save</button>
            </p>
          )}
        </form>
      )}
    </main>
  );
}
