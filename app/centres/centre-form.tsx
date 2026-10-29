// The centre form, shared by /centres/new and the edit form on /centres/[id]; its names are centreFields' (C13).
import type { CentreInput, CentreView } from "@/server/centres";
import { RbacError } from "@/server/rbac";

export const CENTRE_FIELD_LABELS: Record<string, string> = {
  code: "Code", name: "Name", areaId: "Area", email: "Email", phone: "Phone", address: "Address", category: "Category",
  gstEnabled: "GST", gstSupply: "GST supply", gstin: "GSTIN", ownership: "Ownership", agreementFrom: "Agreement from",
  agreementTo: "Agreement to", openedOn: "Opened on", reason: "Reason", active: "Status", status: "Status", regionId: "Region",
  id: "Record", op: "Operation", nothing: "Nothing to change",
};

/** Posted fields to the server shape: "" is null, the checkbox is "1", ids are numbers, dates stay strings. */
export function centreFields(f: Record<string, string>): Omit<CentreInput, "code"> {
  const s = (k: string) => (f[k] ?? "") === "" ? null : f[k]!;
  return { name: f["name"] ?? "", areaId: Number(f["areaId"]), email: s("email"), phone: f["phone"] ?? "", address: s("address"),
    category: s("category") as CentreInput["category"], gstEnabled: f["gstEnabled"] === "1", gstSupply: s("gstSupply") as CentreInput["gstSupply"],
    gstin: s("gstin"), ownership: s("ownership") as CentreInput["ownership"], agreementFrom: s("agreementFrom"), agreementTo: s("agreementTo"),
    openedOn: s("openedOn") };
}
export const unknownOp = () => new RbacError("invalid", "op: unknown");

type Area = { id: number; name: string; regionCode: string };
const row = { display: "block" } as const;
const pick = (name: string, label: string, list: readonly (readonly [string, string])[], v: string | null | undefined) => (
  <label style={row}>{label} <select name={name} defaultValue={v ?? ""}><option value="">Not set</option>
    {list.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
);

export function CentreFields({ areas, c }: { areas: Area[]; c?: CentreView }) {
  const text = (name: keyof CentreView, label: string, extra: Record<string, unknown> = {}) => (
    <label style={row}>{label} <input name={name} defaultValue={(c?.[name] as string | null | undefined) ?? ""} {...extra} /></label>
  );
  return (
    <>
      {text("name", "Name", { required: true, maxLength: 200 })}
      <label style={row}>Area <select name="areaId" required defaultValue={c ? String(c.areaId) : ""}><option value="">Choose…</option>
        {areas.map((a) => <option key={a.id} value={a.id}>{a.regionCode} / {a.name}</option>)}</select></label>
      {text("email", "Email", { type: "email", maxLength: 200 })}
      {text("phone", "Phone (10 digits)", { required: true, inputMode: "tel" })}
      <label style={row}>Address <textarea name="address" maxLength={500} rows={3} defaultValue={c?.address ?? ""} /></label>
      {pick("category", "Category", [["SCHOOL", "School"], ["COLLEGE", "College"]], c?.category)}
      {pick("ownership", "Ownership", [["FRANCHISE", "Franchise"], ["OWN", "Own"]], c?.ownership)}
      <label style={row}><input type="checkbox" name="gstEnabled" value="1" defaultChecked={c?.gstEnabled ?? false} /> GST registered</label>
      {pick("gstSupply", "GST supply", [["STATE", "Within the state"], ["INTERSTATE", "Interstate"]], c?.gstSupply)}
      {text("gstin", "GSTIN", { maxLength: 15 })}
      {text("agreementFrom", "Agreement from", { type: "date" })}
      {text("agreementTo", "Agreement to", { type: "date" })}
      {text("openedOn", "Opened on", { type: "date" })}
    </>
  );
}
