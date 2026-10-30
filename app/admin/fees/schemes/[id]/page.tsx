import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { getScheme } from "@/server/schemes";
import { RbacError } from "@/server/rbac";
import { inr } from "@/lib/money";
import { AdminErrors } from "../../../catalogue/admin-errors";
import { FEE_FIELD_LABELS, ID } from "../../labels";

const STATUS: Record<string, string> = { DRAFT: "Draft", LIVE: "Live", RETIRED: "Retired" };

// A fee scheme: rules per fee type and targets. A draft takes edits and Delete (scheme.manage) and Approve (scheme.approve, by
// someone who neither made nor last edited it); a live scheme never changes and can only be retired (fee-schemes DD-1).
// An unknown scheme, or a draft the viewer may not see, is a 404.
export default async function Scheme({ params, searchParams }: { params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, detail, saved } = await searchParams;
  if (!ID.test(id)) notFound();
  const got = await pageRead((s) => getScheme(s, Number(id)).catch((e: unknown) => (e instanceof RbacError && e.reason === "notfound" ? null : Promise.reject(e))));
  if (!got) notFound();
  const { scheme: s, rules, courses, centres, options, manage, approve } = got;
  const draft = s.status === "DRAFT", edit = manage && draft, save = `/admin/fees/schemes/${s.id}/save`;
  const onCourse = new Set(courses.map((c) => c.id)), onCentre = new Set(centres.map((c) => c.id));
  return (
    <main>
      <p><a href="/admin/fees/schemes">Fee schemes</a></p>
      <h1>{s.code} {s.name}</h1>
      <p>{STATUS[s.status]} · valid {s.validFrom} to {s.validTo} · made by {s.createdBy} · last edited by {s.updatedBy}
        {s.approvedBy && <> · approved by {s.approvedBy} on {s.approvedAt}</>}
        {s.retiredBy && <> · retired by {s.retiredBy} on {s.retiredAt}: {s.retiredReason}</>}</p>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={FEE_FIELD_LABELS} />
      <h2>Rules</h2>
      <p>A percentage applies to each instalment. A fixed amount is a total for the fee type, taken from the last instalments first.</p>
      <table>
        <thead><tr><th>Fee type</th><th>Concession</th></tr></thead>
        <tbody>{rules.map((r) => <tr key={r.feeTypeId}><td>{r.feeTypeCode} {r.feeTypeName}</td>
          <td>{r.kind === "PERCENT" ? `${r.value}%` : `${inr(r.value)} in total`}</td></tr>)}</tbody>
      </table>
      {rules.length === 0 && <p>No rules yet.</p>}
      <h2>Courses</h2>
      <p>{courses.length === 0 ? "None yet." : courses.map((c) => c.code).join(", ")}</p>
      <h2>Centres</h2>
      <p>{centres.length === 0 ? "All centres." : centres.map((c) => c.code).join(", ")}</p>
      {edit && (
        <>
          <form method="post" action={save}>
            <h2>Edit</h2>
            <input type="hidden" name="op" value="update" />
            <label>Name <input name="name" defaultValue={s.name} required maxLength={200} /></label>{" "}
            <label>Valid from <input name="validFrom" type="date" defaultValue={s.validFrom} required /></label>{" "}
            <label>Valid to <input name="validTo" type="date" defaultValue={s.validTo} required /></label>{" "}
            <button type="submit">Save</button>
          </form>
          <form method="post" action={save}>
            <h2>Set a rule</h2>
            <input type="hidden" name="op" value="rule" />
            <label>Fee type <select name="feeTypeId" required defaultValue=""><option value="">Choose…</option>
              {options.feeTypes.map((t) => <option key={t.id} value={t.id}>{t.code} {t.name}</option>)}</select></label>{" "}
            <label>Kind <select name="kind" defaultValue="PERCENT"><option value="PERCENT">Percentage</option><option value="AMOUNT">Fixed amount (total)</option></select></label>{" "}
            <label>Value <input name="value" inputMode="decimal" placeholder="empty removes the rule" /></label>{" "}
            <button type="submit">Save</button>
          </form>
          <form method="post" action={save}>
            <h2>Courses</h2>
            <input type="hidden" name="op" value="courses" />
            {options.courses.map((c) => <label key={c.id}><input type="checkbox" name="courseId" value={c.id} defaultChecked={onCourse.has(c.id)} /> {c.code} </label>)}{" "}
            <button type="submit">Save courses</button>
          </form>
          <form method="post" action={save}>
            <h2>Centres (none ticked means all)</h2>
            <input type="hidden" name="op" value="centres" />
            {options.centres.map((c) => <label key={c.id}><input type="checkbox" name="centreId" value={c.id} defaultChecked={onCentre.has(c.id)} /> {c.code} </label>)}{" "}
            <button type="submit">Save centres</button>
          </form>
          <form method="post" action={save}><input type="hidden" name="op" value="delete" /><button type="submit">Delete draft</button></form>
        </>
      )}
      {approve && draft && (
        <form method="post" action={save}><input type="hidden" name="op" value="approve" /><button type="submit">Approve</button></form>
      )}
      {approve && s.status === "LIVE" && (
        <form method="post" action={save}>
          <input type="hidden" name="op" value="retire" />
          <input name="reason" required maxLength={500} placeholder="Reason" aria-label="Reason for retiring" />{" "}
          <button type="submit">Retire</button>
        </form>
      )}
    </main>
  );
}
