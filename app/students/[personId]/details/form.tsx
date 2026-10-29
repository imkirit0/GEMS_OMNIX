"use client";
// The learner-details edit form. Works before hydration (a plain post re-renders the page with the returned state).
import { useActionState } from "react";
import type { DetailsFormState } from "@/server/admission-form";
import DetailsFields from "../../details-fields";
import { saveDetailsAction } from "./actions";

export default function DetailsForm({ initial, countries }: { initial: DetailsFormState; countries: [string, string][] }) {
  const [state, action, pending] = useActionState(saveDetailsAction, initial);
  return (
    // remounted per state, so every input shows the returned values
    <form action={action} key={JSON.stringify(state)}>
      <input type="hidden" name="personId" value={state.personId} />
      <input type="hidden" name="centreId" value={state.centreId} />
      <input type="hidden" name="version" value={state.version} />
      <DetailsFields values={state.values} errors={state.fieldErrors} countries={countries} />
      <button type="submit" disabled={pending}>Save details</button>
      {state.formError && <p role="alert">{state.formError}</p>}
    </form>
  );
}
