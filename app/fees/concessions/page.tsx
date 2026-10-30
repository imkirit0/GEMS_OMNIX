import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { concessionCentres, concessionRegister } from "@/server/concessions";
import { listSchemes } from "@/server/schemes";
import { istToday } from "@/server/person-rules";
import { RbacError } from "@/server/rbac";
import { inr } from "@/lib/money";

const ID = /^\d{1,9}$/;

// The concession register (docs/designs/fee-schemes G5): a centre's concessions for up to 92 days, optionally of one scheme, with
// the total. No fee.concession with student.view anywhere, or a centre outside it: the same 404.
export default async function Concessions({ searchParams }: { searchParams: Promise<{ centre?: string; from?: string; to?: string; scheme?: string }> }) {
  const q = await searchParams;
  const centres = await pageRead((s) => concessionCentres(s));
  if (centres.length === 0) notFound();
  const centre = q.centre === undefined ? centres[0] : ID.test(q.centre) ? centres.find((c) => c.id === Number(q.centre)) : undefined;
  if (!centre) notFound();
  const today = istToday();
  const from = q.from || today, to = q.to || today;
  const schemeId = q.scheme && ID.test(q.scheme) ? Number(q.scheme) : undefined;
  const [reg, schemes] = await pageRead((s) => Promise.all([
    concessionRegister(s, centre.id, from, to, schemeId).catch((e: unknown) => (e instanceof RbacError && e.reason === "invalid" ? e.message : Promise.reject(e))),
    listSchemes(s),
  ]));
  return (
    <main>
      <p><a href="/">Home</a></p>
      <h1>Concession register</h1>
      <form method="get">
        <label>Centre <select name="centre" defaultValue={centre.id}>{centres.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>{" "}
        <label>From <input name="from" type="date" defaultValue={from} /></label>{" "}
        <label>To <input name="to" type="date" defaultValue={to} /></label>{" "}
        <label>Scheme <select name="scheme" defaultValue={schemeId ?? ""}><option value="">All</option>
          {schemes.rows.filter((x) => x.status !== "DRAFT").map((x) => <option key={x.id} value={x.id}>{x.code}</option>)}</select></label>{" "}
        <button type="submit">Show</button>
      </form>
      {typeof reg === "string" ? <p role="alert">Check the dates: {reg.replace(/^\w+: /, "")}.</p> : (
        <>
          <table>
            <thead><tr><th>Date</th><th>Learner</th><th>Register No</th><th>Course</th><th>Scheme</th><th>Fee type</th><th>Instalment</th><th>Gross</th><th>Concession</th></tr></thead>
            <tbody>
              {reg.rows.map((r) => (
                <tr key={r.id}><td>{r.givenOn}</td><td><a href={`/students/${r.personId}`}>{r.learner}</a></td><td>{r.registerNo}</td><td>{r.courseCode}</td>
                  <td>{r.schemeCode}</td><td>{r.feeTypeName}</td><td>{r.captionName}</td><td>{inr(r.gross)}</td><td>{inr(r.amount)}</td></tr>
              ))}
              <tr><td colSpan={8}>Total</td><td>{inr(reg.total)}</td></tr>
            </tbody>
          </table>
          {reg.rows.length === 0 && <p>No concessions in this range.</p>}
        </>
      )}
    </main>
  );
}
