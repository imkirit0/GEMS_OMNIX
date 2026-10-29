"use client";
// Contact and family inputs, shared by the admit form and the edit form (learner-details design, Z4). Imports only
// src/server/details.ts (no database code). Every select starts empty, so a stored blank never posts a list value (D4).
import { BLOOD_GROUPS, EMPLOYMENT_STATUSES, QUALIFICATIONS } from "@/server/details";

type Props = { values: Record<string, string>; errors: Record<string, string>; countries: [string, string][] };

export default function DetailsFields({ values, errors, countries }: Props) {
  const v = (k: string) => values[k] ?? ""; // no render fallback: a default comes only from the initial state (R8)
  const err = (k: string) => errors[k] && <span role="alert"> {errors[k]}</span>;
  const row = { display: "block" } as const;
  const text = (k: string, label: string, extra: Record<string, string> = {}) => (
    <label style={row}>{label} <input name={k} defaultValue={v(k)} {...extra} />{err(k)}</label>
  );
  const select = (k: string, label: string, options: [string, string][]) => (
    <label style={row}>{label} <select name={k} defaultValue={v(k)}>
      <option value="" />
      {options.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>{err(k)}</label>
  );
  return (
    <>
      <fieldset>
        <legend>Contact</legend>
        <label style={row}>Current address <textarea name="currentAddress" defaultValue={v("currentAddress")} rows={2} />{err("currentAddress")}</label>
        {text("currentPlace", "Current place")}
        {text("currentPincode", "Current pincode", { inputMode: "numeric" })}
        <label style={row}><input type="checkbox" name="permanentSame" defaultChecked={false} /> Permanent address same as current</label>
        <label style={row}>Permanent address <textarea name="permanentAddress" defaultValue={v("permanentAddress")} rows={2} />{err("permanentAddress")}</label>
        {text("permanentPlace", "Permanent place")}
        {text("permanentPincode", "Permanent pincode", { inputMode: "numeric" })}
        {select("nationality", "Nationality", countries)}
        {select("bloodGroup", "Blood group", BLOOD_GROUPS.map((b) => [b, b]))}
        {select("employmentStatus", "Employment status", Object.entries(EMPLOYMENT_STATUSES))}
        {select("qualification", "Qualification", Object.entries(QUALIFICATIONS))}
      </fieldset>
      <fieldset>
        <legend>Family</legend>
        {text("fatherName", "Father's name")}{text("fatherOccupation", "Father's occupation")}{text("fatherPhone", "Father's phone", { inputMode: "tel" })}
        {text("motherName", "Mother's name")}{text("motherOccupation", "Mother's occupation")}{text("motherPhone", "Mother's phone", { inputMode: "tel" })}
        {text("guardianName", "Guardian's name")}{text("guardianRelation", "Guardian's relation")}
        {text("guardianPhone", "Guardian's phone", { inputMode: "tel" })}{text("guardianOccupation", "Guardian's occupation")}
      </fieldset>
    </>
  );
}
