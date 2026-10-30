import { notFound } from "next/navigation";
import { pageRead } from "@/server/page-read";
import { getReceipt } from "@/server/receipts";
import { RbacError } from "@/server/rbac";
import { inr } from "@/lib/money";

// A printable fee receipt (docs/designs/fee-receipts G4): the database's number, date and GST lines. Unseen, missing or
// malformed ids are the same 404.
export default async function Receipt({ params, searchParams }: { params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; replay?: string }> }) {
  const { id } = await params;
  const { saved, replay } = await searchParams;
  const r = await pageRead((s) => getReceipt(s, id).catch((e: unknown) => (e instanceof RbacError && e.reason === "notfound" ? null : Promise.reject(e))));
  if (!r) notFound();
  const taxed = r.lines.some((l) => l.taxable !== l.amount);
  return (
    <main>
      <p><a href={`/students/${r.personId}`}>Back to the learner</a></p>
      {saved && <p role="status">Saved.</p>}
      {replay && <p role="status">Duplicate submission: this receipt was already recorded.</p>}
      <h1>Fee receipt {r.receiptNo}</h1>
      <p>{r.centreName} ({r.centreCode}){r.gstin ? ` · GSTIN ${r.gstin}` : ""}</p>
      <p>Date {r.receivedOn} · {r.learner} · {r.courseCode} {r.courseName} · Register No {r.registerNo}</p>
      <p>Mode {r.mode}{r.reference ? ` · Reference ${r.reference}` : ""}{r.instrumentDate ? ` · Dated ${r.instrumentDate}` : ""}
        {r.status !== "ACTIVE" ? ` · ${r.status}` : ""}</p>
      <table>
        <thead><tr><th>Fee type</th><th>Instalment</th><th>HSN/SAC</th>{taxed && <><th>Rate %</th><th>Taxable</th><th>CGST</th><th>SGST</th><th>IGST</th></>}<th>Amount</th></tr></thead>
        <tbody>
          {r.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.feeTypeName}</td><td>{l.captionName}</td><td>{l.hsnSac}</td>
              {taxed && <><td>{l.gstRate}</td><td>{inr(l.taxable)}</td><td>{inr(l.cgst)}</td><td>{inr(l.sgst)}</td><td>{inr(l.igst)}</td></>}
              <td>{inr(l.amount)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3}>Total</td>
            {taxed && <><td></td><td>{inr(r.totals.taxable)}</td><td>{inr(r.totals.cgst)}</td><td>{inr(r.totals.sgst)}</td><td>{inr(r.totals.igst)}</td></>}
            <td>{inr(r.total)}</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
