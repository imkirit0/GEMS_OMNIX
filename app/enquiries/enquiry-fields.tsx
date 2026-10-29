// The enquiry form's inputs, shared by the new and edit forms (enquiry design). Plain markup: rendered inside a client form.
import { QUALIFICATIONS } from "@/server/details";

export type EnquiryOptions = {
  centres: { id: number; code: string; name: string; manage: boolean }[];
  paths: { id: number; name: string }[]; types: { id: number; name: string }[];
  statuses: { id: number; name: string; kind: string }[]; courses: { code: string; name: string }[];
};

export default function EnquiryFields({ values, errors, options, edit }: {
  values: Record<string, string>; errors: Record<string, string>; options: EnquiryOptions; edit?: boolean;
}) {
  const v = (n: string) => values[n] ?? "";
  const err = (n: string) => errors[n] && <span role="alert"> {errors[n]}</span>;
  const row = { display: "block" } as const;
  const text = (name: string, label: string, extra: Record<string, unknown> = {}) => (
    <label style={row}>{label} <input name={name} defaultValue={v(name)} {...extra} />{err(name)}</label>
  );
  return (
    <>
      {!edit && (
        <label style={row}>Centre <select name="centreId" defaultValue={v("centreId") || (options.centres.filter((c) => c.manage).length === 1 ? String(options.centres.find((c) => c.manage)!.id) : "")}>
          <option value="">Choose…</option>
          {options.centres.filter((c) => c.manage).map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
        </select>{err("centreId")}</label>
      )}
      {text("givenName", "Given name", { required: true, maxLength: 100 })}
      {text("familyName", "Family name", { maxLength: 100 })}
      <label style={row}>Date of birth <input type="date" name="dateOfBirth" required defaultValue={v("dateOfBirth")} />{err("dateOfBirth")}</label>
      <label style={row}>Gender <select name="gender" required defaultValue={v("gender")}>
        <option value="" /><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
      </select>{err("gender")}</label>
      {text("mobile", "Mobile", { required: true, inputMode: "tel" })}
      {text("whatsapp", "WhatsApp", { inputMode: "tel" })}
      {text("landline", "Contact number (landline)", { inputMode: "tel" })}
      {text("email", "Email", { type: "email" })}
      <label style={row}>Address <textarea name="currentAddress" defaultValue={v("currentAddress")} rows={2} />{err("currentAddress")}</label>
      {text("currentPincode", "Pincode", { inputMode: "numeric" })}
      <label style={row}>Academic qualification <select name="qualification" defaultValue={v("qualification")}>
        <option value="" />{Object.entries(QUALIFICATIONS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>{err("qualification")}</label>
      {text("lastSchool", "Last studied school or college", { maxLength: 100 })}
      {text("guardianName", "Parent or guardian", { maxLength: 100 })}
      {text("guardianPhone", "Parent or guardian phone", { inputMode: "tel" })}
      {text("instagram", "Instagram ID", { maxLength: 100 })}
      <label style={row}>Enquiry path <select name="pathId" required defaultValue={v("pathId")}>
        <option value="">Choose…</option>{options.paths.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>{err("pathId")}</label>
      <label style={row}>Enquiry type <select name="typeId" required defaultValue={v("typeId")}>
        <option value="">Choose…</option>{options.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>{err("typeId")}</label>
      {!edit && (
        <>
          <label style={row}>Status <select name="statusId" defaultValue={v("statusId")}>
            <option value="">(default)</option>{options.statuses.filter((s) => s.kind === "OPEN").map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>{err("statusId")}</label>
          <label style={row}>Enquiry date <input type="date" name="enquiredOn" defaultValue={v("enquiredOn")} />{err("enquiredOn")}</label>
        </>
      )}
      {[1, 2, 3].map((n) => (
        <label key={n} style={row}>Course preference {n} <select name={`course${n}`} defaultValue={v(`course${n}`)} required={n === 1}>
          <option value="" />{options.courses.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
        </select>{err(`course${n}`)}</label>
      ))}
      <label style={row}>Remark <textarea name="remark" defaultValue={v("remark")} rows={2} />{err("remark")}</label>
    </>
  );
}
