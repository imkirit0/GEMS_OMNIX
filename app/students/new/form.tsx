"use client";
// The admit form (admission-screens design). Works before hydration: the browser posts it as a plain form and the
// page re-renders with the action's returned state. Values live only in the POST body and that state, never a URL.
import { useActionState } from "react";
import type { AdmitFormState } from "@/server/admission-form";
import { admitAction } from "./actions";

type Options = { centres: { id: number; code: string; name: string }[]; years: { code: string }[];
  courses: { code: string; name: string }[]; today: string };

export default function AdmitForm({ options, initial }: { options: Options; initial: AdmitFormState }) {
  const [state, action, pending] = useActionState(admitAction, initial);
  const v = (name: string, fallback = "") => state.values[name] ?? fallback;
  const err = (name: string) => state.fieldErrors[name] && <span role="alert"> {state.fieldErrors[name]}</span>;
  const row = { display: "block" } as const;
  return (
    // remounted per state, so every input shows the returned values
    <form action={action} key={JSON.stringify(state)}>
      <input type="hidden" name="admissionId" value={state.admissionId} />
      <label style={row}>Centre <select name="centreId" defaultValue={v("centreId", options.centres.length === 1 ? String(options.centres[0]!.id) : "")}>
        <option value="">Choose…</option>
        {options.centres.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}
      </select>{err("centreId")}</label>
      <label style={row}>Academic year <select name="academicYear" defaultValue={v("academicYear")}>
        <option value="">Choose…</option>
        {options.years.map((y) => <option key={y.code} value={y.code}>{y.code}</option>)}
      </select>{err("academicYear")}</label>
      <label style={row}>Admission date <input type="date" name="admittedOn" defaultValue={v("admittedOn", options.today)} />{err("admittedOn")}</label>
      <label style={row}>Given name <input name="givenName" defaultValue={v("givenName")} />{err("givenName")}</label>
      <label style={row}>Family name <input name="familyName" defaultValue={v("familyName")} />{err("familyName")}</label>
      <label style={row}>Gender <select name="gender" defaultValue={v("gender")}>
        <option value="" />
        <option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option>
      </select>{err("gender")}</label>
      <label style={row}>Date of birth <input type="date" name="dateOfBirth" defaultValue={v("dateOfBirth")} />{err("dateOfBirth")}</label>
      <label style={row}>Mobile <input name="mobile" inputMode="tel" defaultValue={v("mobile")} />{err("mobile")}</label>
      <label style={row}>Email <input type="email" name="email" defaultValue={v("email")} />{err("email")}</label>
      {[1, 2, 3].map((n) => (
        <fieldset key={n}>
          <legend>Course {n}</legend>
          <label>Course <select name={`course.${n}.courseCode`} defaultValue={v(`course.${n}.courseCode`)}>
            <option value="" />
            {options.courses.map((c) => <option key={c.code} value={c.code}>{c.code} {c.name}</option>)}
          </select>{err(`course.${n}.courseCode`)}</label>{" "}
          <label>Join date <input type="date" name={`course.${n}.joinDate`} defaultValue={v(`course.${n}.joinDate`)} />{err(`course.${n}.joinDate`)}</label>{" "}
          <label>End date <input type="date" name={`course.${n}.endDate`} defaultValue={v(`course.${n}.endDate`)} />{err(`course.${n}.endDate`)}</label>
        </fieldset>
      ))}
      {/* the first submit button: Enter in a text field submits this one, never a candidate below (design D6) */}
      <button type="submit" disabled={pending}>Admit</button>
      {state.formError && (
        <p role="alert">{state.formError}
          {state.savedPersonId && <> <a href={`/students/${state.savedPersonId}`}>Open the learner</a> · <a href="/students/new">Admit another</a></>}
        </p>
      )}
      {state.candidates && (
        <fieldset>
          <legend>This may be someone already admitted</legend>
          <ul>
            {state.candidates.map((c) => (
              <li key={c.id}>{c.givenName} {c.familyName ?? ""} {c.dateOfBirth ? `(born ${c.dateOfBirth})` : ""}{" "}
                <button type="submit" name="existingId" value={c.id}>Admit this person</button></li>
            ))}
          </ul>
          <button type="submit" name="confirmNew" value={state.candidates.map((c) => c.id).join(",")}>None of these: admit as a new person</button>
        </fieldset>
      )}
    </form>
  );
}
