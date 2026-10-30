import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { getPlan, listCaptions, listFeeTypes } from "@/server/fees";
import { RbacError } from "@/server/rbac";
import { inr } from "@/lib/money";
import { AdminErrors } from "../../../catalogue/admin-errors";
import { FEE_FIELD_LABELS, ID } from "../../labels";

// A fee plan: fee type x instalment grid with totals. A draft takes line edits, Publish and Delete; a published plan
// never changes and offers "New version" (fee-structure DD-3). An unknown or invisible plan is a 404.
export default async function Plan({ params, searchParams }: { params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; detail?: string; saved?: string }> }) {
  const { id } = await params;
  const { error, detail, saved } = await searchParams;
  if (!ID.test(id)) notFound();
  const got = await pageRead((s) => getPlan(s, Number(id)).catch((e: unknown) => (e instanceof RbacError && e.reason === "notfound" ? null : Promise.reject(e))));
  if (!got) notFound();
  const { plan, lines, byCaption, byType, canManage } = got;
  const [types, caps] = await pageRead((s) => Promise.all([listFeeTypes(s), listCaptions(s, plan.academicYear)]));
  const draft = plan.status === "DRAFT", edit = canManage && draft;
  const amount = (t: number, c: number) => lines.find((l) => l.feeTypeId === t && l.captionId === c)?.amount;
  const rowsT = types.rows.filter((t) => t.active || lines.some((l) => l.feeTypeId === t.id));
  const colsC = caps.rows.filter((c) => c.active || lines.some((l) => l.captionId === c.id));
  const save = `/admin/fees/plans/${plan.id}/save`;
  return (
    <main>
      <p><a href="/admin/fees/plans">Fee plans</a></p>
      <h1>{plan.courseCode} {plan.academicYear}, {plan.classCode ? `class ${plan.classCode}` : `centre ${plan.centreCode}`}: version {plan.version}</h1>
      <p>{draft ? "Draft" : `Published ${plan.publishedAt?.slice(0, 10) ?? ""}`} · {plan.currency} · amounts include GST · total {inr(plan.total)}</p>
      {saved && <p role="status">Saved.</p>}
      <AdminErrors error={error} detail={detail} labels={FEE_FIELD_LABELS} />
      <table>
        <thead><tr><th>Fee type</th>{colsC.map((c) => <th key={c.id}>{c.name}<br /><small>{c.dueOn}</small></th>)}<th>Total</th></tr></thead>
        <tbody>
          {rowsT.map((t) => (
            <tr key={t.id}>
              <td>{t.code} {t.name}</td>
              {colsC.map((c) => <td key={c.id}>{amount(t.id, c.id) ? inr(amount(t.id, c.id)!) : ""}</td>)}
              <td>{inr(byType.find((x) => x.feeTypeId === t.id)?.total ?? "0")}</td>
            </tr>
          ))}
          <tr><td>Total</td>{colsC.map((c) => <td key={c.id}>{inr(byCaption.find((x) => x.captionId === c.id)?.total ?? "0")}</td>)}<td>{inr(plan.total)}</td></tr>
        </tbody>
      </table>
      {edit && (
        <>
          <form method="post" action={save}>
            <h2>Set a line</h2>
            <input type="hidden" name="op" value="line" />
            <label>Fee type <select name="feeTypeId" required defaultValue=""><option value="">Choose…</option>
              {types.rows.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.code} {t.name}</option>)}</select></label>{" "}
            <label>Instalment <select name="captionId" required defaultValue=""><option value="">Choose…</option>
              {caps.rows.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.dueOn})</option>)}</select></label>{" "}
            <label>Amount <input name="amount" inputMode="decimal" placeholder="empty removes the line" /></label>{" "}
            <button type="submit">Save</button>
          </form>
          <form method="post" action={save}>
            <input type="hidden" name="op" value="publish" />
            <input name="reason" required placeholder="Reason" aria-label="Reason for publishing" />{" "}
            <button type="submit">Publish</button>
          </form>
          <form method="post" action={save}><input type="hidden" name="op" value="delete" /><button type="submit">Delete draft</button></form>
        </>
      )}
      {canManage && !draft && (
        <form method="post" action={save}><input type="hidden" name="op" value="version" /><button type="submit">New version</button></form>
      )}
    </main>
  );
}
