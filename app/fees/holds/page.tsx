import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { heldDues, holdCentres, holdHistory } from "@/server/holds";
import { listFeeTypes } from "@/server/fees";
import { istToday } from "@/server/person-rules";
import { RbacError } from "@/server/rbac";
import { inr } from "@/lib/money";

const ID = /^\d{1,9}$/;

// Fee holds (R-067; docs/designs/fee-holds G4): dues on hold at a centre, filtered by fee type, course and year, and the hold
// and release history for up to 92 days. No fee.hold with student.view anywhere, or a centre outside it: the same 404.
export default async function FeeHolds({ searchParams }: { searchParams: Promise<{ centre?: string; feeType?: string; course?: string; year?: string;
  from?: string; to?: string; kind?: string }> }) {
  const q = await searchParams;
  const centres = await pageRead((s) => holdCentres(s));
  if (centres.length === 0) notFound();
  const centre = q.centre === undefined ? centres[0] : ID.test(q.centre) ? centres.find((c) => c.id === Number(q.centre)) : undefined;
  if (!centre) notFound();
  const today = istToday();
  const from = q.from || today, to = q.to || today, kind = q.kind || "ALL";
  const feeTypeId = q.feeType && ID.test(q.feeType) ? Number(q.feeType) : undefined;
  const [held, types, history] = await pageRead((s) => Promise.all([
    heldDues(s, centre.id, { feeTypeId, courseCode: q.course?.trim().toUpperCase() || undefined, academicYear: q.year || undefined }),
    listFeeTypes(s),
    holdHistory(s, centre.id, from, to, kind).catch((e: unknown) => (e instanceof RbacError && e.reason === "invalid" ? e.message : Promise.reject(e))),
  ]));
  return (
    <main>
      <p><a href="/">Home</a></p>
      <h1>Fee holds</h1>
      <form method="get">
        <label>Centre <select name="centre" defaultValue={centre.id}>{centres.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>{" "}
        <label>Fee type <select name="feeType" defaultValue={feeTypeId ?? ""}><option value="">All</option>
          {types.rows.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{" "}
        <label>Course <input name="course" defaultValue={q.course ?? ""} maxLength={30} /></label>{" "}
        <label>Academic year <input name="year" defaultValue={q.year ?? ""} placeholder="2026-27" maxLength={7} /></label>{" "}
        <button type="submit">Show</button>
      </form>
      <h2>On hold</h2>
      <table>
        <thead><tr><th>Learner</th><th>Course</th><th>Year</th><th>Fee type</th><th>Instalment</th><th>Owed</th><th>Held since</th><th>By</th><th>Reason</th></tr></thead>
        <tbody>
          {held.map((h) => (
            <tr key={h.dueId}><td><a href={`/students/${h.personId}`}>{h.learner}</a></td><td>{h.courseCode}</td><td>{h.academicYear}</td><td>{h.feeTypeName}</td>
              <td>{h.captionName}</td><td>{inr(h.owed)}</td><td>{h.since}</td><td>{h.by}</td><td>{h.reason}</td></tr>
          ))}
        </tbody>
      </table>
      {held.length === 0 && <p>No dues on hold.</p>}
      <h2>History</h2>
      <form method="get">
        <input type="hidden" name="centre" value={centre.id} />
        <label>From <input name="from" type="date" defaultValue={from} /></label>{" "}
        <label>To <input name="to" type="date" defaultValue={to} /></label>{" "}
        <label>Kind <select name="kind" defaultValue={kind}><option value="ALL">All</option><option value="HOLD">Hold</option><option value="RELEASE">Release</option></select></label>{" "}
        <button type="submit">Show</button>
      </form>
      {typeof history === "string" ? <p role="alert">Check the dates: {history.replace(/^\w+: /, "")}.</p> : (
        <table>
          <thead><tr><th>When</th><th>Action</th><th>Learner</th><th>Fee type</th><th>Instalment</th><th>Reason</th><th>By</th></tr></thead>
          <tbody>{history.map((e) => <tr key={e.id}><td>{e.at}</td><td>{e.action === "HOLD" ? "Hold" : "Release"}</td><td>{e.learner}</td>
            <td>{e.feeTypeName}</td><td>{e.captionName}</td><td>{e.reason}</td><td>{e.by}</td></tr>)}</tbody>
        </table>
      )}
    </main>
  );
}
