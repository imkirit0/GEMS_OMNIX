"use client";
// The new-enquiry form (enquiry design G1): the same-mobile warnings come back first; "Save anyway" posts the shown ids.
import { useActionState } from "react";
import type { EnquiryFormState } from "@/server/enquiry-form";
import { createEnquiryAction } from "../actions";
import EnquiryFields, { type EnquiryOptions } from "../enquiry-fields";

export default function NewEnquiryForm({ options }: { options: EnquiryOptions }) {
  const [state, action, pending] = useActionState(createEnquiryAction, { values: {}, fieldErrors: {} } as EnquiryFormState);
  return (
    <form action={action} key={JSON.stringify(state)}>
      <EnquiryFields values={state.values} errors={state.fieldErrors} options={options} />
      <button type="submit" disabled={pending}>Save enquiry</button>
      {state.formError && <p role="alert">{state.formError}</p>}
      {state.warnings && (
        <fieldset>
          <legend>Already known with this mobile</legend>
          <ul>
            {state.warnings.map((w) => (
              <li key={w.kind === "enquiry" ? `e${w.id}` : `p${w.personId}`}>
                {w.kind === "enquiry" ? <a href={`/enquiries/${w.id}`}>Enquiry {w.id}</a> : <a href={`/students/${w.personId}`}>Learner</a>}
                {": "}{w.givenName} {w.familyName ?? ""}
              </li>
            ))}
          </ul>
          <button type="submit" name="confirm" value={state.confirm} disabled={pending}>Save anyway: this is a different enquiry</button>
        </fieldset>
      )}
    </form>
  );
}
